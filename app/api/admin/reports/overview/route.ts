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

  // Total active clients
  const activeClientsResult = await database
    .select({ count: count() })
    .from(schema.organisations)
    .where(eq(schema.organisations.status, 'active'))

  const totalClients = activeClientsResult[0]?.count ?? 0

  // Total requests
  const totalRequestsResult = await database
    .select({ count: count() })
    .from(schema.requests)

  const totalRequests = totalRequestsResult[0]?.count ?? 0

  // Open requests (not delivered, not archived)
  const openRequestsResult = await database
    .select({ count: count() })
    .from(schema.requests)
    .where(
      and(
        ne(schema.requests.status, 'delivered'),
        ne(schema.requests.status, 'archived')
      )
    )

  const openRequests = openRequestsResult[0]?.count ?? 0

  // Average delivery days (approximate: days between createdAt and deliveredAt for delivered requests)
  const deliveredRequests = await database
    .select({
      createdAt: schema.requests.createdAt,
      deliveredAt: schema.requests.deliveredAt,
    })
    .from(schema.requests)
    .where(eq(schema.requests.status, 'delivered'))

  let avgDeliveryDays = 0
  if (deliveredRequests.length > 0) {
    let totalDays = 0
    let validCount = 0
    for (const r of deliveredRequests) {
      if (r.createdAt && r.deliveredAt) {
        const created = new Date(r.createdAt)
        const delivered = new Date(r.deliveredAt)
        const diffDays = (delivered.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
        if (diffDays >= 0) {
          totalDays += diffDays
          validCount++
        }
      }
    }
    if (validCount > 0) {
      avgDeliveryDays = Math.round((totalDays / validCount) * 10) / 10
    }
  }

  // Total billable hours
  const billableResult = await database
    .select({ total: sum(schema.timeEntries.hours) })
    .from(schema.timeEntries)
    .where(eq(schema.timeEntries.billable, true))

  const totalBillableHours = Number(billableResult[0]?.total ?? 0)

  // Outstanding invoice amount (sent or overdue)
  const outstandingResult = await database
    .select({ total: sum(schema.invoices.totalUsd) })
    .from(schema.invoices)
    .where(inArray(schema.invoices.status, ['sent', 'overdue']))

  const outstandingInvoiceAmount = Number(outstandingResult[0]?.total ?? 0)

  // Request counts by status
  const statusCounts = await database
    .select({
      status: schema.requests.status,
      count: count(),
    })
    .from(schema.requests)
    .groupBy(schema.requests.status)

  const requestsByStatus: Record<string, number> = {}
  for (const row of statusCounts) {
    requestsByStatus[row.status] = row.count
  }

  // Monthly request trend (last 6 months)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const sixMonthsAgoStr = sixMonthsAgo.toISOString()

  const recentRequests = await database
    .select({ createdAt: schema.requests.createdAt })
    .from(schema.requests)
    .where(sql`${schema.requests.createdAt} >= ${sixMonthsAgoStr}`)

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
