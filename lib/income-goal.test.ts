import { describe, it, expect } from 'vitest'
import {
  computeIncomeGoal,
  monthlyTargetFromAnnual,
  roundCents,
  sumItemsNzd,
  INCOME_GOAL_SEGMENTS,
  type IncomeGoalInput,
} from './income-goal'
import { buildRateMap } from './currency'

// rateToUsd: 1 USD = 1.6 NZD means NZD row 1.6, USD row 1. EUR 0.8 per USD.
const RATES = [
  { currency: 'USD', rateToUsd: 1 },
  { currency: 'NZD', rateToUsd: 1.6 },
  { currency: 'EUR', rateToUsd: 0.8 },
]

function input(over: Partial<IncomeGoalInput> = {}): IncomeGoalInput {
  return {
    targetMonthlyNzd: 10000,
    paid: [],
    invoiced: [],
    unbilled: [],
    pipeline: [],
    rates: RATES,
    ...over,
  }
}

describe('monthlyTargetFromAnnual', () => {
  it('is the combined annual take-home over twelve', () => {
    expect(monthlyTargetFromAnnual(64000, 64000)).toBe(10666.67)
  })
  it('ignores missing, negative and non-finite values', () => {
    expect(monthlyTargetFromAnnual(null, 64000)).toBe(5333.33)
    expect(monthlyTargetFromAnnual(-1, undefined)).toBe(0)
    expect(monthlyTargetFromAnnual(Number.NaN, 12000)).toBe(1000)
  })
})

describe('roundCents', () => {
  it('rounds to two places and survives non-finite', () => {
    expect(roundCents(1.005)).toBe(1.01)
    expect(roundCents(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('sumItemsNzd', () => {
  const rateMap = buildRateMap(RATES)
  it('passes NZD through and treats blank currency as USD (the column default)', () => {
    // 50 USD = 80 NZD, 25 USD = 40 NZD
    expect(sumItemsNzd([{ amount: 100, currency: 'NZD' }, { amount: 50, currency: '' }, { amount: 25, currency: null }], rateMap))
      .toEqual({ nzd: 220, skipped: 0 })
  })
  it('converts through the existing FX helpers', () => {
    // 100 USD = 160 NZD; 80 EUR = 100 USD = 160 NZD
    expect(sumItemsNzd([{ amount: 100, currency: 'USD' }, { amount: 80, currency: 'eur' }], rateMap).nzd).toBe(320)
  })
  it('skips and counts a currency with no rate rather than passing it through', () => {
    expect(sumItemsNzd([{ amount: 1000, currency: 'JPY' }, { amount: 10, currency: 'NZD' }], rateMap))
      .toEqual({ nzd: 10, skipped: 1 })
  })
  it('skips missing and non-finite amounts', () => {
    expect(sumItemsNzd([{ amount: null, currency: 'NZD' }, { amount: Number.NaN, currency: 'NZD' }, { amount: 5, currency: 'NZD' }], rateMap))
      .toEqual({ nzd: 5, skipped: 2 })
  })
  it('nets negatives and floors the bucket at zero', () => {
    expect(sumItemsNzd([{ amount: 100, currency: 'NZD' }, { amount: -30, currency: 'NZD' }], rateMap).nzd).toBe(70)
    expect(sumItemsNzd([{ amount: -30, currency: 'NZD' }], rateMap).nzd).toBe(0)
  })
})

describe('computeIncomeGoal', () => {
  it('adds the four segments and reports the gap', () => {
    const r = computeIncomeGoal(input({
      paid: [{ amount: 4000, currency: 'NZD' }],
      invoiced: [{ amount: 100, currency: 'USD' }],
      unbilled: [{ amount: 500, currency: 'NZD' }],
      pipeline: [{ amount: 1000, currency: 'NZD' }],
    }))
    expect(r.paidNzd).toBe(4000)
    expect(r.committedNzd).toBe(4660)
    expect(r.projectedNzd).toBe(5660)
    expect(r.remainingToReceiveNzd).toBe(6000)
    expect(r.gapNzd).toBe(4340)
    expect(r.overByNzd).toBe(0)
    expect(r.paidMeetsTarget).toBe(false)
    expect(r.projectedMeetsTarget).toBe(false)
    expect(r.segments.map(s => s.key)).toEqual(['paid', 'invoiced', 'unbilled', 'pipeline'])
    expect(r.segments[0].pctOfTarget).toBe(40)
  })

  it('bar widths sum to the share of the target when under target', () => {
    const r = computeIncomeGoal(input({ paid: [{ amount: 5000, currency: 'NZD' }] }))
    expect(r.segments[0].barPct).toBe(50)
  })

  it('over target: shows the overshoot and scales the bar to the projected total', () => {
    const r = computeIncomeGoal(input({
      paid: [{ amount: 9000, currency: 'NZD' }],
      invoiced: [{ amount: 3000, currency: 'NZD' }],
    }))
    expect(r.projectedNzd).toBe(12000)
    expect(r.overByNzd).toBe(2000)
    expect(r.gapNzd).toBe(0)
    expect(r.projectedMeetsTarget).toBe(true)
    expect(r.paidMeetsTarget).toBe(false)
    expect(r.segments[0].barPct).toBe(75)
    expect(r.segments[1].barPct).toBe(25)
    expect(r.segments[0].pctOfTarget).toBe(90)
  })

  it('paid alone can meet the target', () => {
    const r = computeIncomeGoal(input({ paid: [{ amount: 10000, currency: 'NZD' }] }))
    expect(r.paidMeetsTarget).toBe(true)
    expect(r.remainingToReceiveNzd).toBe(0)
  })

  it('zero or missing target: no percentages, no gap, no division by zero', () => {
    for (const target of [0, null, undefined, -5, Number.NaN]) {
      const r = computeIncomeGoal(input({ targetMonthlyNzd: target, paid: [{ amount: 1000, currency: 'NZD' }] }))
      expect(r.hasTarget).toBe(false)
      expect(r.targetNzd).toBe(0)
      expect(r.gapNzd).toBe(0)
      expect(r.overByNzd).toBe(0)
      expect(r.projectedMeetsTarget).toBe(false)
      expect(r.segments[0].pctOfTarget).toBeNull()
      expect(r.segments[0].barPct).toBe(100)
    }
  })

  it('an empty month is all zeros, not NaN', () => {
    const r = computeIncomeGoal(input())
    expect(r.projectedNzd).toBe(0)
    expect(r.gapNzd).toBe(10000)
    expect(r.segments.every(s => s.nzd === 0 && s.barPct === 0)).toBe(true)
  })

  it('counts unconverted items per segment and in total', () => {
    const r = computeIncomeGoal(input({
      invoiced: [{ amount: 5, currency: 'XXX' }, { amount: Number.NaN, currency: 'NZD' }],
      unbilled: [{ amount: 1, currency: 'YYY' }],
    }))
    expect(r.segments[1].unconvertedCount).toBe(2)
    expect(r.segments[2].unconvertedCount).toBe(1)
    expect(r.unconvertedCount).toBe(3)
    expect(r.projectedNzd).toBe(0)
  })

  it('with no exchange rates loaded, NZD still works and foreign amounts are skipped', () => {
    const r = computeIncomeGoal(input({
      rates: [],
      paid: [{ amount: 100, currency: 'NZD' }, { amount: 100, currency: 'USD' }],
    }))
    expect(r.paidNzd).toBe(100)
    expect(r.unconvertedCount).toBe(1)
  })

  it('negative buckets never pull the total backwards', () => {
    const r = computeIncomeGoal(input({
      paid: [{ amount: 1000, currency: 'NZD' }],
      invoiced: [{ amount: -400, currency: 'NZD' }],
    }))
    expect(r.projectedNzd).toBe(1000)
  })

  it('rounds to cents so the parts add up to the whole', () => {
    const r = computeIncomeGoal(input({
      paid: [{ amount: 0.1, currency: 'NZD' }, { amount: 0.2, currency: 'NZD' }],
    }))
    expect(r.paidNzd).toBe(0.3)
  })
})

describe('INCOME_GOAL_SEGMENTS', () => {
  it('defines every segment in words without dashes', () => {
    for (const seg of Object.values(INCOME_GOAL_SEGMENTS)) {
      expect(seg.label.length).toBeGreaterThan(0)
      expect(seg.definition).not.toMatch(/[–—]|--/)
    }
  })
})
