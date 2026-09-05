import { describe, it, expect } from 'vitest'
import {
  buildPipelineStageChart,
  RECURRING_MONTHS,
  type PipelineChartStage,
} from '@/lib/pipeline-stage-chart'

/** A row shaped like the pipeline-forecast route's `byStage`, wider than the
 *  chart reads, so a test can prove the chart ignores the unweighted columns. */
interface StageRow extends PipelineChartStage {
  slug: string
  probability: number
  upfrontNzd: number
  monthlyNzd: number
}

let nextPosition = 0
const stage = (over: Partial<StageRow> = {}): StageRow => {
  const position = over.position ?? nextPosition++
  return {
    stageId: `s${position}`,
    name: `Stage ${position}`,
    position,
    colour: null,
    isClosedWon: false,
    isClosedLost: false,
    dealCount: 1,
    upfrontNzd: 0,
    monthlyNzd: 0,
    weightedUpfrontNzd: 0,
    weightedMonthlyNzd: 0,
    slug: `s${position}`,
    probability: 50,
    ...over,
  }
}

const lead = (over: Partial<StageRow> = {}) =>
  stage({ stageId: 'lead', name: 'Lead', slug: 'lead', position: 0, probability: 10, ...over })
const discovery = (over: Partial<StageRow> = {}) =>
  stage({ stageId: 'discovery', name: 'Discovery', slug: 'discovery', position: 1, probability: 20, ...over })
const proposal = (over: Partial<StageRow> = {}) =>
  stage({ stageId: 'proposal', name: 'Proposal', slug: 'proposal', position: 2, probability: 40, ...over })
const won = (over: Partial<StageRow> = {}) =>
  stage({ stageId: 'won', name: 'Closed Won', slug: 'closed_won', position: 6, probability: 100, isClosedWon: true, ...over })
const lost = (over: Partial<StageRow> = {}) =>
  stage({ stageId: 'lost', name: 'Closed Lost', slug: 'closed_lost', position: 7, probability: 0, isClosedLost: true, ...over })

describe('buildPipelineStageChart: empty pipeline', () => {
  it('returns no bars and zero totals for an empty stage list', () => {
    const chart = buildPipelineStageChart([])
    expect(chart.bars).toEqual([])
    expect(chart.totalWeightedNzd).toBe(0)
    expect(chart.totalDeals).toBe(0)
    expect(chart.basis).toBe('count')
  })

  it('survives missing data', () => {
    expect(buildPipelineStageChart(null).bars).toEqual([])
    expect(buildPipelineStageChart(undefined).bars).toEqual([])
  })

  it('drops the stages that hold no deals, so an untouched board charts nothing', () => {
    const chart = buildPipelineStageChart([lead({ dealCount: 0 }), proposal({ dealCount: 0 })])
    expect(chart.bars).toEqual([])
    expect(chart.totalDeals).toBe(0)
  })

  it('leaves nothing to chart when only the closed stages hold deals', () => {
    const chart = buildPipelineStageChart([
      won({ dealCount: 3, weightedUpfrontNzd: 40_000 }),
      lost({ dealCount: 2, weightedUpfrontNzd: 9_000 }),
    ])
    expect(chart.bars).toEqual([])
    expect(chart.totalDeals).toBe(0)
  })
})

describe('buildPipelineStageChart: grouping and order', () => {
  it('follows the board position, not the order the rows arrived in', () => {
    const chart = buildPipelineStageChart([
      proposal({ dealCount: 1, weightedUpfrontNzd: 4_000 }),
      lead({ dealCount: 1, weightedUpfrontNzd: 500 }),
      discovery({ dealCount: 1, weightedUpfrontNzd: 200 }),
    ])
    expect(chart.bars.map(b => b.name)).toEqual(['Lead', 'Discovery', 'Proposal'])
    expect(chart.totalDeals).toBe(3)
  })

  it('carries each stage index from the FULL list, closed stages included', () => {
    // The pipeline board colours its columns with stageColour(name, index in
    // this same list), so the chart has to hand on the unfiltered index.
    const chart = buildPipelineStageChart([
      lead({ dealCount: 0 }),
      discovery({ dealCount: 2, weightedUpfrontNzd: 1_000 }),
      proposal({ dealCount: 1, weightedUpfrontNzd: 900 }),
      won({ dealCount: 4 }),
    ])
    expect(chart.bars.map(b => [b.name, b.stageIndex])).toEqual([
      ['Discovery', 1],
      ['Proposal', 2],
    ])
  })

  it('keeps the stage colour set in pipeline settings, and null when there is none', () => {
    const chart = buildPipelineStageChart([
      lead({ dealCount: 1, colour: '#60a5fa', weightedUpfrontNzd: 100 }),
      proposal({ dealCount: 1, colour: '   ', weightedUpfrontNzd: 100 }),
    ])
    expect(chart.bars[0].colour).toBe('#60a5fa')
    expect(chart.bars[1].colour).toBeNull()
  })

  it('sorts a stage with no usable position after every positioned stage', () => {
    const chart = buildPipelineStageChart([
      stage({ stageId: 'orphan', name: 'Legal review', position: Number.NaN, dealCount: 1, weightedUpfrontNzd: 8_000 }),
      lead({ dealCount: 1, weightedUpfrontNzd: 5_000 }),
    ])
    expect(chart.bars.map(b => b.name)).toEqual(['Lead', 'Legal review'])
  })

  it('labels a nameless stage rather than drawing a blank row', () => {
    const chart = buildPipelineStageChart([lead({ name: '  ', dealCount: 1, weightedUpfrontNzd: 100 })])
    expect(chart.bars[0].name).toBe('Unnamed stage')
  })

  it('ignores a row with no stage id at all', () => {
    const rows = [lead({ dealCount: 1, weightedUpfrontNzd: 100 })] as PipelineChartStage[]
    rows.push({ ...proposal({ dealCount: 2 }), stageId: null as unknown as string })
    const chart = buildPipelineStageChart(rows)
    expect(chart.bars.map(b => b.name)).toEqual(['Lead'])
  })
})

describe('buildPipelineStageChart: the headline is the sum of the bars', () => {
  it('rolls the monthly portion up over the recurring window, per stage', () => {
    const chart = buildPipelineStageChart([
      lead({ dealCount: 2, weightedUpfrontNzd: 2_000 }),
      proposal({ dealCount: 3, weightedUpfrontNzd: 16_000, weightedMonthlyNzd: 400 }),
    ])
    expect(chart.bars[0].weightedNzd).toBe(2_000)
    expect(chart.bars[1].weightedNzd).toBe(16_000 + 400 * RECURRING_MONTHS)
  })

  it('totals exactly what the card prints above the bars', () => {
    const rows = [
      lead({ dealCount: 2, weightedUpfrontNzd: 2_000 }),
      discovery({ dealCount: 1, weightedUpfrontNzd: 4_000, weightedMonthlyNzd: 100 }),
      proposal({ dealCount: 3, weightedUpfrontNzd: 16_000, weightedMonthlyNzd: 400 }),
      // Closed stages carry value but are not ahead of us, and the forecast
      // route leaves them out of its own totals too.
      won({ dealCount: 5, weightedUpfrontNzd: 90_000 }),
    ]
    const chart = buildPipelineStageChart(rows)
    const headline =
      (2_000 + 4_000 + 16_000) + (0 + 100 + 400) * RECURRING_MONTHS
    expect(chart.totalWeightedNzd).toBe(headline)
    expect(chart.totalWeightedNzd).toBe(chart.bars.reduce((s, b) => s + b.weightedNzd, 0))
    expect(chart.totalDeals).toBe(6)
  })

  it('takes a shorter recurring window when it is given one', () => {
    const chart = buildPipelineStageChart([proposal({ dealCount: 1, weightedMonthlyNzd: 500 })], 3)
    expect(chart.bars[0].weightedNzd).toBe(1_500)
  })

  it('falls back to the standard window when handed a broken one', () => {
    const chart = buildPipelineStageChart([proposal({ dealCount: 1, weightedMonthlyNzd: 500 })], Number.NaN)
    expect(chart.bars[0].weightedNzd).toBe(500 * RECURRING_MONTHS)
  })

  it('ignores null and non-finite money on a row', () => {
    const chart = buildPipelineStageChart([
      proposal({
        dealCount: 1,
        weightedUpfrontNzd: null as unknown as number,
        weightedMonthlyNzd: Number.NaN,
      }),
    ])
    expect(chart.bars[0].weightedNzd).toBe(0)
  })

  it('never carries a negative bar into the total', () => {
    const chart = buildPipelineStageChart([proposal({ dealCount: 1, weightedUpfrontNzd: -10_000 })])
    expect(chart.bars[0].weightedNzd).toBe(0)
    expect(chart.totalWeightedNzd).toBe(0)
  })
})

describe('buildPipelineStageChart: bar length', () => {
  it('scales against the longest bar and keeps a small stage visible', () => {
    const chart = buildPipelineStageChart([
      lead({ dealCount: 1, weightedUpfrontNzd: 1_000 }),
      proposal({ dealCount: 1, weightedUpfrontNzd: 100_000 }),
    ])
    expect(chart.basis).toBe('value')
    expect(chart.bars[1].pct).toBe(100)
    expect(chart.bars[0].pct).toBeGreaterThan(0)
    expect(chart.bars[0].pct).toBeLessThan(20)
  })

  it('draws a stage that holds deals but no value as a muted minimum bar', () => {
    // The normal early-stage case: deals logged before anyone has priced them.
    const chart = buildPipelineStageChart([
      lead({ dealCount: 2, weightedUpfrontNzd: 0 }),
      proposal({ dealCount: 1, weightedUpfrontNzd: 40_000 }),
    ])
    expect(chart.basis).toBe('value')
    expect(chart.bars[0].weightedNzd).toBe(0)
    expect(chart.bars[0].pct).toBeGreaterThan(0)
    expect(chart.bars[0].unvalued).toBe(true)
    expect(chart.bars[1].unvalued).toBe(false)
  })

  it('falls back to deal count for bar length when nothing is valued', () => {
    const chart = buildPipelineStageChart([lead({ dealCount: 2 }), proposal({ dealCount: 1 })])
    expect(chart.basis).toBe('count')
    expect(chart.totalWeightedNzd).toBe(0)
    expect(chart.bars[0].pct).toBe(100)
    expect(chart.bars[1].pct).toBe(50)
    // Nothing is muted on a count chart: the length means deals, not money.
    expect(chart.bars.every(b => b.unvalued === false)).toBe(true)
  })
})
