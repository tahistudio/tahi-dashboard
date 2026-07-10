import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, isNotNull, isNull, inArray, ne, desc } from 'drizzle-orm'
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

  // ── scope=me ──────────────────────────────────────────────────────────────
  // Teammate home wants a member-scoped pulse (assignments to me, comments on
  // my requests, my tasks moved) rather than the studio-wide feed. Resolved via
  // teamMembers.clerkUserId; honest empty when the caller has no member row.
  if (new URL(req.url).searchParams.get('scope') === 'me') {
    const events = await memberWire(drizzle, auth.userId)
    return NextResponse.json({ events })
  }

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
    // publish_history table missing - skip content events.
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
    // automation_log table missing - skip ops events.
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
    // leads table / AI columns missing - skip sales events.
  }

  // ── Payments cleared (invoices paidAt recent) - money, gated ──────────────
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
      // invoices table missing - skip money events.
    }
  }

  // ── Reviews / testimonials landed (case_study_submissions) - client, gated ─
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
      // case_study_submissions table missing - skip client events.
    }
  }

  const events = mergeWireEvents(candidates)

  return NextResponse.json({ events })
}

// ── Member-scoped wire (scope=me) ───────────────────────────────────────────
// Builds a pulse of what touched THIS member's work in the last 7 days:
// requests they were added to, comments on their requests, and their own tasks
// moving forward. Reuses the studio wire's WireDomain palette so the-wire.tsx
// renders it unchanged ('client' ink for a client reply, 'ops' otherwise).
// Every source is isolated so a missing table can never break the rail.
async function memberWire(drizzle: D1, userId: string | null): Promise<WireEvent[]> {
  if (!userId) return []

  let memberId: string | null = null
  try {
    const [m] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    memberId = m?.id ?? null
  } catch {
    memberId = null
  }
  if (!memberId) return []

  const since = wireSince(new Date(), 7)
  const PER_SOURCE = 12
  const candidates: WireEvent[] = []

  // Request ids the member owns or participates on - shared by two sources.
  const reqIds = new Set<string>()
  try {
    const direct = await drizzle
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.assigneeId, memberId))
    for (const r of direct) reqIds.add(r.id)
    const parts = await drizzle
      .select({ requestId: schema.requestParticipants.requestId })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.participantId, memberId),
        eq(schema.requestParticipants.participantType, 'team_member'),
        isNull(schema.requestParticipants.removedAt),
      ))
    for (const p of parts) reqIds.add(p.requestId)
  } catch {
    // requests / participants missing - no request-derived events.
  }

  // ── Assignments to me (recently added as assignee/pm) ─────────────────────
  try {
    const rows = await drizzle
      .select({
        id: schema.requestParticipants.id,
        addedAt: schema.requestParticipants.addedAt,
        title: schema.requests.title,
      })
      .from(schema.requestParticipants)
      .innerJoin(schema.requests, eq(schema.requestParticipants.requestId, schema.requests.id))
      .where(and(
        eq(schema.requestParticipants.participantId, memberId),
        eq(schema.requestParticipants.participantType, 'team_member'),
        inArray(schema.requestParticipants.role, ['assignee', 'pm']),
        isNull(schema.requestParticipants.removedAt),
        gte(schema.requestParticipants.addedAt, since),
      ))
      .orderBy(desc(schema.requestParticipants.addedAt))
      .limit(PER_SOURCE)
    for (const r of rows) {
      const title = r.title?.trim()
      candidates.push({
        id: `assign:${r.id}`,
        type: 'ops',
        text: title ? `You were added to ${title}` : 'You were added to a request',
        at: r.addedAt,
      })
    }
  } catch {
    // request_participants missing - skip assignment events.
  }

  // ── Comments on my requests (by anyone other than me) ─────────────────────
  if (reqIds.size > 0) {
    try {
      const rows = await drizzle
        .select({
          id: schema.messages.id,
          createdAt: schema.messages.createdAt,
          authorType: schema.messages.authorType,
          title: schema.requests.title,
        })
        .from(schema.messages)
        .innerJoin(schema.requests, eq(schema.messages.requestId, schema.requests.id))
        .where(and(
          inArray(schema.messages.requestId, [...reqIds]),
          isNull(schema.messages.deletedAt),
          ne(schema.messages.authorId, memberId),
          gte(schema.messages.createdAt, since),
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(PER_SOURCE)
      for (const r of rows) {
        const title = r.title?.trim()
        const isClient = r.authorType === 'contact'
        candidates.push({
          id: `comment:${r.id}`,
          type: isClient ? 'client' : 'ops',
          text: title
            ? `${isClient ? 'New reply' : 'New comment'} on ${title}`
            : (isClient ? 'New client reply' : 'New comment'),
          at: r.createdAt,
        })
      }
    } catch {
      // messages missing - skip comment events.
    }
  }

  // ── My tasks moving forward ───────────────────────────────────────────────
  try {
    const rows = await drizzle
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        status: schema.tasks.status,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(
        eq(schema.tasks.assigneeId, memberId),
        inArray(schema.tasks.status, ['in_progress', 'blocked', 'done']),
        gte(schema.tasks.updatedAt, since),
      ))
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(PER_SOURCE)
    for (const r of rows) {
      const title = r.title?.trim() || 'a task'
      const text = r.status === 'done'
        ? `You completed ${title}`
        : `Task now ${r.status === 'in_progress' ? 'in progress' : 'blocked'}: ${title}`
      candidates.push({
        id: `task:${r.id}`,
        type: 'ops',
        text,
        at: r.updatedAt,
      })
    }
  } catch {
    // tasks missing - skip task events.
  }

  return mergeWireEvents(candidates)
}
