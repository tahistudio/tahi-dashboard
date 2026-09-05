import { describe, it, expect } from 'vitest'
import {
  buildPipelineStageChart,
  RECURRING_MONTHS,
  type PipelineChartDeal,
  type PipelineChartStageOrder,
} from '@/lib/pipeline-stage-chart'

/** A row shaped like GET /api/admin/deals returns it, wider than the chart
 *  reads, so a test can prove the chart ignores the non-NZD money columns. */
interface DealRow extends PipelineChartDeal {
  currency: string
  value: number
}

let nextId = 0
const deal = (over: Partial<DealRow> = {}): DealRow => ({
  id: `d${nextId++}`,
  stageId: 'discovery',
  stageName: 'Discovery',
  stageProbability: 20,
  stageIsClosedWon: 0,
  stageIsClosedLost: 0,
  upfrontValueNzd: 0,
  monthlyValueNzd: 0,
  currency: 'NZD',
  value: 0,
  ...over,
})

// Pipeline order as the forecast route hands it over in `byStage`.
const ORDER: PipelineChartStageOrder[] = [
  { stageId: 'lead', position: 0 },
  { stageId: 'discovery', position: 1 },
  { stageId: 'proposal', position: 2 },
  { stageId: 'won', position: 6 },
  { stageId: 'lost', position: 7 },
]

const lead = (over: Partial<DealRow> = {}) =>
  deal({ stageId: 'lead', stageName: 'Lead', stageProbability: 10, ...over })
const proposal = (over: Partial<DealRow> = {}) =>
  deal({ stageId: 'proposal', stageName: 'Proposal', stageProbability: 40, ...over })

describe('buildPipelineStageChart: empty pipeline', () => {
  it('returns no bars and zero totals for an empty deal list', () => {
    const chart = buildPipelineStageChart([], ORDER)
    expect(chart.bars).toEqual([])
    expect(chart.totalWeightedNzd).toBe(0)
    expect(chart.totalDeals).toBe(0)
    expect(chart.basis).toBe('count')
  })

  it('survives missing data on both sides', () => {
    expect(buildPipelineStageChart(null, null).bars).toEqual([])
    expect(buildPipelineStageChart(undefined, undefined).bars).toEqual([])
    expect(buildPipelineStageChart([deal()], null).bars).toHaveLength(1)
  })

  it('leaves nothing to chart when every deal sits in a closed stage', () => {
    const chart = buildPipelineStageChart(
      [
        deal({ stageId: 'won', stageName: 'Closed Won', stageProbability: 100, stageIsClosedWon: 1, upfrontValueNzd: 40_000 }),
        deal({ stageId: 'lost', stageName: 'Closed Lost', stageProbability: 0, stageIsClosedLost: 1, upfrontValueNzd: 9_000 }),
      ],
      ORDER,
    )
    expect(chart.bars).toEqual([])
    expect(chart.totalDeals).toBe(0)
  })
})

describe('buildPipelineStageChart: grouping and order', () => {
  it('groups deals per stage and follows the pipeline order, not the row order', () => {
    const chart = buildPipelineStageChart(
      [proposal({ upfrontValueNzd: 10_000 }), lead({ upfrontValueNzd: 5_000 }), deal({ upfrontValueNzd: 1_000 })],
      ORDER,
    )
    expect(chart.bars.map(b => b.name)).toEqual(['Lead', 'Discovery', 'Proposal'])
    expect(chart.totalDeals).toBe(3)
  })

  it('counts every open deal in its stage', () => {
    const chart = buildPipelineStageChart([lead(), lead(), proposal()], ORDER)
    expect(chart.bars.map(b => [b.name, b.dealCount])).toEqual([
      ['Lead', 2],
      ['Proposal', 1],
    ])
  })

  it('weights each stage exactly as the forecast route does, so the bars add up to the headline', () => {
    const deals = [
      lead({ upfrontValueNzd: 20_000 }),
      proposal({ upfrontValueNzd: 30_000, monthlyValueNzd: 1_000 }),
      proposal({ upfrontValueNzd: 10_000 }),
    ]
    const chart = buildPipelineStageChart(deals, ORDER)

    // Lead at 10%: 20,000 * 0.1 = 2,000
    expect(chart.bars[0].weightedNzd).toBe(2_000)
    // Proposal at 40%: (40,000 * 0.4) + (1,000 * 0.4 * 12) = 16,000 + 4,800
    expect(chart.bars[1].weightedNzd).toBe(16_000 + 400 * RECURRING_MONTHS)
    expect(chart.totalWeightedNzd).toBe(chart.bars.reduce((s, b) => s + b.weightedNzd, 0))
  })

  it('scales bar length against the longest bar and keeps a small stage visible', () => {
    const chart = buildPipelineStageChart(
      [lead({ upfrontValueNzd: 1_000 }), proposal({ upfrontValueNzd: 100_000 })],
      ORDER,
    )
    expect(chart.basis).toBe('value')
    expect(chart.bars[1].pct).toBe(100)
    expect(chart.bars[0].pct).toBeGreaterThan(0)
    expect(chart.bars[0].pct).toBeLessThan(20)
  })
})

describe('buildPipelineStageChart: unknown stage', () => {
  it('charts a stage the order list does not know about, sorted after the known ones', () => {
    const chart = buildPipelineStageChart(
      [
        deal({ stageId: 'retired', stageName: 'Legal review', stageProbability: 50, upfrontValueNzd: 8_000 }),
        lead({ upfrontValueNzd: 5_000 }),
      ],
      ORDER,
    )
    expect(chart.bars.map(b => b.name)).toEqual(['Lead', 'Legal review'])
    expect(chart.bars[1].weightedNzd).toBe(4_000)
  })

  it('buckets deals with no stage at all rather than dropping them', () => {
    const chart = buildPipelineStageChart(
      [
        lead({ upfrontValueNzd: 5_000 }),
        deal({ stageId: null, stageName: null, stageProbability: null, upfrontValueNzd: 12_000 }),
        deal({ stageId: null, stageName: '  ', stageProbability: null, upfrontValueNzd: 3_000 }),
      ],
      ORDER,
    )
    expect(chart.bars).toHaveLength(2)
    expect(chart.bars[1].name).toBe('Unassigned stage')
    expect(chart.bars[1].dealCount).toBe(2)
    // No probability to weight by, so the stage carries no forecast value.
    expect(chart.bars[1].weightedNzd).toBe(0)
    expect(chart.totalDeals).toBe(3)
  })
})

describe('buildPipelineStageChart: currency mix', () => {
  it('sums the NZD conversion of each deal, never the raw foreign value', () => {
    const chart = buildPipelineStageChart(
      [
        proposal({ currency: 'USD', value: 10_000, upfrontValueNzd: 17_000 }),
        proposal({ currency: 'GBP', value: 5_000, upfrontValueNzd: 11_000 }),
      ],
      ORDER,
    )
    // (17,000 + 11,000) * 40% = 11,200. Adding the raw 15,000 would give 6,000.
    expect(chart.bars).toHaveLength(1)
    expect(chart.bars[0].weightedNzd).toBe(11_200)
  })

  it('mixes currencies inside the monthly portion too', () => {
    const chart = buildPipelineStageChart(
      [
        proposal({ currency: 'AUD', value: 2_000, monthlyValueNzd: 2_200 }),
        proposal({ currency: 'NZD', value: 800, monthlyValueNzd: 800 }),
      ],
      ORDER,
    )
    // (2,200 + 800) * 40% = 1,200 a month, over the 12-month rollup.
    expect(chart.bars[0].weightedNzd).toBe(1_200 * RECURRING_MONTHS)
  })
})

describe('buildPipelineStageChart: zero values', () => {
  it('falls back to deal count for bar length when nothing is valued', () => {
    const chart = buildPipelineStageChart([lead(), lead(), proposal()], ORDER)
    expect(chart.basis).toBe('count')
    expect(chart.totalWeightedNzd).toBe(0)
    expect(chart.bars[0].pct).toBe(100)
    expect(chart.bars[1].pct).toBe(50)
  })

  it('falls back to count when every open stage has a zero probability', () => {
    const chart = buildPipelineStageChart(
      [
        lead({ stageProbability: 0, upfrontValueNzd: 90_000 }),
        proposal({ stageProbability: 0, upfrontValueNzd: 40_000 }),
      ],
      ORDER,
    )
    expect(chart.basis).toBe('count')
    expect(chart.bars.every(b => b.pct === 100)).toBe(true)
  })

  it('ignores null and non-finite money on a row', () => {
    const chart = buildPipelineStageChart(
      [proposal({ upfrontValueNzd: null, monthlyValueNzd: Number.NaN }), proposal({ upfrontValueNzd: 5_000 })],
      ORDER,
    )
    expect(chart.bars[0].dealCount).toBe(2)
    expect(chart.bars[0].weightedNzd).toBe(2_000)
  })

  it('never draws a negative bar', () => {
    const chart = buildPipelineStageChart([proposal({ upfrontValueNzd: -10_000 })], ORDER)
    expect(chart.bars[0].weightedNzd).toBe(0)
    expect(chart.bars[0].pct).toBe(100)
  })
})
