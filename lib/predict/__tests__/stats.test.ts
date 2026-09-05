/**
 * The arithmetic behind a grounded guess.
 *
 * `median` returning null on an empty cohort is the load-bearing behaviour: a
 * zero here would become a due date of today, which is the most confident
 * possible answer built on nothing at all.
 */
import { describe, it, expect } from 'vitest'
import {
  isoDateAfter,
  isoDatePlusDays,
  isoDaysAgo,
  isoHoursAgo,
  meetsCohortFloor,
  median,
  modeOf,
  roundUpDays,
  startOfTodayIso,
  usableTurnarounds,
} from '@/lib/predict/stats'

describe('median', () => {
  it('takes the middle of an odd cohort', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two middles of an even cohort', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('answers null on an empty cohort rather than zero', () => {
    expect(median([])).toBeNull()
  })

  it('does not reorder the caller\'s array', () => {
    const input = [3, 1, 2]
    median(input)
    expect(input).toEqual([3, 1, 2])
  })

  it('handles a single row', () => {
    expect(median([4.5])).toBe(4.5)
  })
})

describe('usableTurnarounds', () => {
  it('drops a delivered date that precedes its created date', () => {
    // A backdated row is a data fault, not a zero-day delivery. Clamping it to
    // zero would drag the median toward a promise nobody can keep.
    expect(usableTurnarounds([4, -2, 6])).toEqual([4, 6])
  })

  it('keeps a genuine same-day delivery', () => {
    expect(usableTurnarounds([0, 1])).toEqual([0, 1])
  })

  it('drops nulls, undefined and non-finite values', () => {
    expect(usableTurnarounds([2, null, undefined, Number.NaN, Infinity, 3])).toEqual([2, 3])
  })

  it('answers an empty list when nothing survives', () => {
    expect(usableTurnarounds([null, -1])).toEqual([])
  })
})

describe('roundUpDays', () => {
  it('rounds a partial day up, because a due date is a whole day', () => {
    expect(roundUpDays(3.2)).toBe(4)
  })

  it('leaves a whole number alone', () => {
    expect(roundUpDays(5)).toBe(5)
  })

  it('floors at one day, so a fast median never means today', () => {
    expect(roundUpDays(0)).toBe(1)
    expect(roundUpDays(0.4)).toBe(1)
    expect(roundUpDays(-3)).toBe(1)
  })

  it('floors at one for a non-finite input', () => {
    expect(roundUpDays(Number.NaN)).toBe(1)
  })
})

describe('meetsCohortFloor', () => {
  it('needs five rows', () => {
    expect(meetsCohortFloor(4)).toBe(false)
    expect(meetsCohortFloor(5)).toBe(true)
    expect(meetsCohortFloor(200)).toBe(true)
  })
})

describe('modeOf', () => {
  it('picks the most common value', () => {
    expect(modeOf(['a', 'b', 'a'])).toBe('a')
  })

  it('ignores nulls', () => {
    expect(modeOf([null, 'b', null, 'b'])).toBe('b')
  })

  it('answers null on an empty list', () => {
    expect(modeOf([])).toBeNull()
    expect(modeOf([null, undefined])).toBeNull()
  })
})

describe('date helpers', () => {
  it('adds days in the local calendar, not UTC', () => {
    const lateEvening = new Date(2026, 8, 3, 23, 30, 0)
    expect(isoDatePlusDays(1, lateEvening)).toBe('2026-09-04')
  })

  it('rolls a month end over', () => {
    expect(isoDatePlusDays(7, new Date(2026, 8, 28))).toBe('2026-10-05')
  })

  it('adds days to an ISO date string without going near a timezone', () => {
    expect(isoDateAfter('2026-09-05', 4)).toBe('2026-09-09')
    expect(isoDateAfter('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('refuses a string that is not a calendar date', () => {
    expect(isoDateAfter('2026-09-05T00:00:00Z', 1)).toBeNull()
    expect(isoDateAfter('tomorrow', 1)).toBeNull()
  })

  it('looks back the number of days it was asked for', () => {
    const from = new Date('2026-09-05T12:00:00Z')
    expect(isoDaysAgo(180, from).slice(0, 10)).toBe('2026-03-09')
  })

  it('looks back an hour for the per-user ceiling', () => {
    const from = new Date('2026-09-05T12:00:00Z')
    expect(isoHoursAgo(1, from)).toBe('2026-09-05T11:00:00.000Z')
  })

  it('names midnight in the shape createdAt is stored in', () => {
    expect(startOfTodayIso(new Date('2026-09-05T18:20:00Z'))).toBe('2026-09-05T00:00:00Z')
  })
})
