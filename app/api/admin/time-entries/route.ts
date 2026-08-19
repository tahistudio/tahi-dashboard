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
 * PATCH / DELETE on individual entries will live in `[id]/route.ts` later
 * (per the existing /requests/[id]/time-entries pattern - not duplicated here).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

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

  // Tahi-internal tasks may have no org; only unrestricted users may read them.
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
    .leftJoin(schema.teamMembers, eq(schema.timeEntries.teamMemberId, schema.teamMembers.id))
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
  } | null
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 })

  const targetRequestId = body.requestId ?? null
  const targetTaskId = body.taskId ?? null
  if ((!targetRequestId && !targetTaskId) || (targetRequestId && targetTaskId)) {
    return NextResponse.json({ error: 'Exactly one of requestId or taskId required' }, { status: 400 })
  }

  // Derive hours + date from whatever combination was provided.
  let hours = body.hours
  const startedAt = body.startedAt ?? null
  const endedAt = body.endedAt ?? null

  if (hours === undefined && startedAt && endedAt) {
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
    if (!Number.isFinite(ms) || ms <= 0) {
      return NextResponse.json({ error: 'Invalid range : endedAt must be after startedAt' }, { status: 400 })
    }
    hours = Math.round((ms / 3600000) * 100) / 100
  }
  if (!hours || hours <= 0) {
    return NextResponse.json({ error: 'hours (or a valid startedAt + endedAt range) required' }, { status: 400 })
  }

  const date = body.date ?? (startedAt ? startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10))

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
    entryOrgId = t.orgId
  }
  if (!entryOrgId) {
    return NextResponse.json({ error: 'Cannot log time on this target (no org attached)' }, { status: 400 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, entryOrgId)
  if (denied) return denied

  const newId = crypto.randomUUID()
  await drizzle.insert(schema.timeEntries).values({
    id: newId,
    orgId: entryOrgId,
    requestId: targetRequestId,
    taskId: targetTaskId,
    teamMemberId: userId,
    hours,
    hourlyRate: body.hourlyRate ?? null,
    billable: body.billable !== false, // default true
    notes: body.notes ?? null,
    date,
    startedAt: startedAt,
    endedAt: endedAt,
    source: 'manual',
  })

  return NextResponse.json({ id: newId, hours, date }, { status: 201 })
}
