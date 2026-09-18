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

export interface ForecastMonth {
  month: string
  /** Active retainers billing in this month, NZD. */
  revenueRetainer: number
  /** Trailing project run-rate, flat across the window, NZD. */
  revenueProject: number
  /** Weighted open deals expected to close in this month, NZD. */
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
