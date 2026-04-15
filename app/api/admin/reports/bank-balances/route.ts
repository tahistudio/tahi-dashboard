import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, gte } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/bank-balances
 *
 * Returns the last-synced bank balances from Xero plus a runway
 * calculation (months of runway at current burn rate).
 *
 * Runway = total bank balance (NZD) / avg monthly expenses (last 3 months)
 *
 * Response:
 *   asOf (date of last Xero sync)
 *   accounts: [{ accountId, accountName, currency, balance, balanceNzd }]
 *   totalBalanceNzd: sum across all accounts
 *   avgMonthlyBurnNzd: trailing 3-month average from xero_pnl_snapshots
 *   runwayMonths: totalBalance / avgMonthlyBurn (null if no burn data)
 *   lastSyncedAt: max(updatedAt) across bank rows
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  const balances = await drizzle
    .select()
    .from(schema.xeroBankBalances)
    .catch(() => [] as Array<typeof schema.xeroBankBalances.$inferSelect>)

  if (balances.length === 0) {
    return NextResponse.json({
      asOf: null,
      accounts: [],
      totalBalanceNzd: 0,
      avgMonthlyBurnNzd: 0,
      runwayMonths: null,
      lastSyncedAt: null,
    })
  }

  const accounts = balances.map(b => ({
    accountId: b.accountId,
    accountName: b.accountName,
    currency: b.currency,
    balance: b.balance,
    balanceNzd: toNzd(b.balance, b.currency ?? 'NZD', rateMap),
  }))

  const totalBalanceNzd = accounts.reduce((s, a) => s + a.balanceNzd, 0)

  // Trailing 3-month burn from P&L snapshots
  const now = new Date()
  now.setUTCDate(1)
  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
    .toISOString().slice(0, 7)

  const recentSnapshots = await drizzle
    .select()
    .from(schema.xeroPnlSnapshots)
    .where(gte(schema.xeroPnlSnapshots.monthKey, threeMonthsAgo))
    .orderBy(desc(schema.xeroPnlSnapshots.monthKey))
    .catch(() => [] as Array<typeof schema.xeroPnlSnapshots.$inferSelect>)

  let avgMonthlyBurnNzd = 0
  if (recentSnapshots.length > 0) {
    const total = recentSnapshots.reduce((s, snap) => {
      const burn = snap.totalExpenses + snap.totalCostOfSales
      return s + toNzd(burn, snap.currency ?? 'NZD', rateMap)
    }, 0)
    avgMonthlyBurnNzd = total / recentSnapshots.length
  }

  const runwayMonths = avgMonthlyBurnNzd > 0
    ? totalBalanceNzd / avgMonthlyBurnNzd
    : null

  const lastSyncedAt = balances.reduce<string | null>((max, b) => {
    if (!max || b.updatedAt > max) return b.updatedAt
    return max
  }, null)

  return NextResponse.json({
    asOf: balances[0].asOf,
    accounts,
    totalBalanceNzd,
    avgMonthlyBurnNzd,
    runwayMonths,
    lastSyncedAt,
  })
}
