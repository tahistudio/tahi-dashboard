/**
 * Pure aggregation helpers for the admin overview ("The Studio Ledger").
 *
 * Extracted out of app/api/admin/overview/route.ts so they can be unit
 * tested without a live D1 (Next.js forbids exporting non-route helpers
 * from a route.ts file). The route imports these; the math lives here.
 *
 * All currency conversion is expected to have already happened upstream
 * (callers pass NZD amounts in) so these helpers stay free of the rate map.
 */

/**
 * Start-of-yesterday in UTC, as an ISO string.
 *
 * "Overnight" on the ledger means "since the start of the prior calendar
 * day (UTC)" so the morning summary always covers a full day plus whatever
 * has happened so far today. For a `now` of 2026-06-11T09:00:00Z this
 * returns 2026-06-10T00:00:00.000Z.
 */
export function overnightCutoff(now: Date = new Date()): string {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
    0, 0, 0, 0,
  ))
  return cutoff.toISOString()
}

/**
 * Whole days an invoice is past due, given a due date and a reference
 * "now". Returns 0 when there is no due date or the invoice is not yet
 * due. Mirrors the math in reports/invoice-aging.
 */
export function daysPastDue(dueDate: string | null, now: Date = new Date()): number {
  if (!dueDate) return 0
  const due = new Date(dueDate).getTime()
  if (!Number.isFinite(due)) return 0
  const diffMs = now.getTime() - due
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

export interface ArAgingInput {
  /** NZD amount for this invoice (already converted upstream). */
  amountNzd: number
  /** Whole days past due (see daysPastDue). */
  daysPastDue: number
  /** Display name for the oldest-invoice callout. */
  clientName: string | null
}

export interface ArAging {
  currentNzd: number
  d30Nzd: number
  d60Nzd: number
  d90Nzd: number
  totalNzd: number
  oldest: { clientName: string | null; daysPastDue: number; amountNzd: number } | null
}

/**
 * Bucket sent invoices into the standard AR aging buckets and find the
 * single oldest one (by daysPastDue) for the headline callout.
 *
 * Buckets (matching reports/invoice-aging):
 *   current : 0..30 days past due
 *   d30     : 31..60
 *   d60     : 61..90
 *   d90     : 91+
 */
export function bucketArAging(invoices: ArAgingInput[]): ArAging {
  const aging: ArAging = {
    currentNzd: 0,
    d30Nzd: 0,
    d60Nzd: 0,
    d90Nzd: 0,
    totalNzd: 0,
    oldest: null,
  }

  let oldestDays = -1
  for (const inv of invoices) {
    const amount = Number.isFinite(inv.amountNzd) ? inv.amountNzd : 0
    if (inv.daysPastDue <= 30) {
      aging.currentNzd += amount
    } else if (inv.daysPastDue <= 60) {
      aging.d30Nzd += amount
    } else if (inv.daysPastDue <= 90) {
      aging.d60Nzd += amount
    } else {
      aging.d90Nzd += amount
    }
    aging.totalNzd += amount

    if (inv.daysPastDue > oldestDays) {
      oldestDays = inv.daysPastDue
      aging.oldest = {
        clientName: inv.clientName,
        daysPastDue: inv.daysPastDue,
        amountNzd: Math.round(amount),
      }
    }
  }

  aging.currentNzd = Math.round(aging.currentNzd)
  aging.d30Nzd = Math.round(aging.d30Nzd)
  aging.d60Nzd = Math.round(aging.d60Nzd)
  aging.d90Nzd = Math.round(aging.d90Nzd)
  aging.totalNzd = Math.round(aging.totalNzd)

  return aging
}

/**
 * Runway in months at the current burn rate.
 *
 *   runwayMonths = totalBalanceNzd / avgMonthlyBurnNzd
 *
 * Returns null when there is no positive burn (cannot divide by zero, and
 * "infinite runway" is not a number the UI should render). Mirrors the
 * math in reports/bank-balances.
 */
export function computeRunwayMonths(totalBalanceNzd: number, avgMonthlyBurnNzd: number): number | null {
  if (!Number.isFinite(avgMonthlyBurnNzd) || avgMonthlyBurnNzd <= 0) return null
  if (!Number.isFinite(totalBalanceNzd)) return null
  return totalBalanceNzd / avgMonthlyBurnNzd
}

/**
 * Total cleared cash in NZD, Airwallex-first.
 *
 * Airwallex is the source of truth for every currency it reports: its
 * `availableBalance` is the real spendable cash in the account. Xero's
 * BankSummary is used only for currencies Airwallex does not cover, so the
 * same cash is never counted twice.
 *
 * Preferring Airwallex is not just about dedup: Xero's BankSummary overstates
 * foreign-currency accounts because it books invoiced-but-not-yet-settled
 * amounts (money still owed to us) as if the cash had landed. Airwallex
 * reflects what is actually in the bank. Mirrors the aggregation in
 * financial-reports/summary so the overview Cash card and the finance page
 * agree.
 */
export function aggregateCashNzd(
  airwallex: Array<{ currency: string | null; availableBalance: number }>,
  xero: Array<{ currency: string | null; balance: number }>,
  toNzd: (amount: number, currency: string) => number,
): number {
  const airwallexCurrencies = new Set<string>()
  let totalNzd = 0
  for (const b of airwallex) {
    const cur = b.currency ?? 'NZD'
    airwallexCurrencies.add(cur)
    totalNzd += toNzd(b.availableBalance, cur)
  }
  for (const b of xero) {
    const cur = b.currency ?? 'NZD'
    if (airwallexCurrencies.has(cur)) continue
    totalNzd += toNzd(b.balance, cur)
  }
  return totalNzd
}

/**
 * The month-key (YYYY-MM, UTC) three calendar months before `now`, used
 * as the lower bound for the trailing-3-month burn window. Mirrors the
 * window in reports/bank-balances.
 */
export function trailingThreeMonthKey(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * Human label for the active timer pill, e.g. "47m on Acme" or
 * "2h 5m on Acme". Falls back gracefully when the target name is missing.
 */
export function activeTimerLabel(elapsedSeconds: number, targetName: string | null): string {
  const totalMinutes = Math.max(0, Math.floor(elapsedSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  return targetName ? `${duration} on ${targetName}` : duration
}
