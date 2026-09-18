import { describe, it, expect } from 'vitest'
import { assembleForecastMonths } from '@/lib/cash-flow-forecast'

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
