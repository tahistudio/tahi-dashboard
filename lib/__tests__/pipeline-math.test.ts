/**
 * pipeline-math invariants.
 *
 * Regression guard for the weighted-forecast mismatch (2026-04-21): the
 * overview page and the pipeline page were computing different weighted
 * values because one used static stage probability and the other used
 * historical close rate. Every totals path now routes through
 * `calculatePipelineTotals` so the numbers agree everywhere.
 */

import { describe, it, expect } from 'vitest'
import {
  pointEstimate,
  effectiveProbability,
  calculatePipelineTotals,
  rangeConfidence,
  rangeConfidenceLevel,
  formatDealValue,
  type DealForMath,
  type StageForMath,
} from '../pipeline-math'

const STAGES: StageForMath[] = [
  { id: 'lead',     probability: 10, historicalProbability: 5,    isClosedWon: false, isClosedLost: false },
  { id: 'discovery', probability: 25, historicalProbability: 12, isClosedWon: false, isClosedLost: false },
  { id: 'proposal', probability: 50, historicalProbability: null, isClosedWon: false, isClosedLost: false },
  { id: 'won',      probability: 100, historicalProbability: null, isClosedWon: true,  isClosedLost: false },
  { id: 'lost',     probability: 0,   historicalProbability: null, isClosedWon: false, isClosedLost: true },
]

describe('pointEstimate', () => {
  it('prefers valueNzd when set', () => {
    expect(pointEstimate({ stageId: 'x', valueNzd: 5000, value: 3000 })).toBe(5000)
  })
  it('falls back to value when valueNzd missing', () => {
    expect(pointEstimate({ stageId: 'x', value: 3000 })).toBe(3000)
  })
  it('returns 0 when nothing set', () => {
    expect(pointEstimate({ stageId: 'x' })).toBe(0)
  })
  it('treats null valueNzd as missing', () => {
    expect(pointEstimate({ stageId: 'x', valueNzd: null, value: 100 })).toBe(100)
  })
})

describe('effectiveProbability', () => {
  it('prefers historical probability when set', () => {
    const deal: DealForMath = { stageId: 'discovery', stageProbability: 99 }
    expect(effectiveProbability(deal, STAGES)).toBe(12)
  })
  it('falls back to stage static when historical null', () => {
    const deal: DealForMath = { stageId: 'proposal', stageProbability: 99 }
    expect(effectiveProbability(deal, STAGES)).toBe(50)
  })
  it('falls back to denormalised stageProbability when stage list missing', () => {
    const deal: DealForMath = { stageId: 'x', stageProbability: 42 }
    expect(effectiveProbability(deal)).toBe(42)
  })
  it('returns 0 when nothing is known', () => {
    const deal: DealForMath = { stageId: 'x' }
    expect(effectiveProbability(deal)).toBe(0)
  })
  it('accepts a single stage record directly', () => {
    const deal: DealForMath = { stageId: 'discovery' }
    expect(effectiveProbability(deal, STAGES[1])).toBe(12)
  })
})

describe('calculatePipelineTotals', () => {
  const openDeals: DealForMath[] = [
    { stageId: 'discovery', valueNzd: 10000, stageIsClosedWon: false, stageIsClosedLost: false },
    { stageId: 'proposal',  valueNzd: 20000, stageIsClosedWon: false, stageIsClosedLost: false },
  ]

  it('sums point estimates across open deals only', () => {
    const totals = calculatePipelineTotals(openDeals, STAGES)
    expect(totals.totalValue).toBe(30000)
    expect(totals.openDealCount).toBe(2)
  })

  it('uses historical probability when available (not static)', () => {
    // discovery: 10000 * 0.12 = 1200
    // proposal: 20000 * 0.50 = 10000 (historical null → static 50)
    const totals = calculatePipelineTotals(openDeals, STAGES)
    expect(totals.weightedValue).toBe(11200)
  })

  it('excludes closed-won and closed-lost from totals', () => {
    const deals: DealForMath[] = [
      ...openDeals,
      { stageId: 'won',  valueNzd: 50000, stageIsClosedWon: true },
      { stageId: 'lost', valueNzd: 99999, stageIsClosedLost: true },
    ]
    const totals = calculatePipelineTotals(deals, STAGES)
    expect(totals.totalValue).toBe(30000) // won/lost not in pipeline
    expect(totals.wonCount).toBe(1)
    expect(totals.lostCount).toBe(1)
    expect(totals.winRate).toBe(50)
  })

  it('returns zero totals for empty list', () => {
    const totals = calculatePipelineTotals([], STAGES)
    expect(totals.totalValue).toBe(0)
    expect(totals.weightedValue).toBe(0)
    expect(totals.openDealCount).toBe(0)
    expect(totals.avgDealSize).toBe(0)
    expect(totals.winRate).toBe(0)
  })

  it('falls back to static probability when no historical and no stages passed', () => {
    const deals: DealForMath[] = [
      { stageId: 's1', valueNzd: 10000, stageProbability: 30, stageIsClosedWon: false, stageIsClosedLost: false },
    ]
    const totals = calculatePipelineTotals(deals) // no stages arg
    expect(totals.weightedValue).toBe(3000)
  })

  it('reproduces the exact overview-vs-pipeline discrepancy scenario', () => {
    // The bug: a deal on a stage where historical is much lower than
    // static, the two pages previously disagreed. They must agree now.
    const deal: DealForMath = {
      stageId: 'discovery',
      valueNzd: 100000,
      stageProbability: 25,
      stageIsClosedWon: false,
      stageIsClosedLost: false,
    }
    const totals = calculatePipelineTotals([deal], STAGES)
    // Historical for discovery is 12 -> 12000. Not 25000.
    expect(totals.weightedValue).toBe(12000)
  })
})

describe('rangeConfidence', () => {
  it('returns null when no range set', () => {
    expect(rangeConfidence({ stageId: 'x', valueMin: null, valueMax: null })).toBeNull()
  })
  it('returns 1.0 for a zero-width range (min == max)', () => {
    expect(rangeConfidence({ stageId: 'x', valueMin: 10000, valueMax: 10000 })).toBe(1)
  })
  it('returns ~0.8 for a 20% range', () => {
    // min=9000, max=11000, midpoint=10000, width=2000, ratio=0.2 → 0.8
    const c = rangeConfidence({ stageId: 'x', valueMin: 9000, valueMax: 11000 })
    expect(c).toBeCloseTo(0.8, 2)
  })
  it('returns 0 for a range wider than midpoint', () => {
    // min=5000, max=20000, midpoint=12500, width=15000, ratio=1.2 → 0 (clamped)
    const c = rangeConfidence({ stageId: 'x', valueMin: 5000, valueMax: 20000 })
    expect(c).toBe(0)
  })
})

describe('rangeConfidenceLevel', () => {
  it('tight for small range', () => {
    expect(rangeConfidenceLevel({ stageId: 'x', valueMin: 9500, valueMax: 10500 })).toBe('tight')
  })
  it('rough for medium range', () => {
    // min=8, max=12, mid=10, width=4, ratio=0.4 → conf=0.6 → rough
    expect(rangeConfidenceLevel({ stageId: 'x', valueMin: 8000, valueMax: 12000 })).toBe('rough')
  })
  it('speculative for wide range', () => {
    expect(rangeConfidenceLevel({ stageId: 'x', valueMin: 5000, valueMax: 20000 })).toBe('speculative')
  })
  it('unknown when no range set', () => {
    expect(rangeConfidenceLevel({ stageId: 'x', value: 10000 })).toBe('unknown')
  })
})

describe('formatDealValue', () => {
  const fmt = (n: number) => `$${(n / 1000).toFixed(0)}k`

  it('formats range when min and max differ', () => {
    expect(formatDealValue({ value: 12500, valueMin: 10000, valueMax: 15000 }, fmt)).toBe('$10k\u2013$15k')
  })
  it('formats single value when range is missing', () => {
    expect(formatDealValue({ value: 10000 }, fmt)).toBe('$10k')
  })
  it('formats single value when min == max', () => {
    expect(formatDealValue({ value: 10000, valueMin: 10000, valueMax: 10000 }, fmt)).toBe('$10k')
  })
  it('handles missing value safely', () => {
    expect(formatDealValue({}, fmt)).toBe('$0k')
  })
})
