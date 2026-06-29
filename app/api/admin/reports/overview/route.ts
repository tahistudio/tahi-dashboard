import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, ne, and, inArray, sql, count, sum } from 'drizzle-orm'

// ── GET /api/admin/reports/overview ─────────────────────────────────────────
// Return aggregate stats for the reports dashboard.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Monthly request trend window (last 6 months)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const sixMonthsAgoStr = sixMonthsAgo.toISOString()

  // All of these aggregates are independent reads, so fire them in one
  // Promise.all instead of eight sequential D1 round-trips. The average
  // delivery time is now computed entirely in SQL via julianday() so no
  // delivered-request rows transfer over the wire.
  const [
    activeClientsResult,
    totalRequestsResult,
    openRequestsResult,
    avgDeliveryResult,
    billableResult,
    outstandingResult,
    statusCounts,
    recentRequests,
  ] = await Promise.all([
    database
      .select({ count: count() })
      .from(schema.organisations)
      .where(eq(schema.organisations.status, 'active')),
    database
      .select({ count: count() })
      .from(schema.requests),
    database
      .select({ count: count() })
      .from(schema.requests)
      .where(
        and(
          ne(schema.requests.status, 'delivered'),
          ne(schema.requests.status, 'archived')
        )
      ),
    database
      .select({
        avgDays: sql<number | null>`AVG(julianday(${schema.requests.deliveredAt}) - julianday(${schema.requests.createdAt}))`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.status, 'delivered'),
          sql`${schema.requests.deliveredAt} IS NOT NULL`,
          sql`${schema.requests.createdAt} IS NOT NULL`,
          sql`julianday(${schema.requests.deliveredAt}) - julianday(${schema.requests.createdAt}) >= 0`
        )
      ),
    database
      .select({ total: sum(schema.timeEntries.hours) })
      .from(schema.timeEntries)
      .where(eq(schema.timeEntries.billable, true)),
    database
      .select({ total: sum(schema.invoices.totalUsd) })
      .from(schema.invoices)
      .where(inArray(schema.invoices.status, ['sent', 'overdue'])),
    database
      .select({
        status: schema.requests.status,
        count: count(),
      })
      .from(schema.requests)
      .groupBy(schema.requests.status),
    database
      .select({ createdAt: schema.requests.createdAt })
      .from(schema.requests)
      .where(sql`${schema.requests.createdAt} >= ${sixMonthsAgoStr}`),
  ])

  const totalClients = activeClientsResult[0]?.count ?? 0
  const totalRequests = totalRequestsResult[0]?.count ?? 0
  const openRequests = openRequestsResult[0]?.count ?? 0

  const avgDaysRaw = avgDeliveryResult[0]?.avgDays
  const avgDeliveryDays = avgDaysRaw != null ? Math.round(avgDaysRaw * 10) / 10 : 0

  const totalBillableHours = Number(billableResult[0]?.total ?? 0)
  const outstandingInvoiceAmount = Number(outstandingResult[0]?.total ?? 0)

  const requestsByStatus: Record<string, number> = {}
  for (const row of statusCounts) {
    requestsByStatus[row.status] = row.count
  }

  const monthlyTrend: Record<string, number> = {}
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyTrend[key] = 0
  }

  for (const r of recentRequests) {
    if (r.createdAt) {
      const d = new Date(r.createdAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (key in monthlyTrend) {
        monthlyTrend[key]++
      }
    }
  }

  return NextResponse.json({
    totalClients,
    totalRequests,
    openRequests,
    avgDeliveryDays,
    totalBillableHours,
    outstandingInvoiceAmount,
    requestsByStatus,
    monthlyTrend,
  })
}
