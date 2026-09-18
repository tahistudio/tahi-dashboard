/**
 * lib/pipeline-stage-chart.ts - the ordering and scaling maths behind the
 * stage chart on the owner overview's "Pipeline ahead" card, plus the
 * closing-this-month / past-close-date split for the same card's stat row.
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
 * so this file only orders the stages and scales the bars. Reading the bars
 * off the same response as the headline (rather than re-deriving them from
 * GET /api/admin/deals, which is access scoped, drops archived deals and
 * pages at 100 rows) is what lets the card render its headline as the sum
 * of the bars, not by two populations agreeing.
 *
 * Money is NZD throughout. The forecast route sums the *Nzd columns only, so a
 * mixed-currency pipeline converts before it adds rather than adding dollars to
 * pounds.
 *
 * Closed-won and closed-lost stages are dropped (realised, not ahead of us), as
 * are stages holding no deals.
 *
 * The headline used to roll `weightedMonthlyNzd` up over a 12-month window and
 * add it into `weightedUpfrontNzd`, so the card printed a number neither the
 * forecast API nor the deals page ever showed anywhere else (beta audit,
 * 2026-09-19: card read NZ$6.2k while the forecast reported weightedUpfrontNzd
 * 3230 and weightedMonthlyNzd 250). The bars now chart weightedUpfrontNzd only,
 * matching the forecast's own weightedUpfrontNzd total exactly; monthly value
 * is summed separately and shown beside the headline, never folded into it.
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
  /** Weighted upfront value of the stage in NZD. Bar length's basis. */
  weightedUpfrontNzd: number
  /** Weighted monthly (retainer) value of the stage in NZD. Carried for
   *  display, never rolled into the bar length or the headline. */
  weightedMonthlyNzd: number
  /** 0 to 100, the bar's length against the longest bar in the chart. */
  pct: number
  /** The stage holds deals but carries no weighted upfront value, so its bar
   *  is drawn at the minimum length and should be inked muted rather than
   *  coloured: bar length encodes money, and this stage has none yet. */
  unvalued: boolean
}

export interface PipelineStageChart {
  /** Open stages holding at least one deal, in pipeline order. */
  bars: PipelineStageBar[]
  /** Sum of the bars' weighted upfront value. Matches the forecast route's
   *  own `weightedUpfrontNzd` total exactly, since both sum the same
   *  per-stage figures over the same open stages. */
  totalWeightedUpfrontNzd: number
  /** Sum of the bars' weighted monthly value. Shown separately from the
   *  headline, e.g. "+ NZ$250 a month", never added into it. */
  totalWeightedMonthlyNzd: number
  totalDeals: number
  /** What the bar lengths encode. Falls back to deal count when the whole
   *  open pipeline has no upfront value priced yet, so the shape is still
   *  readable. */
  basis: 'value' | 'count'
}

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
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
}

/**
 * Turns the forecast's per-stage rows into one bar per open stage that holds
 * deals, in pipeline order.
 *
 * @param stages `byStage` from GET /api/admin/reports/pipeline-forecast
 */
export function buildPipelineStageChart(
  stages: readonly PipelineChartStage[] | null | undefined,
): PipelineStageChart {
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
      weightedUpfrontNzd: Math.max(0, finite(stage.weightedUpfrontNzd)),
      weightedMonthlyNzd: Math.max(0, finite(stage.weightedMonthlyNzd)),
    })
  })

  const ordered = open.sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.stageIndex - b.stageIndex,
  )

  const basis: 'value' | 'count' = ordered.some(stage => stage.weightedUpfrontNzd > 0) ? 'value' : 'count'
  const metrics = ordered.map(stage => (basis === 'value' ? stage.weightedUpfrontNzd : stage.dealCount))
  const peak = metrics.reduce((max, value) => Math.max(max, value), 0)

  const bars: PipelineStageBar[] = ordered.map((stage, i) => ({
    stageId: stage.stageId,
    name: stage.name,
    colour: stage.colour,
    stageIndex: stage.stageIndex,
    dealCount: stage.dealCount,
    weightedUpfrontNzd: stage.weightedUpfrontNzd,
    weightedMonthlyNzd: stage.weightedMonthlyNzd,
    // Every stage in the chart holds deals, so every stage gets a bar. One
    // with nothing priced yet is floored at the minimum and flagged, for
    // the caller to ink muted.
    pct:
      peak <= 0 || metrics[i] <= 0
        ? MIN_VISIBLE_PCT
        : Math.max(MIN_VISIBLE_PCT, Math.round((metrics[i] / peak) * 100)),
    unvalued: basis === 'value' && stage.weightedUpfrontNzd <= 0,
  }))

  return {
    bars,
    totalWeightedUpfrontNzd: bars.reduce((sum, bar) => sum + bar.weightedUpfrontNzd, 0),
    totalWeightedMonthlyNzd: bars.reduce((sum, bar) => sum + bar.weightedMonthlyNzd, 0),
    totalDeals: bars.reduce((sum, bar) => sum + bar.dealCount, 0),
    basis,
  }
}

/** A deal row, narrowed to what the closing split reads. */
export interface ClosingDealRow {
  stageIsClosedWon: number | null | boolean
  stageIsClosedLost: number | null | boolean
  expectedCloseDate: string | null
}

export interface ClosingSplit {
  /** Open deals whose expected close date is today or later, within the
   *  current calendar month. */
  closingThisMonth: number
  /** Open deals whose expected close date has already passed (any month, not
   *  only the current one), so an overdue deal never falls out of the count
   *  just because its close month has ended. */
  pastCloseDate: number
}

/**
 * Splits open deals into "closing this month" (expected close is today or
 * later, within the current month) and "past its close date" (expected close
 * has already passed, whatever month it fell in). A deal in neither bucket
 * simply is not due this month, so it stays silent on this card.
 *
 * Closed-won and closed-lost deals are dropped: they are realised, not ahead
 * of us, matching the stage chart above.
 *
 * Dates are compared as UTC calendar days (YYYY-MM-DD), not local wall-clock
 * time. `expectedCloseDate` is stored as a bare date string with no time
 * component, and the Worker this runs in is UTC, so comparing UTC calendar
 * days is what "today" means here and keeps this stable under a browser or
 * test runner in any other timezone.
 */
export function splitClosingDeals(
  deals: readonly ClosingDealRow[] | null | undefined,
  now: Date = new Date(),
): ClosingSplit {
  const todayKey = now.toISOString().slice(0, 10)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  let closingThisMonth = 0
  let pastCloseDate = 0

  for (const deal of deals ?? []) {
    if (!deal) continue
    if (deal.stageIsClosedWon || deal.stageIsClosedLost) continue
    if (!deal.expectedCloseDate) continue
    const close = new Date(deal.expectedCloseDate)
    if (Number.isNaN(close.getTime())) continue
    const closeKey = /^\d{4}-\d{2}-\d{2}/.test(deal.expectedCloseDate)
      ? deal.expectedCloseDate.slice(0, 10)
      : close.toISOString().slice(0, 10)

    if (closeKey < todayKey) {
      pastCloseDate++
      continue
    }
    if (close.getUTCFullYear() === year && close.getUTCMonth() === month) {
      closingThisMonth++
    }
  }

  return { closingThisMonth, pastCloseDate }
}
