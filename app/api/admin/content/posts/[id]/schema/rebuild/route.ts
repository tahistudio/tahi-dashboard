/**
 * POST /api/admin/content/posts/[id]/schema/rebuild
 *
 * Rebuilds the agent-generated JSON-LD additions for a single Webflow
 * blog post and writes the result to the post's `schema` CMS field.
 * Edit is STAGED — Webflow won't surface it until the next publish.
 *
 * Layered on top of the existing SchemaFlow output (don't replace
 * SchemaFlow yet — Webflow renders both, Google merges them).
 *
 * NOTE (Liam action): the Webflow Blog Posts collection needs a new
 * field "Hreflang block" (Plain text long, slug `hreflang-block`).
 * Once added, this route also patches that field. Until then the
 * hreflang patch is skipped silently — the schema patch still lands.
 *
 * Contract:
 *   POST /api/admin/content/posts/{webflowItemId}/schema/rebuild
 *   200: { jsonLd, charsWritten, postUrl, hreflangWritten }
 *   404: { error } when item not found in Webflow
 *   500: { error } on Webflow API failure
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCollectionItem, patchCollectionItem, loadBlogReferenceLookups } from '@/lib/webflow'
import { buildBlogSchemaAdditions, buildHreflangBlock } from '@/lib/blog-schema'
import {
  buildSchemaInputForPost,
  type BlogPostFields,
} from '@/lib/blog-schema-input'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Post id is required' }, { status: 400 })
  }

  try {
    const item = await getCollectionItem(BLOG_POSTS_COLLECTION_ID, id)
    const f = item.fieldData as BlogPostFields
    const slug = f.slug ?? ''
    const postUrl = `https://www.tahi.studio/blog/${slug}`

    const refs = await loadBlogReferenceLookups().catch(() => null)
    const input = buildSchemaInputForPost(f, postUrl, refs?.categoryNameById)
    const { jsonLdString } = buildBlogSchemaAdditions(input)
    const hreflang = buildHreflangBlock(postUrl)

    // Always patch the schema field. hreflang-block is patched best-
    // effort; if Liam hasn't added the field yet Webflow returns 400 on
    // unknown fields, so we patch in two calls to keep schema safe.
    await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, id, { schema: jsonLdString })

    let hreflangWritten = false
    try {
      await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, id, { 'hreflang-block': hreflang })
      hreflangWritten = true
    } catch (err) {
      console.warn(
        'hreflang-block patch failed (field probably not yet added to Webflow)',
        err instanceof Error ? err.message : String(err),
      )
    }

    return NextResponse.json({
      jsonLd: jsonLdString,
      charsWritten: jsonLdString.length,
      postUrl,
      hreflangWritten,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/404/.test(msg)) {
      return NextResponse.json({ error: 'Post not found in Webflow' }, { status: 404 })
    }
    console.error('schema rebuild failed', msg)
    return NextResponse.json({
      error: 'Failed to rebuild post schema',
      detail: msg.slice(0, 300),
    }, { status: 500 })
  }
}
