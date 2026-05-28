/**
 * Blog schema generator — Phase I · Slice 3.
 *
 * Builds a `@graph` JSON-LD block that augments Tahi's existing
 * SchemaFlow output. SchemaFlow already emits BlogPosting + basic
 * Organization + breadcrumb; this generator layers on:
 *   - richer Article (wordCount, timeRequired, inLanguage, abstract...)
 *   - FAQPage (conditional on faqs.length > 0)
 *   - HowTo (conditional on postType === 'how-to')
 *   - Organization (Tahi Studio) with knowsAbout + sameAs
 *   - Person (the author) with sameAs + curated knowsAbout
 *   - mentions / about / citation arrays
 *   - SpeakableSpecification (xpath pinned to ids that Slice 5 publish
 *     template injects: #tldr, #key-takeaways, /html/head/title)
 *   - 4-level BreadcrumbList (home → blog → category → post)
 *
 * Google merges duplicate @types in JSON-LD without complaint, so we
 * don't have to strip SchemaFlow's output. Both blocks ship side-by-side
 * until Slice 5 (or later) replaces SchemaFlow entirely.
 *
 * Everything here is a pure function — no DB, no fetch, no IO. The
 * caller assembles the input and writes the result to Webflow's
 * `schema` CMS field.
 */

// ─── inputs / outputs ───────────────────────────────────────────────────────

export interface SchemaInput {
  url: string
  title: string
  metaDescription: string
  bodyMarkdown: string
  bodyHtml: string
  publishedAt: string
  updatedAt: string
  authorName: string
  authorJobTitle: string
  authorLinkedIn?: string | null
  authorBio?: string | null
  authorImage?: string | null
  imageUrl: string
  imageWidth?: number
  imageHeight?: number
  mainCategory: string
  categories?: string[]
  wordCount: number
  faqs: Array<{ question: string; answer: string }>
  keyTakeaways?: string[]
  postType?: 'definition' | 'how-to' | 'opinion' | 'comparison' | 'general'
  citations?: Array<{ url: string; title?: string }>
  mentions?: string[]
  aboutEntities?: string[]
}

export interface SchemaOutput {
  jsonLdString: string
  blocks: object[]
}

// ─── brand + author entity tables ───────────────────────────────────────────

/**
 * Hard-coded canonical URLs for known brand entities. Used by both the
 * `mentions` graph node and the entity extractor. Keep names exactly as
 * they appear in body copy (case-insensitive match handled by extractor).
 */
const BRAND_URLS: Record<string, string> = {
  'Webflow': 'https://webflow.com',
  'Shopify': 'https://www.shopify.com',
  'Stripe': 'https://stripe.com',
  'Figma': 'https://www.figma.com',
  'Framer': 'https://www.framer.com',
  'WordPress': 'https://wordpress.org',
  'Sanity': 'https://www.sanity.io',
  'Contentful': 'https://www.contentful.com',
  'Sitecore': 'https://www.sitecore.com',
  'Klaviyo': 'https://www.klaviyo.com',
  'Mailchimp': 'https://mailchimp.com',
  'Resend': 'https://resend.com',
  'Anthropic': 'https://www.anthropic.com',
  'OpenAI': 'https://openai.com',
  'Slack': 'https://slack.com',
  'Notion': 'https://www.notion.so',
  'Linear': 'https://linear.app',
  'GitHub': 'https://github.com',
  'Vercel': 'https://vercel.com',
  'Cloudflare': 'https://www.cloudflare.com',
  'AWS': 'https://aws.amazon.com',
  'Google': 'https://www.google.com',
  'Microsoft': 'https://www.microsoft.com',
  'Apple': 'https://www.apple.com',
  'Adobe': 'https://www.adobe.com',
  'Sketch': 'https://www.sketch.com',
  'Asana': 'https://asana.com',
  'Monday': 'https://monday.com',
  'Airtable': 'https://www.airtable.com',
  'Zapier': 'https://zapier.com',
  'Make': 'https://www.make.com',
  'n8n': 'https://n8n.io',
}

const KNOWN_BRANDS = Object.keys(BRAND_URLS)

/**
 * Per-author `knowsAbout` lists. Falls back to a generic Tahi list when
 * the author isn't recognised.
 */
const AUTHOR_KNOWS_ABOUT: Record<string, string[]> = {
  'Liam Miller': [
    'Enterprise Webflow',
    'Webflow Development',
    'B2B SaaS Websites',
    'Webflow Migration',
    'Design Systems',
    'Web Performance',
    'Headless CMS',
  ],
  'Staci Miller': [
    'Web Design',
    'Brand Identity',
    'Design Systems',
    'Webflow Design',
    'UX Design',
    'Accessibility',
    'Sustainable Web Design',
  ],
}

const TAHI_KNOWS_ABOUT = [
  'Webflow',
  'Enterprise Web Design',
  'Design Systems',
  'Webflow Migration',
  'Web Accessibility',
  'Sustainable Web',
  'B2B SaaS Websites',
]

const TAHI_ORG_ID = 'https://www.tahi.studio/#organization'
const TAHI_BLOG_ID = 'https://www.tahi.studio/blog'

// ─── helpers ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** PT{N}M based on words/200 with a minimum of 2 minutes. */
function timeRequiredIso(wordCount: number): string {
  const minutes = Math.max(2, Math.round(wordCount / 200))
  return `PT${minutes}M`
}

/** Build the breadcrumb's category URL from the main category slug. */
function categoryUrl(mainCategory: string): string {
  const slug = mainCategory
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${TAHI_BLOG_ID}/category/${slug}`
}

// ─── post-type detection ────────────────────────────────────────────────────

/**
 * Heuristic post-type classifier. Cheap, deterministic, runs on title +
 * (optionally) body. Used both internally and exported for the
 * Researcher → Writer pipeline so the writer can opt-in to HowTo
 * conventions when the upstream pick disagrees.
 */
export function detectPostType(
  title: string,
  body: string,
): NonNullable<SchemaInput['postType']> {
  const t = title.trim().toLowerCase()

  if (/^how\s+(to|do\s+i)\b/.test(t)) return 'how-to'

  if (/\s+vs\.?\s+|\bcompare(d)?\b|\balternatives?\b|\bbest\s+\w+/.test(t)) {
    return 'comparison'
  }

  if (/^(what\s+is|what's|what\s+are|whats)\b/.test(t)) return 'definition'

  // single noun phrase title (no verb, <=4 words) → also definition-ish
  if (
    t.split(/\s+/).filter(Boolean).length <= 4 &&
    !/\b(why|how|when|where|should|is|are|do|does|will)\b/.test(t)
  ) {
    return 'definition'
  }

  if (
    /\b(why|should\s+you|my\s+take|we\s+(built|shipped|learned)|i\s+(built|shipped|think))\b/.test(t)
  ) {
    return 'opinion'
  }

  // Fall through: peek at body H1 for a single-noun-phrase signal.
  const firstH1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ''
  if (
    firstH1 &&
    firstH1.split(/\s+/).filter(Boolean).length <= 4 &&
    !/\b(why|how|when|where|should)\b/i.test(firstH1)
  ) {
    return 'definition'
  }

  return 'general'
}

// ─── entity + citation extraction ───────────────────────────────────────────

/**
 * Best-effort entity extraction. Cheap regex passes — good enough for
 * SEO schema, not a replacement for NER. Three jobs:
 *
 *   - mentions: known brand names (case-insensitive) found in body
 *   - aboutEntities: H1 + first 5 H2s as topic candidates
 *   - citations: external `<a href>` URLs from body HTML, deduped + capped
 */
export function extractEntities(body: string): {
  mentions: string[]
  aboutEntities: string[]
  citations: Array<{ url: string; title?: string }>
} {
  // mentions — match known brand names as whole words, case-insensitive
  const found = new Set<string>()
  const text = stripHtml(body)
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (re.test(text)) found.add(brand)
  }

  // aboutEntities — H1 + first 5 H2s
  const aboutEntities: string[] = []
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (h1) aboutEntities.push(h1)
  const h2s = Array.from(body.matchAll(/^##\s+(.+)$/gm)).map(m => m[1].trim())
  for (const h2 of h2s.slice(0, 5)) {
    if (!aboutEntities.includes(h2)) aboutEntities.push(h2)
  }

  // citations — external <a href> in body HTML, exclude tahi.studio, dedupe, cap 10
  const citations: Array<{ url: string; title?: string }> = []
  const seen = new Set<string>()
  const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(body)) !== null) {
    const href = match[1]
    if (!/^https?:\/\//i.test(href)) continue
    if (/tahi\.studio/i.test(href)) continue
    if (seen.has(href)) continue
    seen.add(href)
    const inner = stripHtml(match[2]).trim()
    citations.push({ url: href, title: inner.length > 0 ? inner.slice(0, 160) : undefined })
    if (citations.length >= 10) break
  }

  return {
    mentions: Array.from(found),
    aboutEntities,
    citations,
  }
}

// ─── HowTo step detection ───────────────────────────────────────────────────

interface HowToStep {
  name: string
  text: string
}

/**
 * Detect HowTo steps from a markdown body. Each H2 is a step; the first
 * paragraph (or text up to the next heading) is the step text, capped at
 * 200 chars. H3s aren't promoted to their own steps in v1; they get
 * folded into the parent step's text if we ever need to.
 */
function detectHowToSteps(bodyMarkdown: string): HowToStep[] {
  const steps: HowToStep[] = []
  // Split on H2 boundaries
  const sections = bodyMarkdown.split(/^##\s+/m)
  // First chunk is the pre-H2 intro; skip it
  for (let i = 1; i < sections.length; i++) {
    const chunk = sections[i]
    const newlineIdx = chunk.indexOf('\n')
    const headingLine = (newlineIdx === -1 ? chunk : chunk.slice(0, newlineIdx)).trim()
    const rest = newlineIdx === -1 ? '' : chunk.slice(newlineIdx + 1)
    // Stop at the next H2 (already handled by split) or H3 / H1
    const stopAt = rest.search(/^#{1,3}\s/m)
    const body = (stopAt === -1 ? rest : rest.slice(0, stopAt))
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .find(p => p.length > 0)
      ?? ''
    const text = stripHtml(body).slice(0, 200)
    if (headingLine.length > 0) {
      steps.push({ name: headingLine, text })
    }
  }
  return steps
}

// ─── graph builders ─────────────────────────────────────────────────────────

function buildArticle(input: SchemaInput): object {
  const categories = input.categories && input.categories.length > 0
    ? input.categories
    : [input.mainCategory]
  return {
    '@type': 'Article',
    '@id': `${input.url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    headline: input.title,
    description: input.metaDescription,
    abstract: input.metaDescription,
    image: {
      '@type': 'ImageObject',
      url: input.imageUrl,
      ...(input.imageWidth ? { width: input.imageWidth } : {}),
      ...(input.imageHeight ? { height: input.imageHeight } : {}),
    },
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    author: { '@id': `${input.url}#author` },
    publisher: { '@id': TAHI_ORG_ID },
    isPartOf: {
      '@type': 'Blog',
      '@id': TAHI_BLOG_ID,
      name: 'Tahi Studio Blog',
    },
    inLanguage: 'en-GB',
    articleSection: input.mainCategory,
    keywords: categories.join(', '),
    wordCount: input.wordCount,
    timeRequired: timeRequiredIso(input.wordCount),
  }
}

function buildFaqPage(input: SchemaInput): object | null {
  if (!input.faqs || input.faqs.length === 0) return null
  return {
    '@type': 'FAQPage',
    '@id': `${input.url}#faq`,
    mainEntity: input.faqs.map((f, i) => ({
      '@type': 'Question',
      '@id': `${input.url}#faq-${i + 1}`,
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  }
}

function buildHowTo(input: SchemaInput): object | null {
  if (input.postType !== 'how-to') return null
  const steps = detectHowToSteps(input.bodyMarkdown)
  if (steps.length === 0) return null
  return {
    '@type': 'HowTo',
    '@id': `${input.url}#howto`,
    name: input.title,
    description: input.metaDescription,
    totalTime: timeRequiredIso(input.wordCount),
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  }
}

function buildOrganization(): object {
  return {
    '@type': 'Organization',
    '@id': TAHI_ORG_ID,
    name: 'Tahi Studio',
    url: 'https://www.tahi.studio/',
    logo: {
      '@type': 'ImageObject',
      url: 'https://www.tahi.studio/logo.png',
    },
    sameAs: [
      'https://www.linkedin.com/company/tahi-studio',
      'https://x.com/tahistudio',
    ],
    knowsAbout: TAHI_KNOWS_ABOUT,
  }
}

function buildPerson(input: SchemaInput): object {
  const sameAs: string[] = []
  if (input.authorLinkedIn) sameAs.push(input.authorLinkedIn)
  return {
    '@type': 'Person',
    '@id': `${input.url}#author`,
    name: input.authorName,
    jobTitle: input.authorJobTitle,
    ...(input.authorBio ? { description: input.authorBio } : {}),
    ...(input.authorImage
      ? { image: { '@type': 'ImageObject', url: input.authorImage } }
      : {}),
    worksFor: { '@id': TAHI_ORG_ID },
    ...(sameAs.length > 0 ? { sameAs } : {}),
    knowsAbout: AUTHOR_KNOWS_ABOUT[input.authorName] ?? TAHI_KNOWS_ABOUT,
  }
}

function buildMentions(mentions: string[] | undefined): object[] {
  if (!mentions || mentions.length === 0) return []
  return mentions.map(name => ({
    '@type': 'Thing',
    name,
    ...(BRAND_URLS[name] ? { url: BRAND_URLS[name], sameAs: BRAND_URLS[name] } : {}),
  }))
}

function buildAbout(aboutEntities: string[] | undefined): object[] {
  if (!aboutEntities || aboutEntities.length === 0) return []
  return aboutEntities.map(name => ({ '@type': 'Thing', name }))
}

function buildCitations(
  citations: Array<{ url: string; title?: string }> | undefined,
): object[] {
  if (!citations || citations.length === 0) return []
  return citations.map(c => ({
    '@type': 'WebPage',
    '@id': c.url,
    url: c.url,
    ...(c.title ? { name: c.title } : {}),
  }))
}

function buildBreadcrumbs(input: SchemaInput): object {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${input.url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.tahi.studio/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: TAHI_BLOG_ID },
      {
        '@type': 'ListItem',
        position: 3,
        name: input.mainCategory,
        item: categoryUrl(input.mainCategory),
      },
      { '@type': 'ListItem', position: 4, name: input.title, item: input.url },
    ],
  }
}

// ─── main entry ─────────────────────────────────────────────────────────────

/**
 * Build the full JSON-LD additions block for a blog post. Always
 * deterministic — same input produces byte-identical output. Output is
 * a single `<script type="application/ld+json">` element wrapping a
 * `@graph` array. Drop it straight into Webflow's `schema` field.
 */
export function buildBlogSchemaAdditions(input: SchemaInput): SchemaOutput {
  const blocks: object[] = []

  blocks.push(buildArticle(input))

  const faq = buildFaqPage(input)
  if (faq) blocks.push(faq)

  const howto = buildHowTo(input)
  if (howto) blocks.push(howto)

  blocks.push(buildOrganization())
  blocks.push(buildPerson(input))

  const mentions = buildMentions(input.mentions)
  if (mentions.length > 0) blocks.push(...mentions)

  const about = buildAbout(input.aboutEntities)
  if (about.length > 0) blocks.push(...about)

  const citations = buildCitations(input.citations)
  if (citations.length > 0) blocks.push(...citations)

  // SpeakableSpecification removed: it pointed xpath at #tldr /
  // #key-takeaways anchors the Webflow template never injects, so every
  // post failed schema.org with 3 "no matches found" errors. speakable is
  // a pending-namespace feature with marginal payoff — dropping it is the
  // clean fix. Re-add only if the template gains stable, real anchors.
  blocks.push(buildBreadcrumbs(input))

  const payload = {
    '@context': 'https://schema.org',
    '@graph': blocks,
  }

  // Strict JSON.stringify — no pretty printing. Closing-tag injection
  // is guarded by escaping `</` in any string value so the script block
  // can't be broken by user content.
  const safeJson = JSON.stringify(payload).replace(/<\/(script)/gi, '<\\/$1')
  const jsonLdString = `<script type="application/ld+json">${safeJson}</script>`

  return { jsonLdString, blocks }
}

// ─── hreflang helper ────────────────────────────────────────────────────────

/**
 * Build the `<link rel="alternate" hreflang="...">` block for a post.
 * Same canonical URL serves UK/NZ/AU/x-default since geos share a tree.
 *
 * NOTE (Liam action): the Webflow Blog Posts collection needs a new
 * field "Hreflang block" (Plain text long, slug `hreflang-block`) for
 * the rebuild routes to write into. The Webflow template should render
 * the field's contents inside `<head>` on the blog post template.
 */
export function buildHreflangBlock(canonicalUrl: string): string {
  return [
    `<link rel="alternate" hreflang="en-GB" href="${canonicalUrl}" />`,
    `<link rel="alternate" hreflang="en-NZ" href="${canonicalUrl}" />`,
    `<link rel="alternate" hreflang="en-AU" href="${canonicalUrl}" />`,
    `<link rel="alternate" hreflang="x-default" href="${canonicalUrl}" />`,
  ].join('\n')
}
