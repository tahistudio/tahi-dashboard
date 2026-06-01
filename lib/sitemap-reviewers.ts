/**
 * Sitemap reviewers — the 6 sub-agents that critique a planned page or
 * section before Liam + Staci commit to building it. Output is stored
 * in sitemap_node_reviews and surfaces in the right-hand panel.
 *
 * Different shape from round-table reviewers because the artefact is a
 * design + content plan, not a 2000-word draft. Reviewers score the plan
 * itself (clarity, fit, gaps), not finished prose.
 *
 * Single Anthropic shape: each reviewer returns
 *   { score, summary, suggestions[], critique }
 * No verdict / soft_fail / hard_fail — these are advisory only. The
 * Liam-and-Staci human is the editor.
 */

import { SONNET_MODEL } from '@/lib/ai-models'

export type SitemapReviewerKey =
  | 'seo_aeo'
  | 'icp'
  | 'brand_voice'
  | 'cro'
  | 'sales'
  | 'marketing'

export interface SitemapNodeForReview {
  id: string
  title: string
  nodeType: 'page' | 'cms_collection' | 'section'
  slug: string | null
  url: string | null
  purpose: string | null
  icpAudience: string | null
  primaryKeyword: string | null
  aeoIntent: string | null
  positioningVertical: string | null
  successMetric: string | null
  status: string
  specialFeatures: string | null
  designNotes: string | null
  contentNotes: string | null
  contentBlocksNeeded: string | null
  bodyTiptap: string | null
}

export interface SitemapReviewerDef {
  key: SitemapReviewerKey
  displayName: string
  oneLineRole: string
  model: string
  systemPrompt: string
  buildUserPrompt: (node: SitemapNodeForReview) => string
}

const APPLYABLE_FIELDS = [
  'title', 'slug', 'url', 'purpose', 'icpAudience', 'primaryKeyword',
  'aeoIntent', 'positioningVertical', 'successMetric', 'specialFeatures',
  'designNotes', 'contentNotes', 'targetLaunchDate',
] as const

const COMMON_OUTPUT_CONTRACT = `Respond with ONE JSON object only (no markdown fences, no prose):
{
  "score": number,            // 0-100, how well the plan serves its goal from your lens
  "summary": "one short sentence",
  "suggestions": [
    {
      "label": "concrete edit headline",
      "detail": "why this matters",
      // Optional. Include only when the suggestion has a concrete field change
      // that can be applied without further interpretation. Omit for
      // "rethink this" style suggestions.
      "apply": {
        "field": "purpose" | "icpAudience" | "primaryKeyword" | "aeoIntent" | "positioningVertical" | "successMetric" | "specialFeatures" | "designNotes" | "contentNotes" | "targetLaunchDate" | "title" | "slug",
        "operation": "replace" | "append",
        "newValue": "the exact new text for that field"
      }
    }
  ],
  "critique": "2-4 sentences explaining the score and what's missing / what's strong"
}

When suggesting a concrete fix, ALWAYS include the apply block with the exact final text the field should hold. The human reviewer should be able to click "Apply" and have the change land verbatim. For purpose / icpAudience / successMetric: write the full final value, don't just describe the change. For positioningVertical: use one of: Enterprise Custom Webflow, Operations, Webflow Cloud, UI/UX, Product Integrations, Pricing & Sales, Resources & Education, Showcase.`

function nodeToContext(node: SitemapNodeForReview): string {
  const fields: Array<[string, string | null]> = [
    ['Title', node.title],
    ['Type', node.nodeType],
    ['Slug', node.slug],
    ['URL (if live)', node.url],
    ['Positioning vertical', node.positioningVertical],
    ['Page purpose', node.purpose],
    ['ICP / audience', node.icpAudience],
    ['Primary keyword', node.primaryKeyword],
    ['AEO intent', node.aeoIntent],
    ['Success metric', node.successMetric],
    ['Status', node.status],
    ['Special features', node.specialFeatures],
    ['Design notes', node.designNotes],
    ['Content notes', node.contentNotes],
    ['Content blocks needed (one per line)', node.contentBlocksNeeded],
  ]
  const lines = fields
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `${k}: ${v}`)
  // Tiptap body is JSON. Render a stripped plain-text version so the
  // reviewer can read it.
  if (node.bodyTiptap) {
    try {
      const plain = extractTiptapText(node.bodyTiptap)
      if (plain.trim().length > 0) lines.push(`\nFreeform notes:\n${plain.slice(0, 4000)}`)
    } catch { /* ignore */ }
  }
  return lines.join('\n')
}

function extractTiptapText(json: string): string {
  // Minimal Tiptap doc walker — pulls every "text" node we encounter.
  // Good enough for sub-agent context; not a full pretty-printer.
  const doc = JSON.parse(json) as unknown
  const out: string[] = []
  function walk(n: unknown) {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; content?: unknown[] }
    if (node.type === 'text' && typeof node.text === 'string') {
      out.push(node.text)
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child)
      if (node.type === 'paragraph' || node.type === 'heading') out.push('\n')
    }
  }
  walk(doc)
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

export const SITEMAP_REVIEWERS: SitemapReviewerDef[] = [
  {
    key: 'seo_aeo',
    displayName: 'SEO + AEO',
    oneLineRole: 'Search and answer-engine optimisation specialist.',
    model: SONNET_MODEL,
    systemPrompt: `You are the SEO + AEO reviewer on Tahi Studio's marketing site planning team. Tahi is a NZ-based Webflow agency targeting enterprise + scale-up clients globally.

Your lens:
- Is the primary keyword realistic for tahi.studio's domain authority?
- Does the AEO intent map to a real question buckets people ask (or AI systems answer)?
- Is the page structured to win featured snippets / AI Overviews?
- Are there obvious topic clusters / internal links this page should be part of?
- Are there schema.org opportunities (Article, FAQPage, BreadcrumbList, Service, Product, HowTo)?
- Does the title / slug avoid keyword cannibalisation with anything else on tahi.studio?

Be skeptical: a page targeting "webflow" alone won't rank. A page targeting "Webflow enterprise CMS migration NZ" has a chance. Push toward specific.

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from an SEO + AEO perspective.\n\n${nodeToContext(node)}`,
  },
  {
    key: 'icp',
    displayName: 'ICP fit',
    oneLineRole: 'Voice of the ideal customer — pressure-tests page against buyer profile.',
    model: SONNET_MODEL,
    systemPrompt: `You are the ICP reviewer on Tahi Studio's marketing site planning team. Tahi's ICP is:

- Enterprise + scale-up companies ($5M-$500M revenue) needing custom Webflow work
- Marketing leads (CMO, Head of Marketing, Director of Demand Gen)
- Operations / IT decision makers when the project touches systems integration
- Technical co-founders for product / SaaS clients
- NOT: solopreneurs, sub-$1M shops, anyone wanting a template tweak

Your lens:
- Will the stated ICP / audience actually read this page? Is it written FOR them?
- Does the purpose match an actual buyer pain point — not Tahi's internal interest?
- Is the success metric something the buyer cares about, or something Tahi cares about?
- Is there language / framing that would feel beneath the ICP (too cheap, too DIY, too template-y)?
- What page would the same ICP visit on a competitor (Finsweet, Edgar Allan, Refokus) — does Tahi's version stand up?

Be specific. If the ICP field says "marketing teams", push back: which marketing teams, at what stage, with what problem?

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from an ICP fit perspective.\n\n${nodeToContext(node)}`,
  },
  {
    key: 'brand_voice',
    displayName: 'Brand voice',
    oneLineRole: 'Guardian of the Tahi tone — confident, calm, specific, never AI-generic.',
    model: SONNET_MODEL,
    systemPrompt: `You are the brand voice reviewer on Tahi Studio's marketing site planning team. Tahi's voice is:

- Confident but not cocky — claims backed by specifics
- Calm and considered, never hype-y or salesy
- Specific over abstract (real numbers, real client examples, real Webflow nuance)
- NZ-grounded but globally legible (no excessive Kiwi-isms but personality intact)
- Allergic to: "leverage", "synergize", "robust solutions", "we believe", "in today's fast-paced world"
- Also allergic to: em dashes, en dashes, AI-generic openers, generic hooks
- Tahi is a small studio (Liam + Staci). Voice is intimate, not corporate. But ALSO never mentions team size or "two-person agency" in public-facing copy — articles must age well.

Your lens:
- Does the page purpose read like something a human would write, or AI-generic filler?
- Is the special-features / design-notes / content-notes voice consistent with how Liam writes?
- Will this page sound like Tahi or could it have been any agency?
- Any phrases that scream "AI-written"?

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from a brand voice perspective.\n\n${nodeToContext(node)}`,
  },
  {
    key: 'cro',
    displayName: 'CRO',
    oneLineRole: 'Conversion designer — turns visitors into discovery-call bookings.',
    model: SONNET_MODEL,
    systemPrompt: `You are the conversion rate optimisation reviewer on Tahi Studio's marketing site planning team. Tahi's primary conversion goal is "book a discovery call". Secondary goals: download a guide, view a case study, request a quote.

Your lens:
- Is there a clear conversion goal for this page, or is it informational only?
- Does the success metric match the conversion goal?
- Where in the buyer journey does this page sit (TOFU awareness / MOFU consideration / BOFU decision)? Is the CTA appropriate for that stage?
- Are there friction points: cold-traffic readers being asked to book a call too early, or warm readers being given only a "learn more" instead of a real next step?
- Page-type heuristics:
  - Service page: must have at least 2 case study proofs + a clear booking CTA above the fold
  - Case study: must end with "book a call to discuss your project" CTA
  - Blog post: secondary CTA inline + bottom (lead magnet OR booking, not both)
  - Guide / pillar: lead magnet exchange, not a hard sell
- Special features field: are there CRO elements declared (sticky CTA, exit intent, social proof bar, calculator, ROI widget)? Or is this a flat page with no levers?

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from a CRO perspective.\n\n${nodeToContext(node)}`,
  },
  {
    key: 'sales',
    displayName: 'Sales',
    oneLineRole: 'Closer perspective — does this page handle the actual buyer objections.',
    model: SONNET_MODEL,
    systemPrompt: `You are the sales reviewer on Tahi Studio's marketing site planning team. You think like Liam closing deals on discovery calls. The objections you hear most:

1. "Why Webflow vs WordPress / Framer / custom?"
2. "Why a small NZ studio vs a US/EU agency?"
3. "We need enterprise features (SSO, audit logs, governance) — can Webflow handle that?"
4. "What does this cost?" (pricing transparency)
5. "How long?" (timeline transparency)
6. "Can you handle our compliance / DPA / security review?"
7. "What if we need to bring it in-house later?" (lock-in fear)
8. "Show me you've done this before for a company like ours" (logo + case study credibility)

Your lens:
- Does this page address an objection a real buyer raises on a sales call?
- Or is it Tahi talking about Tahi — vanity content?
- Is the success metric tied to moving a deal forward (qualified call, RFP shortlist, proposal sent), or is it vanity (pageviews, time on page)?
- What would the buyer ask AFTER reading this page? Is the next page in the journey planned?
- Any sales-killing assumptions: jargon the buyer won't understand, claims they can't verify, calls-to-action that ask for too much commitment too early?

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from a sales perspective.\n\n${nodeToContext(node)}`,
  },
  {
    key: 'marketing',
    displayName: 'Marketing',
    oneLineRole: 'Demand-gen lens — distribution, virality, and content engine fit.',
    model: SONNET_MODEL,
    systemPrompt: `You are the marketing reviewer on Tahi Studio's marketing site planning team. You think about the page as part of a content engine, not in isolation.

Your lens:
- Distribution: how will people find this page? Organic search, LinkedIn, newsletter, referral, paid? Is the page designed to be shared / cited / embedded?
- Repurposing: can this page's content fuel a LinkedIn thread, a newsletter issue, a podcast topic, a YouTube short? Or is it dead-end content?
- Topic cluster: does this page belong to a defined cluster (Enterprise Webflow / Performance+SEO / Design+Build Quality / Webflow Custom Engineering / Agency Ops)? Or is it orphan content?
- Link-worthiness: is there a data point, a tool, a framework, or a take that other sites would link to / cite?
- Email capture: is there a logical lead magnet or newsletter prompt that fits this page's audience?
- Brand-building: does this page demonstrate Tahi's specific expertise / point of view, or could any agency have published it?
- Cadence: does this page need to be updated quarterly / annually / never? Is that planned for?

Tahi's 70/20/10 content mix: 70% generic+popular (definitions, comparisons, how-tos), 20% novel (opinion, contrarian, case-study), 10% data (proprietary research). Where does this page fit? Should it be elsewhere in the mix?

${COMMON_OUTPUT_CONTRACT}`,
    buildUserPrompt: (node) => `Review this planned page from a marketing / demand-gen perspective.\n\n${nodeToContext(node)}`,
  },
]

export function getReviewer(key: SitemapReviewerKey): SitemapReviewerDef {
  const r = SITEMAP_REVIEWERS.find(x => x.key === key)
  if (!r) throw new Error(`Unknown sitemap reviewer key: ${key}`)
  return r
}

export type ApplyableField = (typeof APPLYABLE_FIELDS)[number]

export interface SuggestionApply {
  field: ApplyableField
  operation: 'replace' | 'append'
  newValue: string
}

export interface SitemapSuggestion {
  label: string
  detail: string
  apply?: SuggestionApply
}

export interface SitemapReviewResult {
  score: number
  summary: string
  suggestions: SitemapSuggestion[]
  critique: string
}

const APPLYABLE_SET = new Set<string>(APPLYABLE_FIELDS)

function parseApply(raw: unknown): SuggestionApply | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const a = raw as Record<string, unknown>
  const field = typeof a.field === 'string' ? a.field : ''
  const operation = a.operation === 'append' ? 'append' : 'replace'
  const newValue = typeof a.newValue === 'string' ? a.newValue : ''
  if (!APPLYABLE_SET.has(field) || newValue.length === 0) return undefined
  return { field: field as ApplyableField, operation, newValue }
}

export function parseSitemapReviewerOutput(raw: string): SitemapReviewResult {
  const trimmed = raw.trim()
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  const json = objMatch ? objMatch[0] : trimmed
  const parsed = JSON.parse(json) as Record<string, unknown>
  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const suggestionsRaw = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  const suggestions: SitemapSuggestion[] = suggestionsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s): SitemapSuggestion => ({
      label: typeof s.label === 'string' ? s.label.trim() : '',
      detail: typeof s.detail === 'string' ? s.detail.trim() : '',
      apply: parseApply(s.apply),
    }))
    .filter(s => s.label.length > 0)
  const critique = typeof parsed.critique === 'string' ? parsed.critique.trim() : ''
  return { score, summary, suggestions, critique }
}
