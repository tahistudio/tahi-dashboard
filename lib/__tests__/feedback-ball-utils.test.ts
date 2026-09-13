/**
 * Pure helpers behind the feedback ball's drag-versus-click decision and its
 * viewport clamp (components/tahi/feedback-ball.tsx).
 */
import { describe, it, expect } from 'vitest'
import {
  distance,
  isClickGesture,
  clampBallPosition,
  breakpointForWidth,
  snapToEdge,
  positionForEdgeSnap,
  CLICK_DISTANCE_THRESHOLD_PX,
} from '@/lib/feedback-ball-utils'

describe('distance', () => {
  it('computes straight-line distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('is zero for the same point', () => {
    expect(distance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0)
  })
})

describe('isClickGesture', () => {
  it('is a click under the threshold', () => {
    expect(isClickGesture(0)).toBe(true)
    expect(isClickGesture(CLICK_DISTANCE_THRESHOLD_PX - 1)).toBe(true)
  })

  it('is a drag at or over the threshold', () => {
    expect(isClickGesture(CLICK_DISTANCE_THRESHOLD_PX)).toBe(false)
    expect(isClickGesture(CLICK_DISTANCE_THRESHOLD_PX + 10)).toBe(false)
  })

  it('honours a custom threshold', () => {
    expect(isClickGesture(8, 10)).toBe(true)
    expect(isClickGesture(12, 10)).toBe(false)
  })
})

describe('clampBallPosition', () => {
  const viewport = { width: 1024, height: 768 }
  const ballSize = 56

  it('leaves a position already inside bounds unchanged', () => {
    expect(clampBallPosition({ x: 400, y: 300 }, ballSize, viewport)).toEqual({ x: 400, y: 300 })
  })

  it('clamps a negative position to the margin', () => {
    expect(clampBallPosition({ x: -50, y: -20 }, ballSize, viewport)).toEqual({ x: 0, y: 0 })
  })

  it('clamps a position past the far edge so the whole ball stays on screen', () => {
    const result = clampBallPosition({ x: 5000, y: 5000 }, ballSize, viewport)
    expect(result).toEqual({ x: viewport.width - ballSize, y: viewport.height - ballSize })
  })

  it('respects a non-zero margin', () => {
    const result = clampBallPosition({ x: -50, y: 5000 }, ballSize, viewport, 10)
    expect(result).toEqual({ x: 10, y: viewport.height - ballSize - 10 })
  })

  it('never returns a negative max on a viewport smaller than the ball', () => {
    const tiny = { width: 20, height: 20 }
    const result = clampBallPosition({ x: 500, y: 500 }, ballSize, tiny)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
  })
})

describe('breakpointForWidth', () => {
  it('reads phone under 640', () => {
    expect(breakpointForWidth(375)).toBe('phone')
    expect(breakpointForWidth(639)).toBe('phone')
  })

  it('reads tablet from 640 up to 1024', () => {
    expect(breakpointForWidth(640)).toBe('tablet')
    expect(breakpointForWidth(1023)).toBe('tablet')
  })

  it('reads desktop at 1024 and above', () => {
    expect(breakpointForWidth(1024)).toBe('desktop')
    expect(breakpointForWidth(1920)).toBe('desktop')
  })
})

describe('snapToEdge', () => {
  const viewport = { width: 1000, height: 800 }
  const inset = 16
  const ball = { width: 56, height: 56 }

  it('snaps to the left edge when dropped near it', () => {
    const result = snapToEdge({ x: 5, y: 300, ...ball }, viewport, inset)
    expect(result.edge).toBe('left')
    expect(result.offset).toBe(300)
  })

  it('snaps to the right edge when dropped near it', () => {
    const result = snapToEdge({ x: 930, y: 300, ...ball }, viewport, inset)
    expect(result.edge).toBe('right')
    expect(result.offset).toBe(300)
  })

  it('snaps to the top edge when dropped near it', () => {
    const result = snapToEdge({ x: 400, y: 4, ...ball }, viewport, inset)
    expect(result.edge).toBe('top')
    expect(result.offset).toBe(400)
  })

  it('snaps to the bottom edge when dropped near it', () => {
    const result = snapToEdge({ x: 400, y: 730, ...ball }, viewport, inset)
    expect(result.edge).toBe('bottom')
    expect(result.offset).toBe(400)
  })

  it('breaks a four-way tie in favour of left', () => {
    // Dead centre of a square viewport: all four edge distances are equal.
    const square = { width: 800, height: 800 }
    const result = snapToEdge({ x: 372, y: 372, ...ball }, square, inset)
    expect(result.edge).toBe('left')
  })

  it('breaks a left/right tie (equidistant, nearer than top/bottom) in favour of left', () => {
    // width 800 centres x at 372; a much taller viewport keeps top/bottom far away.
    const result = snapToEdge({ x: 372, y: 400, width: 56, height: 56 }, { width: 800, height: 4000 }, inset)
    expect(result.edge).toBe('left')
  })

  it('clamps the along-edge offset up to the inset when dropped past the near end', () => {
    // x=2 keeps "left" the nearest edge (distance 2) even though y=5 is
    // closer to the top than to the bottom, since 2 < 5.
    const result = snapToEdge({ x: 2, y: 5, ...ball }, viewport, inset)
    expect(result.edge).toBe('left')
    expect(result.offset).toBe(inset)
  })

  it('clamps the along-edge offset down at the far end too', () => {
    // x=2 keeps "left" nearest (distance 2) even though y=735 sits only 9px
    // from the bottom edge, since 2 < 9.
    const result = snapToEdge({ x: 2, y: 735, ...ball }, viewport, inset)
    expect(result.edge).toBe('left')
    expect(result.offset).toBe(viewport.height - ball.height - inset)
  })

  it('never produces a negative offset on a viewport smaller than the ball', () => {
    const tiny = { width: 20, height: 20 }
    const result = snapToEdge({ x: 5, y: 5, ...ball }, tiny, inset)
    expect(result.offset).toBeGreaterThanOrEqual(0)
  })
})

describe('positionForEdgeSnap', () => {
  const viewport = { width: 1000, height: 800 }
  const inset = 16
  const ballSize = 56

  it('places the ball flush against the left edge at the given offset', () => {
    const result = positionForEdgeSnap({ edge: 'left', offset: 300 }, ballSize, viewport, inset)
    expect(result).toEqual({ x: inset, y: 300 })
  })

  it('places the ball flush against the right edge, inset from the right', () => {
    const result = positionForEdgeSnap({ edge: 'right', offset: 300 }, ballSize, viewport, inset)
    expect(result).toEqual({ x: viewport.width - ballSize - inset, y: 300 })
  })

  it('places the ball flush against the top edge at the given offset', () => {
    const result = positionForEdgeSnap({ edge: 'top', offset: 400 }, ballSize, viewport, inset)
    expect(result).toEqual({ x: 400, y: inset })
  })

  it('places the ball flush against the bottom edge, inset from the bottom', () => {
    const result = positionForEdgeSnap({ edge: 'bottom', offset: 400 }, ballSize, viewport, inset)
    expect(result).toEqual({ x: 400, y: viewport.height - ballSize - inset })
  })

  it('re-clamps an out-of-range offset on resize to a smaller viewport', () => {
    const result = positionForEdgeSnap({ edge: 'left', offset: 780 }, ballSize, { width: 400, height: 600 }, inset)
    expect(result.y).toBeLessThanOrEqual(600 - ballSize - inset)
    expect(result.y).toBeGreaterThanOrEqual(inset)
  })

  it('never returns a negative position on a viewport smaller than the ball', () => {
    const tiny = { width: 20, height: 20 }
    const result = positionForEdgeSnap({ edge: 'bottom', offset: 5 }, ballSize, tiny, inset)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
  })
})
