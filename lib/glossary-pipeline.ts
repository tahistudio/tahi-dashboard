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
import { fetchSeoSignals } from '@/lib/seo-signals'
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

const WRITER_SYSTEM = `You are writing a glossary entry for Tahi Studio's resources hub at tahi.studio/resources/glossary. Tahi is a Webflow agency serving B2B SaaS and enterprise marketing teams. Tahi's DA is 43 with traffic bleed + many unindexed pages; the goal of every entry is to be cited by AI engines (ChatGPT, Perplexity, Google AI Mode) AND rank well enough to be indexed.

GLOSSARY entries are reference material first, Tahi second. NOT blog posts.

## Hard rules you MUST follow

1. **Open the body with the exact text of "definition"** — a self-contained 40-60 word direct-answer block. Google's AI Mode extracts this for featured snippets and AI citations. No "This article will explain..." filler. No "In this guide we'll cover...".

2. **Use H2 headings phrased as questions the reader actually types** — "How does X work?", "When should you use X?", "What is X used for?", "X vs Y". At least 3 H2s per entry; ideally 4-5.

3. **One concrete example within the first 200 words.** A named tool, a specific scenario, a real number. Wikipedia + MDN both do this.

4. **5-8 contextual internal links per entry.** Mix:
   - 3+ to other glossary terms (slug list returned in relatedTerms gets auto-resolved)
   - 1-2 to Tahi blog posts when relevant (use /blog/slug paths)
   - 1 to a Tahi service page only when editorial not promotional
   Don't link the same anchor twice.

5. **Include a "Common mistakes" H2 IN THE BODY** with 2-4 concrete pitfalls. NOT a separate field — inline. This is one of the highest-value AEO blocks (AI engines cite "common mistakes with X" disproportionately).

6. **Include a "Further reading" H2 IN THE BODY** with 2-3 outbound links to authoritative sources (MDN, W3C, official docs, peer-reviewed work). Inline as proper markdown links so they enter the page link graph.

6a. **Include disambiguation in the body when relevant.** If X is commonly confused with Y, write "X is not Y because..." either inline near the definition OR as a "## What X isn't" H2. AI engines cite these for "X vs Y" queries. No separate field.

7. **600-1500 words.** Floor matters more than ceiling — under 400 reads as a dictionary stub. Over 1500 invites padding which Google flags as thin.

8. **Author = whichever of Liam or Staci legitimately knows the topic.**
   - Liam: business, dev, SEO, agency-ops, webflow-technical, performance, security, hosting, payments
   - Staci: design, brand, UX, accessibility, sustainable web, design systems, typography

9. **alsoKnownAs ONLY when a real synonym exists.** Don't invent acronyms. Leave empty if there isn't a genuine alternate name.

10. **Never use em dashes. Never mention Tahi's team size.** No "delve / leverage / robust / seamless / comprehensive / navigate the complexities / in today's fast-paced / circle back" or any equivalent AI tell. Use commas, parens, periods. The page must read as reference material first, Tahi second.

11. **DO NOT EMIT H1** — the term name is the page H1, set by Webflow. Start with paragraph or H2.

## Output

JSON only (no fences):

{
  "term": "exact term name",
  "alsoKnownAs": ["synonym 1", "synonym 2"],
  "definition": "40-60 words, snippet-ready, self-contained, also the first line of the body",
  "bodyMarkdown": "600-1500 words, opens with definition verbatim, ## H2 sections, includes ## Common mistakes + ## Further reading inline, no H1",
  "faqs": [{"question": "...", "answer": "..."}, ...],
  "examples": ["concrete named example 1", "concrete named example 2"],
  "commonMistakes": ["DON'T duplicate the body — leave this empty if the H2 in body covers it"],
  "citations": [{"url": "https://...", "title": "..."}, ...],
  "relatedTerms": ["related-term-slug", "another-term-slug", "third-slug"],
  "metaTitle": "Term Name | Tahi Glossary (50-60 char)",
  "metaDescription": "145-160 char SERP description",
  "authorSlug": "liam" or "staci",
  "category": "design" | "dev" | "seo" | "business" | "agency-ops" | "webflow",
  "difficulty": "beginner" | "intermediate" | "advanced"
}

Note: the "Common mistakes" + "Further reading" sections live in bodyMarkdown (rule 5+6). The commonMistakes + citations arrays are for the schema generator to read — keep them in sync with what's IN the body, don't add extras.`

const REVIEWER_PANEL = [
  {
    key: 'definition_clarity',
    system: 'You are the Definition Clarity reviewer. Score 0-100 on whether the first 40-60 words is a clean plain-English definition a non-expert understands AND matches the `definition` field verbatim (it MUST be the literal first line of the body). Jargon stacks / preamble / banned AI tells (delve, leverage, robust, seamless, comprehensive, in today\'s, em-dashes) = under 60. Definition not opening the body = under 50. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "one specific sentence to fix"}',
  },
  {
    key: 'snippet_readiness',
    system: 'You are the Featured-Snippet + AI-citation reviewer. Would Google AI Mode or Perplexity extract a coherent 40-50 word answer from the literal opening of the body? Required: definition sentence FIRST + 1-2 key-attribute sentences immediately after, before any H2. One concrete named example must appear within the first 200 words. Buried answer / no example up front = under 50. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'citation_rigor',
    system: 'You are the Citation Rigor reviewer. The entry MUST have a "## Further reading" H2 inline in the body with 2-3 outbound links to authoritative sources (W3C / MDN / official docs / peer-reviewed studies / named publications like Stripe Docs, Webflow University). Inline citations within the body for specific claims are a bonus. Zero external links = under 20. Only marketing/blog citations = under 50. Two+ strong authoritative inline links = 80+. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'structure_completeness',
    system: 'You are the Structure reviewer for glossary entries (2026 AEO standards). Required: (1) definition opens body verbatim, (2) at least 3 Q-shaped H2s ("How does X work?", "When should you use X?", "What is X used for?", "X vs Y"), (3) at least 1 concrete named example in first 200 words, (4) "## Common mistakes" H2 inline with 2-4 pitfalls, (5) "## Further reading" H2 inline with outbound citations. Missing any = subtract 20 each. Score 0-100. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'aeo_citability',
    system: 'You are the AEO reviewer (Answer Engine Optimisation for ChatGPT / Perplexity / Google AI Mode in 2026). Strong citation signals: comparison tables, "X vs Y" sections, common-mistakes list, named examples (not "many tools" or "various platforms"), inline authoritative citations, Q-shaped H2s matching real user queries. Generic prose-only entries with no specific examples = under 40. Strong entries with all signals = 80+. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
  },
  {
    key: 'internal_linking',
    system: 'You are the Internal-Link Density reviewer for a DA-43 glossary network. Tahi needs 5-8 contextual internal links per entry to escape low-DA indexing problems. Count [text](url) links in the body where the url starts with /resources/glossary/ OR /blog/ OR / (Tahi service pages). Under 3 = score under 40 (orphaned, won\'t rank). 5-8 well-placed = 80+. Same anchor linked twice = penalise. Links must read as editorial (the term name is the natural anchor), not stuffed. OUTPUT JSON: {"score": 0-100, "fixSuggestion": "..."}',
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

  // 1a) Research (Perplexity).
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

  // 1b) SEO signals (GSC + GA4 + SE Ranking). The writer + reviewers
  //     see what's currently ranking, what queries this URL earns, and
  //     what competitors look like — concrete competitive grounding.
  let seoBrief = ''
  try {
    const signals = await fetchSeoSignals(opts.database, term, 'glossary')
    seoBrief = signals.writerBrief
    const noteParts: string[] = []
    if (signals.gsc.available) noteParts.push(`GSC ${signals.gsc.impressions30d ?? 0}imp/${signals.gsc.clicks30d ?? 0}clk`)
    if (signals.ga4.available) noteParts.push(`GA4 ${signals.ga4.sessions30d ?? 0}sess`)
    if (signals.seRanking.available) noteParts.push(`SER vol${signals.seRanking.searchVolume ?? '?'}`)
    stages.push({ name: 'seo_signals', costCents: 0, notes: noteParts.length > 0 ? noteParts.join(' · ') : 'sources unavailable' })
  } catch (err) {
    stages.push({ name: 'seo_signals', costCents: 0, notes: `skipped: ${err instanceof Error ? err.message.slice(0, 60) : 'fail'}` })
  }

  // 2) Writer (Sonnet). Cache the research + SEO briefs so the editor
  //    pass + reviewers don't re-pay for them.
  const cachedContext: string[] = []
  if (seoBrief) cachedContext.push(seoBrief)
  if (researchBrief) cachedContext.push(`# Research brief (use as ground-truth for facts + citations)\n\n${researchBrief.slice(0, 6000)}`)

  const writerUserPrompt = `Term: ${term}

${opts.authorSlug ? `Forced author: ${opts.authorSlug}` : 'Pick the right author (liam or staci) based on the topic.'}

The SEO + research briefs are in the cached context above. Use the SEO brief's "top queries" verbatim as H2 headings where they make sense. Write the glossary entry as JSON per the system prompt.`

  const writerResult = await claudeJson<GeneratedGlossaryEntry>({
    database: opts.database,
    scope: 'backfill',
    scopeId: opts.scopeId,
    stage: 'glossary_writer',
    model: SONNET_MODEL,
    systemPrompt: WRITER_SYSTEM,
    userPrompt: writerUserPrompt,
    cachedSystemBlocks: cachedContext.length > 0 ? cachedContext : undefined,
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
