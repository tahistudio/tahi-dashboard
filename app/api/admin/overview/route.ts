import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, ne, count, and, inArray, gte, sql, desc } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { resolvePermissions, can } from '@/lib/permissions'
import {
  overnightCutoff,
  daysPastDue,
  bucketArAging,
  computeRunwayMonths,
  trailingThreeMonthKey,
  activeTimerLabel,
  type ArAging,
} from '@/lib/overview-aggregates'
import { elapsedSeconds } from '@/lib/timer-helpers'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// See lib/currency.ts for the conversion math (tested in lib/__tests__/currency.test.ts)
async function getRateMap(drizzle: D1): Promise<RateMap> {
  const rates = await drizzle.select().from(schema.exchangeRates)
  return buildRateMap(rates)
}

// ── GET /api/admin/overview ───────────────────────────────────────────────────
// Returns all KPIs needed for the admin dashboard home page in one request.
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // Resolve caller's feature-level access so sensitive KPIs are omitted from
  // the response when the caller lacks the corresponding feature.
  const access = await resolvePermissions(drizzle, auth)
  const canSeeMrr = can(access, 'financial_reports')
  const canSeeInvoices = can(access, 'invoices')

  // Load exchange rates for currency conversion
  const rateMap = await getRateMap(drizzle)

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
    outstandingInvoiceRows,
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

    // Outstanding invoices (sent or overdue) - individual rows for currency conversion
    drizzle
      .select({
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        status: schema.invoices.status,
        dueDate: schema.invoices.dueDate,
      })
      .from(schema.invoices)
      .where(inArray(schema.invoices.status, ['sent', 'overdue'])),
  ])

  // Outstanding invoices total in NZD, plus counts for the Owed vital sub
  // ("N invoices · M overdue"). Overdue = explicit status OR past its due date.
  let outstandingNzd = 0
  let overdueInvoicesCount = 0
  for (const inv of outstandingInvoiceRows) {
    outstandingNzd += toNzd(inv.totalUsd, inv.currency ?? 'USD', rateMap)
    if (inv.status === 'overdue' || daysPastDue(inv.dueDate ?? null, now) > 0) {
      overdueInvoicesCount++
    }
  }
  const outstandingInvoicesCount = outstandingInvoiceRows.length

  // Aggregate paid invoices into monthly buckets (converted to NZD)
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
        const nzd = toNzd(inv.totalUsd ?? 0, inv.currency ?? 'USD', rateMap)
        monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + nzd)
      }
    } catch {
      // Skip invalid dates
    }
  }

  const monthlyRevenue = Array.from(monthlyMap.entries()).map(([month, total]) => ({
    month,
    total: Math.round(total * 100) / 100,
  }))

  // Month-over-month delta for the Hero's "vs last month" chip. Derived from
  // the monthly paid-revenue series (last bucket = this month). Null when there
  // is no prior-month baseline to divide by (honest: no fabricated trend).
  let mrrDeltaPct: number | null = null
  if (monthlyRevenue.length >= 2) {
    const thisMonth = monthlyRevenue[monthlyRevenue.length - 1].total
    const lastMonth = monthlyRevenue[monthlyRevenue.length - 2].total
    if (lastMonth > 0) {
      mrrDeltaPct = Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10
    }
  }

  // MRR from custom_mrr field, converted per-org currency to NZD
  let mrr = 0
  try {
    const mrrRows = await drizzle.all<{ custom_mrr: number; preferred_currency: string }>(
      sql`SELECT custom_mrr, preferred_currency FROM organisations WHERE status = 'active' AND custom_mrr > 0`
    )
    for (const row of mrrRows ?? []) {
      mrr += toNzd(row.custom_mrr, row.preferred_currency ?? 'NZD', rateMap)
    }
  } catch {
    // Column doesn't exist yet
  }

  // ── Studio Ledger additions (Slice 0) ───────────────────────────────────
  // Every aggregate below is wrapped in its own try/catch so a missing Xero
  // table, a column that hasn't been migrated yet, or empty data can never
  // 500 the home page. Each falls back to a safe default (null / 0 / {}).

  const since = overnightCutoff(now)

  // Cash + runway (gated on financial_reports). Mirrors reports/bank-balances.
  let cash: { totalNzd: number; runwayMonths: number | null; burnNzd: number } | null = null
  if (canSeeMrr) {
    try {
      const balances = await drizzle.select().from(schema.xeroBankBalances)
      const totalNzd = balances.reduce(
        (sum, b) => sum + toNzd(b.balance, b.currency ?? 'NZD', rateMap),
        0,
      )

      let burnNzd = 0
      try {
        const threeMonthsAgo = trailingThreeMonthKey(now)
        const snapshots = await drizzle
          .select()
          .from(schema.xeroPnlSnapshots)
          .where(gte(schema.xeroPnlSnapshots.monthKey, threeMonthsAgo))
          .orderBy(desc(schema.xeroPnlSnapshots.monthKey))
        if (snapshots.length > 0) {
          const total = snapshots.reduce((sum, snap) => {
            const burn = snap.totalExpenses + snap.totalCostOfSales
            return sum + toNzd(burn, snap.currency ?? 'NZD', rateMap)
          }, 0)
          burnNzd = total / snapshots.length
        }
      } catch {
        // P&L snapshots table missing — leave burn at 0 (runway becomes null).
      }

      cash = {
        totalNzd: Math.round(totalNzd),
        runwayMonths: computeRunwayMonths(totalNzd, burnNzd),
        burnNzd: Math.round(burnNzd),
      }
    } catch {
      // Bank balances table missing — degrade to null.
      cash = null
    }
  }

  // AR aging + oldest invoice (gated on invoices). Mirrors reports/invoice-aging.
  let arAging: ArAging | null = null
  if (canSeeInvoices) {
    try {
      const sentInvoices = await drizzle
        .select({
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
          dueDate: schema.invoices.dueDate,
          orgName: schema.organisations.name,
        })
        .from(schema.invoices)
        .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
        .where(eq(schema.invoices.status, 'sent'))

      arAging = bucketArAging(
        sentInvoices.map(inv => ({
          amountNzd: toNzd(inv.totalUsd, inv.currency ?? 'USD', rateMap),
          daysPastDue: daysPastDue(inv.dueDate ?? null, now),
          clientName: inv.orgName ?? null,
        })),
      )
    } catch {
      arAging = null
    }
  }

  // Overnight activity. Always present; money sub-fields gate on invoices.
  let deliveriesCompleted = 0
  try {
    const deliveredRows = await drizzle
      .select({ count: count() })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.status, 'delivered'),
        gte(sql`COALESCE(${schema.requests.deliveredAt}, ${schema.requests.updatedAt})`, since),
      ))
    deliveriesCompleted = deliveredRows[0]?.count ?? 0
  } catch {
    deliveriesCompleted = 0
  }

  let clientReplies = 0
  try {
    const replyRows = await drizzle
      .select({ count: count() })
      .from(schema.messages)
      .where(and(
        inArray(schema.messages.authorType, ['contact', 'client']),
        gte(schema.messages.createdAt, since),
      ))
    clientReplies = replyRows[0]?.count ?? 0
  } catch {
    clientReplies = 0
  }

  let paymentsClearedCount = 0
  let paymentsClearedNzd = 0
  if (canSeeInvoices) {
    try {
      const clearedRows = await drizzle
        .select({
          totalUsd: schema.invoices.totalUsd,
          currency: schema.invoices.currency,
        })
        .from(schema.invoices)
        .where(and(
          eq(schema.invoices.status, 'paid'),
          gte(schema.invoices.paidAt, since),
        ))
      paymentsClearedCount = clearedRows.length
      for (const inv of clearedRows) {
        paymentsClearedNzd += toNzd(inv.totalUsd, inv.currency ?? 'USD', rateMap)
      }
    } catch {
      paymentsClearedCount = 0
      paymentsClearedNzd = 0
    }
  }

  const overnight: {
    since: string
    deliveriesCompleted: number
    clientReplies: number
    paymentsClearedCount?: number
    paymentsClearedNzd?: number
  } = {
    since,
    deliveriesCompleted,
    clientReplies,
    ...(canSeeInvoices
      ? { paymentsClearedCount, paymentsClearedNzd: Math.round(paymentsClearedNzd) }
      : {}),
  }

  // Active timer for the current user. Best-effort: a running timer row
  // (no endedAt; active_timers only holds live timers) yields a label.
  let activeTimer: { running: boolean; label: string | null } = { running: false, label: null }
  try {
    if (auth.userId) {
      const [timer] = await drizzle
        .select()
        .from(schema.activeTimers)
        .where(eq(schema.activeTimers.userId, auth.userId))
        .limit(1)
      if (timer) {
        let targetName: string | null = null
        if (timer.orgId) {
          const [o] = await drizzle
            .select({ name: schema.organisations.name })
            .from(schema.organisations)
            .where(eq(schema.organisations.id, timer.orgId))
            .limit(1)
          targetName = o?.name ?? null
        } else if (timer.requestId) {
          const [r] = await drizzle
            .select({ orgName: schema.organisations.name })
            .from(schema.requests)
            .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
            .where(eq(schema.requests.id, timer.requestId))
            .limit(1)
          targetName = r?.orgName ?? null
        }
        activeTimer = {
          running: true,
          label: activeTimerLabel(elapsedSeconds(timer, now), targetName),
        }
      }
    }
  } catch {
    activeTimer = { running: false, label: null }
  }

  // Open requests grouped by status (excludes archived). e.g. { in_progress: 4 }.
  const openByStatus: Record<string, number> = {}
  try {
    const grouped = await drizzle
      .select({ status: schema.requests.status, count: count() })
      .from(schema.requests)
      .where(ne(schema.requests.status, 'archived'))
      .groupBy(schema.requests.status)
    for (const row of grouped) {
      if (row.status) openByStatus[row.status] = row.count
    }
  } catch {
    // Leave openByStatus empty on any error.
  }

  // Active subscriptions grouped by plan type for the Clients vital sub
  // ("5 Scale · 4 Maintain"). e.g. { scale: 5, maintain: 4 }.
  const clientsByPlan: Record<string, number> = {}
  try {
    const planned = await drizzle
      .select({ planType: schema.subscriptions.planType, count: count() })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.status, 'active'))
      .groupBy(schema.subscriptions.planType)
    for (const row of planned) {
      if (row.planType) clientsByPlan[row.planType] = row.count
    }
  } catch {
    // Leave clientsByPlan empty on any error (table/column missing).
  }

  return NextResponse.json({
    kpis: {
      activeClients: activeClientsResult[0]?.count ?? 0,
      openRequests: openRequestsResult[0]?.count ?? 0,
      inProgress: inProgressResult[0]?.count ?? 0,
      ...(canSeeInvoices
        ? {
            outstandingInvoicesNzd: Math.round(outstandingNzd),
            outstandingInvoicesCount,
            overdueInvoicesCount,
          }
        : {}),
      ...(canSeeMrr ? { mrr: Math.round(mrr) } : {}),
    },
    ...(canSeeMrr ? { mrrDeltaPct } : {}),
    recentRequests,
    monthlyRevenue,
    cash,
    arAging,
    overnight,
    activeTimer,
    openByStatus,
    clientsByPlan,
  })
}
