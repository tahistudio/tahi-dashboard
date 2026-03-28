import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, gte, lt, eq, sql } from 'drizzle-orm'

// GET /api/admin/reports/billing-summary?month=YYYY-MM
// Returns per-org breakdown of billable hours, hourly rate, and total amount due.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const month = url.searchParams.get('month')

  // Default to current month
  const now = new Date()
  const targetYear = month ? parseInt(month.split('-')[0]) : now.getFullYear()
  const targetMonth = month ? parseInt(month.split('-')[1]) - 1 : now.getMonth()

  const startDate = new Date(targetYear, targetMonth, 1).toISOString().split('T')[0]
  const endDate = new Date(targetYear, targetMonth + 1, 1).toISOString().split('T')[0]

  const database = await db()

  // Get billable time entries grouped by org
  const entries = await database
    .select({
      orgId: schema.timeEntries.orgId,
      totalHours: sql<number>`SUM(${schema.timeEntries.hours})`,
      billableHours: sql<number>`SUM(CASE WHEN ${schema.timeEntries.billable} = 1 THEN ${schema.timeEntries.hours} ELSE 0 END)`,
    })
    .from(schema.timeEntries)
    .where(
      and(
        gte(schema.timeEntries.date, startDate),
        lt(schema.timeEntries.date, endDate)
      )
    )
    .groupBy(schema.timeEntries.orgId)

  // Get org names
  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)

  const orgMap = new Map(orgs.map(o => [o.id, o.name]))

  const summary = entries.map(entry => ({
    orgId: entry.orgId,
    orgName: orgMap.get(entry.orgId) ?? 'Unknown',
    totalHours: entry.totalHours ?? 0,
    billableHours: entry.billableHours ?? 0,
    // Hourly rate would come from org config; default to $150 for now
    hourlyRate: 150,
    totalAmount: (entry.billableHours ?? 0) * 150,
  }))

  const totalBillable = summary.reduce((sum, s) => sum + s.billableHours, 0)
  const totalAmount = summary.reduce((sum, s) => sum + s.totalAmount, 0)

  return NextResponse.json({
    month: `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`,
    summary,
    totals: {
      billableHours: totalBillable,
      amount: totalAmount,
    },
  })
}
