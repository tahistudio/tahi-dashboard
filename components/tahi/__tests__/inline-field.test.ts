import { describe, it, expect } from 'vitest'
import { isCompleteDateValue, resolveDateCommit } from '@/components/tahi/requests/inline-field'

// Vitest runs in the `node` environment here, so this covers the rule the Due
// editor now commits through rather than the input itself: a native date
// input fires `input` on every segment, and the old editor treated each one
// as a commit and closed. Case A below is the regression that silently moved
// a request eight months earlier; case B is the one where a due date could
// not be set from the keyboard at all.

describe('isCompleteDateValue', () => {
  it('accepts a full ISO calendar date', () => {
    expect(isCompleteDateValue('2026-09-10')).toBe(true)
    expect(isCompleteDateValue('2024-02-29')).toBe(true)
  })

  it('rejects anything a half-filled input reports', () => {
    expect(isCompleteDateValue('')).toBe(false)
    expect(isCompleteDateValue('2026')).toBe(false)
    expect(isCompleteDateValue('2026-09')).toBe(false)
    expect(isCompleteDateValue('2026-9-1')).toBe(false)
  })

  it('rejects a well-shaped string that is not a real date', () => {
    expect(isCompleteDateValue('2026-13-01')).toBe(false)
    expect(isCompleteDateValue('2026-02-30')).toBe(false)
    expect(isCompleteDateValue('2026-00-10')).toBe(false)
  })
})

describe('resolveDateCommit', () => {
  it('case A: a partial draft over an existing date changes nothing', () => {
    // The user opened the editor on 2026-09-10 and has typed one digit.
    expect(resolveDateCommit('2026-09', '2026-09-10')).toEqual({ changed: false, value: '2026-09-10' })
  })

  it('case B: a partial draft on an empty field does not clear it', () => {
    expect(resolveDateCommit('2026', null)).toEqual({ changed: false, value: null })
  })

  it('commits a complete date that differs from the current value', () => {
    expect(resolveDateCommit('2026-12-10', '2026-09-10')).toEqual({ changed: true, value: '2026-12-10' })
  })

  it('does not re-write the value it already holds', () => {
    expect(resolveDateCommit('2026-09-10', '2026-09-10')).toEqual({ changed: false, value: '2026-09-10' })
  })

  it('reads through a stored value that carries a time component', () => {
    expect(resolveDateCommit('2026-09-10', '2026-09-10T00:00:00.000Z'))
      .toEqual({ changed: false, value: '2026-09-10' })
  })

  it('clears the date when the field is emptied, but only if there was one', () => {
    expect(resolveDateCommit('', '2026-09-10')).toEqual({ changed: true, value: null })
    expect(resolveDateCommit('', null)).toEqual({ changed: false, value: null })
  })
})
