/**
 * Per-blog-post backfill helper. Extends the existing schema rebuild
 * with an opt-in AI-tell sanitizer pass on the body and a generic
 * date-modified bump.
 */

import { getCollectionItem, patchCollectionItem, loadBlogReferenceLookups } from '@/lib/webflow'
import { buildBlogSchemaAdditions, buildHreflangBlock } from '@/lib/blog-schema'
import { buildSchemaInputForPost, type BlogPostFields } from '@/lib/blog-schema-input'
import { sanitizeAiTells } from '@/lib/ai-tell-sanitizer'
import { validateJsonLd } from '@/lib/schema-validate'

export interface PostBackfillOptions {
  dryRun?: boolean
  rewriteBody?: boolean
}

export interface PostBackfillResult {
  itemId: string
  slug: string
  title: string
  schemaCharsBefore: number
  schemaCharsAfter: number
  schemaValidBefore: boolean
  schemaValidAfter: boolean
  schemaErrorsBefore: number
  schemaErrorsAfter: number
  bodyChanged: boolean
  bodyChangesCount: number
  patched: boolean
  patchedFields: string[]
  skippedFields: string[]
  hreflangWritten: boolean
}

export async function backfillPost(
  collectionId: string,
  itemId: string,
  opts: PostBackfillOptions = {},
): Promise<PostBackfillResult> {
  const item = await getCollectionItem(collectionId, itemId)
  const f = item.fieldData as BlogPostFields
  const slug = f.slug ?? ''
  const title = (f as { name?: string }).name ?? '(untitled)'
  const postUrl = `https://www.tahi.studio/blog/${slug}`

  const schemaBefore = ((f as { schema?: string }).schema) ?? ''
  const validationBefore = validateJsonLd(schemaBefore)

  // Body sanitiser (opt-in). Webflow's `post-body` is rich text HTML.
  const bodyHtml = (f as { 'post-body'?: string })['post-body'] ?? ''
  let newBodyHtml = bodyHtml
  let bodyChangesCount = 0
  if (opts.rewriteBody && bodyHtml) {
    const result = sanitizeAiTells(bodyHtml)
    newBodyHtml = result.markdown
    bodyChangesCount = result.totalChanges
  }
  const bodyChanged = newBodyHtml !== bodyHtml

  // Build fresh schema from current state.
  const refs = await loadBlogReferenceLookups().catch(() => null)
  const input = buildSchemaInputForPost(f, postUrl, refs?.categoryNameById)
  const { jsonLdString } = buildBlogSchemaAdditions(input)
  const hreflang = buildHreflangBlock(postUrl)
  const validationAfter = validateJsonLd(jsonLdString)

  const patchedFields: string[] = []
  const skippedFields: string[] = []
  let patched = false
  let hreflangWritten = false

  if (!opts.dryRun) {
    try {
      await patchCollectionItem(collectionId, itemId, { schema: jsonLdString })
      patchedFields.push('schema')
      patched = true
    } catch (err) {
      skippedFields.push(`schema: ${err instanceof Error ? err.message.slice(0, 100) : 'fail'}`)
    }
    try {
      await patchCollectionItem(collectionId, itemId, { 'hreflang-block': hreflang })
      patchedFields.push('hreflang-block')
      hreflangWritten = true
    } catch (err) {
      skippedFields.push(`hreflang-block: ${err instanceof Error ? err.message.slice(0, 60) : 'fail'}`)
    }
    if (opts.rewriteBody && bodyChanged) {
      try {
        await patchCollectionItem(collectionId, itemId, { 'post-body': newBodyHtml })
        patchedFields.push('post-body')
      } catch (err) {
        skippedFields.push(`post-body: ${err instanceof Error ? err.message.slice(0, 60) : 'fail'}`)
      }
    }
  }

  return {
    itemId, slug, title,
    schemaCharsBefore: schemaBefore.length,
    schemaCharsAfter: jsonLdString.length,
    schemaValidBefore: validationBefore.valid,
    schemaValidAfter: validationAfter.valid,
    schemaErrorsBefore: validationBefore.errors.length,
    schemaErrorsAfter: validationAfter.errors.length,
    bodyChanged,
    bodyChangesCount,
    patched,
    patchedFields,
    skippedFields,
    hreflangWritten,
  }
}
