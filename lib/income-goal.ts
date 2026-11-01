/**
 * income-goal.ts: the arithmetic behind the overview "Income goal" bar (LP.7).
 *
 * Pure on purpose: no database, no clock, no fetch. The route gathers the raw
 * rows and this module turns them into the five numbers on the bar, so every
 * rounding, conversion and edge case lives in one tested place.
 *
 * Currency. Every figure is expressed in NZD, the studio base currency
 * (Decision #028, BASE_CURRENCY in lib/currency.ts). Native-currency amounts
 * are converted with the same buildRateMap / toNzd pair the finance summary
 * uses. The one deliberate difference from toNzd: a currency with no rate in
 * the table is NOT passed through unconverted (toNzd would treat 1,000 EUR as
 * 1,000 NZD). It is left out of the segment and counted in `unconvertedCount`
 * so the card can say so. A wrong-looking money number is worse than a short
 * one with a note.
 *
 * Segments (the plain-words definitions live in INCOME_GOAL_SEGMENTS so the
 * card and the tests read the same text):
 *   paid      invoices marked paid in Xero or Stripe this month (not bank cash)
 *   invoiced  unpaid invoices issued this month
 *   unbilled  logged billable hours not yet on an invoice
 *   pipeline  open deals expected to close this month or overdue, weighted
 *
 * Unpaid invoices issued BEFORE the month are reported separately as
 * olderOutstandingNzd and are never part of projected or the gap.
 *
 * The invoice buckets never overlap by construction
 * (lib/income-goal-invoices.ts: paid needs a paid status, invoiced needs an
 * owed status and no paid date). Unbilled time can overlap Invoiced if hours
 * were billed by hand without the invoiced stamp; see the unbilled definition.
 *
 * Period. The month is a UTC calendar month, the same convention as the
 * finance summary route.
 *
 * GST. Which amount is used per invoice (ex-GST for NZD) is decided before
 * this module, in lib/income-goal-invoices.ts.
 */

import { buildRateMap, toNzd, type ExchangeRate, type RateMap } from '@/lib/currency'

export type IncomeGoalSegmentKey = 'paid' | 'invoiced' | 'unbilled' | 'pipeline'

/** One native-currency amount, as it sits in the database. */
export interface MoneyItem {
  amount: number | null | undefined
  /** ISO code. Blank or missing is read as NZD, the base currency. */
  currency: string | null | undefined
}

export interface IncomeGoalInput {
  /** The monthly target in NZD (annual combined take-home / 12). */
  targetMonthlyNzd: number | null | undefined
  paid: readonly MoneyItem[]
  invoiced: readonly MoneyItem[]
  unbilled: readonly MoneyItem[]
  pipeline: readonly MoneyItem[]
  /** Unpaid invoices issued before the month. Reported, never added to the bar. */
  olderOutstanding?: readonly MoneyItem[]
  /** Rows of the exchange_rates table. */
  rates: readonly ExchangeRate[]
}

export interface IncomeGoalSegment {
  key: IncomeGoalSegmentKey
  /** NZD, rounded to cents, never negative. */
  nzd: number
  /** Items skipped: non-finite amount, or a currency with no exchange rate. */
  unconvertedCount: number
  /** Share of the target, 0 to many (over 100 is possible). Null when the target is not set. */
  pctOfTarget: number | null
  /** Bar width as a percent of the bar, 0 to 100. Segments sum to at most 100. */
  barPct: number
}

export interface IncomeGoalResult {
  targetNzd: number
  hasTarget: boolean
  segments: IncomeGoalSegment[]
  /** paid, to the cent. */
  paidNzd: number
  /** paid + invoiced + unbilled: money earned or owed, excluding forecast. */
  committedNzd: number
  /** paid + invoiced + unbilled + pipeline. */
  projectedNzd: number
  /** target minus paid, floored at 0: what is still to be received this month. */
  remainingToReceiveNzd: number
  /** target minus projected, floored at 0: the shortfall even if everything is paid. */
  gapNzd: number
  /** projected minus target, floored at 0. */
  overByNzd: number
  /** True when paid alone already meets a set target. */
  paidMeetsTarget: boolean
  /** True when projected is at or above a set target. */
  projectedMeetsTarget: boolean
  /** Total skipped items across segments and the older outstanding total. */
  unconvertedCount: number
  /** Unpaid invoices issued before the month. Outside projected and gap. */
  olderOutstandingNzd: number
}

/** The wording on the card. One place, so UI and tests agree. */
export const INCOME_GOAL_SEGMENTS: Record<IncomeGoalSegmentKey, { label: string; definition: string }> = {
  paid: {
    label: 'Paid',
    definition:
      'Invoices marked paid in Xero or Stripe this month, in NZD and without GST. This follows the invoice records, not the bank, so it can differ from Airwallex.',
  },
  invoiced: {
    label: 'Invoiced',
    definition:
      'Invoices issued this month that are not marked paid yet, in NZD and without GST. Older unpaid invoices are listed separately below and are not in this bar.',
  },
  unbilled: {
    label: 'Unbilled',
    definition:
      'Billable hours logged this month for hourly clients that are not on an invoice yet, at the entry rate or the client default rate. Hours with no rate are left out. If hours were billed by hand in Xero without being marked as invoiced here, they can also appear under Invoiced, so this can double count.',
  },
  pipeline: {
    label: 'Pipeline',
    definition:
      'Open deals expected to close this month, plus open deals whose close date passed in the last 90 days: upfront value times the stage win chance. A forecast, not money. Deals with no close date or more than 90 days overdue are left out, and monthly recurring value is not counted.',
  },
}

const SEGMENT_ORDER: IncomeGoalSegmentKey[] = ['paid', 'invoiced', 'unbilled', 'pipeline']

/** A deal this many days past its expected close date is stale and not counted. */
export const PIPELINE_STALE_DAYS = 90

/**
 * Where an open deal sits for a month.
 *   'in'     expected to close inside the month.
 *   'rolled' close date has passed (within the stale limit) and the requested
 *            month is the current one, so it counts now. Only ever for the
 *            current month: any other month counts only deals dated inside it.
 *   'stale'  close date more than PIPELINE_STALE_DAYS before today. Not counted;
 *            the card lists how many so their dates can be updated.
 *   'out'    no or unreadable close date, or a later month.
 * Dates are YYYY-MM-DD (a longer ISO string is cut to its date). `todayDate`
 * is today's UTC date.
 */
export function pipelineDealPlacement(
  expectedCloseDate: string | null | undefined,
  monthStartDate: string,
  monthEndDate: string,
  opts: { isCurrentMonth: boolean; todayDate: string },
): 'in' | 'rolled' | 'stale' | 'out' {
  const d = typeof expectedCloseDate === 'string' ? expectedCloseDate.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'out'
  if (d >= monthEndDate) return 'out'
  if (d >= monthStartDate) return 'in'
  if (!opts.isCurrentMonth) return 'out'
  const today = Date.parse(`${opts.todayDate}T00:00:00.000Z`)
  const closed = Date.parse(`${d}T00:00:00.000Z`)
  if (Number.isNaN(today) || Number.isNaN(closed)) return 'out'
  const daysPast = Math.floor((today - closed) / 86_400_000)
  return daysPast > PIPELINE_STALE_DAYS ? 'stale' : 'rolled'
}

export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0
  // Number.EPSILON nudges 1.005 style halves the right way.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function cleanTarget(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return roundCents(value)
}

/**
 * Sum one bucket in NZD. This helper itself nets any negative item against the
 * positives and floors the bucket at zero. Invoice rows never arrive negative:
 * lib/income-goal-invoices.ts floors each row at zero first, so a credit note
 * simply contributes nothing.
 */
export function sumItemsNzd(
  items: readonly MoneyItem[],
  rateMap: RateMap,
): { nzd: number; skipped: number } {
  let total = 0
  let skipped = 0
  for (const item of items) {
    const amount = item.amount
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      skipped++
      continue
    }
    const raw = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : ''
    const currency = raw === '' ? 'NZD' : raw
    if (currency !== 'NZD') {
      const rate = rateMap[currency]
      if (!rate || !Number.isFinite(rate) || rate <= 0) {
        skipped++
        continue
      }
    }
    total += toNzd(amount, currency, rateMap)
  }
  return { nzd: Math.max(0, roundCents(total)), skipped }
}

/** The monthly target from the two annual take-home settings. */
export function monthlyTargetFromAnnual(
  liamAnnual: number | null | undefined,
  staciAnnual: number | null | undefined,
): number {
  const clean = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  return roundCents((clean(liamAnnual) + clean(staciAnnual)) / 12)
}

export function computeIncomeGoal(input: IncomeGoalInput): IncomeGoalResult {
  const rateMap = buildRateMapQuiet(input.rates)
  const targetNzd = cleanTarget(input.targetMonthlyNzd)
  const hasTarget = targetNzd > 0

  const sums = SEGMENT_ORDER.map(key => ({ key, ...sumItemsNzd(input[key], rateMap) }))
  const older = sumItemsNzd(input.olderOutstanding ?? [], rateMap)
  const projectedNzd = roundCents(sums.reduce((a, s) => a + s.nzd, 0))
  const paidNzd = sums[0].nzd
  const committedNzd = roundCents(sums[0].nzd + sums[1].nzd + sums[2].nzd)

  // The bar is as wide as the larger of the target and the projected total, so
  // an over-target month shows the overshoot instead of clipping at 100%.
  const barScale = Math.max(targetNzd, projectedNzd)

  const segments: IncomeGoalSegment[] = sums.map(s => ({
    key: s.key,
    nzd: s.nzd,
    unconvertedCount: s.skipped,
    pctOfTarget: hasTarget ? Math.round((s.nzd / targetNzd) * 1000) / 10 : null,
    barPct: barScale > 0 ? Math.round((s.nzd / barScale) * 1000) / 10 : 0,
  }))

  return {
    targetNzd,
    hasTarget,
    segments,
    paidNzd,
    committedNzd,
    projectedNzd,
    remainingToReceiveNzd: hasTarget ? Math.max(0, roundCents(targetNzd - paidNzd)) : 0,
    gapNzd: hasTarget ? Math.max(0, roundCents(targetNzd - projectedNzd)) : 0,
    overByNzd: hasTarget ? Math.max(0, roundCents(projectedNzd - targetNzd)) : 0,
    paidMeetsTarget: hasTarget && paidNzd >= targetNzd,
    projectedMeetsTarget: hasTarget && projectedNzd >= targetNzd,
    unconvertedCount: sums.reduce((a, s) => a + s.skipped, 0) + older.skipped,
    olderOutstandingNzd: older.nzd,
  }
}

/**
 * buildRateMap logs a console warning when the NZD row is missing. The library
 * rule is no console in production code, so an empty table gets the identity
 * NZD map here and every foreign amount is reported as unconverted instead.
 */
function buildRateMapQuiet(rates: readonly ExchangeRate[]): RateMap {
  if (!rates.some(r => r.currency === 'NZD')) return { NZD: 1 }
  return buildRateMap([...rates])
}
