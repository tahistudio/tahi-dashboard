import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/utilization?weeks=4
 *
 * Per-team-member utilization = billable hours / available hours over
 * a rolling window (default 4 weeks).
 *
 * Available hours per member = team_members.weekly_capacity_hours × weeks
 * Billable hours = SUM(time_entries.hours WHERE billable = 1) in window.
 *
 * Contractors (is_contractor = 1) are flagged but not excluded so you
 * can see their utilization too.
 *
 * Response: {
 *   weeks, windowStart, windowEnd,
 *   members: [{
 *     id, name, title, isContractor, weeklyCapacityHours, availableHours,
 *     billableHours, utilizationPct, health: 'green' | 'amber' | 'red'
 *   }],
 *   teamAverage: number,
 * }
 *
 * Thresholds (configurable in UI later):
 *   green >= 70, amber 50-70, red < 50
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const weeks = Math.max(1, Math.min(52, parseInt(url.searchParams.get('weeks') ?? '4', 10)))

  const drizzle = (await db()) as D1

  const windowStart = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000)
  const windowStartIso = windowStart.toISOString()
  const windowStartDate = windowStartIso.slice(0, 10)
  const windowEnd = new Date().toISOString()

  // Team members
  const members = await drizzle
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      title: schema.teamMembers.title,
      isContractor: schema.teamMembers.isContractor,
      weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours,
    })
    .from(schema.teamMembers)

  if (members.length === 0) {
    return NextResponse.json({
      weeks,
      windowStart: windowStartIso,
      windowEnd,
      members: [],
      teamAverage: 0,
    })
  }

  // Aggregate billable hours per member over window
  const billableRows = await drizzle
    .select({
      memberId: schema.timeEntries.teamMemberId,
      total: sql<number>`SUM(${schema.timeEntries.hours})`.as('total'),
    })
    .from(schema.timeEntries)
    .where(sql`${schema.timeEntries.billable} = 1 AND ${schema.timeEntries.date} >= ${windowStartDate}`)
    .groupBy(schema.timeEntries.teamMemberId)

  const billableMap = new Map(
    billableRows
      .filter(r => r.memberId)
      .map(r => [r.memberId as string, Number(r.total) || 0])
  )

  let utilizationSum = 0
  let utilizationCount = 0
  const memberResults = members.map(m => {
    const weekly = m.weeklyCapacityHours ?? 40
    const availableHours = weekly * weeks
    const billableHours = billableMap.get(m.id) ?? 0
    const utilizationPct = availableHours > 0
      ? (billableHours / availableHours) * 100
      : 0
    const health: 'green' | 'amber' | 'red' =
      utilizationPct >= 70 ? 'green'
      : utilizationPct >= 50 ? 'amber'
      : 'red'

    // Only include permanent team in the team average (contractors distort it)
    if (!m.isContractor) {
      utilizationSum += utilizationPct
      utilizationCount++
    }

    return {
      id: m.id,
      name: m.name,
      title: m.title,
      isContractor: !!m.isContractor,
      weeklyCapacityHours: weekly,
      availableHours,
      billableHours,
      utilizationPct,
      health,
    }
  })

  // Sort highest utilization first (makes the overloaded people obvious)
  memberResults.sort((a, b) => b.utilizationPct - a.utilizationPct)

  const teamAverage = utilizationCount > 0
    ? utilizationSum / utilizationCount
    : 0

  return NextResponse.json({
    weeks,
    windowStart: windowStartIso,
    windowEnd,
    members: memberResults,
    teamAverage,
  })
}
