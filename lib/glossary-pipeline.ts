/**
 * Glossary content engine.
 *
 * Three tiers — pick based on the term's potential:
 *
 *   Tier 1 (lib/glossary-backfill.ts, existing)
 *     Deterministic schema + date refresh. No LLM. $0/term.
 *
 *   Tier 2 (auditGlossaryTerm, this file)
 *     Haiku 4.5 scorecard: definition clarity, snippet readiness,
 *     citation rigor, structure, AEO citability. ~$0.01/term.
 *
 *   Tier 3 (generateGlossaryEntry, this file)
 *     Perplexity research → Sonnet writer → 5-reviewer panel →
 *     Sonnet editor (only when worst review < 75). ~$0.30/term.
 *
 * Different ranking math than blog content — glossary wins on
 * definition clarity + snippet readiness + AI-engine citability, NOT
 * on opinion or anecdote. The reviewer panel reflects that.
 */

import { claudeJson } from '@/lib/anthropic-cost'
import { SONNET_MODEL, HAIKU_MODEL } from '@/lib/ai-models'
import { buildResearchBrief } from '@/lib/perplexity'
import type { db } from '@/lib/db'

type Database = Awaited<ReturnType<typeof db>>

function parseJsonLoose<T>(raw: string): T {
  // Trim code fences if the model wrapped the JSON.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Fall back: find the outermost { ... } and parse that.
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('No JSON object found in response')
    return JSON.parse(match[0]) as T
  }
}

// ─── Tier 2: audit / scorecard ─────────────────────────────────────────────

export interface GlossaryScorecard {
  definitionClarity: number
  snippetReadiness: number
  citationRigor: number
  structureCompleteness: number
  aeoCitability: number
  overall: number
  improvements: string[]
  costCents: number
}

const AUDIT_SYSTEM = `You are auditing a glossary entry from Tahi Studio's Webflow / agency vocabulary. Your job is to score it on 5 dimensions that drive ranking + AI-engine citability, and identify the 3-5 highest-leverage improvements.

DIMENSIONS (each 0-100):

1. DEFINITION CLARITY — first 40-60 words should give a clean, plain-English definition. No jargon stacks, no "let's explore" preamble.

2. SNIPPET READINESS — would Google's featured snippet engine extract a coherent 40-50 word answer? Definition sentence followed by 1-2 attributes.

3. CITATION RIGOR — 2-3 inline citations to authoritative external sources (W3C, official docs, named publications, peer-reviewed studies)? Zero = under 30. Marketing-only links = under 60.

4. STRUCTURE COMPLETENESS — definition → key concepts → at least 1 named example → related terms → 3+ FAQ-shaped H2s.

5. AEO CITABILITY — would ChatGPT / Perplexity cite this for definitional, comparison, or how-to queries? Strong signals: comparison tables, "vs" sections, common-mistakes list, named examples (not "many tools").

OUTPUT JSON ONLY (no fences):
{
  "definitionClarity": 0-100,
  "snippetReadiness": 0-100,
  "citationRigor": 0-100,
  "structureCompleteness": 0-100,
  "aeoCitability": 0-100,
  "improvements": ["specific actionable fix 1", "specific actionable fix 2", ...]
}`

interface AuditInput {
  term: string
  definition: string
  bodyMarkdown: string
  bodyHtml: string
}

export async function auditGlossaryTerm(
  database: Database,
  termId: string,
  input: AuditInput,
): Promise<GlossaryScorecard> {
  const userPrompt = `Term: ${input.term}

Current definition (first 600 chars):
${input.definition.slice(0, 600)}

Full body (first 2000 chars):
${input.bodyMarkdown.slice(0, 2000)}

Audit this entry and return the JSON scorecard.`

  const { result, costCents } = await claudeJson<{
    definitionClarity: number
    snippetReadiness: number
    citationRigor: number
    structureCompleteness: number
    aeoCitability: number
    improvements: string[]
  }>({
    database,
    scope: 'backfill',
    scopeId: termId,
    stage: 'glossary_audit',
    model: HAIKU_MODEL,
    systemPrompt: AUDIT_SYSTEM,
    userPrompt,
    maxTokens: 1024,
    parse: parseJsonLoose,
    skipCostCap: true,
  })

  const overall = Math.round(
    (result.definitionClarity * 0.20)
    + (result.snippetReadiness * 0.20)
    + (result.citationRigor * 0.15)
    + (result.structureCompleteness * 0.20)
    + (result.aeoCitability * 0.25),
  )
  return { ...result, overall, costCents }
}

// ─── Tier 3: generate / rewrite ────────────────────────────────────────────

export interface GeneratedGlossaryEntry {
  term: string
  alsoKnownAs: string[]
  definition: string
  bodyMarkdown: string
  faqs: Array<{ question: string; answer: string }>
  examples: string[]
  commonMistakes: string[]
  citations: Array<{ url: string; title?: string }>
  relatedTerms: string[]
  metaTitle: string
  metaDescription: string
  authorSlug: 'liam' | 'staci'
  category: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
}

export interface GenerateResult extends GeneratedGlossaryEntry {
  totalCostCents: number
  stages: Array<{ name: string; costCents: number; notes?: string }>
}

const WRITER_SYSTEM = `You are writing a glossary entry for Tahi Studio's resources hub at tahi.studio/resources/glossary. Tahi is a Webflow agency serving B2B SaaS and enterprise marketing teams.

GLOSSARY entries are DIFFERENT from blog posts:
- Snippet-ready: first 40-60 words must be a clean definition Google could extract for a featured snippet
- Structured > narrative: scannable sections, NOT a story
- Authoritative > opinionated: cite real sources, don't editorialise
- 600-1500 words sweet spot (NOT blog-length)
- Body structure: definition → key concepts → 2-4 named examples → related concepts → common mistakes (if applicable)

VOICE: Tahi house voice. Direct, plain English, no jargon stacking. NO em-dashes. NO en-dashes. NO "delve / leverage / robust / seamless / comprehensive / navigate the complexities / in today's fast-paced / circle back". Use commas, parens, periods.

CRITICAL — DO NOT EMIT H1. The term name is the page H1 (set by Webflow). Start with paragraph or H2.

OUTPUT JSON ONLY (no fences):
{
  "term": "exact term name",
  "alsoKnownAs": ["synonym 1", "synonym 2"],
  "definition": "40-60 words, snippet-ready",
  "bodyMarkdown": "600-1500 words, ## headings only, no H1",
  "faqs": [{"question": "...", "answer": "..."}, ...],
  "examples": ["concrete named example 1", ...],
  "commonMistakes": ["specific mistake 1", ...],
  "citations": [{"url": "https://...", "title": "..."}, ...],
  "relatedTerms": ["related-term-slug", ...],
  "metaTitle": "Term Name | Tahi Glossary (50-60 char)",
  "metaDescription": "145-160 char SERP description",
  "authorSlug": "liam" or "staci",
  "category": "design" | "dev" | "seo" | "business" | "agency-ops" | "webflow",
  "difficulty": "beginner" | "intermediate" | "advanced"
}

AUTHOR SELECTION:
- Liam: business, dev, SEO, agency-ops, webflow-technical topics
- Staci: design, brand, UX, accessibility, sustainable web topics`

const REVIEWER_PANEL = [
  {
    key: 'definition_clarity',
    system: 'You are the Definition Clarity reviewer. Score 0-100 on whether the first 40-60 words is a clean plain-English definition a non-expert understands. Jargon stacks / preamble / banned AI tells (delve, leverage, robust, seamless, comprehensive, in today\'s, em-dashes) = under 60. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "one specific sentence to fix"}',
  },
  {
    key: 'snippet_readiness',
    system: 'You are the Featured-Snippet reviewer. Would Google extract a coherent 40-50 word featured snippet from the entry? First sentence must be definition; next 1-2 must give key attributes. Buried answer = under 50. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'citation_rigor',
    system: 'You are the Citation Rigor reviewer. Does the entry cite 2-3 authoritative external sources (W3C / MDN / official docs / peer-reviewed studies / named publications) inline where claims are made? Zero = under 30. Marketing-only = under 60. Two strong inline = 80+. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'structure_completeness',
    system: 'You are the Structure reviewer for glossary entries. Required: (1) headline definition, (2) key concepts section with H2, (3) at least 1 concrete named example, (4) related terms named in body, (5) at least 3 FAQ-shaped H2s. Score 0-100 based on completeness. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'aeo_citability',
    system: 'You are the AEO reviewer. Would ChatGPT / Perplexity / Google AI Mode cite this entry for definitional, comparison, or how-to queries? Strong signals: comparison tables, "vs" sections, common-mistakes list, named examples (not "many tools"), inline citations. Generic prose-only = under 40. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
] as const

const EDITOR_SYSTEM = `You are the editor on a glossary entry. You receive (1) the writer's draft and (2) critique JSON from 5 specialist reviewers. Produce a revised version that addresses every reviewer's fixSuggestion while preserving the writer's structural choices.

CRITICAL RULES (do not violate):
- Definition stays 40-60 words, snippet-ready
- NO em-dashes anywhere
- No "delve / leverage / robust / seamless / comprehensive / navigate the complexities / in today's fast-paced" or any equivalent AI tell
- Don't invent citations — leave a citation out rather than fabricate
- Body stays 600-1500 words
- NO H1 in body

OUTPUT JSON — same shape as the writer.`

interface GenerateOptions {
  database: Database
  authorSlug?: 'liam' | 'staci'
  /** Skip Perplexity research when false. Default true. */
  research?: boolean
  /** Track cost against a draft id (optional). */
  scopeId?: string
}

export async function generateGlossaryEntry(
  term: string,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const stages: GenerateResult['stages'] = []
  let totalCostCents = 0

  // 1) Research (Perplexity, free for our quota). buildResearchBrief
  //    returns structured sections + citations; we flatten into a brief
  //    string for the writer.
  let researchBrief = ''
  if (opts.research !== false) {
    try {
      const research = await buildResearchBrief(term, 'glossary definition with authoritative sources, examples, and comparison points')
      researchBrief = research.sections.map(s => `## ${s.question}\n${s.content}`).join('\n\n')
      stages.push({ name: 'research', costCents: 0, notes: `${research.allCitations.length} sources` })
    } catch (err) {
      stages.push({ name: 'research', costCents: 0, notes: `skipped: ${err instanceof Error ? err.message.slice(0, 60) : 'fail'}` })
    }
  }

  // 2) Writer (Sonnet).
  const writerUserPrompt = `Term: ${term}

${researchBrief ? `Research brief (use as ground-truth for facts + citations):\n${researchBrief.slice(0, 6000)}\n\n` : ''}${opts.authorSlug ? `Forced author: ${opts.authorSlug}` : 'Pick the right author (liam or staci) based on the topic.'}

Write the glossary entry as JSON per the system prompt.`

  const writerResult = await claudeJson<GeneratedGlossaryEntry>({
    database: opts.database,
    scope: 'backfill',
    scopeId: opts.scopeId,
    stage: 'glossary_writer',
    model: SONNET_MODEL,
    systemPrompt: WRITER_SYSTEM,
    userPrompt: writerUserPrompt,
    maxTokens: 4096,
    parse: parseJsonLoose,
    skipCostCap: true,
  })
  let draft = writerResult.result
  totalCostCents += writerResult.costCents
  stages.push({ name: 'writer', costCents: writerResult.costCents })

  // 3) Reviewer panel (5 parallel Haiku calls). The draft text is the
  //    same across all 5 — bigger than 1024 tokens — so it's a perfect
  //    cache target. First reviewer pays full price + creates the cache;
  //    next 4 hit the 10% read tier. ~60% cost reduction on the panel.
  interface ReviewerOutput { score: number; fixSuggestion?: string }
  const draftAsContext = `Entry to review:\n${JSON.stringify(draft, null, 2)}`
  const reviews = await Promise.allSettled(REVIEWER_PANEL.map(r =>
    claudeJson<ReviewerOutput>({
      database: opts.database,
      scope: 'backfill',
      scopeId: opts.scopeId,
      stage: `glossary_review_${r.key}`,
      model: HAIKU_MODEL,
      // Reviewer-specific instructions stay in systemPrompt (varies per
      // reviewer); the draft itself goes in the cached block (identical
      // across the 5).
      cachedSystemBlocks: [draftAsContext],
      systemPrompt: r.system,
      userPrompt: 'Return the JSON critique per your system prompt. The entry to review is in the cached context above.',
      maxTokens: 512,
      parse: parseJsonLoose,
      skipCostCap: true,
    }).then(out => ({ key: r.key, ...out }))
  ))
  const reviewSummaries: Array<{ key: string; score: number; fix: string }> = []
  for (const r of reviews) {
    if (r.status === 'fulfilled') {
      totalCostCents += r.value.costCents
      stages.push({ name: `review_${r.value.key}`, costCents: r.value.costCents, notes: `score ${r.value.result.score}` })
      reviewSummaries.push({
        key: r.value.key,
        score: r.value.result.score,
        fix: r.value.result.fixSuggestion ?? '',
      })
    }
  }

  // 4) Editor — only when worst review < 75.
  const worstScore = reviewSummaries.length > 0 ? Math.min(...reviewSummaries.map(r => r.score)) : 100
  if (worstScore < 75) {
    const editorUserPrompt = `Draft to revise:
${JSON.stringify(draft, null, 2)}

Reviewer critiques (address each fix):
${JSON.stringify(reviewSummaries, null, 2)}

Return the revised JSON, same shape.`

    const editorResult = await claudeJson<GeneratedGlossaryEntry>({
      database: opts.database,
      scope: 'backfill',
      scopeId: opts.scopeId,
      stage: 'glossary_editor',
      model: SONNET_MODEL,
      systemPrompt: EDITOR_SYSTEM,
      userPrompt: editorUserPrompt,
      maxTokens: 4096,
      parse: parseJsonLoose,
      skipCostCap: true,
    })
    draft = editorResult.result
    totalCostCents += editorResult.costCents
    stages.push({ name: 'editor', costCents: editorResult.costCents, notes: `worst review ${worstScore}` })
  } else {
    stages.push({ name: 'editor', costCents: 0, notes: 'skipped (all reviewers ≥ 75)' })
  }

  return {
    ...draft,
    totalCostCents,
    stages,
  }
}

// ─── Tier dispatcher (used by UI) ──────────────────────────────────────────

export type GlossaryTier = 'schema' | 'audit' | 'full'

export function describeTier(tier: GlossaryTier): { name: string; models: string[]; cost: string } {
  switch (tier) {
    case 'schema': return {
      name: 'Schema-only (Tier 1)',
      models: ['deterministic — no LLM'],
      cost: '$0 / term',
    }
    case 'audit': return {
      name: 'Audit + scorecard (Tier 2)',
      models: [HAIKU_MODEL],
      cost: '~$0.01 / term',
    }
    case 'full': return {
      name: 'Full rewrite (Tier 3)',
      models: ['Perplexity (research)', `${SONNET_MODEL} (writer)`, `${HAIKU_MODEL} × 5 (reviewers)`, `${SONNET_MODEL} (editor if needed)`],
      cost: '~$0.30 / term',
    }
  }
}
