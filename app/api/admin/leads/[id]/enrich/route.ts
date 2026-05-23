/**
 * POST /api/admin/leads/[id]/enrich
 *
 * Lead enrichment + scoring + discovery questions via Claude Sonnet 4.6
 * with the Anthropic web_search tool.
 *
 * Modes (via ?mode= query):
 *   full   (default) — enrich + score + questions. Writes summary,
 *                      sources, questions, score, scoreReason. Sets
 *                      enrichedAt + lastAiRunAt.
 *   score          — score only. Cheap path used by the daily cron.
 *                    Skips web search. Writes score + scoreReason.
 *                    Sets lastAiRunAt only.
 *
 * Reliability tactics baked into the prompt:
 *   - Every factual claim MUST cite a URL. Claims without a URL
 *     should be dropped by the model.
 *   - "Unknown" is an allowed answer; hallucination is not.
 *   - LinkedIn / personal email / direct phone are explicitly out
 *     of scope (gated providers, not web-scrapeable reliably).
 *
 * Cost gate: aiTokensSpent is incremented by input + output tokens.
 * If a single lead exceeds 25k tokens over its lifetime, the route
 * returns 429 (caller can override via ?force=1).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const MODEL_FULL = 'claude-sonnet-4-6'
const MODEL_SCORE = 'claude-haiku-4-5-20251001'
const TOKEN_HARD_CAP = 25_000

// ── Prompt building ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT_FULL = `You are an enrichment assistant for Tahi Studio, a Webflow design and development agency based in New Zealand. Your job is to research an incoming lead and produce a short briefing that helps the sales operator prepare for a discovery call.

USE THE web_search TOOL. Run 2-4 targeted searches. Prefer the company website, recent news (last 12 months), and credible aggregators (Crunchbase, AngelList, press releases).

RELIABILITY RULES (these matter):
1. Every factual claim in your summary MUST be backed by a URL in the <sources> list. If you cannot find a source, omit the claim. Do not paraphrase from memory.
2. "Unknown" is an allowed and respected answer. Hallucination is not.
3. Do NOT attempt to retrieve: LinkedIn personal profile details (job tenure, past roles, education), direct email addresses, direct phone numbers. These are gated and unreliable to scrape.
4. NZ English spelling (colour, organise, centre). No em dashes or en dashes; use commas, colons, or full stops.

OUTPUT FORMAT (strict — the response is parsed by regex):

<score>0-100</score>
<score_reason>One concise line (under 20 words) explaining the score. Mention urgency signals, fit, or risk.</score_reason>
<snapshot>
2-3 SHORT sentences. Who they are, what they do, who they sell to. Scannable in 10 seconds. No filler.
</snapshot>
<fit>
2-3 SHORT sentences. Why this lead might need Tahi specifically. Reference real signals (recent hires, tech stack gaps, scaling moments, etc). If fit is weak, say so plainly.
</fit>
<watch_outs>
1-2 SHORT sentences. Risks, urgency mismatches, geography or fit concerns, budget question marks. If nothing concerning, write "None obvious."
</watch_outs>
<signals>
Structured deal-sizing signals. Every populated field MUST have a matching <field>_source URL or be omitted. If you cannot verify a field, OMIT it — do not guess. Use plain text content inside each tag (no formatting).

<employee_count>e.g. "45" or "approx 100-250"</employee_count>
<employee_count_source>https://...</employee_count_source>

<funding_raised>e.g. "USD 8M Series A"</funding_raised>
<funding_stage>e.g. "Series A" or "bootstrapped"</funding_stage>
<funding_source>https://...</funding_source>

<revenue_estimate>e.g. "USD 2M-5M ARR" — only if explicitly disclosed publicly, not guessed</revenue_estimate>
<revenue_source>https://...</revenue_source>

<pricing_visible>e.g. "Tiered: $29 / $99 / Enterprise"</pricing_visible>
<pricing_source>https://...</pricing_source>

<customer_count>e.g. "Trusted by 500+ teams (homepage claim)"</customer_count>
<customer_source>https://...</customer_source>

<site_tech_stack>Comma-separated stack guess from publicly visible signals (job posts, careers page). e.g. "WordPress, React, Stripe"</site_tech_stack>
<site_tech_source>https://...</site_tech_source>

<decision_maker>Most likely person Tahi should talk to (role, not personal name unless it's the actual lead). e.g. "Likely Head of Marketing or Founder" or "Lead person Anna Walker (in our system) appears to be the decision-maker"</decision_maker>
<decision_maker_confidence>low | medium | high</decision_maker_confidence>
</signals>
<sources>
<url>https://...</url>
<url>https://...</url>
</sources>
<questions>
<q>Question one specific to this company's context. Should surface insight relevant to scoping a project.</q>
<q>Question two specific to this company's situation. Should help Tahi understand fit / urgency / budget.</q>
<q>Question three specific to this company's signals. Should surface decision-making process or competitive landscape.</q>
</questions>

SCORING RUBRIC:
- 80-100: clearly inbound, clear budget signal, fits Tahi's service offer, decision-maker, urgent
- 60-79: solid fit on most axes; one or two unknowns
- 40-59: mixed signals; small business or unclear budget
- 20-39: poor fit, very early stage, or low urgency
- 0-19: dead lead, no signal, or out of scope`

const SYSTEM_PROMPT_SCORE = `You are a lead scorer for Tahi Studio. Score the lead on a 0-100 scale based on the information provided. Do not invent facts. Output ONLY:

<score>0-100</score>
<score_reason>One concise line (under 20 words).</score_reason>

SCORING RUBRIC:
- 80-100: clearly inbound, clear budget signal, fits Tahi's service offer, decision-maker, urgent
- 60-79: solid fit on most axes; one or two unknowns
- 40-59: mixed signals; small business or unclear budget
- 20-39: poor fit, very early stage, or low urgency
- 0-19: dead lead, no signal, or out of scope`

interface LeadForPrompt {
  name: string
  email: string | null
  phone: string | null
  company: string | null
  jobTitle: string | null
  website: string | null
  brief: string | null
  source: string
  sourceDetail: string | null
  estimatedValue: number | null
  currency: string
}

function buildUserMessage(lead: LeadForPrompt): string {
  const lines: string[] = []
  lines.push(`Lead name: ${lead.name}`)
  if (lead.jobTitle) lines.push(`Job title: ${lead.jobTitle}`)
  if (lead.email) lines.push(`Email: ${lead.email}`)
  if (lead.phone) lines.push(`Phone: ${lead.phone}`)
  if (lead.company) lines.push(`Company: ${lead.company}`)
  if (lead.website) lines.push(`Website: ${lead.website}`)
  if (lead.brief) lines.push(`Brief from the lead: ${lead.brief}`)
  lines.push(`Source: ${lead.source}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ''}`)
  if (lead.estimatedValue) lines.push(`Estimated value: ${lead.estimatedValue} ${lead.currency}`)
  lines.push('')
  lines.push('Please research this lead and produce the briefing.')
  return lines.join('\n')
}

// ── Parsing ─────────────────────────────────────────────────────────────────

interface AiSignals {
  employeeCount?: string
  employeeCountSource?: string
  fundingRaised?: string
  fundingStage?: string
  fundingSource?: string
  revenueEstimate?: string
  revenueSource?: string
  pricingVisible?: string
  pricingSource?: string
  customerCount?: string
  customerSource?: string
  siteTechStack?: string
  siteTechSource?: string
  decisionMaker?: string
  decisionMakerConfidence?: 'low' | 'medium' | 'high'
}

interface ParsedFull {
  score: number | null
  scoreReason: string | null
  /** Compiled into a single JSON string for aiSummary storage: { snapshot, fit, watchOuts }. */
  summary: string | null
  sources: string[]
  questions: string[]
  signals: AiSignals
}

function parseFullResponse(text: string): ParsedFull {
  const score = matchInt(text, /<score>\s*(\d{1,3})\s*<\/score>/i)
  const scoreReason = matchText(text, /<score_reason>([\s\S]*?)<\/score_reason>/i)
  const snapshot = matchText(text, /<snapshot>([\s\S]*?)<\/snapshot>/i)?.trim() ?? null
  const fit = matchText(text, /<fit>([\s\S]*?)<\/fit>/i)?.trim() ?? null
  const watchOuts = matchText(text, /<watch_outs>([\s\S]*?)<\/watch_outs>/i)?.trim() ?? null
  // Stored as JSON so the UI can render each section separately. We
  // also keep backwards compatibility: if a legacy <summary> block is
  // present, fall through to it.
  const summary = (snapshot || fit || watchOuts)
    ? JSON.stringify({ snapshot, fit, watchOuts })
    : (matchText(text, /<summary>([\s\S]*?)<\/summary>/i)?.trim() ?? null)

  const sourcesBlock = matchText(text, /<sources>([\s\S]*?)<\/sources>/i) ?? ''
  const sources = Array.from(sourcesBlock.matchAll(/<url>\s*([^<\s][^<]*?)\s*<\/url>/gi))
    .map(m => m[1].trim())
    .filter(u => /^https?:\/\//i.test(u))

  const questionsBlock = matchText(text, /<questions>([\s\S]*?)<\/questions>/i) ?? ''
  const questions = Array.from(questionsBlock.matchAll(/<q>([\s\S]*?)<\/q>/gi))
    .map(m => m[1].trim())
    .filter(q => q.length > 0)
    .slice(0, 3)

  // Signals block. Each field is optional. A field is only included
  // when (a) the value tag was present AND (b) the matching _source
  // tag is also present (enforces the cite-or-omit rule). Exception:
  // decision_maker is allowed without a source because it's
  // inference + the confidence tag carries its own honesty signal.
  const signalsBlock = matchText(text, /<signals>([\s\S]*?)<\/signals>/i) ?? ''
  const sig = (name: string) => matchText(signalsBlock, new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.trim() ?? null
  const signals: AiSignals = {}
  const pairs: Array<[keyof AiSignals, string, keyof AiSignals, string]> = [
    ['employeeCount', 'employee_count', 'employeeCountSource', 'employee_count_source'],
    ['fundingRaised', 'funding_raised', 'fundingSource', 'funding_source'],
    ['revenueEstimate', 'revenue_estimate', 'revenueSource', 'revenue_source'],
    ['pricingVisible', 'pricing_visible', 'pricingSource', 'pricing_source'],
    ['customerCount', 'customer_count', 'customerSource', 'customer_source'],
    ['siteTechStack', 'site_tech_stack', 'siteTechSource', 'site_tech_source'],
  ]
  for (const [jsKey, xmlKey, srcJsKey, srcXmlKey] of pairs) {
    const value = sig(xmlKey)
    const source = sig(srcXmlKey)
    if (value && source && /^https?:\/\//i.test(source)) {
      ;(signals[jsKey] as string) = value
      ;(signals[srcJsKey] as string) = source
    }
  }
  // funding_stage is allowed alongside fundingRaised even if it has
  // no own source — it's a categorical not a fact.
  const fundingStage = sig('funding_stage')
  if (fundingStage && signals.fundingRaised) signals.fundingStage = fundingStage
  const decisionMaker = sig('decision_maker')
  const confidence = sig('decision_maker_confidence')?.toLowerCase()
  if (decisionMaker) signals.decisionMaker = decisionMaker
  if (confidence === 'low' || confidence === 'medium' || confidence === 'high') {
    signals.decisionMakerConfidence = confidence
  }

  return {
    score: score != null ? Math.max(0, Math.min(100, score)) : null,
    scoreReason: scoreReason?.trim() ?? null,
    summary: summary?.trim() ?? null,
    sources,
    questions,
    signals,
  }
}

function matchInt(text: string, re: RegExp): number | null {
  const m = text.match(re)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

function matchText(text: string, re: RegExp): string | null {
  const m = text.match(re)
  return m ? m[1] : null
}

// ── Anthropic call ──────────────────────────────────────────────────────────

interface AnthropicCallResult {
  text: string
  inputTokens: number
  outputTokens: number
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string,
  withWebSearch: boolean,
): Promise<AnthropicCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    ...(withWebSearch && {
      tools: [{
        type: 'web_search_20250305' as const,
        name: 'web_search',
        max_uses: 4,
      }],
    }),
  })

  // Aggregate all text blocks. Tool-result + thinking blocks are skipped.
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'score' ? 'score' : 'full'
  const force = url.searchParams.get('force') === '1'

  const database = await db()

  const [lead] = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (!force && lead.aiTokensSpent && lead.aiTokensSpent >= TOKEN_HARD_CAP) {
    return NextResponse.json({
      error: 'Token cap reached for this lead. Retry with ?force=1 to override.',
      tokensSpent: lead.aiTokensSpent,
    }, { status: 429 })
  }

  const promptInput: LeadForPrompt = {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    jobTitle: lead.jobTitle,
    website: lead.website,
    brief: lead.brief,
    source: lead.source,
    sourceDetail: lead.sourceDetail,
    estimatedValue: lead.estimatedValue,
    currency: lead.currency,
  }

  const userMessage = buildUserMessage(promptInput)
  const now = new Date().toISOString()

  try {
    if (mode === 'score') {
      const { text, inputTokens, outputTokens } = await callAnthropic(
        MODEL_SCORE,
        SYSTEM_PROMPT_SCORE,
        userMessage,
        false,
      )
      const parsed = parseFullResponse(text)
      await database
        .update(schema.leads)
        .set({
          aiScore: parsed.score,
          aiScoreReason: parsed.scoreReason,
          aiTokensSpent: (lead.aiTokensSpent ?? 0) + inputTokens + outputTokens,
          lastAiRunAt: now,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, id))
      return NextResponse.json({
        mode,
        score: parsed.score,
        scoreReason: parsed.scoreReason,
        tokensThisRun: inputTokens + outputTokens,
      })
    }

    // Full enrichment
    const { text, inputTokens, outputTokens } = await callAnthropic(
      MODEL_FULL,
      SYSTEM_PROMPT_FULL,
      userMessage,
      true,
    )
    const parsed = parseFullResponse(text)

    // If the model failed to produce a summary or sources, treat as
    // a soft failure: don't overwrite existing enrichment data, but
    // still bump lastAiRunAt + tokens spent so the cron doesn't retry
    // immediately. Caller can re-run manually.
    if (!parsed.summary || parsed.sources.length === 0) {
      await database
        .update(schema.leads)
        .set({
          aiScore: parsed.score ?? lead.aiScore,
          aiScoreReason: parsed.scoreReason ?? lead.aiScoreReason,
          aiTokensSpent: (lead.aiTokensSpent ?? 0) + inputTokens + outputTokens,
          lastAiRunAt: now,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, id))
      return NextResponse.json({
        mode,
        warning: 'Enrichment produced no usable summary or sources. Existing data preserved.',
        score: parsed.score,
        scoreReason: parsed.scoreReason,
        tokensThisRun: inputTokens + outputTokens,
      })
    }

    const signalsJson = Object.keys(parsed.signals).length > 0
      ? JSON.stringify(parsed.signals)
      : null

    await database
      .update(schema.leads)
      .set({
        aiScore: parsed.score,
        aiScoreReason: parsed.scoreReason,
        aiSummary: parsed.summary,
        aiSources: JSON.stringify(parsed.sources),
        aiQuestions: JSON.stringify(parsed.questions),
        aiSignals: signalsJson,
        aiTokensSpent: (lead.aiTokensSpent ?? 0) + inputTokens + outputTokens,
        enrichedAt: now,
        lastAiRunAt: now,
        // Clear the "don't ask again" suppression: explicit re-enrich
        // resets the prompt logic.
        enrichRepromptSuppressed: false,
        updatedAt: now,
      })
      .where(eq(schema.leads.id, id))

    return NextResponse.json({
      mode,
      score: parsed.score,
      scoreReason: parsed.scoreReason,
      summary: parsed.summary,
      sources: parsed.sources,
      questions: parsed.questions,
      signals: parsed.signals,
      tokensThisRun: inputTokens + outputTokens,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      error: 'Enrichment failed',
      detail: message,
    }, { status: 500 })
  }
}
