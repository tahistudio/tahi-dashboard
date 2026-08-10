import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, gte } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'
import { resolvePermissions, can } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/bank-balances
 *
 * Bank truth, Airwallex-first. Balances come from airwallex_balances:
 * wallet rows synced daily from the Airwallex API plus operator-maintained
 * yield rows (Airwallex Capital, materialised from the finance.yieldHoldings
 * setting by the sync). Wallet rows are reported on the available/cleared
 * basis, matching the Airwallex UI and the overview Cash card.
 *
 * Xero bank accounts fill in ONLY for currencies Airwallex does not report,
 * so the same cash is never counted twice. Xero's ledger view of the
 * Airwallex accounts is deliberately ignored: it drifts whenever
 * reconciliation falls behind (in Aug 2026 it silently overstated total
 * cash by 67 percent). Same source policy as financial-reports/summary and
 * lib/overview-aggregates aggregateCashNzd; the deterministic drift alarm
 * in the finance-anomaly-scan cron watches the two sources for divergence.
 *
 * Runway = total balance (NZD) / avg monthly expenses (last 3 months).
 *
 * Response:
 *   asOf (latest as_of across the rows used)
 *   accounts: [{ accountId, accountName, currency, balance, balanceNzd, source }]
 *   totalBalanceNzd: sum across all accounts
 *   avgMonthlyBurnNzd: trailing 3-month average from xero_pnl_snapshots
 *   runwayMonths: totalBalance / avgMonthlyBurn (null if no burn data)
 *   lastSyncedAt: max(updatedAt) across the rows used
 */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature(auth, 'financial_reports')
  if (denied) return denied

  const drizzle = (await db()) as D1

  // Cash + runway is sensitive; gate behind the financial_reports feature so a
  // team member without it cannot reach the figures by calling the API directly.
  const access = await resolvePermissions(drizzle, auth)
  if (!can(access, 'financial_reports')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // The Airwallex read fails LOUD (500), same as financial-reports/summary.
  // Swallowing it would empty airwallexCurrencies and let every Xero row
  // through the fallback filter, silently serving the drifted ledger
  // numbers this endpoint exists to distrust. Losing the Xero read only
  // loses fallback currencies, so that one degrades quietly.
  const [airwallexRows, xeroRows] = await Promise.all([
    drizzle.select().from(schema.airwallexBalances),
    drizzle
      .select()
      .from(schema.xeroBankBalances)
      .catch(() => [] as Array<typeof schema.xeroBankBalances.$inferSelect>),
  ])

  const airwallexCurrencies = new Set(
    airwallexRows.map(b => (b.currency ?? 'NZD').toUpperCase()),
  )

  const accounts = [
    ...airwallexRows.map(b => {
      const isYield = b.accountId.startsWith('yield:')
      // Wallet rows report available (cleared) funds; for yield rows the
      // two figures are identical by construction.
      const amount = isYield ? b.balance : b.availableBalance
      return {
        accountId: b.accountId,
        accountName: b.accountName,
        currency: b.currency,
        balance: amount,
        balanceNzd: toNzd(amount, b.currency ?? 'NZD', rateMap),
        source: isYield ? 'airwallex_yield' : 'airwallex',
      }
    }),
    ...xeroRows
      .filter(b => !airwallexCurrencies.has((b.currency ?? 'NZD').toUpperCase()))
      .map(b => ({
        accountId: b.accountId,
        accountName: b.accountName,
        currency: b.currency,
        balance: b.balance,
        balanceNzd: toNzd(b.balance, b.currency ?? 'NZD', rateMap),
        source: 'xero',
      })),
  ].sort((a, b) => b.balanceNzd - a.balanceNzd)

  if (accounts.length === 0) {
    return NextResponse.json({
      asOf: null,
      accounts: [],
      totalBalanceNzd: 0,
      avgMonthlyBurnNzd: 0,
      runwayMonths: null,
      lastSyncedAt: null,
    })
  }

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

  const usedRows: Array<{ asOf: string; updatedAt: string }> = [
    ...airwallexRows.map(b => ({ asOf: b.asOf, updatedAt: b.updatedAt })),
    ...xeroRows
      .filter(b => !airwallexCurrencies.has((b.currency ?? 'NZD').toUpperCase()))
      .map(b => ({ asOf: b.asOf, updatedAt: b.updatedAt })),
  ]
  const asOf = usedRows.reduce<string | null>((max, r) => (!max || r.asOf > max ? r.asOf : max), null)
  const lastSyncedAt = usedRows.reduce<string | null>((max, r) => (!max || r.updatedAt > max ? r.updatedAt : max), null)

  return NextResponse.json({
    asOf,
    accounts,
    totalBalanceNzd,
    avgMonthlyBurnNzd,
    runwayMonths,
    lastSyncedAt,
  })
}
