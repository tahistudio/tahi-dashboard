import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { gte, desc } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/expenses?months=12
 *
 * Returns categorised monthly expenses from Xero P&L sync data.
 *
 * Response:
 *   months: [YYYY-MM, ...] in ascending order
 *   totals: { YYYY-MM: totalExpensesNzd } for the expense summary chart
 *   pnl: [{ monthKey, revenue, costOfSales, expenses, grossProfit, netProfit }] for the P&L trend
 *   categories: [{ accountName, isRecurring, monthly: { YYYY-MM: amount }, total: sum }]
 *     sorted by total desc so the biggest expenses come first
 *   summary: { totalRevenue, totalExpenses, totalNetProfit, avgMonthlyBurn }
 *
 * All amounts are in NZD (Xero base currency for an NZ tenant; multi-currency
 * tenants would need rate conversion at source — left as a future upgrade).
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const months = Math.max(1, Math.min(24, parseInt(url.searchParams.get('months') ?? '12', 10)))

  const drizzle = (await db()) as D1

  // Window start
  const now = new Date()
  now.setUTCDate(1); now.setUTCHours(0, 0, 0, 0)
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1))
  const windowStartKey = windowStart.toISOString().slice(0, 7)

  // Load rates once (kept for future multi-currency tenants)
  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // Snapshots + categories — tolerate pre-migration
  const snapshots = await drizzle
    .select()
    .from(schema.xeroPnlSnapshots)
    .where(gte(schema.xeroPnlSnapshots.monthKey, windowStartKey))
    .orderBy(desc(schema.xeroPnlSnapshots.monthKey))
    .catch(() => [] as Array<typeof schema.xeroPnlSnapshots.$inferSelect>)

  const categories = await drizzle
    .select()
    .from(schema.xeroExpenseCategories)
    .where(gte(schema.xeroExpenseCategories.monthKey, windowStartKey))
    .catch(() => [] as Array<typeof schema.xeroExpenseCategories.$inferSelect>)

  // Build month list from windowStart to current month
  const monthKeys: string[] = []
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth() + i, 1))
    monthKeys.push(d.toISOString().slice(0, 7))
  }

  // P&L by month (filled with zeros where no snapshot exists)
  const pnlByMonth = new Map<string, typeof schema.xeroPnlSnapshots.$inferSelect>()
  for (const s of snapshots) pnlByMonth.set(s.monthKey, s)

  const pnl = monthKeys.map(m => {
    const row = pnlByMonth.get(m)
    return {
      monthKey: m,
      revenue: row ? toNzd(row.totalRevenue, row.currency ?? 'NZD', rateMap) : 0,
      costOfSales: row ? toNzd(row.totalCostOfSales, row.currency ?? 'NZD', rateMap) : 0,
      expenses: row ? toNzd(row.totalExpenses, row.currency ?? 'NZD', rateMap) : 0,
      grossProfit: row ? toNzd(row.grossProfit, row.currency ?? 'NZD', rateMap) : 0,
      netProfit: row ? toNzd(row.netProfit, row.currency ?? 'NZD', rateMap) : 0,
    }
  })

  // Category breakdown: group by accountName, build per-month map
  const byAccount = new Map<string, {
    accountName: string
    accountCode: string | null
    section: string
    isRecurring: boolean
    monthly: Record<string, number>
    total: number
  }>()

  for (const c of categories) {
    const key = c.accountName
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        accountName: c.accountName,
        accountCode: c.accountCode ?? null,
        section: c.section,
        isRecurring: !!c.isRecurring,
        monthly: Object.fromEntries(monthKeys.map(m => [m, 0])),
        total: 0,
      })
    }
    const entry = byAccount.get(key)!
    const nzd = toNzd(c.amount, c.currency ?? 'NZD', rateMap)
    entry.monthly[c.monthKey] = (entry.monthly[c.monthKey] ?? 0) + nzd
    entry.total += nzd
    // If any row for this category is recurring, mark the whole account recurring
    if (c.isRecurring) entry.isRecurring = true
  }

  const categoryRows = Array.from(byAccount.values())
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

  // Summary over the window
  const totalRevenue = pnl.reduce((s, m) => s + m.revenue, 0)
  const totalExpenses = pnl.reduce((s, m) => s + m.expenses + m.costOfSales, 0)
  const totalNetProfit = pnl.reduce((s, m) => s + m.netProfit, 0)
  const monthsWithData = pnl.filter(m => m.expenses > 0 || m.revenue > 0).length
  const avgMonthlyBurn = monthsWithData > 0
    ? (pnl.reduce((s, m) => s + m.expenses + m.costOfSales, 0) / monthsWithData)
    : 0

  const totals = Object.fromEntries(
    monthKeys.map(m => [m, (pnlByMonth.get(m)?.totalExpenses ?? 0) + (pnlByMonth.get(m)?.totalCostOfSales ?? 0)])
  )

  return NextResponse.json({
    months: monthKeys,
    totals,
    pnl,
    categories: categoryRows,
    summary: {
      totalRevenue,
      totalExpenses,
      totalNetProfit,
      avgMonthlyBurn,
      monthsWithData,
    },
    lastSyncedAt: snapshots[0]?.syncedAt ?? null,
  })
}
