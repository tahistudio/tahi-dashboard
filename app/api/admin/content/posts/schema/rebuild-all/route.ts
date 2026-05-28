/**
 * POST /api/admin/content/posts/schema/rebuild-all
 *
 * Bulk-rebuilds the agent-generated JSON-LD additions for every item
 * in the Webflow Blog Posts collection. Patches are STAGED — this route
 * does NOT auto-publish. Liam batch-publishes from the Webflow Editor
 * or via the publish route Slice 5 ships.
 *
 * Concurrency is capped at 5 simultaneous Webflow calls so we don't
 * trip the v2 Data API's 60 req/min limit. With ~57 posts a full pass
 * runs in roughly 25-40s including the get + 1-2 patch calls per item.
 *
 * NOTE (Liam action): the Webflow Blog Posts collection needs a new
 * field "Hreflang block" (Plain text long, slug `hreflang-block`).
 * Until that field exists each item's hreflang patch will silently
 * fail (logged) — the schema patch still lands.
 *
 * Contract:
 *   POST body: { itemIds?: string[] }   // optional subset, else all items
 *   200: {
 *     attempted: number,
 *     succeeded: number,
 *     failed: number,
 *     hreflangWritten: number,
 *     results: Array<{ id: string; slug?: string; ok: boolean; charsWritten?: number; error?: string }>,
 *     completedAt: string,
 *   }
 *   500: { error } on top-level failure (e.g. listing the collection)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import {
  getCollectionItem,
  listCollectionItems,
  patchCollectionItem,
  loadBlogReferenceLookups,
} from '@/lib/webflow'
import { buildBlogSchemaAdditions, buildHreflangBlock } from '@/lib/blog-schema'
import {
  buildSchemaInputForPost,
  type BlogPostFields,
} from '@/lib/blog-schema-input'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'
const CONCURRENCY = 5
const WEBFLOW_PAGE_SIZE = 100

interface ItemResult {
  id: string
  slug?: string
  ok: boolean
  charsWritten?: number
  hreflangWritten?: boolean
  error?: string
}

async function listAllItemIds(): Promise<string[]> {
  const ids: string[] = []
  let offset = 0
  // Loop until Webflow returns fewer items than the page size.
  // Safety cap at 10 pages (1000 items) — Tahi has ~57 posts today.
  for (let i = 0; i < 10; i++) {
    const { items, total } = await listCollectionItems(BLOG_POSTS_COLLECTION_ID, {
      limit: WEBFLOW_PAGE_SIZE,
      offset,
    })
    for (const it of items) ids.push(it.id)
    if (items.length < WEBFLOW_PAGE_SIZE) break
    offset += items.length
    if (offset >= total) break
  }
  return ids
}

async function rebuildOne(id: string): Promise<ItemResult> {
  try {
    const item = await getCollectionItem(BLOG_POSTS_COLLECTION_ID, id)
    const f = item.fieldData as BlogPostFields
    const slug = f.slug ?? ''
    const postUrl = `https://www.tahi.studio/blog/${slug}`

    const refs = await loadBlogReferenceLookups().catch(() => null)
    const input = buildSchemaInputForPost(f, postUrl, refs?.categoryNameById)
    const { jsonLdString } = buildBlogSchemaAdditions(input)
    const hreflang = buildHreflangBlock(postUrl)

    await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, id, { schema: jsonLdString })

    let hreflangWritten = false
    try {
      await patchCollectionItem(BLOG_POSTS_COLLECTION_ID, id, { 'hreflang-block': hreflang })
      hreflangWritten = true
    } catch (err) {
      console.warn(
        `hreflang-block patch failed for ${id} (field probably not yet added)`,
        err instanceof Error ? err.message : String(err),
      )
    }

    return {
      id,
      slug,
      ok: true,
      charsWritten: jsonLdString.length,
      hreflangWritten,
    }
  } catch (err) {
    return {
      id,
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    }
  }
}

/**
 * Run `work` over `items` with a fixed concurrency. Returns results in
 * the same order as `items`. No external dependency — a simple worker-
 * pool over an index counter.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await worker(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { itemIds?: string[] }

  let ids: string[]
  try {
    if (Array.isArray(body.itemIds) && body.itemIds.length > 0) {
      ids = body.itemIds.filter(s => typeof s === 'string' && s.length > 0)
    } else {
      ids = await listAllItemIds()
    }
  } catch (err) {
    console.error('rebuild-all: failed to list items', err)
    return NextResponse.json({
      error: 'Failed to list Webflow collection items',
      detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
    }, { status: 500 })
  }

  const results = await runWithConcurrency(ids, rebuildOne, CONCURRENCY)

  const succeeded = results.filter(r => r.ok).length
  const failed = results.length - succeeded
  const hreflangWritten = results.filter(r => r.ok && r.hreflangWritten).length

  return NextResponse.json({
    attempted: results.length,
    succeeded,
    failed,
    hreflangWritten,
    results,
    completedAt: new Date().toISOString(),
  })
}
