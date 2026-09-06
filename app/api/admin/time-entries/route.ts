/**
 * POST /api/admin/time-entries
 *
 * Manual time entry creation. Supports all three modes :
 *
 *   1. Scalar  : { requestId?, taskId?, hours, date?, notes?, billable? }
 *      Logs a flat "I spent N hours on this" entry. date defaults to today.
 *
 *   2. Range   : { requestId?, taskId?, startedAt, endedAt, notes?, billable? }
 *      Server computes hours = (endedAt - startedAt) / 3600000.
 *      date derived from startedAt.
 *
 *   3. Mixed   : both { hours, startedAt } set - server trusts the explicit
 *      hours and stores the range for reference.
 *
 * Exactly one of requestId or taskId required. Admin only.
 *
 * The entry is owned by the caller's team_members row unless the body names a
 * teamMemberId, which is how the MCP tools and the service token log on
 * someone's behalf. Either way the value stored is a team_members.id, never a
 * Clerk user id.
 *
 * A task with no client is still loggable. time_entries.org_id is NOT NULL,
 * so a studio (tahi_internal) task resolves its org the same way a stopped
 * timer does, through resolveTimerOrgId, rather than being refused.
 *
 * PATCH / DELETE on individual entries will live in `[id]/route.ts` later
 * (per the existing /requests/[id]/time-entries pattern - not duplicated here).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { resolveTimerOrgId } from '@/lib/timer-helpers'
import { INTERNAL_ORG_ID } from '@/lib/internal-org'
import {
  createTimeEntry,
  deriveHoursAndDate,
  isTimeEntryFailure,
  resolveLoggingTeamMemberId,
  timeEntryFailureResponse,
  timeEntryLoggerJoin,
} from '@/lib/time-entries'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/time-entries?taskId=... (or ?requestId=...)
 *
 * Lists the time entries logged against a single task or request, newest
 * first, with the logging member's name resolved. Returns the running total
 * so the caller can render "6.5h logged" without a second round trip. Admin
 * only; org access is enforced against the target's org.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const taskId = url.searchParams.get('taskId')
  const requestId = url.searchParams.get('requestId')

  if ((!taskId && !requestId) || (taskId && requestId)) {
    return NextResponse.json({ error: 'Exactly one of taskId or requestId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Resolve the target org for the access gate.
  let targetOrgId: string | null = null
  if (taskId) {
    const [t] = await drizzle
      .select({ orgId: schema.tasks.orgId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1)
    if (!t) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    targetOrgId = t.orgId
  } else if (requestId) {
    const [r] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1)
    if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    targetOrgId = r.orgId
  }

  // A Tahi-internal task has no client to gate against, and it is the
  // studio's own work, so every team member on this surface may read its
  // hours. Same rule as guardTask in lib/task-access.ts.
  if (targetOrgId) {
    const denied = await requireAccessToOrg(drizzle, userId, targetOrgId)
    if (denied) return denied
  }

  const items = await drizzle
    .select({
      id: schema.timeEntries.id,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      notes: schema.timeEntries.notes,
      date: schema.timeEntries.date,
      source: schema.timeEntries.source,
      teamMemberId: schema.timeEntries.teamMemberId,
      teamMemberName: schema.teamMembers.name,
      createdAt: schema.timeEntries.createdAt,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.teamMembers, timeEntryLoggerJoin())
    .where(taskId ? eq(schema.timeEntries.taskId, taskId) : eq(schema.timeEntries.requestId, requestId as string))
    .orderBy(desc(schema.timeEntries.date))

  const totalHours = items.reduce((sum, e) => sum + (e.hours ?? 0), 0)

  return NextResponse.json({ items, totalHours })
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const body = await req.json().catch(() => null) as {
    requestId?: string | null
    taskId?: string | null
    hours?: number
    startedAt?: string
    endedAt?: string
    date?: string
    notes?: string | null
    billable?: boolean
    hourlyRate?: number | null
    teamMemberId?: string | null
  } | null
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 })

  const targetRequestId = body.requestId ?? null
  const targetTaskId = body.taskId ?? null
  if ((!targetRequestId && !targetTaskId) || (targetRequestId && targetTaskId)) {
    return NextResponse.json({ error: 'Exactly one of requestId or taskId required' }, { status: 400 })
  }

  // Derive hours + date from whatever combination was provided. Shared with
  // POST /api/admin/time so the two manual-entry URLs cannot drift again.
  const startedAt = body.startedAt ?? null
  const endedAt = body.endedAt ?? null
  const derived = deriveHoursAndDate({
    hours: body.hours,
    startedAt,
    endedAt,
    date: body.date,
  })
  if (isTimeEntryFailure(derived)) return timeEntryFailureResponse(derived)
  const { hours, date } = derived

  // Look up orgId for the entry.
  const database = await db()
  const drizzle = database as Drizzle

  let entryOrgId: string | null = null
  if (targetRequestId) {
    const [r] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, targetRequestId))
      .limit(1)
    if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    entryOrgId = r.orgId
  } else if (targetTaskId) {
    const [t] = await drizzle
      .select({ orgId: schema.tasks.orgId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, targetTaskId))
      .limit(1)
    if (!t) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // A studio task carries no client, and time_entries.org_id is NOT NULL,
    // so a plain read of the task's org used to 400 every tahi_internal row
    // out of this route while the live timer happily logged the same hours.
    // Resolve it exactly the way a stopped timer does (the request it hangs
    // off, else the hidden internal studio org) so manual and timed hours on
    // one task never land on two different clients.
    entryOrgId = t.orgId
      ?? await resolveTimerOrgId(drizzle, { requestId: null, taskId: targetTaskId, orgId: null })
  }
  if (!entryOrgId) {
    return NextResponse.json({ error: 'Cannot log time on this target (no org attached)' }, { status: 400 })
  }

  // Gate on the target's OWN client, which is what the caller is reaching
  // into. The hidden internal studio org is not a client: nobody is ever
  // scoped to it, so gating there 403'd every scoped team member out of
  // logging time on a Tahi task, which contradicts the rule the tasks routes
  // now hold (a task with no client is the studio's own and every team
  // member may reach it). An org inherited from a linked request is still a
  // real client and is still checked.
  if (entryOrgId !== INTERNAL_ORG_ID) {
    const denied = await requireAccessToOrg(drizzle, userId, entryOrgId)
    if (denied) return denied
  }

  // team_member_id points at team_members.id, and `userId` is a Clerk id.
  // This route used to insert the Clerk id raw, so every entry logged from a
  // request or task time card joined to no member and read as "Unknown" on
  // /time while the live timer, which resolved first, read correctly. Same
  // resolution for both now, and a caller who cannot be resolved is refused
  // rather than written as an orphan.
  const logger = await resolveLoggingTeamMemberId(drizzle, {
    userId,
    supplied: body.teamMemberId,
  })
  if (!logger.ok) return timeEntryFailureResponse(logger.failure)

  // One writer for both manual-entry URLs (lib/time-entries.ts). It also
  // resolves the rate: a rate on the body wins, else the client's
  // default_hourly_rate, else null. Never 0.
  const result = await createTimeEntry(drizzle, {
    orgId: entryOrgId,
    teamMemberId: logger.teamMemberId,
    requestId: targetRequestId,
    taskId: targetTaskId,
    hours,
    date,
    notes: body.notes ?? null,
    billable: body.billable,
    hourlyRate: body.hourlyRate,
    startedAt,
    endedAt,
    source: 'manual',
  })
  if (!result.ok) return timeEntryFailureResponse(result.failure)

  return NextResponse.json({ id: result.entry.id, hours, date }, { status: 201 })
}
