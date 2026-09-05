/**
 * lib/pipeline-stage-chart.ts - the ordering and scaling maths behind the
 * stage chart on the owner overview's "Pipeline ahead" card.
 *
 * Kept out of the component so it can be unit tested.
 *
 * The rows this takes are `byStage` from GET /api/admin/reports/pipeline-forecast,
 * which is the same payload the card's weighted headline comes from. That route
 * has already done the weighting, per stage:
 *
 *   weighted upfront = ROUND(SUM(upfrontValueNzd) * stage.probability / 100)
 *   weighted monthly = ROUND(SUM(monthlyValueNzd) * stage.probability / 100)
 *
 * so this file only rolls the monthly portion up over RECURRING_MONTHS, orders
 * the stages, and scales the bars. Reading the bars off the same response as
 * the headline (rather than re-deriving them from GET /api/admin/deals, which
 * is access scoped, drops archived deals and pages at 100 rows) is what lets
 * the card render its headline as `totalWeightedNzd`: the number above the bars
 * is the sum of the bars by construction, not by two populations agreeing.
 *
 * Money is NZD throughout. The forecast route sums the *Nzd columns only, so a
 * mixed-currency pipeline converts before it adds rather than adding dollars to
 * pounds.
 *
 * Closed-won and closed-lost stages are dropped (realised, not ahead of us), as
 * are stages holding no deals.
 */

/** A stage as the pipeline-forecast route returns it in `byStage`, narrowed to
 *  what the chart reads. The route sends more fields (slug, probability, the
 *  unweighted sums); they are none of the chart's business. */
export interface PipelineChartStage {
  stageId: string
  name: string
  /** Board position. Ties fall back to the order the rows arrived in. */
  position: number
  /** The stage's own colour from pipeline settings, when one is set. */
  colour: string | null
  isClosedWon: boolean
  isClosedLost: boolean
  dealCount: number
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
}

export interface PipelineStageBar {
  stageId: string
  /** Stage name as shown on the pipeline board. */
  name: string
  /** The stage's own colour, or null to let the caller pick one. */
  colour: string | null
  /** The stage's index in the FULL ordered stage list, closed stages included.
   *  That is the index the pipeline board hands stageColour(), so a caller
   *  falling back to the shared palette lands on the board's colour. */
  stageIndex: number
  dealCount: number
  /** Weighted value of the stage in NZD (upfront + monthly * RECURRING_MONTHS). */
  weightedNzd: number
  /** 0 to 100, the bar's length against the longest bar in the chart. */
  pct: number
  /** The stage holds deals but carries no weighted value, so its bar is drawn
   *  at the minimum length and should be inked muted rather than coloured:
   *  bar length encodes money, and this stage has none yet. */
  unvalued: boolean
}

export interface PipelineStageChart {
  /** Open stages holding at least one deal, in pipeline order. */
  bars: PipelineStageBar[]
  /** Sum of the bars, which is the card's weighted headline. */
  totalWeightedNzd: number
  totalDeals: number
  /** What the bar lengths encode. Falls back to deal count when the whole
   *  open pipeline is valued at zero, so the shape is still readable. */
  basis: 'value' | 'count'
}

/** Months of retainer counted into a stage's weighted value. Matches the
 *  12-month rollup the Pipeline ahead headline uses. */
export const RECURRING_MONTHS = 12

/** Shortest bar drawn for a stage that holds pipeline, so a small stage stays
 *  visible next to a dominant one, and an unvalued stage still reads as a bar
 *  rather than as a track that failed to draw. */
const MIN_VISIBLE_PCT = 6

/** Shown when a stage row arrives with no usable name. */
const UNNAMED_STAGE = 'Unnamed stage'

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

interface OpenStage {
  stageId: string
  name: string
  colour: string | null
  stageIndex: number
  position: number
  dealCount: number
  weightedNzd: number
}

/**
 * Turns the forecast's per-stage rows into one bar per open stage that holds
 * deals, in pipeline order.
 *
 * @param stages          `byStage` from GET /api/admin/reports/pipeline-forecast
 * @param recurringMonths months of retainer counted into weighted value
 */
export function buildPipelineStageChart(
  stages: readonly PipelineChartStage[] | null | undefined,
  recurringMonths: number = RECURRING_MONTHS,
): PipelineStageChart {
  const months = Number.isFinite(recurringMonths) ? Math.max(0, recurringMonths) : RECURRING_MONTHS

  const open: OpenStage[] = []
  ;(stages ?? []).forEach((stage, stageIndex) => {
    if (!stage || typeof stage.stageId !== 'string') return
    // Closed-won and closed-lost are realised, not ahead of us.
    if (stage.isClosedWon || stage.isClosedLost) return
    const dealCount = Math.max(0, Math.round(finite(stage.dealCount)))
    if (dealCount === 0) return
    const name = typeof stage.name === 'string' && stage.name.trim() ? stage.name.trim() : UNNAMED_STAGE
    open.push({
      stageId: stage.stageId,
      name,
      colour: typeof stage.colour === 'string' && stage.colour.trim() ? stage.colour.trim() : null,
      stageIndex,
      // A row with no usable position sorts after every positioned stage
      // rather than jumping to the top of the board's order.
      position: Number.isFinite(stage.position) ? stage.position : Number.MAX_SAFE_INTEGER,
      dealCount,
      weightedNzd: Math.max(
        0,
        finite(stage.weightedUpfrontNzd) + finite(stage.weightedMonthlyNzd) * months,
      ),
    })
  })

  const ordered = open.sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.stageIndex - b.stageIndex,
  )

  const basis: 'value' | 'count' = ordered.some(stage => stage.weightedNzd > 0) ? 'value' : 'count'
  const metrics = ordered.map(stage => (basis === 'value' ? stage.weightedNzd : stage.dealCount))
  const peak = metrics.reduce((max, value) => Math.max(max, value), 0)

  const bars: PipelineStageBar[] = ordered.map((stage, i) => ({
    stageId: stage.stageId,
    name: stage.name,
    colour: stage.colour,
    stageIndex: stage.stageIndex,
    dealCount: stage.dealCount,
    weightedNzd: stage.weightedNzd,
    // Every stage in the chart holds deals, so every stage gets a bar. One
    // with nothing weighted yet is floored at the minimum and flagged, for
    // the caller to ink muted.
    pct:
      peak <= 0 || metrics[i] <= 0
        ? MIN_VISIBLE_PCT
        : Math.max(MIN_VISIBLE_PCT, Math.round((metrics[i] / peak) * 100)),
    unvalued: basis === 'value' && stage.weightedNzd <= 0,
  }))

  return {
    bars,
    totalWeightedNzd: bars.reduce((sum, bar) => sum + bar.weightedNzd, 0),
    totalDeals: bars.reduce((sum, bar) => sum + bar.dealCount, 0),
    basis,
  }
}
