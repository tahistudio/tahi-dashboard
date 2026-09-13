import { describe, it, expect } from 'vitest'
import { clampComposerHeight, COMPOSER_MAX_LINES } from '@/lib/composer-autogrow'

describe('clampComposerHeight', () => {
  it('grows to the natural scroll height for a one-line answer', () => {
    const result = clampComposerHeight(20, 20, 8, 0)
    expect(result).toEqual({ height: 20, scrolls: false })
  })

  it('grows for a few lines, still under the cap', () => {
    const result = clampComposerHeight(80, 20, 8, 0)
    expect(result).toEqual({ height: 80, scrolls: false })
  })

  it('caps at max lines and reports that it now scrolls', () => {
    const result = clampComposerHeight(400, 20, 8, 0)
    expect(result).toEqual({ height: 160, scrolls: true })
  })

  it('folds vertical padding into the cap', () => {
    const result = clampComposerHeight(400, 20, 8, 16)
    expect(result).toEqual({ height: 176, scrolls: true })
  })

  it('defaults to the 8-line cap when none is given', () => {
    const result = clampComposerHeight(1000, 20)
    expect(result.height).toBe(20 * COMPOSER_MAX_LINES)
    expect(result.scrolls).toBe(true)
  })

  it('falls back to a sane line height when the measured one is not finite', () => {
    const result = clampComposerHeight(1000, Number.NaN, 8, 0)
    expect(result.height).toBe(20 * 8)
  })

  it('never reports a negative or zero height for an empty box', () => {
    const result = clampComposerHeight(0, 20, 8, 0)
    expect(result.height).toBeGreaterThan(0)
  })
})
