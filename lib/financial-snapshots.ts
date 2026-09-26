/**
 * Monthly financial snapshot writer, the cash backfill, and the single-month
 * fill.
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
 *                          yet. Never overwrites a row unless it is asked to
 *                          refresh, and even then only rows it wrote itself.
 *                          Cash only: MRR / owed / active clients stay null.
 *                          Writes nothing while Airwallex yield is held (see
 *                          reconstructCashNzd).
 *
 * fillMonthSnapshot      : write ONE missing past month, insert only. Cash
 *                          rebuilt the way the backfill rebuilds it, burn and
 *                          runway, plus money owed when the invoice dates can
 *                          prove it. Refuses a month that already has a row,
 *                          the current month, any future month, a month from
 *                          before the data we hold, and a month for which
 *                          neither cash nor money owed can be rebuilt.
 *                          Touches no other month.
 *
 * See db/schema.ts (financial_snapshots) for the table contract.
 */
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { computeRunwayMonths } from '@/lib/overview-aggregates'
import { computeCurrentMetrics, type FinancialMetrics } from '@/lib/financial-metrics'
import {
  isDraftInvoice,
  isOwedInvoice,
  isPaidInvoice,
  isVoidInvoice,
  normaliseInvoiceStatus,
} from '@/lib/invoice-status'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** UTC month key (YYYY-MM) for a given date. */
function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * A month key is a year from 2000 on, a dash, and a real month (01 to 12).
 * The year floor keeps out keys like 0050-01, which Date.UTC would quietly
 * read as 1950; the real lower bound is the data we hold, checked in
 * fillMonthSnapshot.
 */
const MONTH_KEY_RE = /^20\d{2}-(0[1-9]|1[0-2])$/

/**
 * The month-end instant for the month starting at `monthStart`: the first
 * millisecond of the following month, UTC. Everything dated before it
 * belongs to the month.
 */
function monthEndOf(monthStart: Date): number {
  return Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)
}

/**
 * A stored timestamp as epoch milliseconds, or null when it cannot be read.
 *
 * Three shapes reach here: toISOString (zone Z), SQLite's default (Z, no
 * milliseconds) and Xero's invoice dates, which carry no zone at all. A stamp
 * with no zone is read as UTC, which is what the worker does anyway; left to
 * Date it would be read as local time wherever the code happened to run.
 */
export function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  let iso = trimmed
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    iso = `${trimmed.replace(' ', 'T')}Z`
  }
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
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

// ── Shared reconstruction (backfill and fill) ───────────────────────────────

interface LedgerEntry { currency: string; amount: number; time: number }

interface ReconstructionContext {
  rateMap: RateMap
  /**
   * Stored wallet balance per currency, the anchor the ledger rewinds from,
   * with when it was read (the oldest as_of among that currency's rows; null
   * when one cannot be read).
   */
  balByCurrency: Map<string, { balance: number; asOf: number | null }>
  /**
   * When the whole anchor was read: the OLDEST as_of across every wallet row,
   * since the anchor is only as current as its stalest row. Null when any
   * row's as_of cannot be read.
   */
  anchorAsOf: number | null
  /**
   * Airwallex yield holdings with money in them (accountId 'yield:CUR'), kept
   * out of the wallet anchor. Any entry here stops the cash rebuild; see
   * reconstructCashNzd.
   */
  yieldHeld: Array<{ currency: string; balance: number }>
  ledger: LedgerEntry[]
  /** Earliest usable transaction time; Infinity when the ledger is empty. */
  earliestTime: number
  pnlByMonth: Map<string, { burn: number; currency: string; syncedAt: number | null }>
}

/**
 * Everything the month-end reconstruction reads, loaded once.
 *
 * Anchor: current TOTAL balance per currency. airwallex_balances keys each
 * row as "<accountId>:<currency>", while airwallex_transactions carries a
 * bare accountId plus a currency, so the two only reconcile on CURRENCY: a
 * USD transaction moves the USD balance.
 *
 * Wallet rows only in the anchor: yield rows (accountId 'yield:CUR',
 * materialised from the finance.yieldHoldings setting) are kept apart,
 * because the wallet ledger already records the outbound transfer when funds
 * moved into yield. Rewinding a wallet-plus-yield anchor past that transfer
 * would double-count the amount. They are still read, into yieldHeld, because
 * the Cash card counts them.
 */
async function loadReconstructionContext(drizzle: D1): Promise<ReconstructionContext> {
  const rates = await drizzle.select().from(schema.exchangeRates)
  const rateMap = buildRateMap(rates)

  const allBalances = await drizzle.select().from(schema.airwallexBalances)
  const isYield = (b: { accountId: string }) => b.accountId.startsWith('yield:')
  const yieldHeld = allBalances
    .filter(b => isYield(b) && Math.abs(b.balance) >= 0.005)
    .map(b => ({ currency: b.currency ?? 'NZD', balance: b.balance }))
  const balances = allBalances.filter(b => !isYield(b))
  const oldest = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : Math.min(a, b))
  const balByCurrency = new Map<string, { balance: number; asOf: number | null }>()
  let anchorAsOf: number | null = balances.length > 0 ? Infinity : null
  for (const b of balances) {
    const cur = b.currency ?? 'NZD'
    const asOf = parseInstant(b.asOf)
    const prior = balByCurrency.get(cur)
    balByCurrency.set(cur, {
      balance: (prior?.balance ?? 0) + b.balance,
      asOf: prior ? oldest(prior.asOf, asOf) : asOf,
    })
    anchorAsOf = oldest(anchorAsOf, asOf)
  }

  const txns = await drizzle
    .select({
      currency: schema.airwallexTransactions.currency,
      amount: schema.airwallexTransactions.amount,
      settledAt: schema.airwallexTransactions.settledAt,
      createdAt: schema.airwallexTransactions.createdAt,
    })
    .from(schema.airwallexTransactions)

  // Prefer the settlement time (posted_at); Airwallex frequently leaves that
  // null, so fall back to created_at, which is always present and is a close
  // proxy for when the transaction hit the ledger. Without this fallback the
  // whole reconstruction is a no-op whenever posted_at is unset (the common
  // case).
  const ledger: LedgerEntry[] = []
  let earliestTime = Infinity
  for (const t of txns) {
    const ts = t.settledAt ?? t.createdAt
    if (!ts) continue
    const time = new Date(ts).getTime()
    if (!Number.isFinite(time)) continue
    ledger.push({ currency: t.currency ?? 'NZD', amount: t.amount, time })
    if (time < earliestTime) earliestTime = time
  }

  const pnl = await drizzle.select().from(schema.xeroPnlSnapshots)
  const pnlByMonth = new Map<string, { burn: number; currency: string; syncedAt: number | null }>()
  for (const p of pnl) {
    pnlByMonth.set(p.monthKey, {
      burn: p.totalExpenses + p.totalCostOfSales,
      currency: p.currency ?? 'NZD',
      syncedAt: parseInstant(p.syncedAt),
    })
  }

  return { rateMap, balByCurrency, anchorAsOf, yieldHeld, ledger, earliestTime, pnlByMonth }
}

/** Today's yield holdings in words, e.g. "USD 25100, AUD 534; about NZ$43300 at today's FX". */
function describeYield(ctx: ReconstructionContext): string {
  const parts = ctx.yieldHeld.map(y => `${y.currency} ${Math.round(y.balance)}`)
  const nzd = ctx.yieldHeld.reduce((sum, y) => sum + toNzd(y.balance, y.currency, ctx.rateMap), 0)
  return `${parts.join(', ')}; about NZ$${Math.round(nzd)} at today's FX`
}

/** Why no month-end cash can be rebuilt while yield is held. */
function yieldNotStoredReason(ctx: ReconstructionContext): string {
  return `The Cash card counts the Airwallex yield holdings as cash (${describeYield(ctx)}), and what sat in yield at a past month end is not stored: the yield rows are rewritten from the finance.yieldHoldings setting on every sync, and the wallet ledger does not mark transfers into or out of yield. A wallet-only rewind would read low by the holding, and adding today's holding would be off by whatever has moved since, so month-end cash cannot be rebuilt on the Cash card's basis.`
}

type CashRewind =
  | { cashNzd: number; txnsRewound: number }
  | { cashNzd: null; reason: 'no_anchor' | 'yield_not_stored' | 'ledger_too_short' | 'anchor_before_month_end' }

/**
 * Month-end cash in NZD, rewound from the stored wallet balances.
 *
 * balance(T) = balance(read) minus the sum of every same-currency
 * transaction after T, up to when the balance was read. Amounts are signed
 * (inbound +, outbound -), so subtracting the forward transactions rewinds
 * the balance to any earlier instant. A transaction dated after the balance
 * was read is not in that balance, so it is not subtracted from it. Foreign
 * balances convert at the CURRENT FX rate; historical rates are not stored.
 *
 * Null, with the reason, when there is no anchor; while any yield is held;
 * when the ledger does not reach back to the month end (before the earliest
 * transaction we hold it is incomplete); or when the balances were read
 * before the month end (a rewind cannot move forward).
 *
 * The yield case. The Cash card, and every cron row written since yield
 * rows existed, counts wallet plus yield. The wallet ledger rewinds wallet
 * cash only, and the yield held at a past month end is not stored anywhere
 * (see yieldNotStoredReason), so for any month after money first moved into
 * yield a wallet-only figure is low by the holding. Which months those are
 * cannot be told either, because the ledger does not mark the transfers. So
 * while yield is held, no month-end cash is rebuilt at all.
 */
function reconstructCashNzd(ctx: ReconstructionContext, monthEnd: number): CashRewind {
  if (ctx.balByCurrency.size === 0) return { cashNzd: null, reason: 'no_anchor' }
  if (ctx.yieldHeld.length > 0) return { cashNzd: null, reason: 'yield_not_stored' }
  if (!Number.isFinite(ctx.earliestTime) || monthEnd <= ctx.earliestTime) return { cashNzd: null, reason: 'ledger_too_short' }
  if (ctx.anchorAsOf == null || ctx.anchorAsOf < monthEnd) return { cashNzd: null, reason: 'anchor_before_month_end' }
  let cashNzd = 0
  let txnsRewound = 0
  for (const [cur, anchor] of ctx.balByCurrency) {
    let bal = anchor.balance
    // Never null here: a null as_of on any row makes anchorAsOf null above.
    const readAt = anchor.asOf ?? Infinity
    for (const s of ctx.ledger) {
      if (s.currency === cur && s.time > monthEnd && s.time <= readAt) {
        bal -= s.amount
        txnsRewound++
      }
    }
    cashNzd += toNzd(bal, cur, ctx.rateMap)
  }
  return { cashNzd: Math.round(cashNzd), txnsRewound }
}

/**
 * Trailing-3-month average burn (expenses plus cost of sales) ending at the
 * month starting `monthStart`, from the stored Xero P&L. A P&L month last
 * synced before that month had closed is a partial month and would understate
 * burn, so it is left out of the average rather than counted.
 */
function trailingBurnEndingAt(ctx: ReconstructionContext, monthStart: Date): { burnNzd: number | null; months: string[] } {
  const window: number[] = []
  const months: string[] = []
  for (let k = 0; k < 3; k++) {
    const wd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - k, 1))
    const key = monthKeyOf(wd)
    const p = ctx.pnlByMonth.get(key)
    if (!p) continue
    if (p.syncedAt == null || p.syncedAt < monthEndOf(wd)) continue
    window.push(toNzd(p.burn, p.currency, ctx.rateMap))
    months.push(key)
  }
  if (window.length === 0) return { burnNzd: null, months }
  return { burnNzd: Math.round(window.reduce((a, b) => a + b, 0) / window.length), months: months.reverse() }
}

// ── Backfill ────────────────────────────────────────────────────────────────

/**
 * True when a write reports that it changed no row. A driver that reports no
 * count at all is taken at its word that the write landed, which is what the
 * backfill assumed before it read the count.
 */
function changedNothing(result: unknown): boolean {
  const changes = (result as { meta?: { changes?: unknown } } | null | undefined)?.meta?.changes
  return typeof changes === 'number' && changes === 0
}

export interface BackfillOptions {
  /**
   * Recompute months that already hold a row this backfill wrote (source
   * 'backfill'). Off by default: without it an existing month is never
   * written, whatever its source. A 'cron' row is never written either way.
   */
  refresh?: boolean
}

export interface BackfillResult {
  refresh: boolean
  /** New rows inserted for months that had none. */
  monthsWritten: number
  /** Existing 'backfill' rows recomputed. Always 0 without refresh. */
  monthsRefreshed: number
  monthsSkippedExisting: number
  writtenMonths: string[]
  refreshedMonths: string[]
  skippedMonths: string[]
  earliestMonth: string | null
  latestMonth: string | null
  note: string
}

/**
 * Reconstruct past month-end cash from the Airwallex ledger.
 *
 * We anchor on the current TOTAL balance, so reconstructed months are on a
 * total-incl-pending basis (the forward cron snapshots use spendable
 * balance; at month end the two are close). Foreign balances are converted
 * with the CURRENT FX rate, so months with large foreign holdings carry a
 * small FX approximation.
 *
 * Only months whose month-end is at or after the earliest transaction we
 * hold are reconstructed (before that the ledger is incomplete). A month
 * that already has a row is left exactly as it is: re-running recomputes
 * nothing, because a re-run would restate settled months from today's FX and
 * today's P&L. `refresh: true` is the explicit opt-in to recompute the rows a
 * previous backfill wrote (cash, burn and runway only; any money-owed figure
 * a fill stored stays). A 'cron' row is never overwritten.
 *
 * While any Airwallex yield is held nothing is written, refresh or not: no
 * month-end cash can be rebuilt on the Cash card's basis (reconstructCashNzd).
 *
 * The month lists report what the database actually changed: a row that
 * appeared between the read and the write leaves the insert (or the
 * source-guarded update) changing nothing, and that month is reported as
 * left untouched, not as written.
 */
export async function backfillCashFromLedger(
  drizzle: D1,
  now: Date = new Date(),
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const refresh = options.refresh === true
  const empty = (note: string): BackfillResult => ({
    refresh,
    monthsWritten: 0,
    monthsRefreshed: 0,
    monthsSkippedExisting: 0,
    writtenMonths: [],
    refreshedMonths: [],
    skippedMonths: [],
    earliestMonth: null,
    latestMonth: null,
    note,
  })

  const ctx = await loadReconstructionContext(drizzle)
  if (ctx.balByCurrency.size === 0) return empty('No Airwallex balances to anchor reconstruction.')
  if (ctx.yieldHeld.length > 0) return empty(`Nothing written. ${yieldNotStoredReason(ctx)}`)
  if (!Number.isFinite(ctx.earliestTime)) return empty('No Airwallex transactions with a usable timestamp to reconstruct from.')

  const existing = await drizzle
    .select({ monthKey: schema.financialSnapshots.monthKey, source: schema.financialSnapshots.source })
    .from(schema.financialSnapshots)
  const sourceByMonth = new Map(existing.map(r => [r.monthKey, r.source]))

  const MAX_MONTHS = 24
  const nowIso = now.toISOString()
  const writtenMonths: string[] = []
  const refreshedMonths: string[] = []
  const skippedMonths: string[] = []
  const afterAnchorMonths: string[] = []

  for (let i = 1; i <= MAX_MONTHS; i++) {
    const md = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const monthEnd = monthEndOf(md)
    const monthKey = monthKeyOf(md)
    const cash = reconstructCashNzd(ctx, monthEnd)
    if (cash.cashNzd == null) {
      // Balances last read before this month ended: an earlier month may
      // still rewind, so keep walking back. Anything else means the ledger
      // doesn't reach this far back, and no earlier month will either.
      if (cash.reason === 'anchor_before_month_end') {
        afterAnchorMonths.push(monthKey)
        continue
      }
      break
    }

    const existingSource = sourceByMonth.get(monthKey)
    const isRefresh = existingSource === 'backfill' && refresh
    if (existingSource !== undefined && !isRefresh) {
      skippedMonths.push(monthKey)
      continue
    }

    const { cashNzd } = cash
    const { burnNzd } = trailingBurnEndingAt(ctx, md)
    const runwayMonths = burnNzd != null ? computeRunwayMonths(cashNzd, burnNzd) : null

    if (isRefresh) {
      // The WHERE on source is the second lock: if a cron row landed since
      // the read above, this update matches nothing.
      const result = await drizzle
        .update(schema.financialSnapshots)
        .set({ cashNzd, burnNzd, runwayMonths, capturedAt: nowIso })
        .where(and(
          eq(schema.financialSnapshots.monthKey, monthKey),
          eq(schema.financialSnapshots.source, 'backfill'),
        ))
      if (changedNothing(result)) skippedMonths.push(monthKey)
      else refreshedMonths.push(monthKey)
    } else {
      // Insert only. A row that appeared since the read above wins, and this
      // write becomes a no-op rather than an overwrite.
      const result = await drizzle
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
      if (changedNothing(result)) skippedMonths.push(monthKey)
      else writtenMonths.push(monthKey)
    }
  }

  // Months are walked newest first, so the first touched is the latest.
  const touched = [...writtenMonths, ...refreshedMonths].sort()
  const earliestMonth = touched[0] ?? null
  const latestMonth = touched[touched.length - 1] ?? null

  const noteParts: string[] = [
    touched.length > 0
      ? `Reconstructed month-end cash for ${earliestMonth}..${latestMonth} from the Airwallex wallet ledger (total-balance basis, current FX).`
      : 'Nothing written.',
  ]
  if (skippedMonths.length > 0) {
    noteParts.push(`Left untouched, because they already have a row: ${skippedMonths.sort().join(', ')}. ${refresh ? 'A cron row is never overwritten, refresh or not.' : 'Existing rows are never overwritten; pass refresh=1 to recompute earlier backfill rows.'}`)
  }
  if (afterAnchorMonths.length > 0) {
    noteParts.push(`Not reconstructed, because the Airwallex balances were last synced before they ended: ${afterAnchorMonths.sort().join(', ')}. Run the Airwallex sync, then backfill again.`)
  }
  if (touched.length === 0 && skippedMonths.length === 0 && afterAnchorMonths.length === 0) {
    noteParts.push('The Airwallex ledger does not reach back to any past month end.')
  }
  const note = noteParts.join(' ')

  return {
    refresh,
    monthsWritten: writtenMonths.length,
    monthsRefreshed: refreshedMonths.length,
    monthsSkippedExisting: skippedMonths.length,
    writtenMonths: writtenMonths.sort(),
    refreshedMonths: refreshedMonths.sort(),
    skippedMonths: skippedMonths.sort(),
    earliestMonth,
    latestMonth,
    note,
  }
}

// ── Money owed at a past instant ────────────────────────────────────────────

export interface OwedInvoiceRow {
  id: string
  number: string | null
  status: string
  totalUsd: number
  currency: string | null
  /** Which importer wrote the row ('xero', 'stripe', 'manyrequests', 'manual'). */
  source: string | null
  sentAt: string | null
  paidAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface AmbiguousInvoice {
  id: string
  number: string | null
  status: string
  amountNzd: number
  reason: string
}

export interface OwedAsOfResult {
  /**
   * Money owed at the instant, NZD. Null when any invoice's state then cannot
   * be told, or when the ledger does not reach back to the instant.
   */
  owedNzd: number | null
  /** Invoices certainly issued and unpaid at the instant. */
  certainCount: number
  certainNzd: number
  /** Invoices that may or may not have been owed at the instant. */
  ambiguous: AmbiguousInvoice[]
  ambiguousNzd: number
  /** The earliest issue date of any issued invoice the ledger holds (ISO), or null when it holds none. */
  ledgerFrom: string | null
  /** True when no invoice in the ledger was issued at or before the instant. */
  beforeLedger: boolean
}

/**
 * Money owed at a past instant, rebuilt from the invoice ledger, with the
 * same meaning as the live figure: issued and unpaid (lib/invoice-status.ts),
 * total converted to NZD. Drafts are never money.
 *
 * An invoice counts as issued at its first send (sent_at) or, when that was
 * never stamped, at created_at, which the Xero, Stripe and ManyRequests
 * importers all set to the source's own invoice date. Paid invoices carry a
 * paid_at, so "paid after the instant" is provable.
 *
 * Some states cannot be placed in time. Write-offs carry no date at all, and
 * a paid invoice can lack paid_at. A ManyRequests row whose paid_at equals
 * its created_at counts as lacking one: when ManyRequests sends no payment
 * date the importer copies the invoice date across (mapInvoicePaidAt), so the
 * invoice would read as never owed. (A Stripe charge row has the two equal
 * for real, since a charge is paid the moment it exists, so the rule is
 * limited to ManyRequests rows.) Such a row is only settled when its
 * updated_at is at or before the instant: every status writer stamps
 * updated_at, so an untouched row had the status it has now. Otherwise the
 * row is ambiguous, and one ambiguous row with any money on it makes the
 * whole figure unknowable, so owedNzd is null and the rows are listed. Zero
 * totals are never ambiguous; they cannot move the figure.
 *
 * A zero is only a figure when the ledger reaches the instant. If no invoice
 * in it was issued at or before the instant, nothing shows the ledger goes
 * back that far (the Xero importer pages newest first, so its older end can
 * be thin), and owedNzd is null with beforeLedger set, never a made-up 0.
 *
 * Caveats that stand either way: FX is today's rate; an invoice deleted since
 * (a deduplicated twin, a test row) or issued before the ledger's earliest
 * row and never imported is not there to count; and a Xero row imported or
 * synced as paid when Xero sent no payment date carries that sync's time as
 * paid_at (lib/xero-sync.ts, lib/xero-status.ts), so it reads as owed until
 * that sync.
 */
export function owedAsOf(rows: readonly OwedInvoiceRow[], instant: number, rateMap: RateMap): OwedAsOfResult {
  let certainCount = 0
  let certainNzd = 0
  let ambiguousNzd = 0
  const ambiguous: AmbiguousInvoice[] = []
  let earliestIssuedAt: number | null = null

  for (const row of rows) {
    const status = normaliseInvoiceStatus(row.status)
    const amountNzd = toNzd(row.totalUsd, row.currency ?? 'USD', rateMap)
    const updatedAt = parseInstant(row.updatedAt)
    const untouchedSince = updatedAt != null && updatedAt <= instant
    const sentAt = parseInstant(row.sentAt)
    const createdAt = parseInstant(row.createdAt)
    const issuedAt = sentAt ?? createdAt

    let reason: string | null = null
    let owed = false

    if (isDraftInvoice(status)) {
      // A draft that was sent before the instant and has been rewritten since
      // was pulled back to draft after the fact.
      if (sentAt != null && sentAt <= instant && !untouchedSince) {
        reason = 'A draft now, but first sent before month end and rewritten since, so it may have been owed then.'
      }
    } else if (isOwedInvoice(status) || isPaidInvoice(status) || isVoidInvoice(status)) {
      if (issuedAt != null && (earliestIssuedAt == null || issuedAt < earliestIssuedAt)) earliestIssuedAt = issuedAt
      if (issuedAt == null) {
        reason = 'No issue date: neither sent_at nor created_at can be read.'
      } else if (issuedAt <= instant) {
        if (isOwedInvoice(status)) {
          owed = true
        } else if (isPaidInvoice(status)) {
          const storedPaidAt = parseInstant(row.paidAt)
          const copiedFromCreated = storedPaidAt != null && row.source === 'manyrequests' && storedPaidAt === createdAt
          const paidAt = copiedFromCreated ? null : storedPaidAt
          if (paidAt != null) owed = paidAt > instant
          else if (!untouchedSince) {
            reason = copiedFromCreated
              ? 'Paid, but its paid date is only a copy of its invoice date (the ManyRequests import fallback when no payment date came across), and rewritten since month end, so it may have been paid after.'
              : 'Paid, but with no paid date, and rewritten since month end, so it may have been paid after.'
          }
        } else if (!untouchedSince) {
          reason = `Now ${status}, which carries no date, and rewritten since month end, so it may still have been owed then.`
        }
      }
    }

    if (owed) {
      certainCount++
      certainNzd += amountNzd
    } else if (reason && Math.abs(amountNzd) >= 0.005) {
      ambiguous.push({ id: row.id, number: row.number, status, amountNzd: Math.round(amountNzd), reason })
      ambiguousNzd += amountNzd
    }
  }

  const beforeLedger = earliestIssuedAt == null || earliestIssuedAt > instant
  return {
    owedNzd: ambiguous.length === 0 && !beforeLedger ? Math.round(certainNzd) : null,
    certainCount,
    certainNzd: Math.round(certainNzd),
    ambiguous,
    ambiguousNzd: Math.round(ambiguousNzd),
    ledgerFrom: earliestIssuedAt != null ? new Date(earliestIssuedAt).toISOString() : null,
    beforeLedger,
  }
}

// ── Single-month fill ───────────────────────────────────────────────────────

export type SnapshotFillRefusalCode =
  | 'invalid_month'
  | 'not_past'
  | 'before_data'
  | 'exists'
  | 'balances_stale'
  | 'nothing_derivable'

/** A fill that was refused before anything was written. */
export class SnapshotFillRefusal extends Error {
  readonly code: SnapshotFillRefusalCode
  readonly status: 400 | 409 | 422
  readonly existing: { source: string; capturedAt: string } | null

  constructor(
    code: SnapshotFillRefusalCode,
    status: 400 | 409 | 422,
    message: string,
    existing: { source: string; capturedAt: string } | null = null,
  ) {
    super(message)
    this.name = 'SnapshotFillRefusal'
    this.code = code
    this.status = status
    this.existing = existing
  }
}

export interface FilledField {
  value: number | null
  /** Where the value came from, or why it was left null. */
  basis: string
}

export type SnapshotField = 'cashNzd' | 'owedNzd' | 'mrrNzd' | 'activeClients' | 'burnNzd' | 'runwayMonths'

export interface FillMonthResult {
  monthKey: string
  /** The instant the figures describe: the first moment of the next month, UTC. */
  monthEnd: string
  source: 'backfill'
  capturedAt: string
  fields: Record<SnapshotField, FilledField>
  filled: SnapshotField[]
  leftNull: SnapshotField[]
  /** The working behind owedNzd, including every invoice that blocked it. */
  owed: OwedAsOfResult
}

const FIELD_ORDER: SnapshotField[] = ['cashNzd', 'owedNzd', 'mrrNzd', 'activeClients', 'burnNzd', 'runwayMonths']

const NO_HISTORY =
  'organisations.custom_mrr and organisations.status are overwritten in place (client edits, importers) and no history or audit of their old values is kept, so their values at month end cannot be recovered. Left null rather than guessed.'

/**
 * The earliest instant any of the data a fill rebuilds from reaches: the
 * first Airwallex transaction, the first stored Xero P&L month, the first
 * issued invoice. Null when none of them holds anything.
 */
function earliestDataAt(ctx: ReconstructionContext, owed: OwedAsOfResult): number | null {
  const candidates: number[] = []
  if (Number.isFinite(ctx.earliestTime)) candidates.push(ctx.earliestTime)
  for (const key of ctx.pnlByMonth.keys()) {
    const start = parseInstant(`${key}-01`)
    if (start != null) candidates.push(start)
  }
  const ledgerFrom = parseInstant(owed.ledgerFrom)
  if (ledgerFrom != null) candidates.push(ledgerFrom)
  return candidates.length > 0 ? Math.min(...candidates) : null
}

/**
 * Write the snapshot for ONE past month that has no row, insert only.
 *
 * Refuses, writing nothing:
 *   invalid_month      (400) not YYYY-MM from 2000 on.
 *   not_past           (400) the current month (the daily cron owns it) or a
 *                            month that has not happened.
 *   exists             (409) the month already has a row, whatever its source.
 *   before_data        (400) the month ended before the earliest Airwallex
 *                            transaction, Xero P&L month and issued invoice
 *                            we hold, so there is nothing to rebuild it from.
 *   balances_stale     (422) the Airwallex balances were read before the
 *                            month ended. Syncing them makes cash rebuildable,
 *                            so the fill waits for that rather than writing a
 *                            row without it that a second fill could not add
 *                            to.
 *   nothing_derivable  (422) neither month-end cash nor money owed can be
 *                            rebuilt. Those are the point-in-time figures the
 *                            table exists to keep; burn is recomputable from
 *                            the stored P&L at any time, so a row holding only
 *                            burn would add nothing and would block a later,
 *                            better fill.
 *
 * Fields: cash, burn and runway as backfillCashFromLedger rebuilds them (so
 * no cash, and no runway, while Airwallex yield is held); money owed via
 * owedAsOf when the invoice dates prove it; MRR and active clients always
 * null (see NO_HISTORY). Written with source 'backfill'. Never reads or
 * writes any other month's row beyond the existence check. A failed read
 * throws, so a fill never writes a row with a field missing only because a
 * query failed.
 */
export async function fillMonthSnapshot(drizzle: D1, monthKey: string, now: Date = new Date()): Promise<FillMonthResult> {
  if (!MONTH_KEY_RE.test(monthKey)) {
    throw new SnapshotFillRefusal('invalid_month', 400, `"${monthKey}" is not a month. Use YYYY-MM, for example 2026-08.`)
  }
  const currentMonthKey = monthKeyOf(now)
  if (monthKey === currentMonthKey) {
    throw new SnapshotFillRefusal('not_past', 400, `${monthKey} is the current month. The daily snapshot owns it until the month closes; a fill only writes months that have ended.`)
  }
  if (monthKey > currentMonthKey) {
    throw new SnapshotFillRefusal('not_past', 400, `${monthKey} has not happened yet. A fill only writes months that have ended.`)
  }

  const [existing] = await drizzle
    .select({
      source: schema.financialSnapshots.source,
      capturedAt: schema.financialSnapshots.capturedAt,
    })
    .from(schema.financialSnapshots)
    .where(eq(schema.financialSnapshots.monthKey, monthKey))
    .limit(1)
  if (existing) {
    throw new SnapshotFillRefusal(
      'exists',
      409,
      `${monthKey} already has a snapshot (source ${existing.source}, captured ${existing.capturedAt}). A fill never overwrites; nothing was written.`,
      { source: existing.source, capturedAt: existing.capturedAt },
    )
  }

  const [year, month] = monthKey.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = monthEndOf(monthStart)
  const ctx = await loadReconstructionContext(drizzle)
  const invoiceRows = await drizzle
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      status: schema.invoices.status,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      source: schema.invoices.source,
      sentAt: schema.invoices.sentAt,
      paidAt: schema.invoices.paidAt,
      createdAt: schema.invoices.createdAt,
      updatedAt: schema.invoices.updatedAt,
    })
    .from(schema.invoices)
  const owed = owedAsOf(invoiceRows, monthEnd, ctx.rateMap)

  const earliest = earliestDataAt(ctx, owed)
  if (earliest != null && monthEnd <= earliest) {
    throw new SnapshotFillRefusal(
      'before_data',
      400,
      `${monthKey} ended before the earliest data we hold (${new Date(earliest).toISOString()}, the first of the Airwallex ledger, the stored Xero P&L and the issued invoices), so there is nothing to rebuild it from. Nothing was written.`,
    )
  }

  // Cash.
  const cash = reconstructCashNzd(ctx, monthEnd)
  if (cash.cashNzd == null && cash.reason === 'anchor_before_month_end') {
    throw new SnapshotFillRefusal(
      'balances_stale',
      422,
      `The Airwallex balances were last synced ${ctx.anchorAsOf != null ? new Date(ctx.anchorAsOf).toISOString() : 'at an unreadable time'}, before ${monthKey} ended, and a rewind cannot move forward. Run the Airwallex sync, then fill again. Nothing was written, so the fill can still run in full.`,
    )
  }
  let cashBasis: string
  if (cash.cashNzd != null) {
    const anchor = ctx.anchorAsOf != null ? new Date(ctx.anchorAsOf).toISOString() : 'unknown'
    cashBasis = `Rewound from the Airwallex wallet balances synced ${anchor} (total incl. pending) through ${cash.txnsRewound} ledger transactions dated after month end and before those balances were read; foreign balances at today's FX. No yield is held, so wallet cash is the Cash card's whole Airwallex figure.`
  } else if (cash.reason === 'no_anchor') {
    cashBasis = 'No Airwallex balances to anchor the rewind. Left null.'
  } else if (cash.reason === 'yield_not_stored') {
    cashBasis = `${yieldNotStoredReason(ctx)} Left null.`
  } else {
    cashBasis = 'The Airwallex ledger we hold does not reach back to this month end, so the rewind would be incomplete. Left null.'
  }
  const cashNzd = cash.cashNzd

  // Burn and runway.
  const burn = trailingBurnEndingAt(ctx, monthStart)
  const burnBasis = burn.burnNzd != null
    ? `Average monthly expenses plus cost of sales from the stored Xero P&L for ${burn.months.join(', ')}, leaving out any month last synced before it closed.`
    : 'No Xero P&L month in the trailing three that was synced after it closed. Left null.'
  const runwayMonths = cashNzd != null && burn.burnNzd != null ? computeRunwayMonths(cashNzd, burn.burnNzd) : null
  const runwayBasis = runwayMonths != null
    ? 'Month-end cash divided by that trailing burn.'
    : 'Needs both month-end cash and a positive trailing burn. Left null.'

  // Money owed.
  let owedBasis: string
  if (owed.beforeLedger) {
    owedBasis = `No invoice in the ledger was issued by month end (${owed.ledgerFrom != null ? `the earliest issue date held is ${owed.ledgerFrom}` : 'it holds no issued invoice'}), so nothing shows the ledger reaches back this far, and a 0 here would be a guess. Left null.`
  } else if (owed.owedNzd != null) {
    owedBasis = `${owed.certainCount} invoices issued by month end and not paid by then (issue date = sent_at, else the source invoice date in created_at; paid_at for payment), at today's FX. Counts only what the ledger holds, which reaches back to ${owed.ledgerFrom}. A Xero invoice synced as paid without a payment date carries the sync's time as paid_at, so it reads as owed until then.`
  } else {
    owedBasis = `${owed.ambiguous.length} invoices worth NZ$${owed.ambiguousNzd} cannot be placed at month end (listed under owed.ambiguous, each with its reason; typically a write-off, which carries no date, on a row rewritten after month end). Certainly owed then: NZ$${owed.certainNzd} across ${owed.certainCount} invoices, so the true figure lies between that and NZ$${owed.certainNzd + owed.ambiguousNzd}. Left null rather than guessed.`
  }
  const owedNzd = owed.owedNzd

  const fields: Record<SnapshotField, FilledField> = {
    cashNzd: { value: cashNzd, basis: cashBasis },
    owedNzd: { value: owedNzd, basis: owedBasis },
    mrrNzd: { value: null, basis: NO_HISTORY },
    activeClients: { value: null, basis: NO_HISTORY },
    burnNzd: { value: burn.burnNzd, basis: burnBasis },
    runwayMonths: { value: runwayMonths, basis: runwayBasis },
  }
  const filled = FIELD_ORDER.filter(f => fields[f].value != null)
  const leftNull = FIELD_ORDER.filter(f => fields[f].value == null)

  if (cashNzd == null && owedNzd == null) {
    throw new SnapshotFillRefusal(
      'nothing_derivable',
      422,
      `Neither month-end cash nor money owed for ${monthKey} can be rebuilt honestly, so no row was written and a later fill is still possible. (Burn alone is not written: it is recomputable from the stored Xero P&L at any time, and a row holding only burn would block a later fill.) Cash: ${cashBasis} Owed: ${owedBasis} Burn: ${burnBasis}`,
    )
  }

  const nowIso = now.toISOString()
  try {
    // A plain insert, deliberately with no conflict clause: if a row for this
    // month appeared since the check above, the primary key refuses this one
    // and the other row stands.
    await drizzle.insert(schema.financialSnapshots).values({
      monthKey,
      cashNzd,
      owedNzd,
      mrrNzd: null,
      activeClients: null,
      burnNzd: burn.burnNzd,
      runwayMonths,
      source: 'backfill',
      capturedAt: nowIso,
      createdAt: nowIso,
    })
  } catch (err) {
    // The driver may wrap the database error, so read the cause too.
    const cause = err instanceof Error && err.cause instanceof Error ? ` ${err.cause.message}` : ''
    const message = `${err instanceof Error ? err.message : String(err)}${cause}`
    if (/unique|constraint|primary key/i.test(message)) {
      throw new SnapshotFillRefusal('exists', 409, `${monthKey} gained a snapshot while this fill ran. A fill never overwrites; nothing was written.`)
    }
    throw err
  }

  return {
    monthKey,
    monthEnd: new Date(monthEnd).toISOString(),
    source: 'backfill',
    capturedAt: nowIso,
    fields,
    filled,
    leftNull,
    owed,
  }
}
