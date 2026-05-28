/**
 * Bridge between the Webflow CMS shape and the pure `buildBlogSchema`
 * generator. Kept in its own module so both the per-item rebuild route
 * and the bulk rebuild route can share the field-extraction logic.
 *
 * The slugs here are the EXACT Webflow CMS slugs (verified via API on
 * 2026-05-28, collection id `685941c739fa006940c9b4de`). Changing a
 * slug in Webflow without updating this file will silently drop fields.
 */

import {
  detectPostType,
  extractEntities,
  type SchemaInput,
} from '@/lib/blog-schema'

// Webflow CMS slugs — these are the actual field IDs as registered on
// the live Blog Posts collection (685941c739fa006940c9b4de). The `-2`
// suffixes are leftover from Webflow's "you can't delete a field with
// data" rename behaviour; that's why meta-description, summary and
// thumbnail-image all have `-2` siblings. Do NOT use the bare names —
// they don't exist on the collection any more.
export interface BlogPostFields {
  name?: string
  slug?: string
  'meta-title'?: string
  'meta-description-2'?: string
  'main-image'?: { url?: string; alt?: string; fileId?: string; width?: number; height?: number }
  'thumbnail-image-2'?: { url?: string; alt?: string; fileId?: string; width?: number; height?: number }
  'post-body'?: string
  'post-description'?: string
  'summary-2'?: string
  'main-category'?: { name?: string } | string
  'other-categories'?: Array<{ name?: string } | string>
  author?: { name?: string; jobTitle?: string; linkedIn?: string; bio?: string; image?: { url?: string } } | string
  'key-takeaways'?: string
  'ai-prompt'?: string
  'faq-question-1'?: string
  'faq-answer-1'?: string
  'faq-question-2'?: string
  'faq-answer-2'?: string
  'faq-question-3'?: string
  'faq-answer-3'?: string
  'faq-question-4'?: string
  'faq-answer-4'?: string
  'faq-question-5'?: string
  'faq-answer-5'?: string
  'faq-question-6'?: string
  'faq-answer-6'?: string
  'published-on'?: string
  'updated-on'?: string
  schema?: string
  'hreflang-block'?: string
}

function categoryName(v: BlogPostFields['main-category']): string {
  if (!v) return 'General'
  if (typeof v === 'string') return v
  return v.name ?? 'General'
}

function otherCategoryNames(v: BlogPostFields['other-categories']): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map(c => (typeof c === 'string' ? c : c?.name ?? ''))
    .filter(s => s.length > 0)
}

function countWords(body: string): number {
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length === 0) return 0
  return text.split(/\s+/).length
}

function pickFaqs(f: BlogPostFields): Array<{ question: string; answer: string }> {
  const out: Array<{ question: string; answer: string }> = []
  for (let i = 1; i <= 6; i++) {
    const q = (f[`faq-question-${i}` as keyof BlogPostFields] as string | undefined)?.trim()
    const a = (f[`faq-answer-${i}` as keyof BlogPostFields] as string | undefined)?.trim()
    if (q && a) out.push({ question: q, answer: a })
  }
  return out
}

function pickKeyTakeaways(html: string | undefined): string[] {
  if (!html) return []
  const lis = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map(m =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  )
  if (lis.length > 0) return lis.filter(s => s.length > 0)
  return html
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** Convert a Webflow body HTML blob into pseudo-markdown for the H2 step
 * detector + post-type classifier. We don't try to be a perfect parser;
 * we just need H1/H2/H3 markers and paragraph breaks. */
function htmlToPseudoMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
}

/**
 * Build the SchemaInput payload for a Webflow blog post. Pure shape
 * transformation — no DB or fetch. Returns a fully-populated input
 * ready for `buildBlogSchemaAdditions`.
 */
export function buildSchemaInputForPost(
  f: BlogPostFields,
  postUrl: string,
  /** Optional id -> category-name map. Webflow returns reference fields as
   *  bare item ids; pass this (from loadBlogReferenceLookups) so the
   *  schema gets the real category name instead of "687d1abb...". */
  categoryNameById?: Map<string, string>,
): SchemaInput {
  const bodyHtml = f['post-body'] ?? ''
  const bodyMarkdown = htmlToPseudoMarkdown(bodyHtml)

  const title = (f['meta-title'] ?? f.name ?? '').trim()
  const metaDescription = (f['meta-description-2'] ?? f['post-description'] ?? f['summary-2'] ?? '').trim()
  const rawCat = f['main-category']
  const main = (typeof rawCat === 'string' && categoryNameById?.get(rawCat))
    ? (categoryNameById.get(rawCat) as string)
    : categoryName(rawCat)
  const others = otherCategoryNames(f['other-categories'])
  const categories = Array.from(new Set([main, ...others])).filter(Boolean)

  const authorObj = typeof f.author === 'object' && f.author !== null ? f.author : null
  const authorName = (authorObj?.name ?? (typeof f.author === 'string' ? f.author : 'Liam Miller')).trim()
  const authorJobTitle = authorObj?.jobTitle ?? (authorName === 'Staci Miller' ? 'Designer' : 'Founder')
  const authorLinkedIn = authorObj?.linkedIn ?? null
  const authorBio = authorObj?.bio ?? null
  const authorImage = authorObj?.image?.url ?? null

  const wordCount = countWords(bodyHtml)
  const faqs = pickFaqs(f)
  const keyTakeaways = pickKeyTakeaways(f['key-takeaways'])
  const postType = detectPostType(title, bodyMarkdown)
  const extracted = extractEntities(bodyHtml)

  return {
    url: postUrl,
    title,
    metaDescription,
    bodyMarkdown,
    bodyHtml,
    publishedAt: f['published-on'] ?? new Date().toISOString(),
    updatedAt: f['updated-on'] ?? new Date().toISOString(),
    authorName,
    authorJobTitle,
    authorLinkedIn,
    authorBio,
    authorImage,
    imageUrl: f['main-image']?.url ?? '',
    imageWidth: f['main-image']?.width,
    imageHeight: f['main-image']?.height,
    mainCategory: main,
    categories,
    wordCount,
    faqs,
    keyTakeaways,
    postType,
    citations: extracted.citations,
    mentions: extracted.mentions,
    aboutEntities: extracted.aboutEntities,
  }
}
