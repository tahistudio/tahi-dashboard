import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, or, isNull, inArray, gte, desc } from 'drizzle-orm'
import { elapsedSeconds } from '@/lib/timer-helpers'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Task statuses that mean "no longer open work".
const TASK_CLOSED = new Set(['done', 'completed', 'cancelled', 'archived'])
// Request statuses that count as live work in front of the member.
const REQUEST_OPEN = new Set(['submitted', 'in_review', 'in_progress', 'client_review'])

// Lookback for "replies waiting" - older inbound threads are stale.
function since(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

// Date-part (YYYY-MM-DD) of an ISO/date string, or null.
function dayOf(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, 10)
}

// ── GET /api/admin/overview/me ─────────────────────────────────────────────
// Single-fetch aggregate for the TEAMMATE home Hero + Vitals, scoped to the
// signed-in team member (resolved via teamMembers.clerkUserId = auth userId).
// Returns honest zeros / null when the caller has no team_members row (e.g. a
// pure admin without a member record) rather than leaking studio-wide numbers.
//
//   { openWork, dueToday, overdue, timer: {elapsedSeconds,title}|null, repliesWaiting }
//
// Every source is wrapped so a missing table / un-migrated column can never
// 500 the home page; it just contributes zero.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // Timer is keyed by the Clerk userId (active_timers.user_id), so it resolves
  // even before we know the team_members row.
  const timer = await resolveTimer(drizzle, userId)

  // Resolve the current team member. Without one, there is no scoped work.
  let memberId: string | null = null
  if (userId) {
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
  }

  if (!memberId) {
    return NextResponse.json({ openWork: 0, dueToday: 0, overdue: 0, timer, repliesWaiting: 0 })
  }

  const today = new Date().toISOString().slice(0, 10)

  // Open items carry a status + optional due date; we count them uniformly.
  const openItems: Array<{ dueDate: string | null }> = []

  // Tasks assigned to the member (team_member assignee; legacy rows may have a
  // null assigneeType but still point at the member's id).
  try {
    const tasks = await drizzle
      .select({ status: schema.tasks.status, dueDate: schema.tasks.dueDate })
      .from(schema.tasks)
      .where(and(
        eq(schema.tasks.assigneeId, memberId),
        or(isNull(schema.tasks.assigneeType), eq(schema.tasks.assigneeType, 'team_member')),
      ))
    for (const t of tasks) {
      if (!TASK_CLOSED.has(t.status)) openItems.push({ dueDate: t.dueDate })
    }
  } catch {
    // tasks table missing - no task work counted.
  }

  // Requests the member owns (direct assignee) or participates on.
  try {
    const reqIds = new Set<string>()
    const rows: Array<{ id: string; status: string; dueDate: string | null }> = []

    const direct = await drizzle
      .select({ id: schema.requests.id, status: schema.requests.status, dueDate: schema.requests.dueDate })
      .from(schema.requests)
      .where(eq(schema.requests.assigneeId, memberId))
    for (const r of direct) {
      reqIds.add(r.id)
      rows.push(r)
    }

    const parts = await drizzle
      .select({ requestId: schema.requestParticipants.requestId })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.participantId, memberId),
        eq(schema.requestParticipants.participantType, 'team_member'),
        isNull(schema.requestParticipants.removedAt),
      ))
    const extraIds = parts.map(p => p.requestId).filter(id => !reqIds.has(id))
    if (extraIds.length > 0) {
      const extra = await drizzle
        .select({ id: schema.requests.id, status: schema.requests.status, dueDate: schema.requests.dueDate })
        .from(schema.requests)
        .where(inArray(schema.requests.id, extraIds))
      for (const r of extra) rows.push(r)
    }

    for (const r of rows) {
      if (REQUEST_OPEN.has(r.status)) openItems.push({ dueDate: r.dueDate })
    }
  } catch {
    // requests / participants table missing - no request work counted.
  }

  let dueToday = 0
  let overdue = 0
  for (const item of openItems) {
    const d = dayOf(item.dueDate)
    if (!d) continue
    if (d === today) dueToday++
    else if (d < today) overdue++
  }

  let repliesWaiting = 0
  try {
    repliesWaiting = await countRepliesWaiting(drizzle, memberId)
  } catch {
    repliesWaiting = 0
  }

  return NextResponse.json({
    openWork: openItems.length,
    dueToday,
    overdue,
    timer,
    repliesWaiting,
  })
}

// Current user's running timer, with the target's title. Null when none.
async function resolveTimer(
  drizzle: D1,
  userId: string | null,
): Promise<{ elapsedSeconds: number; title: string | null } | null> {
  if (!userId) return null
  try {
    const [timer] = await drizzle
      .select()
      .from(schema.activeTimers)
      .where(eq(schema.activeTimers.userId, userId))
      .limit(1)
    if (!timer) return null

    let title: string | null = null
    if (timer.requestId) {
      const [r] = await drizzle
        .select({ title: schema.requests.title })
        .from(schema.requests)
        .where(eq(schema.requests.id, timer.requestId))
        .limit(1)
      title = r?.title ?? null
    } else if (timer.taskId) {
      const [t] = await drizzle
        .select({ title: schema.tasks.title })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, timer.taskId))
        .limit(1)
      title = t?.title ?? null
    } else if (timer.orgId) {
      const [o] = await drizzle
        .select({ name: schema.organisations.name })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, timer.orgId))
        .limit(1)
      title = o?.name ?? null
    }

    return { elapsedSeconds: elapsedSeconds(timer), title }
  } catch {
    return null
  }
}

// Count of threads (conversations + request threads) the member is on where the
// last non-deleted message was authored by a client contact - i.e. awaiting the
// member's reply. Mirrors the item builder in ../replies-waiting/route.ts; kept
// count-only here to stay within this route's owned file.
async function countRepliesWaiting(drizzle: D1, memberId: string): Promise<number> {
  const cutoff = since(60)
  let count = 0

  // Conversations the member participates in.
  const convRows = await drizzle
    .select({ conversationId: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(and(
      eq(schema.conversationParticipants.participantId, memberId),
      eq(schema.conversationParticipants.participantType, 'team_member'),
    ))
  const convIds = [...new Set(convRows.map(c => c.conversationId))]
  if (convIds.length > 0) {
    const msgs = await drizzle
      .select({
        conversationId: schema.messages.conversationId,
        authorType: schema.messages.authorType,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(
        inArray(schema.messages.conversationId, convIds),
        isNull(schema.messages.deletedAt),
        gte(schema.messages.createdAt, cutoff),
      ))
      .orderBy(desc(schema.messages.createdAt))
    const seen = new Set<string>()
    for (const m of msgs) {
      const key = m.conversationId
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (m.authorType === 'contact') count++
    }
  }

  // Request threads the member owns or participates on.
  const reqIds = new Set<string>()
  const directReqs = await drizzle
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.assigneeId, memberId))
  for (const r of directReqs) reqIds.add(r.id)
  const partReqs = await drizzle
    .select({ requestId: schema.requestParticipants.requestId })
    .from(schema.requestParticipants)
    .where(and(
      eq(schema.requestParticipants.participantId, memberId),
      eq(schema.requestParticipants.participantType, 'team_member'),
      isNull(schema.requestParticipants.removedAt),
    ))
  for (const p of partReqs) reqIds.add(p.requestId)

  const reqIdList = [...reqIds]
  if (reqIdList.length > 0) {
    const msgs = await drizzle
      .select({
        requestId: schema.messages.requestId,
        authorType: schema.messages.authorType,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(
        inArray(schema.messages.requestId, reqIdList),
        isNull(schema.messages.conversationId),
        isNull(schema.messages.deletedAt),
        gte(schema.messages.createdAt, cutoff),
      ))
      .orderBy(desc(schema.messages.createdAt))
    const seen = new Set<string>()
    for (const m of msgs) {
      const key = m.requestId
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (m.authorType === 'contact') count++
    }
  }

  return count
}
