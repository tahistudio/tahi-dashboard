import { describe, it, expect } from 'vitest'
import { easeOutCubic, computeTweenValue } from './motion-utils'

describe('easeOutCubic', () => {
  it('returns 0 at t=0', () => {
    expect(easeOutCubic(0)).toBe(0)
  })

  it('returns 1 at t=1', () => {
    expect(easeOutCubic(1)).toBe(1)
  })

  it('returns a value between 0 and 1 for a mid-progress value', () => {
    const v = easeOutCubic(0.5)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  it('decelerates: progress at 0.25 is past the linear 0.25 mark', () => {
    // Ease-out curves run ahead of linear at the start.
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25)
  })

  it('clamps inputs below 0 to 0', () => {
    expect(easeOutCubic(-1)).toBe(0)
  })

  it('clamps inputs above 1 to 1', () => {
    expect(easeOutCubic(2)).toBe(1)
  })
})

describe('computeTweenValue', () => {
  it('returns `to` immediately when elapsed >= duration', () => {
    expect(computeTweenValue(0, 100, 500, 500)).toBe(100)
    expect(computeTweenValue(0, 100, 600, 500)).toBe(100)
  })

  it('returns `from` at elapsed=0', () => {
    expect(computeTweenValue(0, 100, 0, 500)).toBe(0)
    expect(computeTweenValue(50, 200, 0, 400)).toBe(50)
  })

  it('returns `to` when duration is 0', () => {
    expect(computeTweenValue(0, 100, 0, 0)).toBe(100)
  })

  it('interpolates upward (from < to)', () => {
    const v = computeTweenValue(0, 1000, 250, 500)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1000)
  })

  it('interpolates downward (from > to)', () => {
    const v = computeTweenValue(1000, 0, 250, 500)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1000)
  })

  it('never returns values outside [from, to] range on count-up', () => {
    for (let ms = 0; ms <= 600; ms += 50) {
      const v = computeTweenValue(0, 500, ms, 500)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(500)
    }
  })

  it('never returns values outside [to, from] range on count-down', () => {
    for (let ms = 0; ms <= 600; ms += 50) {
      const v = computeTweenValue(500, 0, ms, 500)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(500)
    }
  })

  it('reaches exactly `to` at the final frame', () => {
    expect(computeTweenValue(0, 42, 500, 500)).toBe(42)
  })
})
