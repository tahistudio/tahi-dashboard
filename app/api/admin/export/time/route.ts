import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lte, desc } from 'drizzle-orm'

// -- GET /api/admin/export/time --
// Returns time entries as CSV.
// Query params: dateFrom, dateTo, orgId, teamMemberId
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const orgIdFilter = url.searchParams.get('orgId')
  const teamMemberIdFilter = url.searchParams.get('teamMemberId')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (orgIdFilter) conditions.push(eq(schema.timeEntries.orgId, orgIdFilter))
  if (teamMemberIdFilter) conditions.push(eq(schema.timeEntries.teamMemberId, teamMemberIdFilter))
  if (dateFrom) conditions.push(gte(schema.timeEntries.date, dateFrom))
  if (dateTo) conditions.push(lte(schema.timeEntries.date, dateTo))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const items = await drizzle
    .select({
      date: schema.timeEntries.date,
      teamMemberName: schema.teamMembers.name,
      orgName: schema.organisations.name,
      requestTitle: schema.requests.title,
      hours: schema.timeEntries.hours,
      billable: schema.timeEntries.billable,
      notes: schema.timeEntries.notes,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.teamMembers, eq(schema.timeEntries.teamMemberId, schema.teamMembers.id))
    .leftJoin(schema.organisations, eq(schema.timeEntries.orgId, schema.organisations.id))
    .leftJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
    .where(whereClause)
    .orderBy(desc(schema.timeEntries.date))

  const header = 'Date,Team Member,Client,Request,Hours,Billable,Notes'
  const rows = items.map((item) => {
    const billable = item.billable ? 'Yes' : 'No'
    return [
      item.date,
      csvEscape(item.teamMemberName ?? ''),
      csvEscape(item.orgName ?? ''),
      csvEscape(item.requestTitle ?? ''),
      item.hours,
      billable,
      csvEscape(item.notes ?? ''),
    ].join(',')
  })

  const csv = [header, ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="time-entries.csv"',
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
