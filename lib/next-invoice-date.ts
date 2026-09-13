/**
 * lib/next-invoice-date.ts
 *
 * The client home used to print "Next invoice: TBC" for any retainer whose
 * subscription row carries no currentPeriodEnd, which is the ordinary state
 * for a client billed through Xero rather than a Stripe subscription: Xero
 * owns the period, so nothing here ever writes that column back. TBC read as
 * an operational gap ("we don't know when you're billed") when the honest
 * answer was simply "not tracked as a date, but the cadence is known".
 *
 * Two ways out of TBC, in order:
 *   1. currentPeriodEnd is set (a real, specific date). Unaffected by this
 *      file; the caller uses it directly.
 *   2. currentPeriodStart plus a billing interval are both known. The cadence
 *      lets an actual expected date be projected forward from the last known
 *      period start, rolled forward past cycles it has already missed so the
 *      answer is always the NEXT upcoming bill, not one long past.
 * When neither is available, the caller falls back to naming the rail and
 * the cadence in prose ("Invoiced monthly through Xero") rather than TBC.
 *
 * Pure, so the projection is unit testable without a D1 handle or a system
 * clock (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

import { CYCLE_MONTHS, type BillingInterval } from '@/lib/billing'

/** Guards against a corrupt cycleMonths ever spinning the loop forever. */
const MAX_ROLL_FORWARD_CYCLES = 240

/**
 * Projects the next occurrence of a recurring billing date on or after `now`,
 * given the last known period start and a billing interval.
 *
 * Returns null when `periodStart` does not parse, since there is nothing to
 * project from: that is the "org has no known cadence" case, and the caller
 * is expected to fall back to prose rather than a fabricated date.
 */
export function projectNextInvoiceDate(
  periodStart: string | null | undefined,
  interval: BillingInterval | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!periodStart) return null
  const start = new Date(periodStart)
  if (Number.isNaN(start.getTime())) return null

  const cycleMonths = CYCLE_MONTHS[(interval as BillingInterval) ?? 'monthly'] ?? CYCLE_MONTHS.monthly

  const next = new Date(start.getTime())
  next.setUTCMonth(next.getUTCMonth() + cycleMonths)

  let cycles = 0
  while (next.getTime() < now.getTime() && cycles < MAX_ROLL_FORWARD_CYCLES) {
    next.setUTCMonth(next.getUTCMonth() + cycleMonths)
    cycles += 1
  }

  return next.toISOString()
}

/** Cadence word for the honest fallback sentence, e.g. "Invoiced monthly through Xero". */
export function cadenceWord(interval: BillingInterval | string | null | undefined): string {
  switch (interval) {
    case 'quarterly': return 'quarterly'
    case 'annual': return 'annually'
    default: return 'monthly'
  }
}
