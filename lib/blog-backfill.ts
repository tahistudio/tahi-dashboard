/**
 * Blog backfill — Phase I · Slice 6.5.
 *
 * One-time (resumable) job that walks every existing Tahi blog post and
 * populates the supporting fields a modern AI-searchable post needs but
 * older posts were never authored with:
 *
 *   - FAQ Question/Answer #1-6 (4-6 entries, q + a)
 *   - Key Takeaways (3-5 bullets, rendered as <ul><li>...</li></ul>)
 *   - AI Summary Prompt (1-2 sentence prompt tuned to this post's topic
 *     for the "Summarize with Claude/Gemini/etc" buttons on the live page)
 *   - Schema (the JSON-LD additions Slice 3 generates — Article + FAQPage
 *     + Organization + Person + breadcrumb)
 *   - Hreflang block (4 <link rel="alternate"> tags for UK/NZ/AU/x-default)
 *
 * Pure orchestrator + per-post generator. No DB writes here. The caller
 * (the backfill API route) handles auth, listing items, batching, and
 * writing the blog_backfill_log row.
 *
 * Sonnet 4.6 with web search OFF — we work from the post's existing body,
 * not external research. Token budget ~3000 keeps each call cheap.
 *
 * The body is truncated to ~12k chars of plain text before being sent to
 * Sonnet. The full Tahi post pages stay well under that limit; the cap
 * is defensive in case of stub posts containing image galleries that
 * exploded under HTML serialization.
 */

import { buildBlogSchemaAdditions, buildHreflangBlock, detectPostType, extractEntities } from '@/lib/blog-schema'
import { SONNET_MODEL } from '@/lib/ai-models'

// ── Models + budgets ──────────────────────────────────────────────────────

const MODEL = SONNET_MODEL
const MAX_TOKENS = 3000
const MAX_BODY_CHARS = 12_000

// ── Public shape ──────────────────────────────────────────────────────────

export interface BackfillPostInput {
  webflowItemId: string
  postUrl: string
  title: string
  bodyHtml: string
  metaDescription: string | null
  publishedAt: string | null
  authorName: string | null
  mainCategoryName: string | null
}

export interface BackfillPostOutput {
  /** 4-6 FAQs. Each answer is ~40-60 words. */
  faqs: Array<{ q: string; a: string }>
  /** 3-5 bullets wrapped in a single <ul>. Ready to drop into the
   *  Key Takeaways CMS field. */
  keyTakeawaysHtml: string
  /** 1-2 sentence prompt specific to this post's topic + audience.
   *  Powers the "Summarize with Claude/Gemini/etc" buttons. */
  aiSummaryPrompt: string
  /** Full <script type="application/ld+json">...</script> block. */
  schemaJsonLd: string
  /** 4 <link rel="alternate" hreflang="..."> tags joined with \n. */
  hreflangBlock: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Strip HTML to plain text, collapsing whitespace. Cap at MAX_BODY_CHARS. */
function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= MAX_BODY_CHARS) return text
  return text.slice(0, MAX_BODY_CHARS) + ' [TRUNCATED]'
}

/** Convert a Webflow body HTML blob into pseudo-markdown for the H2 step
 *  detector + post-type classifier. Lifted from blog-schema-input. */
function htmlToPseudoMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
}

function countWords(text: string): number {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return 0
  return cleaned.split(/\s+/).length
}

/** Pull `{...}` out of a possibly fenced response. Returns null on parse
 *  failure. */
function safeParseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      const parsed = JSON.parse(match[0])
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function buildSystemPrompt(): string {
  return `You are optimising an existing Tahi Studio blog post for SEO + AEO (answer engine optimisation) without changing the body copy. Tahi Studio is a New Zealand Webflow design + development agency targeting UK / NZ / AU enterprise + scale-up clients.

Your job is to generate the supporting fields a modern AI-searchable post needs but older posts were never authored with. You output ONE JSON object, nothing else.

OUTPUT SCHEMA (strict)
{
  "faqs": [
    { "q": "Question phrased as a real reader would type it", "a": "40-60 word answer in Tahi's UK B2B voice, factual, no marketing fluff" }
  ],
  "keyTakeaways": [
    "3-5 punchy single-sentence bullets",
    "Each should land one concrete idea from the post",
    "No 'In this post we cover' meta-bullets"
  ],
  "aiSummaryPrompt": "1-2 sentence prompt specific to this post's topic + audience. Used on the live page's 'Summarize with Claude/Gemini/etc' buttons. Should tell the LLM what angle to focus on."
}

RULES
1. faqs: exactly 4-6 entries. Every question MUST be answerable from the post body. No questions about things the post doesn't cover.
2. keyTakeaways: exactly 3-5 entries. Each one is a complete sentence ending in a full stop. No leading bullets, no markdown.
3. aiSummaryPrompt: must reference the topic specifically, not generically. Bad: "Summarize this article in 3 bullets." Good: "Summarize this guide for a Head of Marketing evaluating Webflow vs WordPress for an enterprise rebrand, focusing on migration risk + total cost of ownership over 3 years."
4. UK English throughout (colour, organise, centre). NO em or en dashes. Use commas, colons, or full stops.
5. JSON only. No prose, no markdown fence, no explanation. The pipeline JSON.parse() the response.`
}

function buildUserMessage(input: BackfillPostInput): string {
  const plain = htmlToPlainText(input.bodyHtml)
  const lines: string[] = []
  lines.push(`Post URL: ${input.postUrl}`)
  lines.push(`Title: ${input.title}`)
  if (input.metaDescription) lines.push(`Meta description: ${input.metaDescription}`)
  if (input.mainCategoryName) lines.push(`Category: ${input.mainCategoryName}`)
  if (input.authorName) lines.push(`Author: ${input.authorName}`)
  if (input.publishedAt) lines.push(`Published: ${input.publishedAt}`)
  lines.push('')
  lines.push('Body (HTML stripped to plain text):')
  lines.push('---')
  lines.push(plain)
  lines.push('---')
  lines.push('')
  lines.push('Produce the JSON object now.')
  return lines.join('\n')
}

interface SonnetOutput {
  faqs: Array<{ q: string; a: string }>
  keyTakeaways: string[]
  aiSummaryPrompt: string
}

async function callSonnet(input: BackfillPostInput): Promise<SonnetOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')

  const parsed = safeParseJson(text)
  if (!parsed) {
    throw new Error('Sonnet returned non-JSON response')
  }

  // FAQs — strict shape, drop anything malformed.
  const faqs: Array<{ q: string; a: string }> = []
  const rawFaqs = parsed.faqs
  if (Array.isArray(rawFaqs)) {
    for (const item of rawFaqs) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const q = asString(obj.q).trim()
      const a = asString(obj.a).trim()
      if (q.length > 0 && a.length > 0) {
        faqs.push({ q, a })
      }
    }
  }

  // Cap at 6, require at least 1.
  const faqsTrimmed = faqs.slice(0, 6)
  if (faqsTrimmed.length === 0) {
    throw new Error('Sonnet returned no usable FAQs')
  }

  // Key takeaways — strict array of non-empty strings, cap 5.
  const takeaways: string[] = []
  const rawTakeaways = parsed.keyTakeaways
  if (Array.isArray(rawTakeaways)) {
    for (const item of rawTakeaways) {
      const s = asString(item).trim()
      if (s.length > 0) takeaways.push(s)
    }
  }
  const takeawaysTrimmed = takeaways.slice(0, 5)
  if (takeawaysTrimmed.length === 0) {
    throw new Error('Sonnet returned no usable key takeaways')
  }

  const aiSummaryPrompt = asString(parsed.aiSummaryPrompt).trim()
  if (aiSummaryPrompt.length === 0) {
    throw new Error('Sonnet returned an empty aiSummaryPrompt')
  }

  return {
    faqs: faqsTrimmed,
    keyTakeaways: takeawaysTrimmed,
    aiSummaryPrompt,
  }
}

/** Build the <ul>...</ul> string for the Key Takeaways CMS field. Each
 *  bullet HTML-escapes the four critical characters; the post template
 *  re-renders inside a rich text container that already trusts its own
 *  HTML. */
function takeawaysToHtml(bullets: string[]): string {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const lis = bullets.map(b => `<li>${escape(b)}</li>`).join('')
  return `<ul>${lis}</ul>`
}

// ── Main entry ────────────────────────────────────────────────────────────

/**
 * Backfill the supporting fields for a single existing blog post. Pure
 * orchestrator. Caller writes the result to Webflow.
 *
 * Throws on:
 *   - missing ANTHROPIC_API_KEY
 *   - Sonnet returning non-JSON or empty arrays
 *
 * Does NOT throw on:
 *   - thin body (extractor will produce fewer entities; schema still builds)
 *   - missing meta description / author / category (defaults applied)
 */
export async function backfillPostFields(input: BackfillPostInput): Promise<BackfillPostOutput> {
  if (!input.title || !input.title.trim()) {
    throw new Error('backfillPostFields: title is required')
  }
  if (!input.postUrl || !input.postUrl.trim()) {
    throw new Error('backfillPostFields: postUrl is required')
  }
  if (!input.bodyHtml || !input.bodyHtml.trim()) {
    throw new Error('backfillPostFields: bodyHtml is required')
  }

  // 1. Sonnet call for the three generated fields.
  const generated = await callSonnet(input)

  // 2. Compose key takeaways HTML.
  const keyTakeawaysHtml = takeawaysToHtml(generated.keyTakeaways)

  // 3. Build schema JSON-LD using the existing Slice 3 generator. We
  //    feed it the post inputs + the freshly-generated FAQs so the
  //    FAQPage node lands too.
  const bodyMarkdown = htmlToPseudoMarkdown(input.bodyHtml)
  const wordCount = countWords(bodyMarkdown)
  const extracted = extractEntities(input.bodyHtml)
  const postType = detectPostType(input.title, bodyMarkdown)
  const authorName = (input.authorName ?? 'Liam Miller').trim()
  const authorJobTitle = authorName === 'Staci Miller' ? 'Designer' : 'Founder'
  const mainCategory = (input.mainCategoryName ?? 'General').trim()
  const publishedAt = input.publishedAt ?? new Date().toISOString()

  const { jsonLdString } = buildBlogSchemaAdditions({
    url: input.postUrl,
    title: input.title.trim(),
    metaDescription: (input.metaDescription ?? '').trim(),
    bodyMarkdown,
    bodyHtml: input.bodyHtml,
    publishedAt,
    updatedAt: new Date().toISOString(),
    authorName,
    authorJobTitle,
    authorLinkedIn: null,
    authorBio: null,
    authorImage: null,
    imageUrl: '',
    mainCategory,
    categories: [mainCategory],
    wordCount,
    faqs: generated.faqs.map(f => ({ question: f.q, answer: f.a })),
    keyTakeaways: generated.keyTakeaways,
    postType,
    citations: extracted.citations,
    mentions: extracted.mentions,
    aboutEntities: extracted.aboutEntities,
  })

  // 4. Hreflang block — same canonical URL serves UK/NZ/AU/x-default.
  const hreflangBlock = buildHreflangBlock(input.postUrl)

  return {
    faqs: generated.faqs,
    keyTakeawaysHtml,
    aiSummaryPrompt: generated.aiSummaryPrompt,
    schemaJsonLd: jsonLdString,
    hreflangBlock,
  }
}

/**
 * Convert a BackfillPostOutput into the exact Webflow fieldData payload
 * to PATCH onto the item. Exported separately so the API route can keep
 * its handler thin + so tests can lock the slug mapping.
 *
 * IMPORTANT: only the new fields are included. Existing fields (body,
 * title, slug, name, main-image, thumbnail, summary, post-excerpt,
 * shortened-name, featured, main-category, other-categories, author,
 * related-blog-posts) are left untouched.
 */
export function buildWebflowPatchPayload(out: BackfillPostOutput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    'key-takeaways': out.keyTakeawaysHtml,
    'ai-prompt': out.aiSummaryPrompt,
    schema: out.schemaJsonLd,
    'hreflang-block': out.hreflangBlock,
  }
  // FAQ slots — Webflow stores Q + A as 6 sibling fields, not an array.
  for (let i = 0; i < 6; i++) {
    const faq = out.faqs[i]
    payload[`faq-question-${i + 1}`] = faq?.q ?? ''
    payload[`faq-answer-${i + 1}`] = faq?.a ?? ''
  }
  return payload
}
