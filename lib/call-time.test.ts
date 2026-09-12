import { describe, expect, it } from 'vitest'
import { hasExplicitOffset, isCanonicalInstant, normalizeCallInstant } from './call-time'

describe('hasExplicitOffset', () => {
  it('recognises a trailing Z', () => {
    expect(hasExplicitOffset('2026-09-15T10:00:00Z')).toBe(true)
  })
  it('recognises a colon offset', () => {
    expect(hasExplicitOffset('2026-09-15T10:00:00+12:00')).toBe(true)
    expect(hasExplicitOffset('2026-09-15T10:00:00-05:00')).toBe(true)
  })
  it('recognises a non-colon offset', () => {
    expect(hasExplicitOffset('2026-09-15T10:00:00+1200')).toBe(true)
  })
  it('rejects a naive string', () => {
    expect(hasExplicitOffset('2026-09-15T10:00:00')).toBe(false)
    expect(hasExplicitOffset('2026-09-15T10:00')).toBe(false)
  })
})

describe('normalizeCallInstant', () => {
  it('leaves an already-UTC (Z) input alone (same instant)', () => {
    const out = normalizeCallInstant('2026-09-15T22:00:00.000Z')
    expect(out).toBe('2026-09-15T22:00:00.000Z')
  })

  it('converts an offset input to the equivalent Z instant', () => {
    // Google Calendar's own shape for a 10:00 NZST (UTC+12) call.
    const out = normalizeCallInstant('2026-09-15T10:00:00+12:00')
    expect(out).toBe('2026-09-14T22:00:00.000Z')
  })

  it('treats a naive string during NZST (winter, UTC+12) as Pacific/Auckland wall time', () => {
    // 10:00 on 15 Sept 2026 is still NZST (DST starts the last Sunday of
    // September) so this should land on UTC 2026-09-14T22:00:00.000Z.
    const out = normalizeCallInstant('2026-09-15T10:00:00')
    expect(out).toBe('2026-09-14T22:00:00.000Z')
  })

  it('treats a naive string during NZDT (summer, UTC+13) as Pacific/Auckland wall time', () => {
    // 10:00 on 15 Jan is NZDT (UTC+13), so the instant is one hour
    // earlier in UTC terms than the NZST case above.
    const out = normalizeCallInstant('2026-01-15T10:00:00')
    expect(out).toBe('2026-01-14T21:00:00.000Z')
  })

  it('treats a datetime-local value (no seconds) the same way', () => {
    const out = normalizeCallInstant('2026-09-15T10:00')
    expect(out).toBe('2026-09-14T22:00:00.000Z')
  })

  it('honours an explicit timeZone override', () => {
    const out = normalizeCallInstant('2026-09-15T10:00:00', 'UTC')
    expect(out).toBe('2026-09-15T10:00:00.000Z')
  })

  it('returns null for empty input', () => {
    expect(normalizeCallInstant('')).toBeNull()
    expect(normalizeCallInstant(null)).toBeNull()
    expect(normalizeCallInstant(undefined)).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(normalizeCallInstant('not a date')).toBeNull()
  })
})

describe('isCanonicalInstant', () => {
  it('accepts the exact canonical shape', () => {
    expect(isCanonicalInstant('2026-09-15T10:00:00.000Z')).toBe(true)
  })
  it('rejects an offset form', () => {
    expect(isCanonicalInstant('2026-09-15T10:00:00+12:00')).toBe(false)
  })
  it('rejects a naive form', () => {
    expect(isCanonicalInstant('2026-09-15T10:00:00')).toBe(false)
  })
  it('rejects a Z string missing milliseconds', () => {
    expect(isCanonicalInstant('2026-09-15T10:00:00Z')).toBe(false)
  })
})
