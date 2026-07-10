/**
 * Monthly financial snapshot writer + one-time cash backfill.
 *
 * writeCurrentSnapshot   : upsert THIS month's row from the live metrics.
 *                          Fired daily by the snapshot-metrics cron; running
 *                          it repeatedly in a day just overwrites the same
 *                          month, and when the month rolls over that month's
 *                          last write becomes its frozen month-end value.
 *
 * backfillCashFromLedger : reconstruct past month-end CASH by walking the
 *                          Airwallex transaction ledger backwards from
 *                          today's balance, for months that have no snapshot
 *                          yet. Cash only: MRR / owed / active clients have no
 *                          stored history and cannot be honestly rebuilt, so
 *                          they stay null for backfilled months.
 *
 * See db/schema.ts (financial_snapshots) for the table contract.
 */
import { schema } from '@/db/d1'
import { buildRateMap, toNzd } from '@/lib/currency'
import { computeRunwayMonths } from '@/lib/overview-aggregates'
import { computeCurrentMetrics, type FinancialMetrics } from '@/lib/financial-metrics'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** UTC month key (YYYY-MM) for a given date. */
function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface SnapshotWriteResult {
  monthKey: string
  metrics: FinancialMetrics
}

/**
 * Compute the current point-in-time metrics and upsert them into this
 * month's financial_snapshots row (source = 'cron').
 */
export async function writeCurrentSnapshot(drizzle: D1, now: Date = new Date()): Promise<SnapshotWriteResult> {
  const metrics = await computeCurrentMetrics(drizzle, now)
  const monthKey = monthKeyOf(now)
  const nowIso = now.toISOString()

  const values = {
    cashNzd: metrics.cashNzd,
    owedNzd: metrics.owedNzd,
    mrrNzd: metrics.mrrNzd,
    activeClients: metrics.activeClients,
    burnNzd: metrics.burnNzd,
    runwayMonths: metrics.runwayMonths,
    source: 'cron' as const,
    capturedAt: nowIso,
  }

  await drizzle
    .insert(schema.financialSnapshots)
    .values({ monthKey, createdAt: nowIso, ...values })
    .onConflictDoUpdate({ target: schema.financialSnapshots.monthKey, set: values })

  return { monthKey, metrics }
}

export interface BackfillResult {
  monthsWritten: number
  monthsSkippedExisting: number
  earliestMonth: string | null
  latestMonth: string | null
  note: string
}

/**
 * Reconstruct past month-end cash from the Airwallex ledger.
 *
 * balance(T) = balance_now − Σ amount of every settled txn after T. Because
 * amounts are signed (inbound +, outbound −), subtracting the forward
 * transactions rewinds the balance to any earlier instant T. We anchor on
 * the current TOTAL balance, so reconstructed months are on a
 * total-incl-pending basis (the forward cron snapshots use spendable
 * balance; at month end the two are close). Foreign balances are converted
 * with the CURRENT FX rate; historical rates are not stored, so months
 * with large foreign holdings carry a small FX approximation.
 *
 * Only months whose month-end is at or after the earliest transaction we
 * hold are reconstructed (before that the ledger is incomplete). Existing
 * rows are never overwritten, so a real cron snapshot always wins.
 */
export async function backfillCashFromLedger(drizzle: D1, now: Date = new Date()): Promise<BackfillResult> {
  const empty = (note: string): BackfillResult => ({
    monthsWritten: 0, monthsSkippedExisting: 0, earliestMonth: null, latestMonth: null, note,
  })

  const rates = await drizzle.select().from(schema.exchangeRates)
  const rateMap = buildRateMap(rates)

  // Anchor: current per-account TOTAL balance.
  const balances = await drizzle.select().from(schema.airwallexBalances)
  if (balances.length === 0) return empty('No Airwallex balances to anchor reconstruction.')
  const accounts = balances.map(b => ({
    accountId: b.accountId,
    currency: b.currency ?? 'NZD',
    balance: b.balance,
  }))

  // Ledger: signed settled transactions.
  const txns = await drizzle
    .select({
      accountId: schema.airwallexTransactions.accountId,
      amount: schema.airwallexTransactions.amount,
      settledAt: schema.airwallexTransactions.settledAt,
      createdAt: schema.airwallexTransactions.createdAt,
    })
    .from(schema.airwallexTransactions)

  // Prefer the settlement time (posted_at); Airwallex frequently leaves that
  // null, so fall back to created_at, which is always present and is a close
  // proxy for when the transaction hit the ledger. Without this fallback the
  // whole backfill is a no-op whenever posted_at is unset (the common case).
  const settled: Array<{ accountId: string; amount: number; time: number }> = []
  let earliestTime = Infinity
  for (const t of txns) {
    const ts = t.settledAt ?? t.createdAt
    if (!ts) continue
    const time = new Date(ts).getTime()
    if (!Number.isFinite(time)) continue
    settled.push({ accountId: t.accountId, amount: t.amount, time })
    if (time < earliestTime) earliestTime = time
  }
  if (!Number.isFinite(earliestTime)) return empty('No Airwallex transactions with a usable timestamp to reconstruct from.')

  // Pre-fetch P&L once for trailing-3-month burn / runway per historical month.
  const pnl = await drizzle.select().from(schema.xeroPnlSnapshots)
  const pnlByMonth = new Map<string, { burn: number; currency: string }>()
  for (const p of pnl) {
    pnlByMonth.set(p.monthKey, { burn: p.totalExpenses + p.totalCostOfSales, currency: p.currency ?? 'NZD' })
  }

  // Months that already have a snapshot; never clobber those.
  const existing = await drizzle
    .select({ monthKey: schema.financialSnapshots.monthKey })
    .from(schema.financialSnapshots)
  const existingKeys = new Set(existing.map(r => r.monthKey))

  const MAX_MONTHS = 24
  const nowIso = now.toISOString()
  let monthsWritten = 0
  let monthsSkippedExisting = 0
  let earliestMonth: string | null = null
  let latestMonth: string | null = null

  for (let i = 1; i <= MAX_MONTHS; i++) {
    const md = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    // Month-end instant = start of the following month (UTC).
    const monthEnd = Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1)
    if (monthEnd <= earliestTime) break // ledger doesn't reach this far back

    const monthKey = monthKeyOf(md)
    if (existingKeys.has(monthKey)) { monthsSkippedExisting++; continue }

    // Reconstruct each account's month-end balance, sum to NZD.
    let cashNzd = 0
    for (const acct of accounts) {
      let bal = acct.balance
      for (const s of settled) {
        if (s.accountId === acct.accountId && s.time > monthEnd) bal -= s.amount
      }
      cashNzd += toNzd(bal, acct.currency, rateMap)
    }
    cashNzd = Math.round(cashNzd)

    // Trailing-3-month burn ending at this month (in-memory from P&L).
    let burnNzd: number | null = null
    let runwayMonths: number | null = null
    const window: number[] = []
    for (let k = 0; k < 3; k++) {
      const wd = new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth() - k, 1))
      const p = pnlByMonth.get(monthKeyOf(wd))
      if (p) window.push(toNzd(p.burn, p.currency, rateMap))
    }
    if (window.length > 0) {
      burnNzd = Math.round(window.reduce((a, b) => a + b, 0) / window.length)
      runwayMonths = computeRunwayMonths(cashNzd, burnNzd)
    }

    await drizzle
      .insert(schema.financialSnapshots)
      .values({
        monthKey,
        cashNzd,
        owedNzd: null,
        mrrNzd: null,
        activeClients: null,
        burnNzd,
        runwayMonths,
        source: 'backfill',
        capturedAt: nowIso,
        createdAt: nowIso,
      })
      .onConflictDoNothing({ target: schema.financialSnapshots.monthKey })

    monthsWritten++
    if (!latestMonth) latestMonth = monthKey // i=1 is the most recent month
    earliestMonth = monthKey
  }

  const note = monthsWritten > 0
    ? `Reconstructed month-end cash for ${earliestMonth}..${latestMonth} from the Airwallex ledger (total-balance basis, current FX).`
    : 'No new months to backfill (covered months already have snapshots, or the ledger is too short).'

  return { monthsWritten, monthsSkippedExisting, earliestMonth, latestMonth, note }
}
