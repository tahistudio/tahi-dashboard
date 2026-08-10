/**
 * lib/bank-drift.ts: deterministic Airwallex-vs-Xero balance comparison.
 *
 * Airwallex is the bank of truth (the money actually sits there); Xero is
 * the accounting ledger. When the two drift apart for a currency it means
 * transactions are missing or unreconciled in Xero, or a wallet-to-yield
 * transfer was never booked. The finance-anomaly-scan cron runs this on
 * every tick and raises one notification per drifting currency.
 *
 * Yield rows (accountId 'yield:CUR') are excluded from the Airwallex side:
 * Airwallex Capital holdings are not bank accounts, so Xero's bank ledger
 * is not expected to carry them.
 *
 * A currency only counts as drifted when BOTH gates trip:
 *   - absolute difference above DRIFT_ABS_FLOOR (ignores rounding and small
 *     timing noise; the caller compares on the available/cleared basis so
 *     pending settlements never enter the comparison), and
 *   - relative difference above DRIFT_REL_THRESHOLD of the larger balance.
 *
 * Known limits, fine while Tahi banks solely through Airwallex:
 *   - DRIFT_ABS_FLOOR is in native currency units, tuned for currencies
 *     within a few x of NZD parity (NZD/USD/GBP/EUR/AUD). A 100-JPY floor
 *     would be about one NZD; revisit if a minor-unit currency appears.
 *   - The Xero side sums EVERY bank account per currency. A real second
 *     bank (non-Airwallex) in a currency Airwallex also holds would read
 *     as permanent drift; filter by account name before adding one.
 */

export interface BankDriftFinding {
  currency: string
  airwallexBalance: number
  xeroBalance: number
  /** Xero minus Airwallex, signed: positive = Xero overstates. */
  diff: number
  /** abs(diff) relative to the larger absolute balance, 0..1. */
  relDiff: number
}

export const DRIFT_REL_THRESHOLD = 0.05
export const DRIFT_ABS_FLOOR = 100

export function computeBankDrift(
  airwallex: Array<{ accountId: string; currency: string | null; balance: number }>,
  xero: Array<{ currency: string | null; balance: number }>,
): BankDriftFinding[] {
  const awxByCurrency = new Map<string, number>()
  for (const row of airwallex) {
    if (row.accountId.startsWith('yield:')) continue
    const cur = (row.currency ?? 'NZD').toUpperCase()
    awxByCurrency.set(cur, (awxByCurrency.get(cur) ?? 0) + row.balance)
  }

  const xeroByCurrency = new Map<string, number>()
  for (const row of xero) {
    const cur = (row.currency ?? 'NZD').toUpperCase()
    xeroByCurrency.set(cur, (xeroByCurrency.get(cur) ?? 0) + row.balance)
  }

  const findings: BankDriftFinding[] = []
  for (const [cur, awxBalance] of awxByCurrency) {
    const xeroBalance = xeroByCurrency.get(cur)
    // Only compare currencies both sources report: a currency missing on
    // one side is a coverage difference (new wallet, separate real bank
    // account), not evidence of ledger drift.
    if (xeroBalance === undefined) continue
    const diff = xeroBalance - awxBalance
    if (Math.abs(diff) <= DRIFT_ABS_FLOOR) continue
    const larger = Math.max(Math.abs(awxBalance), Math.abs(xeroBalance))
    const relDiff = larger > 0 ? Math.abs(diff) / larger : 0
    if (relDiff <= DRIFT_REL_THRESHOLD) continue
    findings.push({ currency: cur, airwallexBalance: awxBalance, xeroBalance, diff, relDiff })
  }

  return findings.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
}
