import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, isNotNull, desc } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { resolvePermissions, can } from '@/lib/permissions'
import {
  mergeWireEvents,
  wireSince,
  leadScoreText,
  automationRanText,
  type WireEvent,
} from '@/lib/overview-wire'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Compact NZD money label for the wire, e.g. "NZ$4,800". Whole dollars only;
// the ticker is a glance, not a ledger.
function nzd(amount: number): string {
  return `NZ$${Math.round(amount).toLocaleString('en-NZ')}`
}

// ── GET /api/admin/overview/wire ───────────────────────────────────────────────
// Aggregates the most recent cross-dashboard EVENTS for "The Wire" ticker.
// Every source is wrapped in its own try/catch so a missing table or an
// un-migrated column can never 500 the home page; that source just yields no
// events. Returns newest-first, capped, last ~7 days.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // Feature-level access: omit money events without financial_reports and
  // client events without clients (mirrors the overview endpoint's gating).
  const access = await resolvePermissions(drizzle, auth)
  const canSeeMoney = can(access, 'financial_reports')
  const canSeeClients = can(access, 'clients')

  const now = new Date()
  const since = wireSince(now, 7)

  // Per-source row cap. We over-fetch a little per source then merge + cap
  // globally so one chatty source can't crowd the rail.
  const PER_SOURCE = 12

  let rateMap: RateMap = {}
  if (canSeeMoney) {
    try {
      const rates = await drizzle.select().from(schema.exchangeRates)
      rateMap = buildRateMap(rates)
    } catch {
      rateMap = {}
    }
  }

  const candidates: WireEvent[] = []

  // ── Content published (publish_history) ───────────────────────────────────
  try {
    const rows = await drizzle
      .select({
        id: schema.publishHistory.id,
        title: schema.publishHistory.title,
        publishedAt: schema.publishHistory.publishedAt,
      })
      .from(schema.publishHistory)
      .where(gte(schema.publishHistory.publishedAt, since))
      .orderBy(desc(schema.publishHistory.publishedAt))
      .limit(PER_SOURCE)
    for (const r of rows) {
      candidates.push({
        id: `content:${r.id}`,
        type: 'content',
        text: r.title?.trim() ? `Post published: ${r.title.trim()}` : 'Post published',
        at: r.publishedAt,
      })
    }
  } catch {
    // publish_history table missing — skip content events.
  }

  // ── Social posts sent (no Buffer/social posts table in schema) ─────────────
  // Intentionally skipped: there is no posts/buffer table in db/schema.ts.

  // ── Automations run (automation_log + rule name) ──────────────────────────
  try {
    const rows = await drizzle
      .select({
        id: schema.automationLog.id,
        executedAt: schema.automationLog.executedAt,
        ruleName: schema.automationRules.name,
      })
      .from(schema.automationLog)
      .leftJoin(schema.automationRules, eq(schema.automationLog.ruleId, schema.automationRules.id))
      .where(and(
        gte(schema.automationLog.executedAt, since),
        eq(schema.automationLog.status, 'success'),
      ))
      .orderBy(desc(schema.automationLog.executedAt))
      .limit(PER_SOURCE)
    for (const r of rows) {
      candidates.push({
        id: `ops:${r.id}`,
        type: 'ops',
        text: automationRanText(r.ruleName),
        at: r.executedAt,
      })
    }
  } catch {
    // automation_log table missing — skip ops events.
  }

  // ── Leads scored (leads with aiScore, recently run) ───────────────────────
  try {
    const rows = await drizzle
      .select({
        id: schema.leads.id,
        aiScore: schema.leads.aiScore,
        lastAiRunAt: schema.leads.lastAiRunAt,
      })
      .from(schema.leads)
      .where(and(
        isNotNull(schema.leads.aiScore),
        gte(schema.leads.lastAiRunAt, since),
      ))
      .orderBy(desc(schema.leads.lastAiRunAt))
      .limit(PER_SOURCE)
    for (const r of rows) {
      if (r.aiScore == null || !r.lastAiRunAt) continue
      candidates.push({
        id: `sales:${r.id}`,
        type: 'sales',
        text: leadScoreText(r.aiScore),
        at: r.lastAiRunAt,
      })
    }
  } catch {
    // leads table / AI columns missing — skip sales events.
  }

  // ── Payments cleared (invoices paidAt recent) — money, gated ──────────────
  if (canSeeMoney) {
    try {
      const rows = await drizzle
        .select({
          id: schema.invoices.id,
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
          paidAt: schema.invoices.paidAt,
        })
        .from(schema.invoices)
        .where(and(
          eq(schema.invoices.status, 'paid'),
          gte(schema.invoices.paidAt, since),
        ))
        .orderBy(desc(schema.invoices.paidAt))
        .limit(PER_SOURCE)
      for (const r of rows) {
        if (!r.paidAt) continue
        const amount = toNzd(r.totalUsd, r.currency ?? 'USD', rateMap)
        candidates.push({
          id: `money:${r.id}`,
          type: 'money',
          text: `Payment cleared ${nzd(amount)}`,
          at: r.paidAt,
        })
      }
    } catch {
      // invoices table missing — skip money events.
    }
  }

  // ── Reviews / testimonials landed (case_study_submissions) — client, gated ─
  if (canSeeClients) {
    try {
      const rows = await drizzle
        .select({
          id: schema.caseStudySubmissions.id,
          npsScore: schema.caseStudySubmissions.npsScore,
          submittedAt: schema.caseStudySubmissions.submittedAt,
          orgName: schema.organisations.name,
        })
        .from(schema.caseStudySubmissions)
        .leftJoin(schema.organisations, eq(schema.caseStudySubmissions.orgId, schema.organisations.id))
        .where(and(
          isNotNull(schema.caseStudySubmissions.submittedAt),
          gte(schema.caseStudySubmissions.submittedAt, since),
        ))
        .orderBy(desc(schema.caseStudySubmissions.submittedAt))
        .limit(PER_SOURCE)
      for (const r of rows) {
        if (!r.submittedAt) continue
        const who = r.orgName?.trim()
        const nps = r.npsScore != null ? ` (NPS ${r.npsScore})` : ''
        candidates.push({
          id: `client:${r.id}`,
          type: 'client',
          text: who ? `Review from ${who}${nps}` : `New review landed${nps}`,
          at: r.submittedAt,
        })
      }
    } catch {
      // case_study_submissions table missing — skip client events.
    }
  }

  const events = mergeWireEvents(candidates)

  return NextResponse.json({ events })
}
