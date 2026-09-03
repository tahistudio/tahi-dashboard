import { describe, it, expect } from 'vitest'
import { dueDateState, formatDueDateLabel, DUE_SOON_DAYS } from '../due-date-chip'

// A fixed "now" so the boundaries are exact rather than clock-dependent.
const NOW = new Date('2026-09-03T09:00:00')

describe('dueDateState', () => {
  it('is null with no date', () => {
    expect(dueDateState(null, 'in_progress', NOW)).toBeNull()
    expect(dueDateState(undefined, 'in_progress', NOW)).toBeNull()
  })

  it('is null for finished work, however late', () => {
    for (const status of ['delivered', 'cancelled', 'archived']) {
      expect(dueDateState('2020-01-01', status, NOW)).toBeNull()
    }
  })

  it('is overdue once the whole due day has passed', () => {
    expect(dueDateState('2026-09-02', 'in_progress', NOW)).toBe('overdue')
  })

  it('counts today as due soon, not overdue', () => {
    // The rule runs to 23:59:59 on the due day, so this morning is not late.
    expect(dueDateState('2026-09-03', 'in_progress', NOW)).toBe('due-soon')
  })

  it('holds due-soon to the boundary and drops to on-track past it', () => {
    // Measured to the end of the due day, so from 09:00 on the 3rd the
    // 5th is 2.6 days out (soon) and the 6th is 3.6 (not).
    expect(dueDateState('2026-09-05', 'submitted', NOW)).toBe('due-soon')
    expect(dueDateState('2026-09-06', 'submitted', NOW)).toBe('on-track')
    expect(DUE_SOON_DAYS).toBe(3)
  })

  it('is null for a value that is not a date', () => {
    expect(dueDateState('not-a-date', 'in_progress', NOW)).toBeNull()
  })

  it('ignores a time component on the stored value', () => {
    expect(dueDateState('2026-09-02T12:00:00.000Z', 'in_progress', NOW)).toBe('overdue')
  })
})

describe('formatDueDateLabel', () => {
  it('prints day then short month', () => {
    expect(formatDueDateLabel('2026-09-15')).toBe('15 Sep')
    expect(formatDueDateLabel('2026-01-01')).toBe('1 Jan')
  })

  it('trims a timestamp down to its day', () => {
    expect(formatDueDateLabel('2026-12-24T23:30:00.000Z')).toBe('24 Dec')
  })

  it('is null when there is nothing to format', () => {
    expect(formatDueDateLabel(null)).toBeNull()
    expect(formatDueDateLabel('')).toBeNull()
    expect(formatDueDateLabel('soon')).toBeNull()
  })
})
