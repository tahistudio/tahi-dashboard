/**
 * pipeline-math.ts — single source of truth for pipeline value math.
 *
 * Decision #040 (2026-04-21): all pipeline / weighted forecast math routes
 * through this module so KPIs never disagree across pages.
 *
 * Rules:
 *  - Point estimate: use `deal.valueNzd ?? deal.value ?? 0` (midpoint when
 *    range is set, single value otherwise).
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

export interface DealForMath {
  value?: number | null
  valueNzd?: number | null
  valueMin?: number | null
  valueMax?: number | null
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
 * Returns the point estimate used for all totals and weighted math.
 * When a range is set, this is the midpoint. When a single value is set,
 * this is that value. Zero if nothing is set.
 */
export function pointEstimate(deal: DealForMath): number {
  // valueNzd is pre-computed on write and is the canonical figure for
  // cross-currency aggregation. Fall back to `value` only when valueNzd
  // is missing (legacy rows).
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
  totalValue: number
  weightedValue: number
  openDealCount: number
  wonCount: number
  lostCount: number
  avgDealSize: number
  winRate: number
}

/**
 * THE canonical pipeline totals calculator. Every page that shows
 * pipeline value / weighted forecast must use this.
 */
export function calculatePipelineTotals(
  deals: DealForMath[],
  stages?: StageForMath[],
): PipelineTotals {
  let totalValue = 0
  let weightedValue = 0
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
    const val = pointEstimate(deal)
    const prob = effectiveProbability(deal, stages)
    totalValue += val
    weightedValue += val * (prob / 100)
    openDealCount++
  }

  const closedCount = wonCount + lostCount
  const winRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0
  const avgDealSize = openDealCount > 0 ? Math.round(totalValue / openDealCount) : 0

  return {
    totalValue: Math.round(totalValue),
    weightedValue: Math.round(weightedValue),
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
