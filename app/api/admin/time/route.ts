import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'

// ── GET /api/admin/time ──────────────────────────────────────────────────────
// Returns paginated time entries with joins (org name, team member name, request title).
// Query params: orgId, teamMemberId, billable (0|1), dateFrom, dateTo, page (default 1)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const orgIdFilter = url.searchParams.get('orgId')
  const teamMemberIdFilter = url.searchParams.get('teamMemberId')
  const billableFilter = url.searchParams.get('billable')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Build conditions array
  const conditions = []
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
      billable: schema.timeEntries.billable,
      notes: schema.timeEntries.notes,
      date: schema.timeEntries.date,
      createdAt: schema.timeEntries.createdAt,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.organisations, eq(schema.timeEntries.orgId, schema.organisations.id))
    .leftJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
    .leftJoin(schema.teamMembers, eq(schema.timeEntries.teamMemberId, schema.teamMembers.id))
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
  })
}

// ── POST /api/admin/time ─────────────────────────────────────────────────────
// Creates a new time entry.
// Body: { orgId, requestId?, teamMemberId, hours, notes?, billable?, date }
export async function POST(req: NextRequest) {
  const { orgId: authOrgId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    requestId?: string
    teamMemberId?: string
    hours?: number
    notes?: string
    billable?: boolean
    date?: string
  }

  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!body.teamMemberId) {
    return NextResponse.json({ error: 'teamMemberId is required' }, { status: 400 })
  }
  if (typeof body.hours !== 'number' || body.hours <= 0) {
    return NextResponse.json({ error: 'hours must be a positive number' }, { status: 400 })
  }
  if (!body.date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.insert(schema.timeEntries).values({
    id,
    orgId: body.orgId,
    requestId: body.requestId ?? null,
    teamMemberId: body.teamMemberId,
    hours: body.hours,
    billable: body.billable !== false,
    notes: body.notes ?? null,
    date: body.date,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id })
}
