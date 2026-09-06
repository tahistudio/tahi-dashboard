import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { requireAccessToOrg } from '@/lib/require-access'
import {
  createTimeEntry,
  timeEntryFailureResponse,
  timeEntryLoggerJoin,
  validateTimeEntryDraft,
  type TimeEntryDraft,
} from '@/lib/time-entries'
import { orgColumnInScope } from '../_scoping/org-scope'

// ── GET /api/admin/time ──────────────────────────────────────────────────────
// Returns paginated time entries with joins (org name, team member name, request title).
// Query params: orgId, teamMemberId, billable (0|1), dateFrom, dateTo, page (default 1)
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const orgIdFilter = url.searchParams.get('orgId')
  const teamMemberIdParam = url.searchParams.get('teamMemberId')
  const billableFilter = url.searchParams.get('billable')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') {
    return NextResponse.json({
      items: [], page, limit, totalHours: 0, billableHours: 0, entryCount: 0, capacityHours: null,
    })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Resolve teamMemberId=me to the signed-in member (teamMembers.clerkUserId).
  // Also carries the member's weekly capacity target back for the week meter.
  let teamMemberIdFilter = teamMemberIdParam
  let capacityHours: number | null = null
  if (teamMemberIdParam === 'me') {
    const [me] = await drizzle
      .select({ id: schema.teamMembers.id, weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId ?? ''))
      .limit(1)
    if (!me) {
      return NextResponse.json({
        items: [], page, limit, totalHours: 0, billableHours: 0, entryCount: 0, capacityHours: null,
      })
    }
    teamMemberIdFilter = me.id
    capacityHours = me.weeklyCapacityHours ?? null
  } else if (teamMemberIdParam) {
    const [member] = await drizzle
      .select({ weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, teamMemberIdParam))
      .limit(1)
    capacityHours = member?.weeklyCapacityHours ?? null
  }

  // Build conditions array
  const conditions = []
  if (scope.kind === 'some') {
    conditions.push(orgColumnInScope(schema.timeEntries.orgId, scope.orgIds))
  }
  if (orgIdFilter) conditions.push(eq(schema.timeEntries.orgId, orgIdFilter))
  if (teamMemberIdFilter) conditions.push(eq(schema.timeEntries.teamMemberId, teamMemberIdFilter))
  if (billableFilter === '1') conditions.push(eq(schema.timeEntries.billable, true))
  if (billableFilter === '0') conditions.push(eq(schema.timeEntries.billable, false))
  if (dateFrom) conditions.push(gte(schema.timeEntries.date, dateFrom))
  if (dateTo) conditions.push(lte(schema.timeEntries.date, dateTo))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const items = await drizzle
    .select({
      id: schema.timeEntries.id,
      orgId: schema.timeEntries.orgId,
      orgName: schema.organisations.name,
      requestId: schema.timeEntries.requestId,
      requestTitle: schema.requests.title,
      teamMemberId: schema.timeEntries.teamMemberId,
      teamMemberName: schema.teamMembers.name,
      hours: schema.timeEntries.hours,
      // The rate the entry was LOGGED at, not the client's current default.
      // Null is a real answer ("no rate"), which the /time Rate column shows
      // as such rather than as a zero somebody could mistake for free work.
      hourlyRate: schema.timeEntries.hourlyRate,
      billable: schema.timeEntries.billable,
      notes: schema.timeEntries.notes,
      date: schema.timeEntries.date,
      createdAt: schema.timeEntries.createdAt,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.organisations, eq(schema.timeEntries.orgId, schema.organisations.id))
    .leftJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
    .leftJoin(schema.teamMembers, timeEntryLoggerJoin())
    .where(whereClause)
    .orderBy(desc(schema.timeEntries.date))
    .limit(limit)
    .offset(offset)

  // Get summary stats (total hours / billable hours for the current filter)
  const [summary] = await drizzle
    .select({
      totalHours: sql<number>`coalesce(sum(${schema.timeEntries.hours}), 0)`,
      billableHours: sql<number>`coalesce(sum(case when ${schema.timeEntries.billable} = 1 then ${schema.timeEntries.hours} else 0 end), 0)`,
      entryCount: sql<number>`count(*)`,
    })
    .from(schema.timeEntries)
    .where(whereClause)

  return NextResponse.json({
    items,
    page,
    limit,
    totalHours: summary?.totalHours ?? 0,
    billableHours: summary?.billableHours ?? 0,
    entryCount: summary?.entryCount ?? 0,
    capacityHours,
  })
}

// ── POST /api/admin/time ─────────────────────────────────────────────────────
// Creates a new time entry.
// Body: { orgId, requestId?, teamMemberId, hours, notes?, billable?, date,
//         hourlyRate? }
//
// Deliberately no taskId here. This route gates on the orgId the caller sends,
// so accepting a task id would let a body pair its own org with another
// client's task. Task time goes through POST /api/admin/time-entries, which
// derives the org from the task itself.
//
// hourlyRate used to be read by nobody here, so the "Rate ($/hr)" field on the
// /time Log time slide-over posted a number that never reached a column. The
// write now goes through lib/time-entries.ts, the same module POST
// /api/admin/time-entries uses, so a rate typed on either surface is stored,
// and an omitted one falls back to the client's default_hourly_rate.
export async function POST(req: NextRequest) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as {
    orgId?: string
    requestId?: string
    teamMemberId?: string
    hours?: number
    notes?: string
    billable?: boolean
    date?: string
    hourlyRate?: number | null
  } | null
  if (!body) return NextResponse.json({ error: 'Body required' }, { status: 400 })

  const draft: TimeEntryDraft = {
    orgId: body.orgId,
    teamMemberId: body.teamMemberId,
    requestId: body.requestId ?? null,
    hours: body.hours,
    date: body.date,
    notes: body.notes ?? null,
    billable: body.billable,
    hourlyRate: body.hourlyRate,
    source: 'manual',
  }

  // Field checks run before the database is touched: a body with no orgId has
  // nothing for the access gate to gate on, and would otherwise come back
  // "Not found" rather than naming the field that is missing.
  const invalid = validateTimeEntryDraft(draft)
  if (invalid) return timeEntryFailureResponse(invalid)

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const denied = await requireAccessToOrg(drizzle, userId, body.orgId)
  if (denied) return denied

  const result = await createTimeEntry(drizzle, draft)
  if (!result.ok) return timeEntryFailureResponse(result.failure)

  return NextResponse.json({ id: result.entry.id })
}
