import { describe, it, expect } from 'vitest'
import { assembleForecastMonths, projectPipelineByMonth, type PipelineCashFlowDeal } from '@/lib/cash-flow-forecast'

describe('projectPipelineByMonth', () => {
  const months = ['2026-10', '2026-11', '2026-12']
  const rates = { NZD: 1, USD: 0.5, AUD: 0.8 }
  const deal = (overrides: Partial<PipelineCashFlowDeal> = {}): PipelineCashFlowDeal => ({
    currency: 'NZD', probability: 50, expectedCloseDate: '2026-11-15',
    upfrontValueNzd: 1000, monthlyValueNzd: 100, valueNzd: 2200,
    ...overrides,
  })

  it('projects upfront once at close and monthly from that month onward, never annualised into close', () => {
    expect(projectPipelineByMonth([deal()], months, rates)).toEqual({
      '2026-10': 0, '2026-11': 550, '2026-12': 50,
    })
  })

  it('converts native split values when cached NZD amounts are missing', () => {
    expect(projectPipelineByMonth([deal({
      currency: 'USD', upfrontValueNzd: null, monthlyValueNzd: null,
      upfrontValue: 1000, monthlyValue: 100,
    })], months, rates)).toEqual({ '2026-10': 0, '2026-11': 1100, '2026-12': 100 })
  })

  it('uses explicit cached zero amounts and ignores a stale legacy value', () => {
    expect(projectPipelineByMonth([deal({
      currency: 'USD', upfrontValueNzd: 0, monthlyValueNzd: 0,
      upfrontValue: 1000, monthlyValue: 100,
    })], months, rates)).toEqual({ '2026-10': 0, '2026-11': 0, '2026-12': 0 })
  })

  it('respects an explicit delayed recurring start', () => {
    expect(projectPipelineByMonth([deal({ recurringStartDate: '2026-12-01' })], months, rates))
      .toEqual({ '2026-10': 0, '2026-11': 500, '2026-12': 50 })
  })

  it('respects the project end fallback and never bills before expected close', () => {
    expect(projectPipelineByMonth([deal({ engagementEndDate: '2026-12-01' })], months, rates))
      .toEqual({ '2026-10': 0, '2026-11': 500, '2026-12': 50 })
    expect(projectPipelineByMonth([deal({ recurringStartDate: '2026-09-01' })], months, rates))
      .toEqual({ '2026-10': 0, '2026-11': 550, '2026-12': 50 })
  })

  it('includes only in-window recurring receipts when close was before the window', () => {
    expect(projectPipelineByMonth([deal({ expectedCloseDate: '2026-09-01' })], months, rates))
      .toEqual({ '2026-10': 50, '2026-11': 50, '2026-12': 50 })
    expect(projectPipelineByMonth([deal({ expectedCloseDate: '2027-01-01' })], months, rates))
      .toEqual({ '2026-10': 0, '2026-11': 0, '2026-12': 0 })
  })

  it('spreads undated closes evenly, with recurring revenue accumulating as those closes occur', () => {
    expect(projectPipelineByMonth([deal({
      expectedCloseDate: null, upfrontValueNzd: 300, monthlyValueNzd: 90,
    })], months, rates)).toEqual({ '2026-10': 65, '2026-11': 80, '2026-12': 95 })
  })

  it('honours a known recurring start without assuming an undated deal has already closed', () => {
    expect(projectPipelineByMonth([deal({
      expectedCloseDate: null, upfrontValueNzd: 300, monthlyValueNzd: 90,
      recurringStartDate: '2026-11-01',
    })], months, rates)).toEqual({ '2026-10': 50, '2026-11': 80, '2026-12': 95 })
  })

  it('keeps the legacy one-off fallback only when every split field is absent', () => {
    expect(projectPipelineByMonth([deal({
      upfrontValueNzd: null, monthlyValueNzd: null, valueNzd: null, value: 100, currency: 'AUD',
    })], months, rates)).toEqual({ '2026-10': 0, '2026-11': 62.5, '2026-12': 0 })
  })

  it('returns no projections for an empty window', () => {
    expect(projectPipelineByMonth([deal()], [], rates)).toEqual({})
  })
})

describe('assembleForecastMonths', () => {
  const monthKeys = ['2026-09', '2026-10', '2026-11']

  it('splits revenue into retainer, project run-rate and weighted pipeline', () => {
    const rows = assembleForecastMonths({
      monthKeys,
      retainerByMonth: { '2026-09': 10317, '2026-10': 10317, '2026-11': 10317 },
      pipelineByMonth: { '2026-09': 3230 },
      costByMonth: { '2026-09': 16024, '2026-10': 16024, '2026-11': 16024 },
      projectRunRateNzd: 17093,
    })
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      month: '2026-09',
      revenueRetainer: 10317,
      revenueProject: 17093,
      revenuePipeline: 3230,
    })
    expect(rows[0].revenue).toBeCloseTo(30640, 2)
    expect(rows[1].revenuePipeline).toBe(0)
    expect(rows[1].revenue).toBeCloseTo(27410, 2)
  })

  it('carries the project run-rate flat across every month', () => {
    const rows = assembleForecastMonths({
      monthKeys,
      retainerByMonth: {},
      pipelineByMonth: {},
      costByMonth: {},
      projectRunRateNzd: 17093,
    })
    expect(rows.map(r => r.revenueProject)).toEqual([17093, 17093, 17093])
  })

  it('turns the month positive once the run-rate is counted', () => {
    const rows = assembleForecastMonths({
      monthKeys,
      retainerByMonth: { '2026-09': 10317, '2026-10': 10317, '2026-11': 10317 },
      pipelineByMonth: {},
      costByMonth: { '2026-09': 16024, '2026-10': 16024, '2026-11': 16024 },
      projectRunRateNzd: 17093,
    })
    // Retainers alone (10,317 - 16,024) gave the old -5.7k a month.
    expect(rows[0].net).toBeCloseTo(11386, 2)
    expect(rows[2].cumulative).toBeCloseTo(34158, 2)
  })

  it('still reports a negative net when revenue genuinely falls short', () => {
    const rows = assembleForecastMonths({
      monthKeys,
      retainerByMonth: { '2026-09': 1000 },
      pipelineByMonth: {},
      costByMonth: { '2026-09': 16024, '2026-10': 16024, '2026-11': 16024 },
      projectRunRateNzd: 0,
    })
    expect(rows[0].net).toBeCloseTo(-15024, 2)
    expect(rows[2].cumulative).toBeCloseTo(-47072, 2)
  })

  it('returns no rows for an empty window', () => {
    expect(
      assembleForecastMonths({
        monthKeys: [],
        retainerByMonth: {},
        pipelineByMonth: {},
        costByMonth: {},
        projectRunRateNzd: 100,
      }),
    ).toEqual([])
  })
})
