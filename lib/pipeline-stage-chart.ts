/**
 * lib/pipeline-stage-chart.ts - the grouping and ordering maths behind the
 * stage chart on the owner overview's "Pipeline ahead" card.
 *
 * Kept out of the component so it can be unit tested, and kept deliberately
 * in step with the forecast route (app/api/admin/reports/pipeline-forecast),
 * which applies exactly this rule:
 *
 *   weighted upfront = ROUND(SUM(upfrontValueNzd) * stage.probability / 100)
 *   weighted monthly = ROUND(SUM(monthlyValueNzd) * stage.probability / 100)
 *   weighted total   = weighted upfront + weighted monthly * RECURRING_MONTHS
 *
 * with closed-won and closed-lost stages excluded (realised, not forecast).
 * Reproducing the same formula here means the bars add up to the weighted
 * headline the card already shows above them, deal for deal.
 *
 * Money is read from the *Nzd columns ONLY. A deal is stored in its own
 * currency with an NZD conversion alongside, so summing the raw `value`
 * columns across a mixed-currency pipeline would add dollars to pounds.
 *
 * Stage ORDER is not on the deal rows (GET /api/admin/deals joins the stage
 * name and probability but not its position), so the caller passes the
 * ordered stage list the forecast route already returns as `byStage`.
 */

/** A deal as GET /api/admin/deals returns it, narrowed to what the chart reads. */
export interface PipelineChartDeal {
  id: string
  stageId: string | null
  stageName: string | null
  /** 0 to 100, joined from the deal's pipeline stage. */
  stageProbability: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  upfrontValueNzd: number | null
  monthlyValueNzd: number | null
}

/** Pipeline order, as the forecast route returns it in `byStage`. */
export interface PipelineChartStageOrder {
  stageId: string
  position: number
}

export interface PipelineStageBar {
  stageId: string
  /** Stage name as shown on the pipeline board. */
  name: string
  dealCount: number
  /** Weighted value of the stage in NZD (upfront + monthly * RECURRING_MONTHS). */
  weightedNzd: number
  /** 0 to 100, the bar's length against the longest bar in the chart. */
  pct: number
}

export interface PipelineStageChart {
  /** Open stages holding at least one deal, in pipeline order. */
  bars: PipelineStageBar[]
  totalWeightedNzd: number
  totalDeals: number
  /** What the bar lengths encode. Falls back to deal count when the whole
   *  open pipeline is valued at zero, so the shape is still readable. */
  basis: 'value' | 'count'
}

/** Months of retainer counted into a deal's weighted value. Matches the
 *  12-month rollup the Pipeline ahead headline uses. */
export const RECURRING_MONTHS = 12

/** Shortest bar drawn for a stage that holds pipeline, so a small stage is
 *  still visible next to a dominant one. */
const MIN_VISIBLE_PCT = 6

/** Bucket for deals whose stage did not come back on the row (deleted stage,
 *  or a join that produced no name). Sorted last, never silently dropped. */
const UNKNOWN_STAGE_ID = '__unknown_stage__'
const UNKNOWN_STAGE_NAME = 'Unassigned stage'

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

interface StageAccumulator {
  stageId: string
  name: string
  dealCount: number
  upfrontNzd: number
  monthlyNzd: number
  probability: number
  position: number
  firstSeen: number
}

/**
 * Groups open deals into one bar per pipeline stage, in pipeline order.
 *
 * @param deals       rows from GET /api/admin/deals (closed stages ignored)
 * @param stageOrder  `byStage` from the pipeline-forecast route; supplies the
 *                    board's stage order. Stages missing from it sort last.
 * @param recurringMonths months of retainer counted into weighted value.
 */
export function buildPipelineStageChart(
  deals: readonly PipelineChartDeal[] | null | undefined,
  stageOrder: readonly PipelineChartStageOrder[] | null | undefined,
  recurringMonths: number = RECURRING_MONTHS,
): PipelineStageChart {
  const positions = new Map<string, number>()
  for (const stage of stageOrder ?? []) {
    if (!stage || typeof stage.stageId !== 'string') continue
    if (!Number.isFinite(stage.position)) continue
    positions.set(stage.stageId, stage.position)
  }

  const groups = new Map<string, StageAccumulator>()
  let seen = 0

  for (const deal of deals ?? []) {
    if (!deal) continue
    // Closed-won and closed-lost are realised, not ahead of us.
    if (deal.stageIsClosedWon || deal.stageIsClosedLost) continue

    const name = deal.stageName?.trim()
    const key = deal.stageId ?? (name ? `name:${name}` : UNKNOWN_STAGE_ID)
    let group = groups.get(key)
    if (!group) {
      group = {
        stageId: key,
        name: name || UNKNOWN_STAGE_NAME,
        dealCount: 0,
        upfrontNzd: 0,
        monthlyNzd: 0,
        probability: 0,
        // A stage the order list does not know about sorts after every known
        // stage, keeping the pipeline reading top to bottom as on the board.
        position: (deal.stageId != null ? positions.get(deal.stageId) : undefined) ?? Number.MAX_SAFE_INTEGER,
        firstSeen: seen++,
      }
      groups.set(key, group)
    }
    group.dealCount += 1
    group.upfrontNzd += finite(deal.upfrontValueNzd)
    group.monthlyNzd += finite(deal.monthlyValueNzd)
    // Every deal in a stage carries the same joined probability; take the
    // first one that is usable and clamp it to the 0 to 100 the column holds.
    if (group.probability === 0) {
      group.probability = Math.min(100, Math.max(0, finite(deal.stageProbability)))
    }
  }

  const months = Number.isFinite(recurringMonths) ? Math.max(0, recurringMonths) : RECURRING_MONTHS

  const ordered = [...groups.values()].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.firstSeen - b.firstSeen,
  )

  const weighted = ordered.map(group => {
    const upfront = Math.round(group.upfrontNzd * (group.probability / 100))
    const monthly = Math.round(group.monthlyNzd * (group.probability / 100))
    return Math.max(0, upfront + monthly * months)
  })

  const basis: 'value' | 'count' = weighted.some(value => value > 0) ? 'value' : 'count'
  const metrics = ordered.map((group, i) => (basis === 'value' ? weighted[i] : group.dealCount))
  const peak = metrics.reduce((max, value) => Math.max(max, value), 0)

  const bars: PipelineStageBar[] = ordered.map((group, i) => ({
    stageId: group.stageId,
    name: group.name,
    dealCount: group.dealCount,
    weightedNzd: weighted[i],
    pct:
      peak <= 0 || metrics[i] <= 0
        ? 0
        : Math.max(MIN_VISIBLE_PCT, Math.round((metrics[i] / peak) * 100)),
  }))

  return {
    bars,
    totalWeightedNzd: weighted.reduce((sum, value) => sum + value, 0),
    totalDeals: bars.reduce((sum, bar) => sum + bar.dealCount, 0),
    basis,
  }
}
