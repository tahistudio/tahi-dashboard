/**
 * Project calculator types — single source of truth for the JSON shape
 * stored on `project_calculations.inputs` and `.outputs`.
 *
 * The math lives in `./compute.ts`. Anything that needs to render a calc
 * (UI, MCP tool, future PDF export) reads these types and trusts them.
 */

export type ProjectType = 'one_off' | 'retainer' | 'project_plus_retainer'
export type RetainerPlan = 'maintain' | 'scale' | 'tune' | 'launch' | 'custom'
export type ClientRelationship = 'cold' | 'warm' | 'returning'
export type Currency = 'NZD' | 'USD' | 'GBP' | 'AUD' | 'EUR'

/**
 * Inputs the operator types into the calculator. Stored verbatim so we
 * can re-render the form filled-in when re-opening a saved calc.
 */
export interface CalculationInputs {
  projectType: ProjectType
  scope: {
    estimatedDevHours: number
    estimatedDesignHours: number
    estimatedStrategyHours: number
    contractorHours: number      // 0 if no contractor used
    contractorRate: number       // $/hr in `client.currency`
    toolLicenceCost: number      // one-off or per-project tools
  }
  timeline: {
    startDate: string            // ISO date — drives capacity check window
    durationWeeks: number
    targetLaunchDate: string     // ISO date — informational, may differ from start+duration
  }
  retainer: {
    monthlyHours: number         // 0 if not retainer
    durationMonths: number       // expected retainer length
    plan: RetainerPlan
  }
  client: {
    currency: Currency
    complexityMultiplier: number // 0.7 (simple) → 1.5 (very complex)
    relationship: ClientRelationship
    isReturning: boolean         // applies the 10% lifetime discount
  }
  // Operator notes captured alongside the inputs.
  notes: string
}

export interface CalculationOutputs {
  cost: {
    direct: number               // contractor + tool licences
    internal: number             // (devH + designH + strategyH) * effective hourly rate
    total: number
  }
  recommendation: {
    floor: number                // total cost + minimum margin (covers risk)
    target: number               // what to actually quote
    stretch: number              // aspirational ceiling
    targetMarginPct: number      // target / cost - 1
  }
  capacity: {
    requiredHoursThisQuarter: number
    availableHoursThisQuarter: number
    warning: 'over_capacity' | 'tight' | 'comfortable'
    note: string
  }
  benchmarks: {
    similarDeals: Array<{
      dealId: string
      title: string
      value: number
      currency: string
      closedAt: string | null
    }>
    medianValueForSimilar: number | null
    yourPriceVsMedian: 'above' | 'in_line' | 'below' | 'no_benchmark'
  }
  pacing: {
    asProjectPlusRetainer: {
      projectFee: number
      monthlyFee: number
      twelveMonthLifetimeValue: number
    } | null
  }
  // Hourly rate the math used. Surfaced so operators can sanity-check.
  effectiveHourlyRate: number
}

/**
 * Constants used by the math. Tuned to Tahi's actual cost-of-services
 * numbers (Services & Pricing doc, March 2026 audit). Update via PR
 * when the doc updates.
 */
export const CALC_CONSTANTS = {
  /** Effective internal hourly rate (NZD). Includes salary + opex + tools. */
  effectiveHourlyRateNZD: 95,
  /** Margin floor: this much above cost or we're losing money on risk. */
  marginFloorPct: 0.20,
  /** Target margin: where Tahi normally lands. */
  marginTargetPct: 0.45,
  /** Stretch margin: aspirational ceiling (used for premium clients). */
  marginStretchPct: 0.65,
  /** Returning-client lifetime discount per Sales Strategy doc. */
  returningClientDiscountPct: 0.10,
  /** Capacity assumption: hours per FT team member per week. */
  capacityHoursPerWeek: 32,
  /** Number of FT team members on the build side (Liam + Staci). */
  buildTeamSize: 2,
} as const
