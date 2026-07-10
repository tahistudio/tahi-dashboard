import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, inArray, and } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface WorklogMember {
  id: string
  name: string
  trackedHours: number
  billableHours: number
}

// Rolling window length per range. "week" = trailing 7 days (mirrors the
// utilization report's rolling-window approach and dodges calendar-week
// timezone edge cases). "month" = trailing 30 days.
const RANGE_DAYS: Record<string, number> = { week: 7, month: 30 }

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// ── GET /api/admin/reports/worklog?range=week ──────────────────────────────────
// Per-person hours for the owner "Worklog this week" card. trackedHours sums
// ALL time entries in the window; billableHours only the billable ones.
//
// Access scoping: a team member restricted to specific clients only sees hours
// logged against those clients' orgs; admins (unrestricted) see everyone.
//
// Response: {
//   range, windowStart, windowEnd,
//   members: [{ id, name, trackedHours, billableHours }],  // trackedHours>0, desc
//   totalTracked, totalBillable, billablePct, avgPerPerson
// }
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const rangeParam = url.searchParams.get('range') ?? 'week'
  const range = rangeParam in RANGE_DAYS ? rangeParam : 'week'
  const days = RANGE_DAYS[range]

  const drizzle = (await db()) as D1

  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const windowStartIso = windowStart.toISOString()
  const windowStartDate = windowStartIso.slice(0, 10) // time_entries.date is YYYY-MM-DD
  const windowEnd = new Date().toISOString()

  // Org scoping: null = unrestricted; [] = deny all; otherwise allowed org ids.
  const allowedOrgs = await resolveAccessScoping(drizzle, auth.userId)
  if (Array.isArray(allowedOrgs) && allowedOrgs.length === 0) {
    return NextResponse.json({
      range,
      windowStart: windowStartIso,
      windowEnd,
      members: [],
      totalTracked: 0,
      totalBillable: 0,
      billablePct: 0,
      avgPerPerson: 0,
    })
  }

  // Team members keyed by id for name lookup.
  const members = await drizzle
    .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
    .from(schema.teamMembers)
  const nameById = new Map(members.map(m => [m.id, m.name]))

  // One grouped aggregation: tracked (all) + billable (billable=1) per member.
  const conditions = [sql`${schema.timeEntries.date} >= ${windowStartDate}`]
  if (allowedOrgs) conditions.push(inArray(schema.timeEntries.orgId, allowedOrgs))
  const rows = await drizzle
    .select({
      memberId: schema.timeEntries.teamMemberId,
      tracked: sql<number>`SUM(${schema.timeEntries.hours})`.as('tracked'),
      billable: sql<number>`SUM(CASE WHEN ${schema.timeEntries.billable} = 1 THEN ${schema.timeEntries.hours} ELSE 0 END)`.as('billable'),
    })
    .from(schema.timeEntries)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .groupBy(schema.timeEntries.teamMemberId)

  const result: WorklogMember[] = []
  let totalTracked = 0
  let totalBillable = 0
  for (const r of rows) {
    if (!r.memberId) continue
    const tracked = Number(r.tracked) || 0
    if (tracked <= 0) continue
    const billable = Number(r.billable) || 0
    totalTracked += tracked
    totalBillable += billable
    result.push({
      id: r.memberId,
      name: nameById.get(r.memberId) ?? 'Unknown',
      trackedHours: round1(tracked),
      billableHours: round1(billable),
    })
  }

  result.sort((a, b) => b.trackedHours - a.trackedHours)

  const billablePct = totalTracked > 0 ? Math.round((totalBillable / totalTracked) * 100) : 0
  const avgPerPerson = result.length > 0 ? round1(totalTracked / result.length) : 0

  return NextResponse.json({
    range,
    windowStart: windowStartIso,
    windowEnd,
    members: result,
    totalTracked: round1(totalTracked),
    totalBillable: round1(totalBillable),
    billablePct,
    avgPerPerson,
  })
}
