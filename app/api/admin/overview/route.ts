import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, ne, count, and, inArray, gte, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/overview ───────────────────────────────────────────────────
// Returns all KPIs needed for the admin dashboard home page in one request.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Calculate date 6 months ago for revenue query
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const sixMonthsAgoIso = sixMonthsAgo.toISOString()

  const [
    activeClientsResult,
    openRequestsResult,
    inProgressResult,
    recentRequests,
    paidInvoices,
    outstandingInvoices,
  ] = await Promise.all([
    // Active client orgs
    drizzle
      .select({ count: count() })
      .from(schema.organisations)
      .where(eq(schema.organisations.status, 'active')),

    // Open requests (not delivered/archived)
    drizzle
      .select({ count: count() })
      .from(schema.requests)
      .where(and(
        ne(schema.requests.status, 'delivered'),
        ne(schema.requests.status, 'archived'),
        ne(schema.requests.status, 'draft'),
      )),

    // In progress right now
    drizzle
      .select({ count: count() })
      .from(schema.requests)
      .where(inArray(schema.requests.status, ['in_progress', 'in_review', 'client_review'])),

    // Recent 8 requests for activity feed
    drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        priority: schema.requests.priority,
        type: schema.requests.type,
        orgName: schema.organisations.name,
        orgId: schema.requests.orgId,
        updatedAt: schema.requests.updatedAt,
        createdAt: schema.requests.createdAt,
        scopeFlagged: schema.requests.scopeFlagged,
      })
      .from(schema.requests)
      .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
      .where(and(
        ne(schema.requests.status, 'archived'),
      ))
      .orderBy(schema.requests.updatedAt)
      .limit(8),

    // Paid invoices from last 6 months for revenue chart
    drizzle
      .select({
        paidAt: schema.invoices.paidAt,
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
      })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.status, 'paid'),
        gte(schema.invoices.paidAt, sixMonthsAgoIso),
      )),

    // Outstanding invoices (sent or overdue)
    drizzle
      .select({
        total: sql<number>`COALESCE(SUM(${schema.invoices.totalUsd}), 0)`,
      })
      .from(schema.invoices)
      .where(inArray(schema.invoices.status, ['sent', 'overdue'])),
  ])

  // Aggregate paid invoices into monthly buckets
  const monthlyMap = new Map<string, number>()

  // Pre-fill the last 6 months with 0
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyMap.set(key, 0)
  }

  for (const inv of paidInvoices) {
    if (!inv.paidAt) continue
    try {
      const d = new Date(inv.paidAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (monthlyMap.has(key)) {
        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + (inv.totalUsd ?? 0))
      }
    } catch {
      // Skip invalid dates
    }
  }

  const monthlyRevenue = Array.from(monthlyMap.entries()).map(([month, total]) => ({
    month,
    total: Math.round(total * 100) / 100,
  }))

  // MRR from custom_mrr field (raw SQL, column may not exist before migration 0011)
  let mrr = 0
  try {
    const mrrResult = await drizzle.all<{ total_mrr: number }>(
      sql`SELECT COALESCE(SUM(custom_mrr), 0) as total_mrr FROM organisations WHERE status = 'active' AND custom_mrr > 0`
    )
    mrr = mrrResult?.[0]?.total_mrr ?? 0
  } catch {
    // Column doesn't exist yet
  }

  return NextResponse.json({
    kpis: {
      activeClients: activeClientsResult[0]?.count ?? 0,
      openRequests: openRequestsResult[0]?.count ?? 0,
      inProgress: inProgressResult[0]?.count ?? 0,
      outstandingInvoicesUsd: outstandingInvoices[0]?.total ?? 0,
      mrr,
    },
    recentRequests,
    monthlyRevenue,
  })
}
