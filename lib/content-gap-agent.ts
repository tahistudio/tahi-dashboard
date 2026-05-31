/**
 * Content gap hunter agent.
 *
 * Once a week: surfaces topics Tahi DOESN'T cover but should, based on:
 *   1. Site index — what URLs + topics already live on tahi.studio
 *   2. Perplexity — what queries the ICP audience actually asks
 *   3. Sonnet judgment — which gaps are highest-leverage for Tahi's
 *      5-cluster strategy + DA 43 ranking ability
 *
 * Output: an ordered list of 8-15 specific blog/glossary topic ideas
 * with: suggested title, intent, target keyword, suggested cluster,
 * estimated difficulty, rationale. Writes to content_ideas so they
 * appear in the Ideas tab + are pickable by the round-table pipeline.
 *
 * Cost: ~$0.05 per run (mostly Perplexity research + one Sonnet call).
 * Cron: weekly (Sunday 19:00 UTC via GH Actions).
 */

import { claudeJson } from '@/lib/anthropic-cost'
import { SONNET_MODEL } from '@/lib/ai-models'
import { ask } from '@/lib/perplexity'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

type Database = Awaited<ReturnType<typeof db>>

export interface ContentGap {
  contentType: 'blog' | 'glossary'
  suggestedTitle: string
  primaryKeyword: string
  cluster: string                // generic / novel / data
  intent: 'tofu_educational' | 'mofu_comparison' | 'bofu_conversion' | 'how_to' | 'thought_leadership' | 'definition' | 'listicle'
  difficultyEstimate: 'easy' | 'moderate' | 'hard'
  rationale: string              // 1-2 sentences why this is worth writing
  competitorGapNote?: string     // what's missing from competitor SERPs
}

export interface ContentGapRunResult {
  gapsFound: ContentGap[]
  ideasCreated: number
  ideasSkipped: number           // already in DB
  totalCostCents: number
  perplexityQueries: number
}

const STRATEGIST_SYSTEM = `You are the content strategist for Tahi Studio, a NZ Webflow agency targeting B2B SaaS and enterprise marketing teams. Your job: identify 8-15 SPECIFIC topic ideas Tahi should write next, based on:

1. The list of URLs Tahi already covers (don't suggest duplicates)
2. The current SERP landscape (from Perplexity research)
3. Tahi's 5-cluster topical strategy:
   - Enterprise Webflow (RACI, procurement, governance, SOC 2, AEO)
   - Performance + SEO + AEO + Sustainability
   - Design + Build Quality
   - Webflow Custom Engineering
   - Agency Ops (pricing, retainers, productisation)

PRIORITY MATRIX (rank gaps by this):
- High demand + low Tahi coverage + manageable difficulty = TOP
- Question-shape titles ("What is X?" "How to X" "Why X fails") for AEO
- Specific over generic: "Webflow page branching workflow" beats "Webflow tips"
- Glossary terms are high-AEO-value, low effort. Suggest a mix of
  glossary (60%) and blog (40%) topics.

VOICE: Direct titles. No "delve / leverage / robust" in titles either.
No em-dashes. No "[Year]" year-stuffing.

OUTPUT (JSON only):
{
  "gaps": [
    {
      "contentType": "blog" | "glossary",
      "suggestedTitle": "Specific title that would rank",
      "primaryKeyword": "the search query this targets",
      "cluster": "generic" | "novel" | "data",
      "intent": "tofu_educational" | "mofu_comparison" | "bofu_conversion" | "how_to" | "thought_leadership" | "definition" | "listicle",
      "difficultyEstimate": "easy" | "moderate" | "hard",
      "rationale": "1-2 sentences why Tahi should write this",
      "competitorGapNote": "optional: what current SERP results are missing"
    },
    ...
  ]
}`

const RESEARCH_QUESTIONS = [
  'What are the highest-volume, lowest-competition Webflow + enterprise CMS topics being searched right now that small agencies could realistically rank for?',
  'What "what is X" or "how to X" glossary-style queries about Webflow / web design / agency operations are showing up in Reddit, Twitter, and "People Also Ask" but have weak existing answers?',
  'What recent product launches, algorithm updates, or industry shifts in the last 60 days (Webflow Enterprise, AEO, Core Web Vitals, accessibility standards) need fresh coverage?',
  'What B2B SaaS marketing-leader concerns (procurement, governance, change control, internationalisation, compliance) are getting more attention right now?',
]

export async function huntContentGaps(database: Database): Promise<ContentGapRunResult> {
  const totalCostCents = { value: 0 }
  let perplexityQueries = 0

  // 1) Pull existing site URLs from the site_index table — this is
  // already kept up to date by the weekly sync cron.
  const existingPages = await database
    .select({
      url: schema.siteIndex.url,
      title: schema.siteIndex.title,
      summary: schema.siteIndex.summary,
      type: schema.siteIndex.type,
    })
    .from(schema.siteIndex)
    .limit(500)

  const existingTitles = existingPages
    .filter(p => p.title)
    .map(p => `- ${p.type}: ${p.title}`)
    .slice(0, 200)
    .join('\n')

  // 2) Perplexity research — 4 questions parallel.
  const researchResults = await Promise.allSettled(
    RESEARCH_QUESTIONS.map(q => ask(q, { searchRecency: 'month' }))
  )
  const researchText = researchResults
    .map((r, i) => r.status === 'fulfilled'
      ? `## Research Q${i + 1}: ${RESEARCH_QUESTIONS[i]}\n\n${r.value.content}`
      : null,
    )
    .filter((s): s is string => s !== null)
    .join('\n\n---\n\n')
  perplexityQueries = researchResults.filter(r => r.status === 'fulfilled').length

  // 3) Pull existing content_ideas so we don't suggest duplicates.
  const existingIdeas = await database
    .select({ title: schema.contentIdeas.title })
    .from(schema.contentIdeas)
    .limit(500)
  const existingIdeaTitles = existingIdeas.map(i => i.title.toLowerCase())

  // 4) Sonnet strategist call — synthesises everything into a ranked
  // gap list. Cached blocks: the research brief is the same 8000+
  // tokens whether or not we call the strategist multiple times.
  const userPrompt = `## Tahi's existing pages (${existingPages.length} total — don't duplicate)

${existingTitles}

## SERP research (last 30 days)

${researchText}

## Existing ideas in backlog (don't duplicate)

${existingIdeas.slice(0, 80).map(i => `- ${i.title}`).join('\n')}

Identify 8-15 specific content gaps Tahi should fill. Return JSON per the system prompt.`

  const { result, costCents } = await claudeJson<{ gaps: ContentGap[] }>({
    database,
    scope: 'ideation',
    stage: 'content_gap_hunt',
    model: SONNET_MODEL,
    systemPrompt: STRATEGIST_SYSTEM,
    userPrompt,
    maxTokens: 4096,
    parse: (raw: string) => {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      try { return JSON.parse(cleaned) }
      catch {
        const match = cleaned.match(/\{[\s\S]*\}/)
        if (!match) throw new Error('No JSON in strategist response')
        return JSON.parse(match[0])
      }
    },
    skipCostCap: true,
  })
  totalCostCents.value += costCents

  // 5) Persist as content_ideas rows — skip ones already in backlog
  // (case-insensitive title match).
  let ideasCreated = 0
  let ideasSkipped = 0
  const now = new Date().toISOString()
  for (const gap of result.gaps) {
    const titleLc = gap.suggestedTitle.toLowerCase()
    if (existingIdeaTitles.some(t => t === titleLc || t.includes(titleLc) || titleLc.includes(t))) {
      ideasSkipped++
      continue
    }
    try {
      await database.insert(schema.contentIdeas).values({
        title: gap.suggestedTitle,
        angle: `${gap.rationale}${gap.competitorGapNote ? ` SERP gap: ${gap.competitorGapNote}` : ''}`,
        status: 'pitched',
        sourceSignal: `agent:content_gap (${gap.contentType}, ${gap.cluster}, ${gap.intent}, ${gap.difficultyEstimate})`,
      })
      ideasCreated++
    } catch (err) {
      console.error('content gap idea insert failed', gap.suggestedTitle, err)
    }
  }

  return {
    gapsFound: result.gaps,
    ideasCreated,
    ideasSkipped,
    totalCostCents: totalCostCents.value,
    perplexityQueries,
  }
}
