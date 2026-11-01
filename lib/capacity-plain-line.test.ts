import { describe, it, expect } from 'vitest'
import {
  buildCapacityLine,
  buildCapacityLineFromWeek,
  formatStartDate,
  monthlyFreeHours,
  nextMondayIso,
} from './capacity-plain-line'

describe('nextMondayIso', () => {
  it('is the next Monday at midnight UTC, strictly after today', () => {
    // Tuesday 1 Sep 2026
    expect(nextMondayIso(new Date('2026-09-01T10:00:00.000Z'))).toBe('2026-09-07T00:00:00.000Z')
    // A Monday rolls to the following Monday
    expect(nextMondayIso(new Date('2026-09-07T10:00:00.000Z'))).toBe('2026-09-14T00:00:00.000Z')
    // A Sunday rolls to the next day
    expect(nextMondayIso(new Date('2026-09-06T10:00:00.000Z'))).toBe('2026-09-07T00:00:00.000Z')
    // Month boundary
    expect(nextMondayIso(new Date('2026-09-30T10:00:00.000Z'))).toBe('2026-10-05T00:00:00.000Z')
  })
})

describe('buildCapacityLineFromWeek (owner card figures)', () => {
  const now = new Date('2026-09-01T10:00:00.000Z')

  it('available 0 reads as fully booked this week', () => {
    expect(buildCapacityLineFromWeek(80, 0, now)).toEqual({ state: 'full', text: 'Fully booked this week.' })
  })

  it('the 487 percent booked case (80h capacity, 0h available) is fully booked', () => {
    expect(buildCapacityLineFromWeek(80, 0, now).text).toBe('Fully booked this week.')
    // negative available must never read as free time
    expect(buildCapacityLineFromWeek(80, -309.5, now).state).toBe('full')
  })

  it('small positive available is free hours with no start date', () => {
    expect(buildCapacityLineFromWeek(80, 4, now)).toEqual({
      state: 'nearly_full',
      text: 'Free about 17 hours a month, but not enough yet to start a new retainer.',
    })
  })

  it('just under 8 hours has no start date', () => {
    expect(buildCapacityLineFromWeek(80, 7.9, now).text).toContain('not enough yet')
  })

  it('exactly 8 hours can start next Monday', () => {
    expect(buildCapacityLineFromWeek(80, 8, now)).toEqual({
      state: 'nearly_full',
      text: 'Free about 35 hours a month, can start 7 Sep.',
    })
  })

  it('no data is unknown', () => {
    expect(buildCapacityLineFromWeek(0, 0, now).state).toBe('unknown')
    expect(buildCapacityLineFromWeek(undefined, undefined, now).state).toBe('unknown')
  })
})

const NOW = new Date('2026-09-01T10:00:00.000Z')

describe('monthlyFreeHours', () => {
  it('keeps small numbers exact and rounds larger ones to the nearest 5', () => {
    expect(monthlyFreeHours(1)).toBe(4)
    expect(monthlyFreeHours(2)).toBe(9)
    expect(monthlyFreeHours(14)).toBe(60)
    expect(monthlyFreeHours(0)).toBe(0)
  })
})

describe('formatStartDate', () => {
  it('uses day first with a short month and no year in the current year', () => {
    expect(formatStartDate('2026-09-08T00:00:00.000Z', NOW)).toBe('8 Sep')
  })
  it('adds the year when it differs from the current year', () => {
    expect(formatStartDate('2027-01-05T00:00:00.000Z', NOW)).toBe('5 Jan 2027')
  })
  it('reads the UTC calendar day across month boundaries', () => {
    expect(formatStartDate('2026-09-30T00:00:00.000Z', NOW)).toBe('30 Sep')
    expect(formatStartDate('2026-10-01T00:00:00.000Z', NOW)).toBe('1 Oct')
  })
  it('returns null for junk', () => {
    expect(formatStartDate('nope', NOW)).toBeNull()
  })
})

describe('buildCapacityLine', () => {
  it('plenty of room with a start date', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 14, earliestDate: '2026-09-08T00:00:00.000Z' },
      NOW,
    )
    expect(r).toEqual({ state: 'plenty', text: 'Free about 60 hours a month, can start 8 Sep.' })
  })

  it('says can start now when the date is today or past', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 14, earliestDate: '2026-09-01T00:00:00.000Z' },
      NOW,
    )
    expect(r.text).toBe('Free about 60 hours a month, can start now.')
  })

  it('nearly full when 90 percent or more is committed', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 6, earliestDate: '2026-09-08T00:00:00.000Z' },
      NOW,
    )
    expect(r).toEqual({ state: 'nearly_full', text: 'Free about 25 hours a month, can start 8 Sep.' })
  })

  it('singular hour', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 100, availableHoursPerWeek: 0.25, earliestDate: '2026-09-08T00:00:00.000Z' },
      NOW,
    )
    expect(r.text).toBe('Free about 1 hour a month, can start 8 Sep.')
  })

  it('full with a start date', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 0, earliestDate: '2026-10-05T00:00:00.000Z' },
      NOW,
    )
    expect(r).toEqual({ state: 'full', text: 'Fully booked right now, can start 5 Oct.' })
  })

  it('full with no start date', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: -4, earliestDate: null },
      NOW,
    )
    expect(r).toEqual({
      state: 'full',
      text: 'Fully booked this week.',
    })
  })

  it('free hours but no start date for the asked size', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 4, earliestDate: null },
      NOW,
    )
    expect(r.text).toBe('Free about 17 hours a month, but not enough yet to start a new retainer.')
  })

  it('rolls the year over', () => {
    const r = buildCapacityLine(
      { totalTeamCapacity: 80, availableHoursPerWeek: 14, earliestDate: '2027-01-04T00:00:00.000Z' },
      new Date('2026-12-30T00:00:00.000Z'),
    )
    expect(r.text).toBe('Free about 60 hours a month, can start 4 Jan 2027.')
  })

  it('unknown when data is missing or capacity is zero', () => {
    const msg = 'Not enough information yet to say how much room there is.'
    expect(buildCapacityLine({ totalTeamCapacity: null, availableHoursPerWeek: null, earliestDate: null }, NOW))
      .toEqual({ state: 'unknown', text: msg })
    expect(buildCapacityLine({ totalTeamCapacity: 0, availableHoursPerWeek: 0, earliestDate: null }, NOW).state)
      .toBe('unknown')
    expect(buildCapacityLine({ totalTeamCapacity: 40, availableHoursPerWeek: undefined, earliestDate: null }, NOW).state)
      .toBe('unknown')
    expect(buildCapacityLine({ totalTeamCapacity: Number.NaN, availableHoursPerWeek: 5, earliestDate: null }, NOW).state)
      .toBe('unknown')
  })

  it('never uses dashes in any sentence', () => {
    const inputs = [
      { totalTeamCapacity: 80, availableHoursPerWeek: 14, earliestDate: '2026-09-08T00:00:00.000Z' },
      { totalTeamCapacity: 80, availableHoursPerWeek: 0, earliestDate: null },
      { totalTeamCapacity: 0, availableHoursPerWeek: 0, earliestDate: null },
    ]
    for (const i of inputs) expect(buildCapacityLine(i, NOW).text).not.toMatch(/[-\u2013\u2014]/)
  })
})
