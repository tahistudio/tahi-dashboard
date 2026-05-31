/**
 * Shared glossary backfill helpers — used by the per-item route and
 * the bulk runner. Keeps the per-item logic in one place so the bulk
 * version is just a loop with rate-limiting.
 */

import { getCollectionItem, patchCollectionItem } from '@/lib/webflow'
import { buildGlossarySchema, extractFaqsFromGlossaryBody } from '@/lib/glossary-schema'
import { sanitizeAiTells } from '@/lib/ai-tell-sanitizer'
import { validateJsonLd } from '@/lib/schema-validate'

const TAHI_BASE = 'https://www.tahi.studio'

interface BlogPostFields {
  name?: string
  slug?: string
  schema?: string
  'post-body'?: string
  definition?: string
  body?: string
  'rich-text'?: string
  'last-updated'?: string
  'date-modified'?: string
  'author-slug'?: string
  'post-author'?: string
  category?: string
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
  const f = item.fieldData as BlogPostFields
  const slug = f.slug ?? ''
  const term = f.name ?? '(untitled)'
  const url = `${TAHI_BASE}/resources/glossary/${slug}`

  // Body lives under a couple of possible field names; check the
  // common ones in priority order.
  const bodyHtml = f['post-body'] ?? f['definition'] ?? f['body'] ?? f['rich-text'] ?? ''
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)

  // Definition headline: first non-heading paragraph.
  const definition = (() => {
    const lines = bodyMarkdown.split('\n').map(l => l.trim()).filter(Boolean)
    for (const l of lines) {
      if (l.startsWith('#')) continue
      if (l.length < 30) continue
      return l.slice(0, 400)
    }
    return term
  })()

  // Author resolution: explicit opt > existing field > Liam default.
  const authorSlug: 'liam' | 'staci' = opts.authorSlug
    ?? ((f['author-slug'] as string | undefined) === 'staci' ? 'staci' : 'liam')

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

  // Build fresh schema from current state.
  const { jsonLdString, faqCount } = buildGlossarySchema({
    url, term, definition,
    bodyMarkdown, bodyHtml: newBodyHtml,
    updatedAt: new Date().toISOString(),
    authorSlug,
    category: (f.category as string | undefined) ?? null,
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
    // 2) date-modified — best effort, separate call to tolerate missing field.
    try {
      await patchCollectionItem(collectionId, itemId, {
        'last-updated': new Date().toISOString(),
      })
      patchedFields.push('last-updated')
    } catch {
      try {
        await patchCollectionItem(collectionId, itemId, {
          'date-modified': new Date().toISOString(),
        })
        patchedFields.push('date-modified')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        skippedFields.push(`date: ${msg.slice(0, 60)}`)
      }
    }
    // 3) Body rewrite, opt-in.
    if (opts.rewriteBody && bodyChanged) {
      const bodyField = f['post-body'] !== undefined ? 'post-body'
        : f['definition'] !== undefined ? 'definition'
        : f['body'] !== undefined ? 'body'
        : 'rich-text'
      try {
        await patchCollectionItem(collectionId, itemId, { [bodyField]: newBodyHtml })
        patchedFields.push(bodyField)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        skippedFields.push(`${bodyField}: ${msg.slice(0, 60)}`)
      }
    }
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
  const f = item.fieldData as BlogPostFields
  const bodyHtml = f['post-body'] ?? f['definition'] ?? f['body'] ?? f['rich-text'] ?? ''
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)
  return extractFaqsFromGlossaryBody(bodyMarkdown)
}
