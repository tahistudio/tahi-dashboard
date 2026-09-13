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
