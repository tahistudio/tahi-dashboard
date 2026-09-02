import { describe, it, expect } from 'vitest'
import {
  MIN_THUMB_PX,
  maxScrollLeft,
  overflows,
  scrollRatio,
  thumbWidth,
  thumbOffset,
  atStart,
  atEnd,
  scrollLeftFromDrag,
} from '../board-scrollbar'

const m = (clientWidth: number, scrollWidth: number, scrollLeft = 0) =>
  ({ clientWidth, scrollWidth, scrollLeft })

describe('maxScrollLeft', () => {
  it('is the overflow beyond the visible width', () => {
    expect(maxScrollLeft(m(600, 1400))).toBe(800)
  })

  it('never goes negative when the content fits', () => {
    expect(maxScrollLeft(m(900, 600))).toBe(0)
  })
})

describe('overflows', () => {
  it('is false when the content fits the scroller', () => {
    expect(overflows(m(900, 900))).toBe(false)
  })

  it('ignores a sub-pixel rounding overflow', () => {
    expect(overflows(m(900, 901))).toBe(false)
  })

  it('is true once a real column hangs off the edge', () => {
    expect(overflows(m(900, 1178))).toBe(true)
  })
})

describe('scrollRatio', () => {
  it('is 0 at the left edge', () => {
    expect(scrollRatio(m(600, 1400, 0))).toBe(0)
  })

  it('is 1 at the right edge', () => {
    expect(scrollRatio(m(600, 1400, 800))).toBe(1)
  })

  it('is the fraction of the scrollable span in between', () => {
    expect(scrollRatio(m(600, 1400, 200))).toBeCloseTo(0.25, 5)
  })

  it('clamps an over-scrolled position to 1', () => {
    expect(scrollRatio(m(600, 1400, 950))).toBe(1)
  })

  it('is 0 when there is nothing to scroll', () => {
    expect(scrollRatio(m(900, 600, 0))).toBe(0)
  })
})

describe('thumbWidth', () => {
  it('is proportional to the visible fraction of the content', () => {
    // Half the content is visible, so the thumb takes half the track.
    expect(thumbWidth(400, m(600, 1200))).toBe(200)
  })

  it('never drops below the 44px minimum touch target', () => {
    expect(MIN_THUMB_PX).toBe(44)
    // 2% visible would be an 8px thumb; the floor wins.
    expect(thumbWidth(400, m(200, 10000))).toBe(MIN_THUMB_PX)
  })

  it('never exceeds the track', () => {
    expect(thumbWidth(120, m(900, 1000))).toBeLessThanOrEqual(120)
    expect(thumbWidth(30, m(200, 10000))).toBe(30)
  })

  it('fills the track when nothing overflows', () => {
    expect(thumbWidth(400, m(900, 900))).toBe(400)
  })

  it('treats a zero-width scroller as full', () => {
    expect(thumbWidth(400, m(0, 0))).toBe(400)
  })
})

describe('thumbOffset', () => {
  it('is 0 at the left edge', () => {
    expect(thumbOffset(400, m(600, 1200, 0))).toBe(0)
  })

  it('parks the thumb flush at the right edge', () => {
    // track 400, thumb 200, so the travel span is 200.
    expect(thumbOffset(400, m(600, 1200, 600))).toBe(200)
  })

  it('is half the travel span at the halfway scroll position', () => {
    expect(thumbOffset(400, m(600, 1200, 300))).toBe(100)
  })

  it('stays at 0 when the thumb fills the track', () => {
    expect(thumbOffset(400, m(900, 900, 0))).toBe(0)
  })
})

describe('atStart and atEnd', () => {
  it('disables the back arrow only at the left edge', () => {
    expect(atStart(m(600, 1400, 0))).toBe(true)
    expect(atStart(m(600, 1400, 40))).toBe(false)
  })

  it('disables the forward arrow only at the right edge', () => {
    expect(atEnd(m(600, 1400, 800))).toBe(true)
    expect(atEnd(m(600, 1400, 760))).toBe(false)
  })

  it('disables both arrows when nothing overflows', () => {
    expect(atStart(m(900, 900, 0))).toBe(true)
    expect(atEnd(m(900, 900, 0))).toBe(true)
  })

  it('tolerates a sub-pixel gap at either end', () => {
    expect(atStart(m(600, 1400, 1))).toBe(true)
    expect(atEnd(m(600, 1400, 799))).toBe(true)
  })
})

describe('scrollLeftFromDrag', () => {
  it('maps a pointer delta across the track onto the scrollable span', () => {
    // The thumb travels 200px to cover 800px of scroll: 4x amplification.
    expect(scrollLeftFromDrag({ startScrollLeft: 0, deltaX: 50, span: 200, max: 800 })).toBe(200)
  })

  it('clamps at the left edge', () => {
    expect(scrollLeftFromDrag({ startScrollLeft: 100, deltaX: -400, span: 200, max: 800 })).toBe(0)
  })

  it('clamps at the right edge', () => {
    expect(scrollLeftFromDrag({ startScrollLeft: 700, deltaX: 400, span: 200, max: 800 })).toBe(800)
  })

  it('does not divide by a zero-width travel span', () => {
    expect(scrollLeftFromDrag({ startScrollLeft: 120, deltaX: 60, span: 0, max: 800 })).toBe(120)
  })
})
