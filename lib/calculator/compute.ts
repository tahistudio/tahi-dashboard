/**
 * Project calculator math.
 *
 * Pure functions that take CalculationInputs + a context bundle (booked
 * hours, similar deals) and return CalculationOutputs. Server-side only,
 * but no DB access here — the route handler loads context first and
 * passes it in.
 */
import type {
  CalculationInputs,
  CalculationOutputs,
} from './types'
import { CALC_CONSTANTS } from './types'

const FX_TO_NZD: Record<string, number> = {
  NZD: 1,
  USD: 1.65,
  GBP: 2.05,
  AUD: 1.10,
  EUR: 1.80,
}

interface SimilarDeal {
  dealId: string
  title: string
  value: number
  currency: string
  closedAt: string | null
}

interface ComputeContext {
  /** Booked hours per week between [now, startDate + durationWeeks]. */
  bookedHoursInWindow: number
  /** Similar prior deals (won, similar scope) for benchmarking. */
  similarDeals: SimilarDeal[]
}

/**
 * Convert a value in any currency to NZD using static FX rates. The
 * exchange_rates table has live rates; we use a static fallback here
 * so the math doesn't break if the rate cache is stale.
 */
function toNZD(value: number, currency: string): number {
  const rate = FX_TO_NZD[currency] ?? 1
  return value * rate
}

function fromNZD(valueNZD: number, currency: string): number {
  const rate = FX_TO_NZD[currency] ?? 1
  return valueNZD / rate
}

/**
 * Median of a number list. Returns null on empty. Used to benchmark
 * a calc's recommended price against the median of comparable won deals.
 */
function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function compute(
  inputs: CalculationInputs,
  ctx: ComputeContext,
): CalculationOutputs {
  const { scope, timeline, retainer, client } = inputs
  const { complexityMultiplier, currency, isReturning } = client

  // ── Cost ─────────────────────────────────────────────────────────
  // Each scope line is delivered either by the team (priced at the
  // effective internal hourly rate in NZD) or by a contractor (priced
  // at the line's contractorRate in client currency, converted to
  // NZD). Both paths apply the complexity multiplier on hours.
  const lines = [scope.webflow, scope.engineering, scope.design, scope.strategy]

  let internalCostNZD = 0
  let directCostNZD = 0

  for (const line of lines) {
    const hoursAdjusted = line.hours * complexityMultiplier
    if (line.delivery === 'ourselves') {
      internalCostNZD += hoursAdjusted * CALC_CONSTANTS.effectiveHourlyRateNZD
    } else {
      const lineCostClient = hoursAdjusted * line.contractorRate
      directCostNZD += toNZD(lineCostClient, currency)
    }
  }

  directCostNZD += toNZD(scope.toolLicenceCost, currency)
  const totalCostNZD = directCostNZD + internalCostNZD

  // ── Recommendation: floor / target / stretch in client currency ─
  const floorNZD = totalCostNZD * (1 + CALC_CONSTANTS.marginFloorPct)
  let targetNZD = totalCostNZD * (1 + CALC_CONSTANTS.marginTargetPct)
  const stretchNZD = totalCostNZD * (1 + CALC_CONSTANTS.marginStretchPct)

  // Returning clients earn the 10% lifetime discount per Sales Strategy.
  if (isReturning) {
    targetNZD = targetNZD * (1 - CALC_CONSTANTS.returningClientDiscountPct)
  }

  const targetMarginPct = totalCostNZD > 0
    ? (targetNZD / totalCostNZD) - 1
    : 0

  // ── Capacity check ──────────────────────────────────────────────
  // Required hours = the scope lines we deliver ourselves. Contractor
  // lines don't compete for internal capacity.
  const requiredInternalHours = lines
    .filter(l => l.delivery === 'ourselves')
    .reduce((s, l) => s + l.hours, 0)

  const weeksInWindow = Math.max(1, timeline.durationWeeks)
  const availableHoursInWindow = CALC_CONSTANTS.capacityHoursPerWeek
    * CALC_CONSTANTS.buildTeamSize
    * weeksInWindow
  const remainingAfterBooked = availableHoursInWindow - ctx.bookedHoursInWindow

  let capacityWarning: CalculationOutputs['capacity']['warning']
  let capacityNote: string
  const headroom = remainingAfterBooked - requiredInternalHours
  // Slack threshold scales with scope: a 200-hour project with 10
  // hours of headroom is just as tight as a 50-hour project with 2
  // hours. Use 15% of required hours OR 8h × weeks, whichever is
  // higher, as the floor for "comfortable".
  const slackFloor = Math.max(weeksInWindow * 8, requiredInternalHours * 0.15)

  if (headroom < 0) {
    capacityWarning = 'over_capacity'
    capacityNote = `Adding this work tips us ${Math.round(-headroom)} hours over capacity in the start window. Push start by 1-2 weeks, lengthen duration, or bring in a contractor.`
  } else if (headroom < slackFloor) {
    capacityWarning = 'tight'
    capacityNote = `${Math.round(headroom)} hours of slack across the window for ${Math.round(requiredInternalHours)} hours of work. Doable, but no room for surprises.`
  } else {
    capacityWarning = 'comfortable'
    capacityNote = `${Math.round(headroom)} hours of slack across the window for ${Math.round(requiredInternalHours)} hours of work. Plenty of room to absorb scope creep.`
  }

  // ── Benchmarks ──────────────────────────────────────────────────
  const similarValuesInNZD = ctx.similarDeals
    .map(d => toNZD(d.value, d.currency))
    .filter(v => v > 0)
  const medianNZD = median(similarValuesInNZD)
  const medianInClientCcy = medianNZD === null ? null : fromNZD(medianNZD, currency)

  let yourPriceVsMedian: CalculationOutputs['benchmarks']['yourPriceVsMedian']
  if (medianInClientCcy === null) {
    yourPriceVsMedian = 'no_benchmark'
  } else {
    const targetClient = fromNZD(targetNZD, currency)
    const ratio = targetClient / medianInClientCcy
    if (ratio > 1.15) yourPriceVsMedian = 'above'
    else if (ratio < 0.85) yourPriceVsMedian = 'below'
    else yourPriceVsMedian = 'in_line'
  }

  // ── Pacing: project + retainer split ────────────────────────────
  let pacingValue: CalculationOutputs['pacing']['asProjectPlusRetainer'] = null
  if (inputs.projectType === 'project_plus_retainer' && retainer.monthlyHours > 0) {
    const monthlyRetainerNZD = retainer.monthlyHours
      * CALC_CONSTANTS.effectiveHourlyRateNZD
      * (1 + CALC_CONSTANTS.marginTargetPct)
    const lifetimeNZD = (targetNZD * 1.0) + (monthlyRetainerNZD * 12)
    pacingValue = {
      projectFee: Math.round(fromNZD(targetNZD, currency)),
      monthlyFee: Math.round(fromNZD(monthlyRetainerNZD, currency)),
      twelveMonthLifetimeValue: Math.round(fromNZD(lifetimeNZD, currency)),
    }
  }

  // ── Final assembly — convert NZD-internal numbers back to ccy ──
  return {
    cost: {
      direct: Math.round(fromNZD(directCostNZD, currency)),
      internal: Math.round(fromNZD(internalCostNZD, currency)),
      total: Math.round(fromNZD(totalCostNZD, currency)),
    },
    recommendation: {
      floor: Math.round(fromNZD(floorNZD, currency)),
      target: Math.round(fromNZD(targetNZD, currency)),
      stretch: Math.round(fromNZD(stretchNZD, currency)),
      targetMarginPct: Math.round(targetMarginPct * 100) / 100,
    },
    capacity: {
      requiredHoursThisQuarter: Math.round(requiredInternalHours),
      availableHoursThisQuarter: Math.round(remainingAfterBooked),
      warning: capacityWarning,
      note: capacityNote,
    },
    benchmarks: {
      similarDeals: ctx.similarDeals.slice(0, 5),
      medianValueForSimilar: medianInClientCcy === null ? null : Math.round(medianInClientCcy),
      yourPriceVsMedian,
    },
    pacing: { asProjectPlusRetainer: pacingValue },
    effectiveHourlyRate: CALC_CONSTANTS.effectiveHourlyRateNZD,
  }
}
