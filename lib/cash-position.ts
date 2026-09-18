/**
 * The studio's one money source of truth.
 *
 * Before this existed, three surfaces each did their own cash maths and each
 * printed a different burn: the overview Cash card averaged three months of
 * Xero P&L, /financial-reports summed the expense commitments, and the
 * cash-flow forecast added the one-off commitments on top. Same screen, three
 * answers. Every money card now reads this function instead.
 *
 * Two rules the old maths got wrong, both of which came straight from Liam:
 *
 *  1. The tax reserve pot is savings TOWARD the IRD bill, not a second
 *     liability sitting beside it. Deducting the 15k pot AND the 24.2k bill
 *     charged the studio 39.2k for a 24.2k debt and printed "NZ$0 disposable"
 *     on a healthy account. We ring-fence max(bill, pot), never the sum.
 *  2. Revenue is retainers PLUS the trailing project run-rate. Retainers alone
 *     describe about a third of what Tahi actually invoices, which is what made
 *     every forecast month negative.
 *
 * Airwallex is cash truth; Xero's BankSummary books invoiced-but-unsettled
 * money as if it had landed, so it only fills currencies Airwallex misses.
 * See lib/overview-aggregates.ts aggregateCashNzd.
 */
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'
import { aggregateCashNzd } from '@/lib/overview-aggregates'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Settings key holding the TOTAL balance owed to IRD, in NZD. */
export const TAX_OWED_SETTING_KEY = 'finance.lastYearTaxOwed'
/** Settings key holding the operator's manual monthly burn override, in NZD. */
export const BURN_OVERRIDE_SETTING_KEY = 'finance.monthlyBurnNzd'

/** The raw figures the position is derived from. All NZD, all per month where monthly. */
export interface CashPositionInput {
  /** Real bank cash across every currency, Airwallex-first, NZD-equivalent. */
  totalCashNzd: number
  /** Total balance owed to IRD (terminal + provisional), from settings. */
  taxOwedNzd: number
  /** Accrued amount across active reserve pots with category 'tax'. */
  taxPotNzd: number
  /** Accrued amount across the other active reserve pots. */
  otherReservesNzd: number
  /** Active recurring commitments per month. */
  recurringBurnNzd: number
  /** Trailing five months of non-retainer invoiced revenue, per month. */
  projectRunRateNzd: number
  /** Active clients' custom MRR, NZD-equivalent. */
  retainerMrrNzd: number
}

export interface CashPosition extends CashPositionInput {
  /** max(taxOwedNzd, taxPotNzd). The pot is part of the bill, never extra to it. */
  ringFencedTaxNzd: number
  /** Still to save toward the bill: max(0, owed - pot). */
  unreservedTaxNzd: number
  /** Cash left once the IRD ring-fence is honoured. */
  taxAdjustedCashNzd: number
  /** What is genuinely free to spend right now. */
  disposableNzd: number
  /** Retainer MRR + project run-rate. */
  effectiveMonthlyRevenueNzd: number
  /** Effective revenue minus recurring burn. Positive = profitable. */
  monthlySurplusNzd: number
  /** max(0, burn - revenue). Zero means breakeven or better. */
  netMonthlyBurnNzd: number
  /** "If revenue stopped": tax-adjusted cash / burn. Null when burn is unknown. */
  grossRunwayMonths: number | null
  /** Tax-adjusted cash / net burn. Null while the studio is in surplus. */
  netRunwayMonths: number | null
}

/**
 * Pure derivation. Every money card's arithmetic lives here so it can be
 * tested against the real production figures without a live D1.
 */
export function derivePosition(input: CashPositionInput): CashPosition {
  const taxOwedNzd = Math.max(0, input.taxOwedNzd)
  const taxPotNzd = Math.max(0, input.taxPotNzd)
  const otherReservesNzd = Math.max(0, input.otherReservesNzd)
  const ringFencedTaxNzd = Math.max(taxOwedNzd, taxPotNzd)
  const unreservedTaxNzd = Math.max(0, taxOwedNzd - taxPotNzd)
  const taxAdjustedCashNzd = Math.max(0, input.totalCashNzd - ringFencedTaxNzd)
  const disposableNzd = Math.max(0, taxAdjustedCashNzd - otherReservesNzd)

  const effectiveMonthlyRevenueNzd = input.retainerMrrNzd + input.projectRunRateNzd
  const monthlySurplusNzd = effectiveMonthlyRevenueNzd - input.recurringBurnNzd
  const netMonthlyBurnNzd = Math.max(0, -monthlySurplusNzd)

  const grossRunwayMonths = input.recurringBurnNzd > 0
    ? taxAdjustedCashNzd / input.recurringBurnNzd
    : null
  const netRunwayMonths = netMonthlyBurnNzd > 0
    ? taxAdjustedCashNzd / netMonthlyBurnNzd
    : null

  return {
    ...input,
    taxOwedNzd,
    taxPotNzd,
    otherReservesNzd,
    ringFencedTaxNzd,
    unreservedTaxNzd,
    taxAdjustedCashNzd,
    disposableNzd,
    effectiveMonthlyRevenueNzd,
    monthlySurplusNzd,
    netMonthlyBurnNzd,
    grossRunwayMonths,
    netRunwayMonths,
  }
}

/**
 * Normalise one expense commitment's cadence to a monthly figure. One-off
 * commitments are deliberately excluded: they are real cash out, but they are
 * not the recurring burn that runway divides by.
 */
export function cadenceToMonthlyNzd(cadence: string, amountNzd: number): number {
  switch (cadence) {
    case 'monthly': return amountNzd
    case 'quarterly': return amountNzd / 3
    case 'annual': return amountNzd / 12
    default: return 0
  }
}

/**
 * Compact NZD for card subtitles and server-rendered basis text, e.g.
 * NZ$10.3k. Mirrors the moneyCompact rule in components/tahi/overview/ov-kit.
 */
export function formatCompactNzd(nzd: number): string {
  const sign = nzd < 0 ? '-' : ''
  const abs = Math.abs(nzd)
  if (abs >= 1000) {
    const k = abs / 1000
    const num = k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')
    return `${sign}NZ$${num}k`
  }
  return `${sign}NZ$${Math.round(abs)}`
}

/**
 * The one-line answer to "where do the ribbon's numbers come from?". Rendered
 * under the Cash-flow ribbon and as summary.basis on the forecast route, so the
 * card and the finance page never describe the projection differently.
 */
export function cashFlowBasisLine(
  parts: { retainerNzd: number; projectRunRateNzd: number },
  format: (nzd: number) => string = formatCompactNzd,
): string {
  return `Retainers ${format(parts.retainerNzd)} + project run-rate ${format(parts.projectRunRateNzd)}`
    + ' + weighted pipeline, minus commitments'
}

export interface CashPositionOptions {
  /** Reuse an already-built FX rate map instead of re-reading exchange_rates. */
  rateMap?: RateMap
}

/**
 * Read the studio's live cash position out of D1.
 *
 * Every block is independently guarded so a table that has not been migrated
 * yet degrades that one input to zero rather than 500-ing a dashboard. The
 * derivation itself is pure (derivePosition) and unit tested.
 */
export async function computeCashPosition(
  database: D1,
  options: CashPositionOptions = {},
): Promise<CashPosition> {
  let rateMap = options.rateMap
  if (!rateMap) {
    try {
      const rates = await database.all<{ currency: string; rateToUsd: number }>(
        sql`SELECT currency, rate_to_usd AS rateToUsd FROM exchange_rates`
      )
      rateMap = buildRateMap((rates ?? []).map(r => ({ currency: r.currency, rateToUsd: Number(r.rateToUsd) })))
    } catch {
      rateMap = buildRateMap([])
    }
  }
  const rates = rateMap
  const nzd = (amount: number, currency: string | null): number => toNzd(amount, currency ?? 'NZD', rates)

  const [cashRow, settingsRow, reservesRow, burnRow, projectRow, mrrRow] = await Promise.all([
    readCash(database, nzd),
    readSettings(database),
    readReserves(database, nzd),
    readCommitmentBurn(database, nzd),
    readProjectRunRate(database, nzd),
    readRetainerMrr(database, nzd),
  ])

  // Burn precedence, identical to the finance page's reserve card:
  //   1. the operator's manual override (finance.monthlyBurnNzd)
  //   2. the sum of active recurring commitments
  //   3. revenue x 0.5, the last-ditch proxy for a studio with no commitments
  //      configured at all
  const effectiveRevenueNzd = mrrRow + projectRow
  const recurringBurnNzd = settingsRow.burnOverrideNzd > 0
    ? settingsRow.burnOverrideNzd
    : burnRow > 0
      ? burnRow
      : (effectiveRevenueNzd > 0 ? effectiveRevenueNzd * 0.5 : 0)

  return derivePosition({
    totalCashNzd: cashRow,
    taxOwedNzd: settingsRow.taxOwedNzd,
    taxPotNzd: reservesRow.taxPotNzd,
    otherReservesNzd: reservesRow.otherReservesNzd,
    recurringBurnNzd,
    projectRunRateNzd: projectRow,
    retainerMrrNzd: mrrRow,
  })
}

type ToNzd = (amount: number, currency: string | null) => number

async function readCash(database: D1, nzd: ToNzd): Promise<number> {
  try {
    let airwallex: Array<{ currency: string | null; availableBalance: number }> = []
    try {
      airwallex = await database.select().from(schema.airwallexBalances)
    } catch {
      // Airwallex table not migrated here; Xero fills every currency instead.
    }
    let xero: Array<{ currency: string | null; balance: number }> = []
    try {
      xero = await database.select().from(schema.xeroBankBalances)
    } catch {
      // No Xero balances either; total stays at whatever Airwallex reported.
    }
    return aggregateCashNzd(airwallex, xero, (amount, currency) => nzd(amount, currency))
  } catch {
    return 0
  }
}

async function readSettings(database: D1): Promise<{ taxOwedNzd: number; burnOverrideNzd: number }> {
  try {
    const rows = await database.all<{ key: string; value: string }>(sql`
      SELECT key, value FROM settings
      WHERE key IN (${TAX_OWED_SETTING_KEY}, ${BURN_OVERRIDE_SETTING_KEY})
    `)
    const map = new Map((rows ?? []).map(r => [r.key, r.value]))
    return {
      taxOwedNzd: parseFloat(map.get(TAX_OWED_SETTING_KEY) ?? '0') || 0,
      burnOverrideNzd: parseFloat(map.get(BURN_OVERRIDE_SETTING_KEY) ?? '0') || 0,
    }
  } catch {
    return { taxOwedNzd: 0, burnOverrideNzd: 0 }
  }
}

async function readReserves(database: D1, nzd: ToNzd): Promise<{ taxPotNzd: number; otherReservesNzd: number }> {
  try {
    const rows = await database.all<{ category: string; accruedAmount: number; currency: string | null }>(sql`
      SELECT category, accrued_amount AS accruedAmount, currency
      FROM reserves
      WHERE active = 1
    `)
    let taxPotNzd = 0
    let otherReservesNzd = 0
    for (const r of rows ?? []) {
      const amount = nzd(Number(r.accruedAmount ?? 0), r.currency)
      if (r.category === 'tax') taxPotNzd += amount
      else otherReservesNzd += amount
    }
    return { taxPotNzd, otherReservesNzd }
  } catch {
    return { taxPotNzd: 0, otherReservesNzd: 0 }
  }
}

async function readCommitmentBurn(database: D1, nzd: ToNzd): Promise<number> {
  try {
    const rows = await database.all<{ amount: number; currency: string | null; cadence: string }>(sql`
      SELECT amount, currency, cadence
      FROM expense_commitments
      WHERE active = 1
        AND (start_date IS NULL OR start_date <= datetime('now'))
        AND (end_date IS NULL OR end_date >= datetime('now'))
    `)
    return (rows ?? []).reduce(
      (sum, r) => sum + nzd(cadenceToMonthlyNzd(r.cadence, Number(r.amount ?? 0)), r.currency),
      0,
    )
  } catch {
    return 0
  }
}

/**
 * Trailing five months of non-retainer invoiced revenue, per month.
 *
 * invoices.project_id is effectively never set in production (neither the
 * Stripe nor the Xero import populates it), so "project" means "invoiced to an
 * org that carries no custom MRR". Retainer clients drop out; one-off clients
 * count. Converted per invoice so a GBP deliverable is not read as NZD.
 */
async function readProjectRunRate(database: D1, nzd: ToNzd): Promise<number> {
  try {
    const rows = await database.all<{ amount: number; currency: string | null }>(sql`
      SELECT i.total_usd AS amount, i.currency AS currency
      FROM invoices i
      LEFT JOIN organisations o ON o.id = i.org_id
      WHERE i.paid_at IS NOT NULL
        AND i.paid_at > datetime('now', '-150 days')
        AND (o.custom_mrr IS NULL OR o.custom_mrr = 0)
    `)
    const total = (rows ?? []).reduce((sum, r) => sum + nzd(Number(r.amount ?? 0), r.currency), 0)
    return total / 5
  } catch {
    return 0
  }
}

async function readRetainerMrr(database: D1, nzd: ToNzd): Promise<number> {
  try {
    const rows = await database.all<{ mrr: number; currency: string | null }>(sql`
      SELECT custom_mrr AS mrr,
             COALESCE(NULLIF(custom_mrr_currency, 'NZD'), preferred_currency, 'NZD') AS currency
      FROM organisations
      WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0
    `)
    return (rows ?? []).reduce((sum, r) => sum + nzd(Number(r.mrr ?? 0), r.currency), 0)
  } catch {
    return 0
  }
}
