/**
 * use-user-preference tests \u2014 just the pure helpers. The React hook
 * itself is simple enough that exercising it in the UI is sufficient.
 */

import { describe, it, expect } from 'vitest'
import { oneOf } from '../use-user-preference'

describe('oneOf', () => {
  it('accepts values in the allowed list', () => {
    const v = oneOf(['x', 'y'])
    expect(v('x')).toBe(true)
    expect(v('y')).toBe(true)
  })
  it('rejects values not in the allowed list', () => {
    const v = oneOf(['x', 'y'])
    expect(v('z')).toBe(false)
    expect(v(123)).toBe(false)
    expect(v(null)).toBe(false)
    expect(v(undefined)).toBe(false)
  })
  it('narrows the type for TypeScript consumers', () => {
    const v = oneOf<'list' | 'board'>(['list', 'board'])
    const sample: unknown = 'list'
    if (v(sample)) {
      // If this compiles, the narrowing works.
      const narrowed: 'list' | 'board' = sample
      expect(narrowed).toBe('list')
    }
  })
})
