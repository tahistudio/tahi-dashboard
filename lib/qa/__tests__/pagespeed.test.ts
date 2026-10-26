import { describe, it, expect } from 'vitest'
import { parsePageSpeed } from '@/lib/qa/pagespeed'

const NOW = '2026-10-26T00:00:00.000Z'

describe('parsePageSpeed', () => {
  it('reads field data when loadingExperience metrics are present', () => {
    const body = {
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
          INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
        },
      },
      lighthouseResult: { categories: { performance: { score: 0.87 } } },
    }
    expect(parsePageSpeed(body, NOW)).toEqual({
      score: 87, lcpMs: 2100, cls: 0.05, inpMs: 180, tbtMs: null, source: 'field', fetchedAt: NOW,
    })
  })

  it('falls back to lab audits when there is no field data', () => {
    const body = {
      lighthouseResult: {
        categories: { performance: { score: 0.5 } },
        audits: {
          'largest-contentful-paint': { numericValue: 3000 },
          'cumulative-layout-shift': { numericValue: 0.12 },
          'total-blocking-time': { numericValue: 340 },
        },
      },
    }
    expect(parsePageSpeed(body, NOW)).toEqual({
      score: 50, lcpMs: 3000, cls: 0.12, inpMs: null, tbtMs: 340, source: 'lab', fetchedAt: NOW,
    })
  })

  it('returns all nulls for an empty body, labelled as lab', () => {
    expect(parsePageSpeed({}, NOW)).toEqual({
      score: null, lcpMs: null, cls: null, inpMs: null, tbtMs: null, source: 'lab', fetchedAt: NOW,
    })
  })

  it('ignores non-numeric values instead of passing them through', () => {
    const body = { lighthouseResult: { categories: { performance: { score: 'high' } } } }
    expect(parsePageSpeed(body, NOW).score).toBeNull()
  })
})
