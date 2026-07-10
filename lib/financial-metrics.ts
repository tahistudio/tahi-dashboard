/**
 * Shared point-in-time financial metric computation.
 *
 * These are the figures the overview home recomputes live on every load
 * (cash, money owed, MRR, active clients, burn, runway). They are also
 * what the daily snapshot writer (lib/financial-snapshots.ts) freezes into
 * financial_snapshots so we keep monthly history for trends and honest
 * month-over-month deltas.
 *
 * The math here MUST stay in lockstep with app/api/admin/overview/route.ts
 * so a stored snapshot is directly comparable to the live number. Each
 * metric mirrors the corresponding block there; see the inline notes. If
 * you change how a metric is computed in one place, change it in both.
 */
import { schema } from '@/db/d1'
import { eq, gte, inArray, sql, desc, count } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import {
  aggregateCashNzd,
  computeRunwayMonths,
  trailingThreeMonthKey,
} from '@/lib/overview-aggregates'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface FinancialMetrics {
  /** Real bank cash, NZD, Airwallex-first. Null if balances unreadable. */
  cashNzd: number | null
  /** Outstanding invoices (sent + overdue), NZD. */
  owedNzd: number | null
  /** Active orgs' custom_mrr summed in NZD. */
  mrrNzd: number | null
  activeClients: number | null
  /** Trailing-3-month average monthly burn, NZD. */
  burnNzd: number | null
  /** cash / burn. Null when burn is unknown or not positive. */
  runwayMonths: number | null
}

/**
 * Trailing-3-month average monthly burn in NZD, from xero_pnl_snapshots.
 * Mirrors the burn block in overview/route.ts. Returns 0 when there are no
 * P&L snapshots (which makes runway null via computeRunwayMonths).
 */
export async function trailingBurnNzd(drizzle: D1, rateMap: RateMap, now: Date): Promise<number> {
  const threeMonthsAgo = trailingThreeMonthKey(now)
  const snapshots = await drizzle
    .select()
    .from(schema.xeroPnlSnapshots)
    .where(gte(schema.xeroPnlSnapshots.monthKey, threeMonthsAgo))
    .orderBy(desc(schema.xeroPnlSnapshots.monthKey))
  if (snapshots.length === 0) return 0
  const total = snapshots.reduce((sum, snap) => {
    const burn = snap.totalExpenses + snap.totalCostOfSales
    return sum + toNzd(burn, snap.currency ?? 'NZD', rateMap)
  }, 0)
  return total / snapshots.length
}

/**
 * Compute the current point-in-time metrics. Each field is independently
 * guarded so a missing table / column degrades that one metric to null
 * rather than throwing (same resilience contract as the overview route).
 */
export async function computeCurrentMetrics(drizzle: D1, now: Date = new Date()): Promise<FinancialMetrics> {
  const rates = await drizzle.select().from(schema.exchangeRates)
  const rateMap = buildRateMap(rates)

  // ── Cash (Airwallex-first) + runway. Mirrors overview cash block. ──
  let cashNzd: number | null = null
  let burnNzd: number | null = null
  let runwayMonths: number | null = null
  try {
    let airwallexBalances: Array<{ currency: string | null; availableBalance: number }> = []
    try {
      airwallexBalances = await drizzle.select().from(schema.airwallexBalances)
    } catch {
      // Airwallex table missing; fall back to Xero-only via empty array.
    }
    const xeroBalances = await drizzle.select().from(schema.xeroBankBalances)
    cashNzd = aggregateCashNzd(
      airwallexBalances,
      xeroBalances,
      (amount, currency) => toNzd(amount, currency, rateMap),
    )
    try {
      burnNzd = await trailingBurnNzd(drizzle, rateMap, now)
    } catch {
      burnNzd = null
    }
    runwayMonths = burnNzd != null ? computeRunwayMonths(cashNzd, burnNzd) : null
  } catch {
    cashNzd = null
    burnNzd = null
    runwayMonths = null
  }

  // ── Owed (outstanding invoices: sent + overdue). Mirrors overview. ──
  let owedNzd: number | null = null
  try {
    const rows = await drizzle
      .select({ totalUsd: schema.invoices.totalUsd, currency: schema.invoices.currency })
      .from(schema.invoices)
      .where(inArray(schema.invoices.status, ['sent', 'overdue']))
    owedNzd = rows.reduce((sum, inv) => sum + toNzd(inv.totalUsd, inv.currency ?? 'USD', rateMap), 0)
  } catch {
    owedNzd = null
  }

  // ── MRR (active orgs' custom_mrr in native currency). Mirrors overview. ──
  let mrrNzd: number | null = null
  try {
    const mrrRows = await drizzle.all<{ custom_mrr: number; preferred_currency: string }>(
      sql`SELECT custom_mrr, preferred_currency FROM organisations WHERE status = 'active' AND custom_mrr > 0`
    )
    mrrNzd = (mrrRows ?? []).reduce(
      (sum, row) => sum + toNzd(row.custom_mrr, row.preferred_currency ?? 'NZD', rateMap),
      0,
    )
  } catch {
    mrrNzd = null
  }

  // ── Active client orgs. Mirrors overview activeClients count. ──
  let activeClients: number | null = null
  try {
    const rows = await drizzle
      .select({ count: count() })
      .from(schema.organisations)
      .where(eq(schema.organisations.status, 'active'))
    activeClients = rows[0]?.count ?? 0
  } catch {
    activeClients = null
  }

  return {
    cashNzd: cashNzd != null ? Math.round(cashNzd) : null,
    owedNzd: owedNzd != null ? Math.round(owedNzd) : null,
    mrrNzd: mrrNzd != null ? Math.round(mrrNzd) : null,
    activeClients,
    burnNzd: burnNzd != null ? Math.round(burnNzd) : null,
    runwayMonths,
  }
}
