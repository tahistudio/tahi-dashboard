/**
 * Glossary schema generator.
 *
 * Mirrors lib/blog-schema.ts but emits the entity shapes Google +
 * AI engines expect for definitional content:
 *   - DefinedTerm + DefinedTermSet  (the glossary primitive)
 *   - Article wrapper                (so the page itself is a CreativeWork)
 *   - FAQPage                        (when H2s are question-shaped)
 *   - Organization                   (Tahi, reused by @id from blog-schema)
 *   - Person                         (author = Liam OR Staci)
 *   - BreadcrumbList                 (Home → Resources → Glossary → Term)
 *
 * Pure function. No DB, no fetch. Drop output into the Webflow `schema`
 * field (or any HTML embed). The result is a <script>-wrapped JSON-LD
 * string ready to ship.
 */

import { AUTHOR_KNOWS_ABOUT, AUTHOR_PROFILES, TAHI_ORG_NODE } from '@/lib/blog-schema-shared'

const TAHI_ORG_ID = 'https://www.tahi.studio/#organization'
const GLOSSARY_SET_ID = 'https://www.tahi.studio/resources/glossary#defined-term-set'
const GLOSSARY_INDEX_URL = 'https://www.tahi.studio/resources/glossary'

export interface GlossaryInput {
  url: string
  term: string
  definition: string         // 1-3 sentences, the headline answer
  bodyMarkdown: string       // full body, used to extract FAQs
  bodyHtml: string           // used for wordCount + rendering checks
  updatedAt: string
  publishedAt?: string | null
  authorSlug: 'liam' | 'staci'
  category?: string | null   // 'design' | 'dev' | 'seo' | 'business' | 'agency-ops' | 'webflow'
  /** Optional override of related terms (full URLs). When omitted, the
   *  schema simply omits the `relatedLink` field — caller can add
   *  separately via Webflow's multi-ref. */
  relatedTermUrls?: string[]
  /** Same shape — optional related blog post URLs. */
  relatedPostUrls?: string[]
}

export interface GlossaryOutput {
  jsonLdString: string
  blocks: object[]
  faqCount: number
  wordCount: number
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Extract H2-as-FAQ pairs from the body. Treats any H2 starting with a
 *  question word (What/How/Why/When/Is/Are/Does/Should/Can/Do) as an
 *  FAQ question; the paragraph(s) immediately following (up to the next
 *  H2/H3/H1) become the answer. */
export function extractFaqsFromGlossaryBody(bodyMarkdown: string): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = []
  const sections = bodyMarkdown.split(/^##\s+/m)
  for (let i = 1; i < sections.length; i++) {
    const chunk = sections[i]
    const newlineIdx = chunk.indexOf('\n')
    const heading = (newlineIdx === -1 ? chunk : chunk.slice(0, newlineIdx)).trim()
    if (!/^(what|how|why|when|is|are|does|should|can|do)\b/i.test(heading)) continue
    const rest = newlineIdx === -1 ? '' : chunk.slice(newlineIdx + 1)
    const stopAt = rest.search(/^#{1,3}\s/m)
    const body = (stopAt === -1 ? rest : rest.slice(0, stopAt)).trim()
    const answer = stripHtml(body).slice(0, 800)
    if (answer.length > 20) {
      faqs.push({ question: heading, answer })
    }
  }
  return faqs
}

function buildDefinedTerm(input: GlossaryInput): object {
  const node: Record<string, unknown> = {
    '@type': 'DefinedTerm',
    '@id': `${input.url}#term`,
    name: input.term,
    description: input.definition,
    termCode: input.term.toLowerCase(),
    inDefinedTermSet: { '@id': GLOSSARY_SET_ID },
    url: input.url,
  }
  return node
}

function buildDefinedTermSet(): object {
  return {
    '@type': 'DefinedTermSet',
    '@id': GLOSSARY_SET_ID,
    name: 'Tahi Studio Glossary',
    description: 'Definitions for Webflow design, development, brand systems, agency operations, and the digital business vocabulary Tahi works with daily.',
    url: GLOSSARY_INDEX_URL,
    inLanguage: 'en-GB',
  }
}

function buildArticleWrapper(input: GlossaryInput, wordCount: number): object {
  const node: Record<string, unknown> = {
    '@type': 'Article',
    '@id': `${input.url}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    headline: input.term,
    description: input.definition,
    abstract: input.definition,
    url: input.url,
    datePublished: input.publishedAt ?? input.updatedAt,
    dateModified: input.updatedAt,
    author: { '@id': `${input.url}#author` },
    publisher: { '@id': TAHI_ORG_ID },
    isPartOf: {
      '@type': 'CreativeWork',
      '@id': GLOSSARY_INDEX_URL,
      name: 'Tahi Studio Glossary',
    },
    inLanguage: 'en-GB',
    wordCount,
    about: { '@id': `${input.url}#term` },
  }
  if (input.category) node.articleSection = input.category
  return node
}

function buildPerson(authorSlug: 'liam' | 'staci', url: string): object {
  const name = authorSlug === 'staci' ? 'Staci Bonnie' : 'Liam Miller'
  const profile = AUTHOR_PROFILES[name]
  const sameAs: string[] = []
  if (profile?.linkedinUrl) sameAs.push(profile.linkedinUrl)
  if (profile?.xUrl) sameAs.push(profile.xUrl)
  const node: Record<string, unknown> = {
    '@type': 'Person',
    '@id': `${url}#author`,
    name,
    jobTitle: profile?.jobTitle ?? 'Co-Founder',
    worksFor: { '@id': TAHI_ORG_ID },
    knowsAbout: AUTHOR_KNOWS_ABOUT[name] ?? [],
    knowsLanguage: ['en'],
  }
  if (profile?.description) node.description = profile.description
  if (profile?.imageUrl) node.image = { '@type': 'ImageObject', url: profile.imageUrl }
  if (sameAs.length > 0) node.sameAs = sameAs
  if (profile?.nationality) node.nationality = { '@type': 'Country', name: profile.nationality }
  if (profile?.alternateName) node.alternateName = profile.alternateName
  return node
}

function buildBreadcrumbs(input: GlossaryInput): object {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${input.url}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://www.tahi.studio/' },
      { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://www.tahi.studio/resources' },
      { '@type': 'ListItem', position: 3, name: 'Glossary', item: GLOSSARY_INDEX_URL },
      { '@type': 'ListItem', position: 4, name: input.term, item: input.url },
    ],
  }
}

function buildFaqPage(input: GlossaryInput, faqs: Array<{ question: string; answer: string }>): object | null {
  if (faqs.length === 0) return null
  return {
    '@type': 'FAQPage',
    '@id': `${input.url}#faq`,
    mainEntity: faqs.map((f, i) => ({
      '@type': 'Question',
      '@id': `${input.url}#faq-${i + 1}`,
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
}

export function buildGlossarySchema(input: GlossaryInput): GlossaryOutput {
  const wordCount = stripHtml(input.bodyHtml || input.bodyMarkdown).split(/\s+/).filter(Boolean).length
  const faqs = extractFaqsFromGlossaryBody(input.bodyMarkdown)
  const blocks: object[] = []
  blocks.push(buildArticleWrapper(input, wordCount))
  blocks.push(buildDefinedTerm(input))
  blocks.push(buildDefinedTermSet())
  blocks.push(TAHI_ORG_NODE)
  blocks.push(buildPerson(input.authorSlug, input.url))
  blocks.push(buildBreadcrumbs(input))
  const faqNode = buildFaqPage(input, faqs)
  if (faqNode) blocks.push(faqNode)

  // Related-term references (optional). Emit as Thing nodes so the
  // DefinedTerm can reference them via `relatedLink` without duplicating
  // the full definition.
  if (input.relatedTermUrls && input.relatedTermUrls.length > 0) {
    for (const relUrl of input.relatedTermUrls) {
      blocks.push({
        '@type': 'DefinedTerm',
        '@id': `${relUrl}#term`,
        url: relUrl,
        inDefinedTermSet: { '@id': GLOSSARY_SET_ID },
      })
    }
  }

  const graph = { '@context': 'https://schema.org', '@graph': blocks }
  const safeJson = JSON.stringify(graph)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
  const jsonLdString = `<script type="application/ld+json">${safeJson}</script>`
  return { jsonLdString, blocks, faqCount: faqs.length, wordCount }
}
