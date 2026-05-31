/**
 * Shared glossary backfill helpers — used by the per-item route and
 * the bulk runner. Keeps the per-item logic in one place so the bulk
 * version is just a loop with rate-limiting.
 */

import { getCollectionItem, patchCollectionItem, loadBlogReferenceLookups } from '@/lib/webflow'
import { buildGlossarySchema, extractFaqsFromGlossaryBody } from '@/lib/glossary-schema'
import { sanitizeAiTells } from '@/lib/ai-tell-sanitizer'
import { validateJsonLd } from '@/lib/schema-validate'

const TAHI_BASE = 'https://www.tahi.studio'

/** Field shape verified via /glossary/inspect on 2026-05-31.
 *  Actual collection has 19 fields — these are the ones we read. */
interface GlossaryFields {
  name?: string
  slug?: string
  schema?: string
  body?: string                   // rich text — the actual body (not post-body)
  description?: string            // the 40-60 word snippet definition (single source — `definition` field was removed)
  'also-known-as'?: string
  'primary-category'?: string     // Reference: Category item id
  'related-categories'?: string[]
  author?: string                 // Reference: Team Members item id
  'related-terms'?: string[]
  'related-posts'?: string[]
  'common-mistakes'?: string
  'external-sources'?: string
  'meta-title'?: string
  'meta-description-2'?: string
  difficulty?: string
  [k: string]: unknown
}

function htmlToPseudoMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export interface GlossaryBackfillOptions {
  /** If true, compute changes but do NOT patch Webflow. Returns the
   *  diff so the caller can review before approving. */
  dryRun?: boolean
  /** If true, run the AI-tell sanitizer over body content. Default
   *  false — schema-only backfills are safe; body rewrites need
   *  explicit opt-in because they mutate live content. */
  rewriteBody?: boolean
  /** Optional override of the author slug. When omitted, falls back to
   *  the existing Webflow `author-slug` field, then 'liam'. */
  authorSlug?: 'liam' | 'staci'
}

export interface GlossaryBackfillResult {
  itemId: string
  slug: string
  term: string
  schemaCharsBefore: number
  schemaCharsAfter: number
  schemaValidBefore: boolean
  schemaValidAfter: boolean
  schemaErrorsBefore: number
  schemaErrorsAfter: number
  faqsDetected: number
  bodyChanged: boolean
  bodyChangesCount: number
  patched: boolean
  patchedFields: string[]
  skippedFields: string[]
  error?: string
}

export async function backfillGlossaryItem(
  collectionId: string,
  itemId: string,
  opts: GlossaryBackfillOptions = {},
): Promise<GlossaryBackfillResult> {
  const item = await getCollectionItem(collectionId, itemId)
  const f = item.fieldData as GlossaryFields
  const slug = f.slug ?? ''
  const term = f.name ?? '(untitled)'
  const url = `${TAHI_BASE}/resources/glossary/${slug}`

  // Webflow's real field is `body` (rich text). The `definition` field
  // exists separately but is blank on legacy items — fall through to
  // `description` (single-sentence summary that legacy items DO have).
  const bodyHtml = f.body ?? ''
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)

  // Definition comes from `description` (the snippet field). The old
  // `definition` field was removed — description is the single source.
  // Falls back to the first substantive body paragraph.
  const definition = (() => {
    if (f.description && f.description.trim().length > 30) return f.description.trim().slice(0, 400)
    const lines = bodyMarkdown.split('\n').map(l => l.trim()).filter(Boolean)
    for (const l of lines) {
      if (l.startsWith('#')) continue
      if (l.length < 30) continue
      return l.slice(0, 400)
    }
    return term
  })()

  // Author resolution: when explicit, use it. Otherwise try to map the
  // existing `author` Reference (Team Members id) to a liam/staci slug.
  // Falls back to liam.
  let authorSlug: 'liam' | 'staci' = opts.authorSlug ?? 'liam'
  if (!opts.authorSlug && f.author) {
    try {
      const refs = await loadBlogReferenceLookups()
      const liamId = refs.authorsByNamePart.get('liam')
      const staciId = refs.authorsByNamePart.get('staci')
        ?? refs.authorsByNamePart.get('bonnie')
      if (f.author === staciId) authorSlug = 'staci'
      else if (f.author === liamId) authorSlug = 'liam'
    } catch { /* keep default */ }
  }

  // Use Webflow's built-in item-level timestamps for schema dates.
  // No custom date field patches needed.
  const itemUpdatedAt = item.lastUpdated ?? item.lastPublished ?? new Date().toISOString()
  const itemCreatedAt = item.createdOn ?? itemUpdatedAt

  const schemaBefore = f.schema ?? ''
  const validationBefore = validateJsonLd(schemaBefore)

  // Body sanitizer pass (opt-in).
  let newBodyHtml = bodyHtml
  let bodyChangesCount = 0
  if (opts.rewriteBody && bodyHtml) {
    // Sanitizer works on markdown; we re-render to HTML by NOT doing
    // anything — Webflow stores rich text as HTML, and stripping
    // em-dashes / banned words doesn't change structure. Run the
    // sanitizer on the HTML string directly; the regex passes don't
    // care about tag boundaries.
    const result = sanitizeAiTells(bodyHtml)
    newBodyHtml = result.markdown
    bodyChangesCount = result.totalChanges
  }
  const bodyChanged = newBodyHtml !== bodyHtml

  // Build fresh schema from current state. Use Webflow's own timestamps
  // so the schema reflects when the item was actually updated/created,
  // not when this backfill ran.
  const { jsonLdString, faqCount } = buildGlossarySchema({
    url, term, definition,
    bodyMarkdown, bodyHtml: newBodyHtml,
    updatedAt: itemUpdatedAt,
    publishedAt: itemCreatedAt,
    authorSlug,
    category: null,  // resolved via primary-category reference, not embedded in schema yet
  })
  const validationAfter = validateJsonLd(jsonLdString)

  // What to patch back. `schema` is always safe; other fields only
  // if we're rewriting the body, and even then we try each one and
  // tolerate "unknown field" errors so the script keeps working
  // before Liam adds every column manually in Webflow Designer.
  const patchedFields: string[] = []
  const skippedFields: string[] = []
  let patched = false
  if (!opts.dryRun) {
    // 1) Schema — required.
    try {
      await patchCollectionItem(collectionId, itemId, { schema: jsonLdString })
      patchedFields.push('schema')
      patched = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      skippedFields.push(`schema: ${msg.slice(0, 100)}`)
    }
    // 2) Body rewrite, opt-in. Webflow's real rich-text field is `body`.
    if (opts.rewriteBody && bodyChanged) {
      try {
        await patchCollectionItem(collectionId, itemId, { body: newBodyHtml })
        patchedFields.push('body')
      } catch (err) {
        skippedFields.push(`body: ${err instanceof Error ? err.message.slice(0, 60) : 'fail'}`)
      }
    }
    // Note: we no longer try to patch last-updated / date-modified —
    // those fields don't exist on the collection. Webflow's built-in
    // lastUpdated metadata auto-bumps on any patch.
  }

  return {
    itemId, slug, term,
    schemaCharsBefore: schemaBefore.length,
    schemaCharsAfter: jsonLdString.length,
    schemaValidBefore: validationBefore.valid,
    schemaValidAfter: validationAfter.valid,
    schemaErrorsBefore: validationBefore.errors.length,
    schemaErrorsAfter: validationAfter.errors.length,
    faqsDetected: faqCount,
    bodyChanged,
    bodyChangesCount,
    patched,
    patchedFields,
    skippedFields,
  }
}

/** Extract FAQ pairs from any glossary item — useful for the audit
 *  endpoint to count what's recoverable without running the full
 *  backfill. */
export function previewFaqsFromGlossaryItem(item: { fieldData: Record<string, unknown> }): Array<{ question: string; answer: string }> {
  const f = item.fieldData as GlossaryFields
  const bodyHtml = f.body ?? ''
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)
  return extractFaqsFromGlossaryBody(bodyMarkdown)
}
