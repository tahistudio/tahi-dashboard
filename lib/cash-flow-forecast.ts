/**
 * Monthly assembly for GET /api/admin/reports/cash-flow-forecast.
 *
 * Pulled out of the route so the shape (and the three revenue components) can
 * be unit tested without a live D1. The route owns the queries; this owns the
 * arithmetic.
 *
 * The forecast used to count retainer MRR and weighted pipeline as the whole of
 * revenue, which made every month negative for a studio that was actually in
 * surplus: about two thirds of what Tahi invoices is project work that never
 * appears as MRR. revenueProject carries the trailing run-rate flat across the
 * window so the ribbon shows the full picture.
 */

import { toNzd, type RateMap } from '@/lib/currency'
import { resolveRecurringStart, type DealForMath } from '@/lib/pipeline-math'

export interface PipelineCashFlowDeal extends Pick<DealForMath,
  'value' | 'valueNzd' | 'upfrontValue' | 'upfrontValueNzd' | 'monthlyValue' | 'monthlyValueNzd'
  | 'recurringStartDate' | 'engagementEndDate' | 'closedAt' | 'expectedCloseDate'
> {
  currency: string | null
  probability: number | null
}

export const PIPELINE_CASH_FLOW_BASIS = 'Weighted upfront at expected close; monthly from recurring start. '
  + 'Overdue closes land in the current month. '
  + 'Undated closes spread evenly across the forecast window.'

/**
 * Pipeline cash receipts use the split amounts, never the annualised value.
 * A missing close date means each forecast month is equally likely to close:
 * upfront is spread evenly and recurring accumulates as those closes occur.
 */
export function projectPipelineByMonth(
  deals: readonly PipelineCashFlowDeal[],
  monthKeys: readonly string[],
  rateMap: RateMap,
): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(monthKeys.map(month => [month, 0]))
  if (monthKeys.length === 0) return result

  for (const deal of deals) {
    const split = deal.upfrontValue != null || deal.upfrontValueNzd != null
      || deal.monthlyValue != null || deal.monthlyValueNzd != null
    const currency = deal.currency ?? 'NZD'
    const upfront = split
      ? deal.upfrontValueNzd ?? toNzd(deal.upfrontValue ?? 0, currency, rateMap)
      : deal.valueNzd ?? toNzd(deal.value ?? 0, currency, rateMap)
    const monthly = split
      ? deal.monthlyValueNzd ?? toNzd(deal.monthlyValue ?? 0, currency, rateMap)
      : 0
    const probability = (deal.probability ?? 50) / 100
    const expectedCloseMonth = deal.expectedCloseDate?.slice(0, 7)
    // Open deals with an overdue close are still prospective receipts. Bring
    // their close into the current month without backfilling recurring arrears.
    const closeMonth = expectedCloseMonth && expectedCloseMonth < monthKeys[0]
      ? monthKeys[0]
      : expectedCloseMonth
    const hasRecurringDate = deal.recurringStartDate || deal.engagementEndDate || deal.closedAt || deal.expectedCloseDate
    const recurringMonth = hasRecurringDate
      ? resolveRecurringStart({ ...deal, stageId: '' }, new Date(`${monthKeys[0]}-01T00:00:00.000Z`)).toISOString().slice(0, 7)
      : null

    for (const [index, month] of monthKeys.entries()) {
      if (closeMonth === month) result[month] += upfront * probability
      else if (!closeMonth) result[month] += upfront * probability / monthKeys.length

      if (!closeMonth) {
        if (!recurringMonth || month >= recurringMonth) {
          result[month] += monthly * probability * (index + 1) / monthKeys.length
        }
      } else if (recurringMonth) {
        // A deal cannot generate receipts before its expected close, even if
        // an older recurring start date remains on the row.
        if (month >= recurringMonth && (!closeMonth || month >= closeMonth)) result[month] += monthly * probability
      }
    }
  }
  return result
}

export interface ForecastMonth {
  month: string
  /** Active retainers billing in this month, NZD. */
  revenueRetainer: number
  /** Trailing project run-rate, flat across the window, NZD. */
  revenueProject: number
  /** Weighted upfront receipts and recurring pipeline revenue, NZD. */
  revenuePipeline: number
  /** The three above, summed. */
  revenue: number
  cost: number
  net: number
  /** Running total of net across the window. */
  cumulative: number
}

export interface ForecastInput {
  monthKeys: string[]
  retainerByMonth: Record<string, number>
  pipelineByMonth: Record<string, number>
  costByMonth: Record<string, number>
  projectRunRateNzd: number
}

export function assembleForecastMonths(input: ForecastInput): ForecastMonth[] {
  let cumulative = 0
  return input.monthKeys.map(month => {
    const revenueRetainer = input.retainerByMonth[month] ?? 0
    const revenueProject = input.projectRunRateNzd
    const revenuePipeline = input.pipelineByMonth[month] ?? 0
    const revenue = revenueRetainer + revenueProject + revenuePipeline
    const cost = input.costByMonth[month] ?? 0
    const net = revenue - cost
    cumulative += net
    return { month, revenueRetainer, revenueProject, revenuePipeline, revenue, cost, net, cumulative }
  })
}
