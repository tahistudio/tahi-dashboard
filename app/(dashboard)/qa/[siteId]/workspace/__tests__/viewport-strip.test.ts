import { describe, expect, it } from 'vitest'
import { QA_VIEWPORTS } from '@/lib/qa/types'
import { frameOuterWidthRem } from '../viewport-frame'
import {
  actualRowRem,
  actualSizeFits,
  actualSizeWidthPx,
  rowRemForZoom,
  wideRowCapRem,
} from '../viewport-strip'

const GAPS_PX = 16 * (QA_VIEWPORTS.length - 1)

function sharedWidthPx(rowRem: number): number {
  return QA_VIEWPORTS.reduce((n, v) => n + frameOuterWidthRem(v, rowRem) * 16, GAPS_PX)
}

describe('rowRemForZoom', () => {
  it('keeps the medium and large presets unchanged', () => {
    expect(rowRemForZoom('medium', 5000)).toBe(28)
    expect(rowRemForZoom('large', 5000)).toBe(40)
  })

  it('returns the floor when the width is unmeasured or too small', () => {
    expect(rowRemForZoom('fit', 0)).toBe(8)
    expect(rowRemForZoom('fit', 500)).toBe(8)
  })

  it('defaults to the 40rem ceiling when no ceiling is passed', () => {
    // Very wide strip: the default ceiling must cap the result at 40rem.
    expect(rowRemForZoom('fit', 100_000)).toBeCloseTo(40, 3)
    expect(rowRemForZoom('fit', 100_000, 40)).toBeCloseTo(40, 3)
  })

  it('uses a passed ceiling in place of the 40rem default', () => {
    expect(rowRemForZoom('fit', 100_000, 30)).toBeCloseTo(30, 3)
    expect(rowRemForZoom('fit', 100_000, 52)).toBeCloseTo(52, 3)
  })

  it('never returns more than the ceiling, even when the width would allow more', () => {
    const capped = rowRemForZoom('fit', 9000, 20)
    expect(capped).toBeLessThanOrEqual(20 + 1e-9)
    expect(capped).toBeCloseTo(20, 3)
  })

  it('never drops below the floor when the ceiling is smaller than the floor', () => {
    expect(rowRemForZoom('fit', 100_000, 3)).toBe(8)
  })

  it('fits the widths it returns (the binary search stays under the width)', () => {
    const width = 4500
    const rem = rowRemForZoom('fit', width, 80)
    expect(sharedWidthPx(rem)).toBeLessThanOrEqual(width + 0.5)
  })
})

describe('actual size', () => {
  it('needs the five widths plus four gaps', () => {
    const widths = 1920 + 1440 + 768 + 425 + 375
    expect(actualSizeWidthPx()).toBe(widths + GAPS_PX)
    expect(actualSizeWidthPx()).toBe(4992)
  })

  it('fits only when the measured width is at least the sum', () => {
    expect(actualSizeFits(4991)).toBe(false)
    expect(actualSizeFits(4992)).toBe(true)
    expect(actualSizeFits(5120)).toBe(true)
  })

  it('never fits when the width is unmeasured', () => {
    expect(actualSizeFits(0)).toBe(false)
  })

  it('renders each frame at scale exactly 1 (row height equals the real pixel height)', () => {
    for (const v of QA_VIEWPORTS) {
      const rowRem = actualRowRem(v)
      expect(rowRem * 16).toBe(v.height)
      expect(frameOuterWidthRem(v, rowRem) * 16).toBeGreaterThanOrEqual(v.width - 1e-9)
    }
  })

  it('gives the XL frame a 1080px row', () => {
    const xl = QA_VIEWPORTS.find(v => v.key === 'xl')
    expect(xl).toBeDefined()
    if (xl) expect(actualRowRem(xl)).toBe(1080 / 16)
  })
})

describe('wideRowCapRem', () => {
  it('leaves the space under the frames top edge, less the label bar and bottom padding', () => {
    // 1000px window, frames start at 200px: 800px = 50rem, less 3rem label bar and 1rem padding.
    expect(wideRowCapRem(200, 1000)).toBeCloseTo(46, 6)
  })

  it('shrinks as the frames start lower on the page', () => {
    expect(wideRowCapRem(400, 1000)).toBeLessThan(wideRowCapRem(200, 1000))
  })

  it('can go negative on a very short window, which the floor then absorbs', () => {
    expect(wideRowCapRem(900, 600)).toBeLessThan(0)
    expect(rowRemForZoom('fit', 4000, wideRowCapRem(900, 600))).toBe(8)
  })
})
