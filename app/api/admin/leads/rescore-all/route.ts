/**
 * POST /api/admin/leads/rescore-all
 *
 * Force a Haiku rescore on every non-archived lead, regardless of
 * lastAiRunAt. Used after the scoring rubric is tuned (e.g. the ICP
 * doc just got wired into the prompt) so existing scores reflect the
 * new ICP-aware rubric instead of the old generic one.
 *
 * After scoring, any lead with score >= the trigger threshold (default
 * 60, configurable via ?enrichThreshold=N or settings) is queued for
 * a Sonnet full enrichment on the next cron tick by stamping
 * updatedAt > lastAiRunAt (the cron's own gate).
 *
 * Bounded per call (max 25 leads per request) because Haiku takes
 * ~1.5s/call and we want headroom under the 30s D1 timeout. The
 * client should loop POSTing this until { remaining: 0 }.
 *
 * Query:
 *   ?limit=N           cap this call (default 20, max 25)
 *   ?enrichThreshold=N score threshold for auto-enrich queue (default 60)
 *   ?force=1           ignore lastAiRunAt and process leads in
 *                      created-desc order (default behaviour: oldest-
 *                      scored-first so we drain the backlog)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const SCORE_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 25

interface LeadForRescore {
  id: string
  name: string
  email: string | null
  company: string | null
  website: string | null
  jobTitle: string | null
  brief: string | null
  source: string
  sourceDetail: string | null
  estimatedValue: number | null
  currency: string
  status: string
  industry: string | null
  employeeCount: number | null
  revenueBand: string | null
  linkedinUrl: string | null
  linkedinPersonalUrl: string | null
  techStack: string | null
  cms: string | null
  country: string | null
  yearFounded: number | null
  aiScore: number | null
  aiTokensSpent: number | null
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT
  const enrichThresholdRaw = parseInt(url.searchParams.get('enrichThreshold') ?? '', 10)
  const enrichThreshold = Number.isFinite(enrichThresholdRaw) ? enrichThresholdRaw : 60
  const force = url.searchParams.get('force') === '1'

  const database = await db()

  // Pull non-archived leads ordered by oldest-last-scored first, so
  // looping this endpoint drains the backlog of unscored / oldest-
  // scored leads first. With ?force=1 we ignore the lastAiRunAt and
  // process newest leads (useful for a fresh rubric push).
  const rows = await database
    .select()
    .from(schema.leads)
    .where(and(
      ne(schema.leads.status, 'archived'),
      ne(schema.leads.status, 'promoted'),
    ))
    .orderBy(force
      ? desc(schema.leads.createdAt)
      : asc(sql`COALESCE(${schema.leads.lastAiRunAt}, '1970-01-01')`))
    .limit(limit)

  // Load ICP + services context once for the whole batch (cached
  // helper, returns the same string repeatedly with no DB hit after
  // first call within 5min).
  const { loadAiContext } = await import('@/lib/ai-context')
  const contextText = await loadAiContext(['icp', 'services'])

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const systemPrompt = `You are a lead scorer for Tahi Studio, a Webflow design + development agency based in New Zealand.

Score each lead on a 0-100 scale that reflects HOW LIKELY they are to convert into a paying client of Tahi specifically — based on the IDEAL CLIENT PROFILE context above. Be aggressive about discrimination. The same lead population should produce a wide spread (5-95); clusters of identical scores mean you're being lazy.

WEIGHT THESE SIGNALS (the ICP doc above defines what "good fit" means for each axis)

1. ICP FIT (40%) — company size band by market, industry, AEO/SEO pain signals, WordPress switcher or Webflow user.
2. ENGAGEMENT (25%) — has email, has phone, recent inbound activity, came via Webflow Partner / referral.
3. URGENCY + BUDGET (20%) — explicit budget, urgent timeline, "migrating from X" language.
4. DECISION-MAKER ACCESS (15%) — founder / CMO / Head of Marketing in jobTitle.

RUBRIC GUIDE (use the FULL spread, don't bucket):
- 85-100: hot inbound, clear budget, clear urgency, ideal fit on ICP, decision-maker.
- 65-84: strong fit on multiple axes, follow up this week.
- 45-64: medium — worth nurturing, not a full enrichment yet.
- 25-44: low — cold-list type, monitor only.
- 5-24: poor fit (small business with no budget, niche industry, etc).

Do not invent facts. Use what is in the input. Output ONLY:

<score>0-100</score>
<score_reason>One concise line (under 25 words). Mention which axis drove the score.</score_reason>`

  const systemBlocks = contextText
    ? [
        { type: 'text' as const, text: contextText, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: systemPrompt },
      ]
    : [{ type: 'text' as const, text: systemPrompt }]

  let scored = 0
  let queuedForEnrichment = 0
  const samples: Array<{ id: string; name: string; oldScore: number | null; newScore: number | null; reason: string | null }> = []
  const errors: Array<{ id: string; error: string }> = []

  for (const lead of rows as LeadForRescore[]) {
    try {
      const userMessage = buildScoreUserMessage(lead)
      const response = await client.messages.create({
        model: SCORE_MODEL,
        max_tokens: 256,
        system: systemBlocks,
        messages: [{ role: 'user', content: userMessage }],
      })
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('\n')
      const scoreMatch = text.match(/<score>\s*(\d{1,3})\s*<\/score>/i)
      const reasonMatch = text.match(/<score_reason>([\s\S]*?)<\/score_reason>/i)
      const rawScore = scoreMatch ? parseInt(scoreMatch[1], 10) : NaN
      const newScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null
      const reason = reasonMatch?.[1]?.trim() ?? null

      const usage = response.usage as {
        input_tokens: number
        output_tokens: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
      const tokens = usage.input_tokens + usage.output_tokens
        + (usage.cache_creation_input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0)

      const now = new Date().toISOString()
      // For leads scoring >= the auto-enrich threshold, stamp updatedAt
      // AFTER lastAiRunAt so the cron picks them up on its next tick
      // and runs full Sonnet enrichment. For lower scores, treat the
      // score as final and stamp both timestamps equal so the cron
      // skips them.
      const wantsEnrichment = newScore != null && newScore >= enrichThreshold
      await database
        .update(schema.leads)
        .set({
          aiScore: newScore ?? lead.aiScore,
          aiScoreReason: reason ?? null,
          lastAiRunAt: now,
          aiTokensSpent: (lead.aiTokensSpent ?? 0) + tokens,
          // Bump updatedAt slightly past lastAiRunAt for hot leads so
          // the cron auto-enrich gate fires next tick.
          updatedAt: wantsEnrichment ? new Date(Date.now() + 1000).toISOString() : now,
        })
        .where(eq(schema.leads.id, lead.id))

      if (samples.length < 10) {
        samples.push({
          id: lead.id,
          name: lead.name,
          oldScore: lead.aiScore,
          newScore,
          reason,
        })
      }
      scored++
      if (wantsEnrichment) queuedForEnrichment++
    } catch (err) {
      errors.push({
        id: lead.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Rough remaining count — leads with null lastAiRunAt OR scored
  // before "now" (since we just updated `scored` of them, the next
  // call will skip those automatically due to ordering).
  const [{ count: total }] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.leads)
    .where(and(
      ne(schema.leads.status, 'archived'),
      ne(schema.leads.status, 'promoted'),
    ))

  return NextResponse.json({
    scored,
    queuedForEnrichment,
    errors,
    samples,
    total,
    hint: scored === 0
      ? 'Backlog drained. Re-run only if you want to force-rescore everything (?force=1).'
      : `Re-call POST /api/admin/leads/rescore-all until scored=0. ${queuedForEnrichment} of this batch will auto-enrich on the next cron tick.`,
  })
  void isNull
  void or
}

function buildScoreUserMessage(lead: LeadForRescore): string {
  const lines: string[] = []
  lines.push(`Lead: ${lead.name}`)
  if (lead.jobTitle) lines.push(`Role: ${lead.jobTitle}`)
  if (lead.company) lines.push(`Company: ${lead.company}`)
  if (lead.industry) lines.push(`Industry: ${lead.industry}`)
  if (lead.country) lines.push(`Country: ${lead.country}`)
  if (lead.employeeCount != null) lines.push(`Employees: ${lead.employeeCount}`)
  if (lead.revenueBand) lines.push(`Revenue: ${lead.revenueBand}`)
  if (lead.yearFounded != null) lines.push(`Founded: ${lead.yearFounded}`)
  if (lead.cms) lines.push(`CMS: ${lead.cms}`)
  if (lead.techStack) {
    try {
      const arr = JSON.parse(lead.techStack)
      if (Array.isArray(arr) && arr.length > 0) lines.push(`Tech stack: ${arr.join(', ')}`)
    } catch { /* ignore */ }
  }
  if (lead.email) lines.push(`Email: ${lead.email}`)
  if (lead.linkedinUrl) lines.push(`Company LinkedIn: ${lead.linkedinUrl}`)
  if (lead.linkedinPersonalUrl) lines.push(`Personal LinkedIn: ${lead.linkedinPersonalUrl}`)
  if (lead.website) lines.push(`Website: ${lead.website}`)
  if (lead.brief) lines.push(`Brief: ${lead.brief}`)
  lines.push(`Source: ${lead.source}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ''}`)
  if (lead.estimatedValue) lines.push(`Estimated value: ${lead.estimatedValue} ${lead.currency}`)
  lines.push(`Current status: ${lead.status}`)
  lines.push('')
  lines.push('Score this lead against the ICP context above.')
  return lines.join('\n')
}
