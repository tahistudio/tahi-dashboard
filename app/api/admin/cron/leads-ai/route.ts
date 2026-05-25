/**
 * POST /api/admin/cron/leads-ai
 *
 * The daily lead AI cron. Designed to be cheap, idempotent, and
 * survivable.
 *
 * What it does on each run:
 *   1. Pulls active leads (status IN new, qualifying, nurturing)
 *      where lastAiRunAt is null OR updatedAt > lastAiRunAt — i.e.
 *      something has changed since we last scored.
 *   2. For each: runs a Haiku 4.5 score call (cheap, no web search).
 *      Updates aiScore, aiScoreReason, lastAiRunAt, aiTokensSpent.
 *   3. Detects three transition events and writes notifications:
 *        - Enrichment-completed (lead just got enriched for the first
 *          time — uses enrichedAt + lastAiRunAt to detect "fresh")
 *        - Idle qualifying (lead has sat in 'qualifying' >N days
 *          with no updatedAt since)
 *        - High-intent (score crossed threshold, default 80)
 *   4. Optionally applies auto-status transitions when the matching
 *      settings flag is on (default: OFF, so Liam isn't surprised).
 *
 * Settings consulted (sensible defaults if missing):
 *   leads.cronEnabled            (bool, default true) master kill switch
 *   leads.scoreModelOverride     (string, default unset) override Haiku
 *   leads.notifyOnHighIntent     (bool, default true)
 *   leads.notifyOnIdleQualifying (bool, default true)
 *   leads.notifyOnEnriched       (bool, default true)
 *   leads.highIntentThreshold    (number, default 80)
 *   leads.idleQualifyingDays     (number, default 7)
 *   leads.autoNurturingAfterDays (number, default 0 = disabled)
 *   leads.defaultLeadOwnerId     (string) notifications target this team_member
 *
 * Auth:
 *   - Tahi admin via the normal session (manual / MCP-driven runs)
 *   - OR a Bearer secret matching CRON_SECRET env var (unattended
 *     schedule pings). When the secret is absent, only admin auth
 *     works.
 *
 * The route is bounded: max 50 leads per run, max ~10 second total
 * runtime on the worker. Beyond that it returns early with a summary
 * so the next tick picks up the rest.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const MAX_LEADS_PER_RUN = 50
const RUN_TIME_BUDGET_MS = 25_000
const SCORE_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT_SCORE = `You are a lead scorer for Tahi Studio, a Webflow design + development agency based in New Zealand. Score each lead on a 0-100 scale that reflects HOW LIKELY they are to convert into a paying client of Tahi specifically.

CRITICAL: differentiate aggressively. Score the SAME lead population should produce a wide spread — clusters of identical scores (e.g. everyone at 35) means you are being lazy with the rubric. USE THE FULL SCALE 5-95. Two leads from the same industry but with different team size / revenue tier / engagement level SHOULD score differently.

WEIGHT THESE SIGNALS

1. ENGAGEMENT (40% of weight)
- Has lead.email + lead.phone + recent inbound activity → HIGH (+15 to +25)
- Webflow Partner / Webflow form / referral → MEDIUM-HIGH (+10 to +15)
- Cold outreach with no contact → BASELINE (no boost)
- Demoted from pipeline (was stalled) → MEDIUM-LOW (-5)

2. FIT (30%)
- Mid-market company (100-1000 employees, $10M-$200M revenue) needing Webflow help → HIGHEST FIT (+15 to +20)
- Small business (under 50 employees) or enterprise (1000+) → LOWER FIT (-5 to +5)
- Industries that historically buy: SaaS / Financial Services / Software / Healthcare → +5
- Industries that rarely buy: heavy manufacturing / government / non-profit → -5

3. URGENCY + BUDGET (20%)
- Explicit budget mentioned in brief (e.g. "Budget: $5,000 USD") → +10
- Urgent timeline language (this month / launching soon / migrating from X) → +10
- "Just exploring" / "no rush" → -5

4. DECISION-MAKER ACCESS (10%)
- Founder / CMO / Head of Marketing in lead.jobTitle → +5
- Junior / unclear role → -5

RUBRIC GUIDE (use the FULL spread, don't bucket):
- 85-100: rare hot inbound — clear budget, clear urgency, ideal fit, decision-maker
- 65-84: strong fit on multiple axes, follow up this week
- 45-64: medium — worth a nurturing email, not a full enrichment
- 25-44: low — cold-list type, monitor only
- 5-24: very poor fit — small business, no budget signal, niche industry

Do not invent facts. Use what is in the input. Output ONLY:

<score>0-100</score>
<score_reason>One concise line (under 25 words). Mention which axis drove the score.</score_reason>`

// ── Route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Two auth paths: admin session OR cron secret (x-cron-secret header
  // or Bearer auth). TAHI_CRON_SECRET first, falls back to CRON_SECRET.
  const cronHeader = req.headers.get('x-cron-secret') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const database = await db()
  const startedAt = Date.now()

  // Settings (defaults when row missing).
  const settings = await readLeadSettings(database)
  if (!settings.cronEnabled) {
    const summary = { skipped: 'cron disabled in settings' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'leads-ai', 'skipped', Date.now() - startedAt, summary, null)
    return NextResponse.json(summary)
  }

  // Candidates: active leads where (lastAiRunAt is null) OR (updatedAt > lastAiRunAt).
  // SQLite text comparison works for ISO-8601 timestamps so we can compare directly.
  const candidates = await database
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      email: schema.leads.email,
      company: schema.leads.company,
      website: schema.leads.website,
      brief: schema.leads.brief,
      source: schema.leads.source,
      sourceDetail: schema.leads.sourceDetail,
      estimatedValue: schema.leads.estimatedValue,
      currency: schema.leads.currency,
      status: schema.leads.status,
      aiScore: schema.leads.aiScore,
      aiTokensSpent: schema.leads.aiTokensSpent,
      enrichedAt: schema.leads.enrichedAt,
      lastAiRunAt: schema.leads.lastAiRunAt,
      updatedAt: schema.leads.updatedAt,
      ownerId: schema.leads.ownerId,
    })
    .from(schema.leads)
    .where(and(
      inArray(schema.leads.status, ['new', 'qualifying', 'nurturing']),
      or(
        isNull(schema.leads.lastAiRunAt),
        sql`${schema.leads.updatedAt} > ${schema.leads.lastAiRunAt}`,
      ),
    ))
    .limit(MAX_LEADS_PER_RUN)

  // Daily auto-enrichment cap: count how many full enrichments have
  // already run today (via the lead_enriched activity rows) so we
  // bound spend even when many leads score above the threshold.
  let autoEnrichmentsToday = 0
  if (settings.autoEnrichScoreThreshold > 0 && settings.maxAutoEnrichmentsPerDay > 0) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const cutoff = todayStart.toISOString()
    const todayEnrichments = await database
      .select({ id: schema.activities.id })
      .from(schema.activities)
      .where(and(
        eq(schema.activities.type, 'lead_enriched'),
        sql`${schema.activities.createdAt} >= ${cutoff}`,
      ))
    autoEnrichmentsToday = todayEnrichments.length
  }
  const enrichmentBudget = Math.max(0, settings.maxAutoEnrichmentsPerDay - autoEnrichmentsToday)

  const results: Array<{
    leadId: string
    scored: boolean
    prevScore: number | null
    newScore: number | null
    autoEnriched: boolean
    transitions: string[]
    error?: string
  }> = []

  // ── Parallel scoring (#151 fix) ────────────────────────────────────
  // Score in batches of SCORE_CONCURRENCY so a tick processes ~25
  // leads in ~7-8s instead of one at a time. Haiku calls are
  // network-bound and Anthropic happily handles concurrent requests.
  // DB writes + notifications stay serial after scoring to keep D1
  // transactions clean.
  const SCORE_CONCURRENCY = 5
  interface ScoreOutcome {
    lead: typeof candidates[number]
    score: number | null
    scoreReason: string | null
    tokensSpent: number
    error?: string
  }
  const scoreOutcomes: ScoreOutcome[] = []
  for (let i = 0; i < candidates.length; i += SCORE_CONCURRENCY) {
    if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) {
      for (const lead of candidates.slice(i)) {
        scoreOutcomes.push({ lead, score: null, scoreReason: null, tokensSpent: 0, error: 'budget exhausted' })
      }
      break
    }
    const batch = candidates.slice(i, i + SCORE_CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(lead => scoreLead(lead).then(r => ({ ...r, lead })))
    )
    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j]
      const lead = batch[j]
      if (r.status === 'fulfilled') {
        scoreOutcomes.push({ lead, score: r.value.score, scoreReason: r.value.scoreReason, tokensSpent: r.value.tokensSpent })
      } else {
        scoreOutcomes.push({
          lead,
          score: null,
          scoreReason: null,
          tokensSpent: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        })
      }
    }
  }

  for (const outcome of scoreOutcomes) {
    const lead = outcome.lead
    if (outcome.error) {
      results.push({ leadId: lead.id, scored: false, prevScore: lead.aiScore ?? null, newScore: null, autoEnriched: false, transitions: [], error: outcome.error })
      continue
    }
    try {
      const prevScore = lead.aiScore ?? null
      const { score, scoreReason, tokensSpent } = outcome

      const now = new Date().toISOString()
      await database
        .update(schema.leads)
        .set({
          aiScore: score,
          aiScoreReason: scoreReason,
          aiTokensSpent: (lead.aiTokensSpent ?? 0) + tokensSpent,
          lastAiRunAt: now,
          updatedAt: now,
        })
        .where(eq(schema.leads.id, lead.id))

      // Stamp lead_scored activity when the score CHANGES. Skip when
      // identical to prevent timeline noise on stable leads. The
      // description carries the numeric score so the lead detail page
      // can build a score-over-time sparkline by parsing recent
      // activity rows.
      if (score != null && score !== prevScore) {
        await database.insert(schema.activities).values({
          id: crypto.randomUUID(),
          type: 'lead_scored',
          title: prevScore != null
            ? `Score: ${prevScore} → ${score}`
            : `Score: ${score}`,
          description: `score:${score}${scoreReason ? ` ${scoreReason}` : ''}`,
          leadId: lead.id,
          createdById: 'system',
          createdAt: now,
          updatedAt: now,
        })
      }

      // Smart-enrich gate: auto-trigger full Sonnet enrichment when
      // (a) the score crossed the threshold, (b) the lead hasn't been
      // enriched yet, and (c) we still have budget today.
      let autoEnriched = false
      const crossedAutoEnrich =
        settings.autoEnrichScoreThreshold > 0
        && score != null
        && score >= settings.autoEnrichScoreThreshold
        && !lead.enrichedAt
        && enrichmentBudget - results.filter(r => r.autoEnriched).length > 0
      if (crossedAutoEnrich) {
        try {
          // Call the existing enrich route in full mode. Internal call
          // — uses the same admin auth bypass path as the cron itself.
          const enrichRes = await fetch(
            new URL(`/api/admin/leads/${lead.id}/enrich`, req.url).toString(),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
                Cookie: req.headers.get('cookie') ?? '',
              },
            },
          )
          if (enrichRes.ok) autoEnriched = true
        } catch {
          // best-effort — failure here doesn't fail the whole cron
        }
      }

      // Transitions + notifications.
      const transitions: string[] = []
      if (autoEnriched) transitions.push('auto_enriched')
      const notifyTarget = lead.ownerId ?? settings.defaultLeadOwnerId
      const highIntent = score != null && score >= settings.highIntentThreshold
      const wasNotHighIntent = prevScore == null || prevScore < settings.highIntentThreshold

      // High intent — fires on the run that crosses the threshold.
      if (highIntent && wasNotHighIntent && settings.notifyOnHighIntent && notifyTarget) {
        await pushNotification(database, {
          userId: notifyTarget,
          eventType: 'lead_high_intent',
          title: `High-intent lead: ${lead.name}`,
          body: scoreReason ? `${scoreReason} (score ${score})` : `Score crossed ${settings.highIntentThreshold} (now ${score}).`,
          entityType: 'lead',
          entityId: lead.id,
        })
        transitions.push('high_intent_notified')
      }

      // Idle qualifying — leads sitting in 'qualifying' >N days with
      // no updatedAt since that point.
      if (lead.status === 'qualifying' && settings.notifyOnIdleQualifying && notifyTarget) {
        const idleDays = daysBetween(lead.updatedAt, now)
        if (idleDays >= settings.idleQualifyingDays) {
          // Idempotency: only notify once per idle window. Cheap check —
          // search the notifications table for a recent matching event.
          const alreadyNotified = await database
            .select({ id: schema.notifications.id })
            .from(schema.notifications)
            .where(and(
              eq(schema.notifications.entityId, lead.id),
              eq(schema.notifications.eventType, 'lead_idle_qualifying'),
              sql`${schema.notifications.createdAt} > datetime('now', '-${sql.raw(String(settings.idleQualifyingDays))} days')`,
            ))
            .limit(1)
          if (alreadyNotified.length === 0) {
            await pushNotification(database, {
              userId: notifyTarget,
              eventType: 'lead_idle_qualifying',
              title: `Stale lead: ${lead.name}`,
              body: `Sat in qualifying for ${idleDays} days with no activity. Chase or nurture?`,
              entityType: 'lead',
              entityId: lead.id,
            })
            transitions.push('idle_qualifying_notified')
          }
        }
      }

      // Auto-status: qualifying → nurturing after N days idle. OPT-IN.
      if (
        settings.autoNurturingAfterDays > 0
        && lead.status === 'qualifying'
        && daysBetween(lead.updatedAt, now) >= settings.autoNurturingAfterDays
      ) {
        await database
          .update(schema.leads)
          .set({ status: 'nurturing', updatedAt: now })
          .where(eq(schema.leads.id, lead.id))
        await database.insert(schema.activities).values({
          id: crypto.randomUUID(),
          type: 'lead_status_changed',
          title: 'Status changed: Qualifying → Nurturing (auto)',
          description: `No activity for ${settings.autoNurturingAfterDays} days.`,
          leadId: lead.id,
          createdById: 'system',
          createdAt: now,
          updatedAt: now,
        })
        transitions.push('auto_nurturing')
      }

      results.push({ leadId: lead.id, scored: true, prevScore, newScore: score, autoEnriched, transitions })
    } catch (err) {
      results.push({
        leadId: lead.id,
        scored: false,
        prevScore: lead.aiScore ?? null,
        newScore: null,
        autoEnriched: false,
        transitions: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const summary = {
    candidates: candidates.length,
    scored: results.filter(r => r.scored).length,
    autoEnriched: results.filter(r => r.autoEnriched).length,
    enrichmentBudgetRemaining: Math.max(0, enrichmentBudget - results.filter(r => r.autoEnriched).length),
    errors: results.filter(r => r.error).length,
    transitions: results.flatMap(r => r.transitions),
    durationMs: Date.now() - startedAt,
    results,
  }
  await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'leads-ai', 'success', Date.now() - startedAt, summary, null)
  return NextResponse.json(summary)
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface LeadSettings {
  cronEnabled: boolean
  notifyOnHighIntent: boolean
  notifyOnIdleQualifying: boolean
  notifyOnEnriched: boolean
  highIntentThreshold: number
  idleQualifyingDays: number
  autoNurturingAfterDays: number
  defaultLeadOwnerId: string | null
  /** Auto-trigger full Sonnet enrichment when an unenriched lead's
   *  Haiku score crosses this number. 0 = never auto-enrich.
   *  Default 60 — only spend Sonnet money on leads that look promising. */
  autoEnrichScoreThreshold: number
  /** Hard daily cap on auto-enrichments across all leads. Stops the
   *  cron from spending more than ~N × $0.30 per day even if many
   *  leads score above the threshold simultaneously. Default 10. */
  maxAutoEnrichmentsPerDay: number
}

async function readLeadSettings(database: Awaited<ReturnType<typeof db>>): Promise<LeadSettings> {
  const rows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, [
      'leads.cronEnabled',
      'leads.notifyOnHighIntent',
      'leads.notifyOnIdleQualifying',
      'leads.notifyOnEnriched',
      'leads.highIntentThreshold',
      'leads.idleQualifyingDays',
      'leads.autoNurturingAfterDays',
      'leads.defaultLeadOwnerId',
    ]))

  const get = (key: string) => rows.find(r => r.key === key)?.value ?? null
  const bool = (key: string, fallback: boolean) => {
    const v = get(key)
    if (v == null) return fallback
    return v === 'true' || v === '1'
  }
  const num = (key: string, fallback: number) => {
    const v = get(key)
    if (v == null) return fallback
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : fallback
  }

  return {
    cronEnabled: bool('leads.cronEnabled', true),
    notifyOnHighIntent: bool('leads.notifyOnHighIntent', true),
    notifyOnIdleQualifying: bool('leads.notifyOnIdleQualifying', true),
    notifyOnEnriched: bool('leads.notifyOnEnriched', true),
    highIntentThreshold: num('leads.highIntentThreshold', 80),
    idleQualifyingDays: num('leads.idleQualifyingDays', 7),
    autoNurturingAfterDays: num('leads.autoNurturingAfterDays', 0),
    defaultLeadOwnerId: get('leads.defaultLeadOwnerId'),
    autoEnrichScoreThreshold: num('leads.autoEnrichScoreThreshold', 60),
    maxAutoEnrichmentsPerDay: num('leads.maxAutoEnrichmentsPerDay', 10),
  }
}

interface ScoreInput {
  name: string
  email: string | null
  company: string | null
  website: string | null
  brief: string | null
  source: string
  sourceDetail: string | null
  estimatedValue: number | null
  currency: string
  status: string
}

async function scoreLead(lead: ScoreInput): Promise<{
  score: number | null
  scoreReason: string | null
  tokensSpent: number
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const userMessage = buildScoreMessage(lead)

  // Prepend the ICP + services context as a cached system block. The
  // ICP doc defines who Tahi sells to (employee bands by market,
  // verticals, AEO pain signals) — without it Haiku falls back to
  // generic SaaS heuristics and clusters all cold-outreach leads at
  // 25/35. With it, scoring discriminates on the actual ICP shape.
  const { loadAiContext } = await import('@/lib/ai-context')
  const contextText = await loadAiContext(['icp', 'services'])

  const systemBlocks = contextText
    ? [
        { type: 'text' as const, text: contextText, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: SYSTEM_PROMPT_SCORE },
      ]
    : [{ type: 'text' as const, text: SYSTEM_PROMPT_SCORE }]

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
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : null

  // Include cache tokens in the spend total — cache reads are heavily
  // discounted but still real cost, and cache creation is the same as
  // uncached input on the first call.
  const usage = response.usage as {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  const tokensSpent = usage.input_tokens
    + usage.output_tokens
    + (usage.cache_creation_input_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0)

  return {
    score,
    scoreReason: reasonMatch?.[1]?.trim() ?? null,
    tokensSpent,
  }
}

function buildScoreMessage(lead: ScoreInput): string {
  const lines: string[] = []
  lines.push(`Lead: ${lead.name}`)
  if (lead.company) lines.push(`Company: ${lead.company}`)
  if (lead.website) lines.push(`Website: ${lead.website}`)
  if (lead.email) lines.push(`Email: ${lead.email}`)
  lines.push(`Source: ${lead.source}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ''}`)
  if (lead.estimatedValue) lines.push(`Estimated value: ${lead.estimatedValue} ${lead.currency}`)
  lines.push(`Status: ${lead.status}`)
  if (lead.brief) lines.push(`Brief: ${lead.brief}`)
  return lines.join('\n')
}

interface NotificationInput {
  userId: string
  eventType: string
  title: string
  body: string
  entityType: string
  entityId: string
}

async function pushNotification(
  database: Awaited<ReturnType<typeof db>>,
  n: NotificationInput,
): Promise<void> {
  await database.insert(schema.notifications).values({
    id: crypto.randomUUID(),
    userId: n.userId,
    userType: 'team_member',
    eventType: n.eventType,
    title: n.title,
    body: n.body,
    entityType: n.entityType,
    entityId: n.entityId,
    read: false,
    createdAt: new Date().toISOString(),
  })
}

function daysBetween(fromIso: string | null, toIso: string): number {
  if (!fromIso) return 0
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)))
}
