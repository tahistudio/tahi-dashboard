/**
 * Round-table leads — Phase I · Slice 9.
 *
 * Strategist + Headline Lab + Editor + Sign-off. These are the leadership
 * roles in the pipeline — they set the brief, frame the conversation,
 * arbitrate conflicts, and gate the publish.
 *
 * Each lead exposes:
 *   - systemPrompt (the role's persona + rubric)
 *   - buildUserPrompt (per-call payload assembly)
 *   - parse (JSON validator)
 *
 * Callable via lib/anthropic-cost.ts `claudeJson`.
 */

import type { ReviewerKey, FunnelIntent, ReviewerCritique } from '@/lib/round-table-reviewers'

export interface ResearchBriefSection {
  question: string
  content: string
  citations: Array<{ url: string }>
}

export interface ResearchBrief {
  topic: string
  angle: string | null
  sections: ResearchBriefSection[]
  allCitations: Array<{ url: string }>
}

// ── Strategist ────────────────────────────────────────────────────────────────

export interface StrategistOutput {
  intent: FunnelIntent
  priority: 'standard' | 'high'           // 'high' = generate 2 variants
  /** Author byline — Liam for marketing/business/engineering/CEO-shaped
   *  topics; Staci for design/creative/human-touch topics. Drives the
   *  voice overlay the writer loads. */
  author: 'liam' | 'staci'
  /** Content bucket per Tahi's 70/20/10 mix:
   *   generic  = comparison, news, how-to, definitional (~70%)
   *   novel    = opinion, contrarian, deep-research takes (~20%)
   *   data     = proprietary scrape-and-analyse pieces (~10%)
   *  Reviewers calibrate by bucket (originality stricter on novel). */
  contentBucket: 'generic' | 'novel' | 'data'
  /** REQUIRED. The information-gain delta — what does THIS article add
   *  that the top 10 SERP results for the target keyword DON'T already
   *  cover? Three specific items. Writer must hit these; originality
   *  reviewer verifies they're actually in the body. The single biggest
   *  lever against Google's March 2026 information-gain ranking signal. */
  whatsNetNew: string[]
  /** OPTIONAL but heavily encouraged. A first-hand operator anecdote
   *  the writer should weave in — one specific moment from a client
   *  engagement, named where possible. LLMs can't synthesise these;
   *  they're the strongest E-E-A-T signal a small agency can ship.
   *  Permission considerations: only include if the client has agreed
   *  to be referenced, OR anonymise to 'a UK fintech client' etc. */
  operatorAnecdote?: string | null
  workingTitle: string
  angle: string                           // one-liner of the unique angle
  targetWordCount: number
  primaryKeyword: string
  secondaryKeywords: string[]
  lsiTerms: string[]
  schemaTypes: string[]
  faqCount: number
  headings: Array<{ level: 2 | 3; text: string; wordTarget: number; mustCover: string[] }>
  internalLinkTargets: string[]
  outboundCitationTargets: number
  imageCount: number
  voiceWeights: Partial<Record<ReviewerKey, number>>
  /** Optional: brief explanation of why this angle vs others. Shows up
   *  in the Conflicts UI later. */
  rationale: string
}

export const STRATEGIST_SYSTEM = `You are the Senior Content Strategist at Tahi Studio, a Webflow agency. You sit at the head of the round table. Your job is to read the research brief + the working title and set the per-article brief that all downstream roles (writer + 23 reviewers + editor + sign-off) will execute against.

You decide:
- whatsNetNew: REQUIRED. List THREE specific things THIS article will add that the top 10 SERP results for the target keyword don't already cover. Each must be a concrete claim, data point, framework, or insight — not a generic angle. Examples of acceptable items: "An actual cost breakdown across 5 Webflow agencies (figures Tahi gathered)", "Three specific failure modes from Tahi's enterprise migration work", "A diagram of the CMS structure that allows X". Examples of UNACCEPTABLE items: "A unique perspective", "Tahi's take", "More depth than competitors". The writer's prompt repeats these three back at them and the originality reviewer verifies they're in the body.
- operatorAnecdote: OPTIONAL but heavily preferred. One first-hand operator moment from Tahi's client work, named where the client has been quoted publicly OR anonymised to 'a UK fintech client' / 'a NZ B2B SaaS' etc. Skip ONLY when the topic genuinely has no operator angle. LLMs can't synthesise these; they're the strongest E-E-A-T signal a small agency can ship. Never invent one.
- The funnel intent (one of: tofu_educational, mofu_comparison, bofu_conversion, how_to, thought_leadership, listicle, case_study, refresh)
- The AUTHOR ('liam' or 'staci'). Liam writes marketing, business, engineering, CEO-shaped, agency-ops, technical, and strategic topics. Staci is Creative Director — she writes design things, brand, craft, visual/UX, and anything with a strong human-touch / first-person creative angle. Pick based on the article's centre of gravity.
- The contentBucket ('generic' | 'novel' | 'data') per Tahi's 70/20/10 mix:
    generic  = comparison, news, how-to, definitional — the volume engine for AI Overview fan-out and long-tail search
    novel    = opinion, contrarian take, strategic essay — the brand engine, drives editorial backlinks
    data     = proprietary scrape-and-analyse piece with original numbers — the backlink engine, run rarely
- Whether this is "standard" (1 draft) or "high" priority (2 drafts in parallel, panel picks winner). High priority = high keyword opportunity OR strategically important for Tahi's positioning.
- The target word count — informed by SERP analysis if provided, otherwise: tofu 1200-1500, mofu 2200-2800, bofu 800-1200, how-to 1500-2000, thought leadership 800-1200, listicle 1500-3000, case study 1200-1800.
- The heading outline (H2 + H3) with per-heading word targets and "must cover" bullet points
- Primary keyword + secondary keywords + LSI terms
- Schema types (Article always, + FAQPage if FAQ section, + HowTo if step-by-step)
- Voice weights — adjust the reviewer weights up/down for this article's specific needs

You write a 'rationale' explaining the angle pick so Liam can see your reasoning.

HARD RULES (apply to every brief and to anything you write into the brief):
- NEVER mention Tahi's team size. No "2-person agency", "small team", "co-founders", "just the two of us", or any equivalent. Articles need to age well as the team grows.
- The brief language is INTERNAL — the writer reads it. Don't write Tahi voice copy in the brief itself.`

export function buildStrategistPrompt(input: {
  workingTitle: string
  cluster: string
  targetKeyword: string
  researchBrief: ResearchBrief
  serpAnalysis?: {
    medianWordCount?: number
    commonHeadings?: string[]
    schemaTypes?: string[]
  }
  defaultVoiceWeights: Partial<Record<ReviewerKey, number>>
  /** When a human rejected the previous brief, this is the feedback
   *  note. Re-strategise should address the concern explicitly. */
  rejectionFeedback?: string | null
}): string {
  return `Working title: ${input.workingTitle}
Cluster: ${input.cluster}
Target keyword: ${input.targetKeyword}

${input.rejectionFeedback ? `## HUMAN FEEDBACK FROM PREVIOUS BRIEF (you must address this)
${input.rejectionFeedback}

` : ''}## SERP analysis
${input.serpAnalysis
  ? `Median word count of top 10: ${input.serpAnalysis.medianWordCount ?? 'unknown'}
Common headings: ${(input.serpAnalysis.commonHeadings ?? []).join('; ') || 'unknown'}
Schema types used: ${(input.serpAnalysis.schemaTypes ?? []).join(', ') || 'unknown'}`
  : '(SERP analysis not yet wired — work from research brief alone)'}

## Research brief (5 sections)
${input.researchBrief.sections.map((s, i) => `### ${i + 1}. ${s.question}\n${s.content}`).join('\n\n')}

## Default voice weights (override only when needed)
${JSON.stringify(input.defaultVoiceWeights, null, 2)}

Respond with ONE JSON object only, matching this shape (no markdown fences):

{
  "intent": "tofu_educational|mofu_comparison|bofu_conversion|how_to|thought_leadership|listicle|case_study|refresh",
  "priority": "standard|high",
  "author": "liam|staci",
  "contentBucket": "generic|novel|data",
  "whatsNetNew": ["specific net-new item 1 (concrete claim, data, or framework)", "specific net-new item 2", "specific net-new item 3"],
  "operatorAnecdote": "optional: one first-hand client/operator moment Tahi can authentically write, anonymised if needed, or null if the topic has no operator angle",
  "workingTitle": "the refined title to draft against",
  "angle": "one-sentence angle that differentiates this from the SERP",
  "targetWordCount": number,
  "primaryKeyword": "...",
  "secondaryKeywords": ["...", "..."],
  "lsiTerms": ["...", "..."],
  "schemaTypes": ["Article", "FAQPage"],
  "faqCount": number,
  "headings": [
    { "level": 2, "text": "...", "wordTarget": number, "mustCover": ["...", "..."] }
  ],
  "internalLinkTargets": ["slug-1", "slug-2"],
  "outboundCitationTargets": number,
  "imageCount": number,
  "voiceWeights": { "seo_aeo": 1.5, "sales": 0.5, ... },
  "rationale": "1-2 sentences why this angle, why this author, why this bucket"
}`
}

export function parseStrategist(raw: string): StrategistOutput {
  const parsed = JSON.parse(raw) as Partial<StrategistOutput>
  if (!parsed.intent) throw new Error('Strategist missing intent')
  if (!parsed.workingTitle) throw new Error('Strategist missing workingTitle')
  if (!parsed.angle) throw new Error('Strategist missing angle')
  if (typeof parsed.targetWordCount !== 'number') throw new Error('Strategist missing targetWordCount')
  if (!Array.isArray(parsed.headings) || parsed.headings.length === 0) throw new Error('Strategist missing headings')
  if (!parsed.primaryKeyword) throw new Error('Strategist missing primaryKeyword')
  const author: 'liam' | 'staci' = parsed.author === 'staci' ? 'staci' : 'liam'
  const contentBucket: 'generic' | 'novel' | 'data' =
    parsed.contentBucket === 'novel' || parsed.contentBucket === 'data' ? parsed.contentBucket : 'generic'
  const whatsNetNew = Array.isArray(parsed.whatsNetNew)
    ? parsed.whatsNetNew.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 5)
    : []
  const operatorAnecdote = typeof parsed.operatorAnecdote === 'string' && parsed.operatorAnecdote.trim().length > 0
    ? parsed.operatorAnecdote.trim() : null
  return {
    intent: parsed.intent,
    priority: parsed.priority ?? 'standard',
    author,
    contentBucket,
    whatsNetNew,
    operatorAnecdote,
    workingTitle: parsed.workingTitle,
    angle: parsed.angle,
    targetWordCount: parsed.targetWordCount,
    primaryKeyword: parsed.primaryKeyword,
    secondaryKeywords: parsed.secondaryKeywords ?? [],
    lsiTerms: parsed.lsiTerms ?? [],
    schemaTypes: parsed.schemaTypes ?? ['Article'],
    faqCount: parsed.faqCount ?? 6,
    headings: parsed.headings,
    internalLinkTargets: parsed.internalLinkTargets ?? [],
    outboundCitationTargets: parsed.outboundCitationTargets ?? 4,
    imageCount: parsed.imageCount ?? 3,
    voiceWeights: parsed.voiceWeights ?? {},
    rationale: parsed.rationale ?? '',
  }
}

// ── Headline Lab ─────────────────────────────────────────────────────────────

export interface HeadlineLabOutput {
  finalists: Array<{
    title: string
    metaTitle: string
    metaDescription: string
    pattern: 'number' | 'question' | 'contrarian' | 'how_to' | 'comparison' | 'definition'
    seoScore: number       // 0-100
    croScore: number
    marketerScore: number
    reasoning: string
  }>
  recommendation: number   // index into finalists
}

export const HEADLINE_LAB_SYSTEM = `You are the Headline Lab — three reviewers in one prompt working together: an SEO/AEO reviewer, a CRO/conversion expert, and a marketer.

Together you produce 3 finalist titles for the draft. Each finalist must have:
- Title (the H1) — 50-65 chars ideally
- Meta title (what appears in SERP) — 50-60 chars
- Meta description — 145-160 chars
- One of 6 pattern types: number, question, contrarian, how_to, comparison, definition
- Score from each of you (SEO, CRO, Marketer) 0-100
- Reasoning

You recommend ONE finalist (by index) and explain why.`

export function buildHeadlineLabPrompt(input: {
  workingTitle: string
  angle: string
  primaryKeyword: string
  intent: FunnelIntent
}): string {
  return `Working title: ${input.workingTitle}
Angle: ${input.angle}
Primary keyword: ${input.primaryKeyword}
Intent: ${input.intent}

Produce 3 finalists using different patterns. Respond JSON only:

{
  "finalists": [
    {
      "title": "...",
      "metaTitle": "...",
      "metaDescription": "...",
      "pattern": "number|question|contrarian|how_to|comparison|definition",
      "seoScore": number,
      "croScore": number,
      "marketerScore": number,
      "reasoning": "..."
    }
  ],
  "recommendation": 0
}`
}

export function parseHeadlineLab(raw: string): HeadlineLabOutput {
  const parsed = JSON.parse(raw) as Partial<HeadlineLabOutput>
  if (!Array.isArray(parsed.finalists) || parsed.finalists.length === 0) {
    throw new Error('Headline Lab returned no finalists')
  }
  return {
    finalists: parsed.finalists,
    recommendation: typeof parsed.recommendation === 'number' ? parsed.recommendation : 0,
  }
}

// ── Writer ───────────────────────────────────────────────────────────────────

export interface WriterOutput {
  bodyMarkdown: string
  wordCount: number
  /** Optional: list of slugs the writer linked to internally so the
   *  Editor can verify against the brief's link targets. */
  internalLinksUsed: string[]
  /** Optional: list of outbound URLs the writer cited so the validator
   *  can HEAD-check them. */
  outboundLinksUsed: string[]
}

export const WRITER_SYSTEM = `You are the Senior Writer at Tahi Studio. You write in the Tahi tone of voice with a per-article author overlay — the strategist has picked Liam (marketing/business/engineering/CEO topics) or Staci (design/creative/human-touch topics) as the byline for this article. The Tahi tone of voice + the author's personal voice document + AI Writing Tells (anti-patterns to avoid) are loaded in the user prompt — read them carefully and write IN that voice.

Universal voice rules that apply to every Tahi article:
- Never use em dashes or en dashes. Use commas, parens, periods, or colons.
- Never write "Let's explore", "In this article", "In conclusion", "delve into", "navigate the complexities of", "in today's fast-paced world", or any equivalent AI-tell phrase listed in the AI Writing Tells doc.
- Vary paragraph lengths. Use one-sentence paragraphs for emphasis.
- Back claims with specifics — numbers, names, dates, examples.
- Never mention Tahi's team size. No "2-person agency", "small team", "co-founders", "just the two of us", or any equivalent. Articles need to age well as the team grows.
- FAQ formatting: questions are PLAIN TEXT only — no markdown links, no inline formatting. The Webflow CMS field for the question is plain text. Answers CAN and SHOULD use inline links where citation or internal-linking is natural — they render as rich text. Example: Q "What is Webflow CMS?" (no links). A "Webflow CMS is a built-in [content management system](https://webflow.com/cms) with collections, references, and a visual editor."

You will receive a brief from the Strategist. Follow it precisely: hit the heading outline, the word target ±15%, the primary keyword in the first 100 words + title + first H2, the FAQ count, and the schema requirements.

## AEO + ranking mandates (apply to EVERY article)

1. **whatsNetNew** — the strategist's brief lists 3 specific things this article must add that the SERP doesn't. EACH must appear as a concrete claim or section in the body, not a vague gesture. The originality reviewer verifies this.

2. **operatorAnecdote** — if the brief includes one, weave it into the body as a named (or anonymised) first-hand moment. Use phrasing like "In a recent Tahi engagement with a UK fintech client, X happened" or "When we rebuilt Glasswall on Webflow, the conversion lift was Y%". Never invent client details; only use what the brief gave you.

3. **Specific numbers, not vague qualifiers** — at least 3 specific verifiable numbers per article. NOT "many agencies", "significant improvement", "various tools". USE "11 of the 23 agencies surveyed", "47% conversion lift in 90 days", "$2,400 monthly retainer". Source the numbers from the research brief.

4. **Q-shaped H2s wherever the structure admits it** — write H2s as questions where natural, not statements. "What is Webflow CMS?" beats "Webflow CMS overview". Matches how AI Overviews fan out into sub-queries. (Not every H2 — but the body should have 2-4 question-shaped H2s.)

5. **Comparison table where the topic admits one** — if the article compares 2+ options (platforms, agencies, pricing, approaches), produce a markdown table. AI engines extract 3x more from tables vs prose for comparison queries.

6. **"Common mistakes" numbered list where applicable** — for how-to and educational posts, include a numbered "Common mistakes" or "What goes wrong" section. Disproportionately cited by AI engines for "How NOT to X" queries.

7. **Auto-link named tools on FIRST mention** — when the body first mentions Webflow, Figma, Stripe, Cursor, Lovable, HubSpot, Notion, Linear, Vercel, Cloudflare, Finsweet, Memberstack, Outseta, WordPress, Squarespace, Wix, Framer, or any other named SaaS/tool, link to its official site. Later mentions stay plain text. This feeds the schema engine that auto-detects tool mentions; consistency matters.

Output the body as MARKDOWN ONLY (## headings, **bold**, [links](url), - lists, > quotes, | tables |). Do not output HTML — it's rendered downstream. Keeping output to markdown alone is critical so the JSON response doesn't truncate.`

export function buildWriterPrompt(input: {
  brief: StrategistOutput
  researchBrief: ResearchBrief
  brandDocs?: string
  /** Pre-rendered blog context block (slugs + recent posts + linking
   *  rules) from lib/blog-context.ts. */
  blogContext?: string
  variantLabel?: 'A' | 'B'
  variantInstruction?: string  // for high-priority A/B: "approach this as a deep-dive" vs "approach as listicle"
}): string {
  const variantNote = input.variantLabel
    ? `\nYou are writing VARIANT ${input.variantLabel}. ${input.variantInstruction ?? ''}\n`
    : ''
  return `## Strategist brief
${JSON.stringify(input.brief, null, 2)}

## Research brief (use facts + citations from here)
${input.researchBrief.sections.map(s => `### ${s.question}\n${s.content}\n\nCitations: ${s.citations.map(c => c.url).join(', ')}`).join('\n\n')}

${input.blogContext ?? ''}

## Sourcing rules (STRICT)
- When you state a statistic, study finding, or factual claim drawn from the research brief, INLINE-LINK the specific phrase to the source URL using [phrase](url) right where the claim appears. Do not dump sources in a list at the end.
- Only cite URLs that appear in the research brief above.
- DO NOT link to other Webflow agencies, design studios, or development agencies. Tahi Studio is itself a Webflow agency, so linking to competitors sends our readers to their site. If you'd otherwise cite an agency post, instead link to the underlying PRODUCT (Webflow, Figma, Stripe, Vercel, etc.), the official documentation, a standards body (w3.org, web.dev), or a research/news outlet (Nielsen Norman, A List Apart, Smashing Magazine, news sites). If you can't find a non-agency source, drop the link and state the claim plainly without one — that's better than sending the reader to a competitor.
- Internal links to other Tahi posts use the relative /slug form per the linking rules.

## Voice — load and write in this voice
${input.brandDocs ?? '(no Docs Hub context available — default to a tight, opinionated, no-em-dash voice; never mention team size)'}
${variantNote}
Respond JSON only (markdown body, NOT html):

{
  "bodyMarkdown": "full markdown body",
  "wordCount": number,
  "internalLinksUsed": ["slug-1", "slug-2"],
  "outboundLinksUsed": ["https://...", "https://..."]
}`
}

export function parseWriter(raw: string): WriterOutput {
  const parsed = JSON.parse(raw) as Partial<WriterOutput>
  if (!parsed.bodyMarkdown) throw new Error('Writer missing body')
  return {
    bodyMarkdown: parsed.bodyMarkdown,
    wordCount: parsed.wordCount ?? estimateWords(parsed.bodyMarkdown),
    internalLinksUsed: parsed.internalLinksUsed ?? [],
    outboundLinksUsed: parsed.outboundLinksUsed ?? [],
  }
}

function estimateWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// ── Editor ───────────────────────────────────────────────────────────────────

export interface EditorOutput {
  bodyMarkdown: string
  /** Summary of what changed vs the previous revision. Used in the
   *  Conflicts UI to explain the editor's reasoning. */
  changesSummary: string
  /** Conflict resolutions — pairs of reviewers whose advice disagreed
   *  and the editor's pick. Liam can later override these in the
   *  Conflicts review slide-over. */
  conflictResolutions: Array<{
    reviewerA: ReviewerKey
    reviewerB: ReviewerKey
    topic: string
    picked: 'a' | 'b' | 'compromise'
    reasoning: string
  }>
  /** Composite weighted score (0-100). Editor's own assessment after
   *  applying all reviewer feedback. */
  weightedScore: number
}

export const EDITOR_SYSTEM = `You are the Editor. You receive a draft + critiques from 23 reviewers, each with their voice weight set by the Strategist. Your job is to:

1. Identify CONFLICTS — places where two reviewers gave opposing advice. For each, pick one (or a compromise) and log your reasoning.
2. Apply the consensus + your conflict resolutions to produce a new revision.
3. Compute a weighted composite score (sum of score * weight / sum of weights).
4. Return the new body + a changes summary + the conflict log.

Veto rules:
- If anti_ai, tahi_voice, brand_tone, or citations returned hard_fail, you MUST address those issues before returning.
- If unable to resolve a hard_fail in this pass, set weightedScore to the post-fix estimate and explain in changesSummary which veto needs another revision.

Never use em dashes. Preserve the writer's voice — you're polishing, not rewriting from scratch.

Output the edited body as MARKDOWN ONLY. Do not output HTML — it's rendered downstream. This keeps the JSON response from truncating on a long article.`

export function buildEditorPrompt(input: {
  brief: StrategistOutput
  currentBodyMarkdown: string
  currentBodyHtml: string
  reviews: Array<{
    reviewerKey: ReviewerKey
    weight: number
    critique: ReviewerCritique
  }>
}): string {
  return `## Strategist brief (sticky)
${JSON.stringify(input.brief, null, 2)}

## Current draft (markdown)
${input.currentBodyMarkdown.slice(0, 24000)}

## Reviewer critiques
${input.reviews.map(r => `### ${r.reviewerKey} (weight ${r.weight}, score ${r.critique.score}, verdict ${r.critique.verdict})
Summary: ${r.critique.summary}
Strengths: ${r.critique.strengths.join('; ')}
Issues: ${r.critique.issues.map(i => `[${i.severity}] ${i.description}${i.suggestedFix ? ' → ' + i.suggestedFix : ''}`).join(' | ')}`).join('\n\n')}

Respond JSON only (markdown body, NOT html):

{
  "bodyMarkdown": "edited markdown",
  "changesSummary": "what you changed and why",
  "conflictResolutions": [
    { "reviewerA": "...", "reviewerB": "...", "topic": "...", "picked": "a|b|compromise", "reasoning": "..." }
  ],
  "weightedScore": number
}`
}

export function parseEditor(raw: string): EditorOutput {
  const parsed = JSON.parse(raw) as Partial<EditorOutput>
  if (!parsed.bodyMarkdown) throw new Error('Editor missing body')
  return {
    bodyMarkdown: parsed.bodyMarkdown,
    changesSummary: parsed.changesSummary ?? '',
    conflictResolutions: parsed.conflictResolutions ?? [],
    weightedScore: typeof parsed.weightedScore === 'number' ? parsed.weightedScore : 0,
  }
}

// ── Structuring (decompose into Webflow CMS fields) ───────────────────────────

export interface StructuredDraft {
  /** The article body with FAQ + key-takeaways sections REMOVED — those
   *  have their own Webflow fields. Markdown. */
  bodyMarkdownClean: string
  faqs: Array<{ q: string; a: string }>     // up to 6
  /** A short heading that frames the FAQ block, topic-specific (e.g.
   *  "Common questions about Webflow security"). Maps to the FAQ section
   *  heading CMS field. */
  faqSectionHeading: string
  keyTakeaways: string[]                     // 3-5 bullet strings
  metaTitle: string                          // <= 60 chars
  metaDescription: string                    // 145-160 chars
  summary: string                            // 1-2 sentence post summary
  postExcerpt: string                        // short teaser
  shortenedName: string                      // short label for cards/nav
  /** Purpose-written "what to ask AI about this post" prompt. Lands in
   *  the Webflow `ai-prompt` field. NOT a duplicate of the summary —
   *  framed as a curiosity-driving question or instruction the reader
   *  could paste into ChatGPT/Claude to dig deeper on this topic. */
  aiPrompt: string
}

export const STRUCTURE_SYSTEM = `You are a CMS structuring assistant. You take a finished blog article (markdown) and split it into the discrete fields a Webflow Blog Posts collection expects, so each piece lands in the right CMS field and the post renders correctly.

Rules:
- bodyMarkdownClean: the full article body, but REMOVE any "FAQ"/"Frequently asked questions" section and any "Key takeaways" section — those go in their own fields. Keep everything else verbatim (headings, paragraphs, links, lists). Do not rewrite.
- faqs: extract 4-6 Q/A pairs. If the article had an FAQ section, use those. If not, derive sensible ones from the content. Keep answers to 1-3 sentences. Question text is PLAIN TEXT only — no markdown links, no inline formatting (the Webflow CMS field is plain text). Answers CAN preserve inline markdown links from the source body where they appear; the answer field renders as rich text. If a question in the source body contains a link, strip the link wrapper and keep only the text.
- faqSectionHeading: a short, topic-specific heading that frames the FAQ block (e.g. "Common questions about Webflow security", not just "FAQs"). 4-8 words.
- keyTakeaways: 3-5 punchy one-line takeaways.
- metaTitle <= 60 chars, metaDescription 145-160 chars, summary 1-2 sentences, postExcerpt a short teaser, shortenedName a short card label.
- aiPrompt: a 1-2 sentence prompt the reader could paste into ChatGPT/Claude/Perplexity to dig deeper on this specific article's topic. NOT a duplicate of the summary. Frame as a curiosity-driving question or instruction. Example: "Compare Tahi's approach to enterprise Webflow governance with how three other top Webflow agencies handle SOC 2 readiness for their clients." Make it specific to THIS article's angle.
- Never use em dashes.`

export function buildStructurePrompt(input: {
  title: string
  metaTitle: string | null
  metaDescription: string | null
  bodyMarkdown: string
}): string {
  return `Title: ${input.title}
Existing meta title: ${input.metaTitle ?? '(none)'}
Existing meta description: ${input.metaDescription ?? '(none)'}

## Article body (markdown)
${input.bodyMarkdown}

Respond JSON only:

{
  "bodyMarkdownClean": "article body with FAQ + key-takeaways sections removed, everything else verbatim",
  "faqs": [{ "q": "...", "a": "..." }],
  "faqSectionHeading": "topic-specific FAQ heading, 4-8 words",
  "keyTakeaways": ["...", "..."],
  "metaTitle": "<= 60 chars",
  "metaDescription": "145-160 chars",
  "summary": "1-2 sentences",
  "postExcerpt": "short teaser",
  "shortenedName": "short label",
  "aiPrompt": "1-2 sentence purpose-written 'ask AI about this' prompt, specific to this article"
}`
}

/** Strip markdown links from a string, keeping only the visible text.
 *  Defensive guard for FAQ questions (Webflow plain-text field). Also
 *  strips bare `<...>` HTML tags. */
function stripMarkdownLinksAndTags(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) -> text
    .replace(/<[^>]+>/g, '')                    // strip stray HTML
    .trim()
}

export function parseStructure(raw: string): StructuredDraft {
  const parsed = JSON.parse(raw) as Partial<StructuredDraft>
  if (!parsed.bodyMarkdownClean) throw new Error('Structuring missing bodyMarkdownClean')
  return {
    bodyMarkdownClean: parsed.bodyMarkdownClean,
    // FAQ questions land in a Webflow plain-text field. Strip any
    // markdown link wrappers the model might leave in q. Answers keep
    // their links (rich-text field).
    faqs: (parsed.faqs ?? [])
      .filter(f => f.q && f.a)
      .slice(0, 6)
      .map(f => ({ q: stripMarkdownLinksAndTags(f.q), a: f.a })),
    faqSectionHeading: (parsed.faqSectionHeading ?? 'Frequently asked questions').slice(0, 90),
    keyTakeaways: (parsed.keyTakeaways ?? []).filter(Boolean).slice(0, 5),
    metaTitle: (parsed.metaTitle ?? '').slice(0, 60),
    metaDescription: (parsed.metaDescription ?? '').slice(0, 200),
    summary: parsed.summary ?? '',
    postExcerpt: parsed.postExcerpt ?? '',
    shortenedName: parsed.shortenedName ?? '',
    aiPrompt: parsed.aiPrompt ?? '',
  }
}

// ── Liam's manual edit pass (guardrailed) ─────────────────────────────────────

export interface LiamEditOutput {
  bodyMarkdown: string
  /** Bullet list of exactly what changed, so Liam can verify the model
   *  didn't touch anything he didn't ask for. */
  changeLog: string[]
  /** True if the model judged any instruction too ambiguous/risky to apply
   *  without guessing — surfaced to Liam rather than guessed at. */
  skipped: Array<{ instruction: string; reason: string }>
}

export const LIAM_EDIT_SYSTEM = `You are a precise copy editor applying Liam's specific, hand-written change requests to a finished blog draft. This is a surgical pass, NOT a rewrite.

HARD GUARDRAILS (follow exactly):
- Apply ONLY the changes Liam asks for. Change nothing else.
- Preserve every sentence, heading, link, and paragraph he did not mention, verbatim.
- Do not "improve", reword, re-order, or restructure anything outside his instructions.
- Do not change the title, headings, or links unless explicitly told to.
- Never use em dashes. Match the surrounding voice when you add or alter text.
- If an instruction is ambiguous or would require guessing at his intent, DO NOT guess — add it to "skipped" with a short reason and leave that part of the draft untouched.
- Return the FULL body markdown (the unchanged parts included, verbatim) plus a changeLog listing each edit you made.`

export function buildLiamEditPrompt(input: {
  currentBodyMarkdown: string
  instructions: string
}): string {
  return `## Current draft (markdown) — preserve everything except what the instructions below change
${input.currentBodyMarkdown}

## Liam's edit instructions (apply ONLY these)
${input.instructions}

Respond JSON only:

{
  "bodyMarkdown": "the FULL body with only the requested edits applied, everything else verbatim",
  "changeLog": ["edit 1 you made", "edit 2 you made"],
  "skipped": [{ "instruction": "...", "reason": "why you didn't apply it" }]
}`
}

export function parseLiamEdit(raw: string): LiamEditOutput {
  const parsed = JSON.parse(raw) as Partial<LiamEditOutput>
  if (!parsed.bodyMarkdown) throw new Error('Liam edit missing body')
  return {
    bodyMarkdown: parsed.bodyMarkdown,
    changeLog: parsed.changeLog ?? [],
    skipped: parsed.skipped ?? [],
  }
}

// ── Sign-off ─────────────────────────────────────────────────────────────────

export interface SignOffOutput {
  score: number              // 0-100
  passes: boolean            // score >= 75
  finalNotes: string
  recommendCover: string     // one-line prompt for the cover generator
  recommendPublishWindow: 'immediate' | 'next_mwf' | 'next_high_intent'
}

export const SIGN_OFF_SYSTEM = `You are the final Sign-off reviewer. You read the polished draft once more as a fresh-eye reader and rate it 0-100. You must hit 75 for the draft to be ready_for_publish.

You also recommend:
- A one-line prompt for the cover generator (flat illustration, brand colors)
- A publish window: 'immediate' / 'next_mwf' / 'next_high_intent' (e.g. Tuesday for B2B engagement spikes)`

export function buildSignOffPrompt(input: {
  brief: StrategistOutput
  bodyMarkdown: string
  editorWeightedScore: number
}): string {
  return `Brief: ${JSON.stringify(input.brief, null, 2)}

Editor's weighted score: ${input.editorWeightedScore}

Body (markdown):
${input.bodyMarkdown.slice(0, 22000)}

Respond JSON only:

{
  "score": number,
  "passes": boolean,
  "finalNotes": "what you'd tell Liam before he publishes",
  "recommendCover": "one-line cover image prompt",
  "recommendPublishWindow": "immediate|next_mwf|next_high_intent"
}`
}

export function parseSignOff(raw: string): SignOffOutput {
  const parsed = JSON.parse(raw) as Partial<SignOffOutput>
  if (typeof parsed.score !== 'number') throw new Error('Sign-off missing score')
  return {
    score: parsed.score,
    passes: parsed.passes ?? (parsed.score >= 75),
    finalNotes: parsed.finalNotes ?? '',
    recommendCover: parsed.recommendCover ?? 'flat illustration of a leaf-shaped abstract composition',
    recommendPublishWindow: parsed.recommendPublishWindow ?? 'next_mwf',
  }
}
