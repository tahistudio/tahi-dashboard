/**
 * pipeline-math.ts — single source of truth for pipeline value math.
 *
 * Decision #040 (2026-04-21): all pipeline / weighted forecast math routes
 * through this module so KPIs never disagree across pages.
 *
 * Rules:
 *  - Point estimate: prefer the split-value model (upfront + monthly × horizon)
 *    when either upfrontValue or monthlyValue is set; fall back to the legacy
 *    single `valueNzd` / `value` otherwise. Migration 0023 backfills both
 *    so this only applies to deals predating the migration.
 *  - Recurring start resolution: explicit `recurringStartDate` first, then
 *    `engagementEndDate`, then `closedAt`, then `expectedCloseDate`, then
 *    the supplied refDate. Used for month-counting in the horizon window.
 *  - Weighted probability: prefer `stage.historicalProbability` (actual
 *    close rate) when set, fall back to `stage.probability` (static
 *    config), fall back to 0.
 *  - Open deals: exclude any deal on a stage where `isClosedWon` or
 *    `isClosedLost` is true.
 *  - Range display: show `valueMin–valueMax` when both are set, otherwise
 *    the single value. Never show the range in totals — totals always
 *    use the point estimate.
 *
 * Any page that wants a total should call `calculatePipelineTotals` and
 * use the fields it returns. Do NOT reimplement the math inline.
 */

/** Default horizon (months) for pipeline forecast totals when the caller
 *  does not pass an explicit value. Configurable via the
 *  `pipeline.forecastHorizonMonths` setting; the API endpoints read that
 *  setting and pass it through to this module. */
export const DEFAULT_FORECAST_HORIZON_MONTHS = 12

export interface DealForMath {
  value?: number | null
  valueNzd?: number | null
  valueMin?: number | null
  valueMax?: number | null
  /** One-time / project portion (added in migration 0023). */
  upfrontValue?: number | null
  upfrontValueNzd?: number | null
  /** Recurring / retainer portion in monthly units (added in migration 0023). */
  monthlyValue?: number | null
  monthlyValueNzd?: number | null
  /** Optional explicit start date for the recurring portion. */
  recurringStartDate?: string | null
  /** Project end (used as recurring-start fallback when no explicit date). */
  engagementEndDate?: string | null
  /** Deal close timestamps used as further recurring-start fallbacks. */
  closedAt?: string | null
  expectedCloseDate?: string | null
  stageId: string
  /** Static stage probability denormalised onto the deal row. */
  stageProbability?: number | null
  stageIsClosedWon?: boolean | number | null
  stageIsClosedLost?: boolean | number | null
}

export interface StageForMath {
  id: string
  probability: number | null
  historicalProbability?: number | null
  isClosedWon?: boolean | number | null
  isClosedLost?: boolean | number | null
}

/**
 * Difference between two ISO dates / Date instances in whole months.
 * Negative if `to` is before `from`.
 */
export function monthsBetween(from: Date | string, to: Date | string): number {
  const a = typeof from === 'string' ? new Date(from) : from
  const b = typeof to === 'string' ? new Date(to) : to
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

/**
 * Resolve when the recurring portion of a deal starts. Walks the fallback
 * chain: explicit recurringStartDate → engagementEndDate → closedAt →
 * expectedCloseDate → refDate (today by default).
 */
export function resolveRecurringStart(
  deal: DealForMath,
  refDate: Date = new Date(),
): Date {
  const candidate =
    deal.recurringStartDate ??
    deal.engagementEndDate ??
    deal.closedAt ??
    deal.expectedCloseDate
  if (candidate) {
    const d = new Date(candidate)
    if (!isNaN(d.getTime())) return d
  }
  return refDate
}

/**
 * How many months of recurring revenue fall inside the forecast horizon
 * starting from refDate. Zero when monthlyValue is unset or the recurring
 * starts after the horizon ends.
 */
export function monthsRecurringInHorizon(
  deal: DealForMath,
  horizonMonths: number = DEFAULT_FORECAST_HORIZON_MONTHS,
  refDate: Date = new Date(),
): number {
  if (!deal.monthlyValue && !deal.monthlyValueNzd) return 0
  const start = resolveRecurringStart(deal, refDate)
  const monthsToStart = Math.max(0, monthsBetween(refDate, start))
  return Math.max(0, horizonMonths - monthsToStart)
}

/**
 * Monthly recurring revenue contribution from this deal in NZD. Just the
 * monthly_value_nzd column, with monthly_value as a fallback for legacy
 * rows where currency conversion hadn't run yet.
 */
export function dealMrr(deal: DealForMath): number {
  return deal.monthlyValueNzd ?? deal.monthlyValue ?? 0
}

/**
 * The upfront / one-time portion of a deal in NZD.
 */
export function dealUpfront(deal: DealForMath): number {
  return deal.upfrontValueNzd ?? deal.upfrontValue ?? 0
}

/**
 * Has this deal been migrated to the split-value model? True when either
 * upfront or monthly is non-null. False for legacy rows where only `value`
 * was set and migration 0023 hasn't run yet.
 */
function hasSplitValues(deal: DealForMath): boolean {
  return (
    deal.upfrontValue != null ||
    deal.upfrontValueNzd != null ||
    deal.monthlyValue != null ||
    deal.monthlyValueNzd != null
  )
}

/**
 * Returns the point estimate used for all totals and weighted math.
 *
 * When the deal has been migrated to the split model: upfront + monthly ×
 * monthsInHorizon (clipped to the configured horizon, with recurring-start
 * resolution).
 *
 * When the deal predates the migration: legacy `valueNzd` / `value`.
 */
export function pointEstimate(
  deal: DealForMath,
  opts: { horizonMonths?: number; refDate?: Date } = {},
): number {
  if (hasSplitValues(deal)) {
    const horizon = opts.horizonMonths ?? DEFAULT_FORECAST_HORIZON_MONTHS
    const refDate = opts.refDate ?? new Date()
    const monthsRecurring = monthsRecurringInHorizon(deal, horizon, refDate)
    return dealUpfront(deal) + dealMrr(deal) * monthsRecurring
  }
  // Legacy fallback: valueNzd was the canonical cross-currency figure.
  return deal.valueNzd ?? deal.value ?? 0
}

/**
 * Returns the effective probability for a deal. Prefers historical close
 * rate on the stage when available, falls back to the static stage
 * probability, falls back to 0.
 *
 * Pass either a list of stages (will look up by id) or a direct stage
 * record. If no stage info is supplied, falls back to the denormalised
 * `stageProbability` on the deal itself.
 */
export function effectiveProbability(
  deal: DealForMath,
  stages?: StageForMath[] | StageForMath | null,
): number {
  let stage: StageForMath | undefined | null
  if (Array.isArray(stages)) {
    stage = stages.find(s => s.id === deal.stageId)
  } else if (stages) {
    stage = stages
  }

  if (stage?.historicalProbability != null) return stage.historicalProbability
  if (stage?.probability != null) return stage.probability
  return deal.stageProbability ?? 0
}

export function isOpenDeal(deal: DealForMath): boolean {
  return !deal.stageIsClosedWon && !deal.stageIsClosedLost
}

export function isWonDeal(deal: DealForMath): boolean {
  return !!deal.stageIsClosedWon
}

export function isLostDeal(deal: DealForMath): boolean {
  return !!deal.stageIsClosedLost
}

export interface PipelineTotals {
  /** Sum of each open deal's point estimate (split-model: upfront + monthly × horizon).
   *  This is the "headline" pipeline number — total value over the horizon. */
  totalValue: number
  /** Total value × stage probability (the weighted forecast). */
  weightedValue: number
  /** Sum of monthly_value across all open deals — pipeline MRR if everything closed. */
  totalMrr: number
  /** Pipeline MRR × stage probability — weighted forecast for monthly recurring. */
  weightedMrr: number
  /** Sum of upfront_value across all open deals. */
  totalUpfront: number
  /** Total upfront × stage probability. */
  weightedUpfront: number
  openDealCount: number
  wonCount: number
  lostCount: number
  avgDealSize: number
  winRate: number
}

/**
 * THE canonical pipeline totals calculator. Every page that shows
 * pipeline value / weighted forecast must use this.
 *
 * Pass `horizonMonths` (from the `pipeline.forecastHorizonMonths` setting)
 * to scale the recurring-portion contribution. Defaults to 12.
 */
export function calculatePipelineTotals(
  deals: DealForMath[],
  stages?: StageForMath[],
  opts: { horizonMonths?: number; refDate?: Date } = {},
): PipelineTotals {
  const horizonMonths = opts.horizonMonths ?? DEFAULT_FORECAST_HORIZON_MONTHS
  const refDate = opts.refDate ?? new Date()

  let totalValue = 0
  let weightedValue = 0
  let totalMrr = 0
  let weightedMrr = 0
  let totalUpfront = 0
  let weightedUpfront = 0
  let openDealCount = 0
  let wonCount = 0
  let lostCount = 0

  for (const deal of deals) {
    if (isWonDeal(deal)) {
      wonCount++
      continue
    }
    if (isLostDeal(deal)) {
      lostCount++
      continue
    }
    const val = pointEstimate(deal, { horizonMonths, refDate })
    const mrr = dealMrr(deal)
    const upfront = dealUpfront(deal)
    const prob = effectiveProbability(deal, stages)
    const probFraction = prob / 100

    totalValue += val
    weightedValue += val * probFraction
    totalMrr += mrr
    weightedMrr += mrr * probFraction
    totalUpfront += upfront
    weightedUpfront += upfront * probFraction
    openDealCount++
  }

  const closedCount = wonCount + lostCount
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0
  const avgDealSize = openDealCount > 0 ? Math.round(totalValue / openDealCount) : 0

  return {
    totalValue: Math.round(totalValue),
    weightedValue: Math.round(weightedValue),
    totalMrr: Math.round(totalMrr),
    weightedMrr: Math.round(weightedMrr),
    totalUpfront: Math.round(totalUpfront),
    weightedUpfront: Math.round(weightedUpfront),
    openDealCount,
    wonCount,
    lostCount,
    avgDealSize,
    winRate,
  }
}

/**
 * Returns the "confidence" of a deal's value estimate as a number in
 * [0, 1] where 1 = totally confident (no range, or range width 0), and
 * 0 = extremely uncertain (range width >= 100% of midpoint).
 *
 * null means "no range set" — the caller can treat that as confident OR
 * as "we don't know how confident" depending on context.
 */
export function rangeConfidence(deal: DealForMath): number | null {
  const min = deal.valueMin
  const max = deal.valueMax
  if (min == null || max == null) return null
  const midpoint = (min + max) / 2
  if (midpoint <= 0) return null
  const width = Math.max(0, max - min)
  const ratio = width / midpoint
  // ratio 0 → 1.0, ratio 1+ → 0.0
  return Math.max(0, Math.min(1, 1 - ratio))
}

export type RangeConfidenceLevel = 'tight' | 'rough' | 'speculative' | 'unknown'

export function rangeConfidenceLevel(deal: DealForMath): RangeConfidenceLevel {
  const c = rangeConfidence(deal)
  if (c == null) return 'unknown'
  if (c >= 0.8) return 'tight'
  if (c >= 0.5) return 'rough'
  return 'speculative'
}

/**
 * Format a deal's value for display. Returns a string like "$10k–$15k"
 * when a range is set, or "$12.5k" otherwise.
 *
 * Caller is responsible for currency conversion — we just format the
 * numbers that come in.
 */
export function formatDealValue(
  deal: Pick<DealForMath, 'value' | 'valueMin' | 'valueMax'>,
  formatter: (n: number) => string,
): string {
  if (deal.valueMin != null && deal.valueMax != null && deal.valueMin !== deal.valueMax) {
    return `${formatter(deal.valueMin)}\u2013${formatter(deal.valueMax)}`
  }
  return formatter(deal.value ?? 0)
}

/**
 * Format a split-model deal as "$10k + $2k/mo", "$10k", or "$2k/mo"
 * depending on which sides are set. When a range is on the upfront,
 * shows "$8k\u2013$12k + $2k/mo".
 *
 * Caller passes `formatter` which handles currency \u2014 we only know about
 * the numbers. Returns "\u2014" when both sides are zero/null.
 */
export function formatDealValueSplit(
  deal: Pick<
    DealForMath,
    'upfrontValue' | 'upfrontValueNzd' | 'monthlyValue' | 'monthlyValueNzd' | 'valueMin' | 'valueMax' | 'value' | 'valueNzd'
  >,
  formatter: (n: number) => string,
): string {
  // Pre-migration deals: fall back to the legacy single-value formatter.
  const splitSet =
    deal.upfrontValue != null ||
    deal.upfrontValueNzd != null ||
    deal.monthlyValue != null ||
    deal.monthlyValueNzd != null
  if (!splitSet) {
    return formatDealValue(
      { value: deal.value, valueMin: deal.valueMin, valueMax: deal.valueMax },
      formatter,
    )
  }

  const upfront = deal.upfrontValueNzd ?? deal.upfrontValue ?? 0
  const monthly = deal.monthlyValueNzd ?? deal.monthlyValue ?? 0
  const hasUpfrontRange =
    deal.valueMin != null && deal.valueMax != null && deal.valueMin !== deal.valueMax

  const upfrontLabel = upfront > 0 || hasUpfrontRange
    ? hasUpfrontRange
      ? `${formatter(deal.valueMin ?? 0)}\u2013${formatter(deal.valueMax ?? 0)}`
      : formatter(upfront)
    : null
  const monthlyLabel = monthly > 0 ? `${formatter(monthly)}/mo` : null

  if (upfrontLabel && monthlyLabel) return `${upfrontLabel} + ${monthlyLabel}`
  if (upfrontLabel) return upfrontLabel
  if (monthlyLabel) return monthlyLabel
  return '\u2014'
}
