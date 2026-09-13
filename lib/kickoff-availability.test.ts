/**
 * Liam's feedback walking the kickoff step as a dummy client: the picker
 * offered four fixed labels on any of the next four weekdays with no idea
 * whether the studio actually had that hour free. lib/kickoff-availability.ts
 * replaces that with a real window (the studio's business hours in
 * Pacific/Auckland) minus whatever Google Calendar's free/busy reports busy.
 *
 * These fixtures pin "now" to Thursday 24 September 2026, so the next five
 * working days (Fri 25, Mon 28, Tue 29, Wed 30, Thu 1 Oct) straddle NZ's
 * 2026 daylight-saving transition (2am Sunday 27 September, NZST -> NZDT):
 * Friday's 9am slot is UTC+12, Monday's is UTC+13. If the day math ever
 * regressed to a fixed offset table instead of reading the zone via
 * normalizeCallInstant, this is exactly where it would drift by an hour.
 */
import { describe, it, expect } from 'vitest'
import {
  buildKickoffSlots,
  nextWorkingDays,
  KICKOFF_WORKING_DAYS,
  KICKOFF_WINDOW_START_HOUR,
  KICKOFF_WINDOW_END_HOUR,
  KICKOFF_SLOT_MINUTES,
  STUDIO_TIME_ZONE,
} from '@/lib/kickoff-availability'

// Thursday 24 September 2026, 2pm NZST (well inside the working day).
const NOW = new Date('2026-09-24T02:00:00.000Z')
const SLOTS_PER_DAY = ((KICKOFF_WINDOW_END_HOUR - KICKOFF_WINDOW_START_HOUR) * 60) / KICKOFF_SLOT_MINUTES

describe('nextWorkingDays', () => {
  it('never offers today, only days after it', () => {
    const days = nextWorkingDays(NOW, KICKOFF_WORKING_DAYS, STUDIO_TIME_ZONE)
    expect(days[0]).toEqual({ year: 2026, month: 9, day: 25 })
  })

  it('skips both weekend days', () => {
    const days = nextWorkingDays(NOW, KICKOFF_WORKING_DAYS, STUDIO_TIME_ZONE)
    const keys = days.map(d => `${d.year}-${d.month}-${d.day}`)
    expect(keys).toEqual(['2026-9-25', '2026-9-28', '2026-9-29', '2026-9-30', '2026-10-1'])
  })

  it('returns exactly the requested count', () => {
    expect(nextWorkingDays(NOW, 3, STUDIO_TIME_ZONE)).toHaveLength(3)
    expect(nextWorkingDays(NOW, KICKOFF_WORKING_DAYS, STUDIO_TIME_ZONE)).toHaveLength(KICKOFF_WORKING_DAYS)
  })
})

describe('buildKickoffSlots: the plain window', () => {
  it('offers every half-hour in business hours, on every working day, with no busy blocks', () => {
    const slots = buildKickoffSlots({ now: NOW })
    expect(slots).toHaveLength(KICKOFF_WORKING_DAYS * SLOTS_PER_DAY)
    const days = new Set(slots.map(s => s.studioDate))
    expect(days).toEqual(new Set(['2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']))
  })

  it('never returns a slot at or before "now"', () => {
    const slots = buildKickoffSlots({ now: NOW })
    for (const s of slots) expect(new Date(s.start).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('every slot is exactly KICKOFF_SLOT_MINUTES long', () => {
    const slots = buildKickoffSlots({ now: NOW })
    for (const s of slots) {
      expect(new Date(s.end).getTime() - new Date(s.start).getTime()).toBe(KICKOFF_SLOT_MINUTES * 60_000)
    }
  })

  it('crosses the NZ DST transition without drifting: Friday is +12, the following Monday is +13', () => {
    const slots = buildKickoffSlots({ now: NOW })
    // First slot of the day is always the window's opening half-hour.
    const fridayFirst = slots.filter(s => s.studioDate === '2026-09-25')[0]
    const mondayFirst = slots.filter(s => s.studioDate === '2026-09-28')[0]
    expect(fridayFirst.start).toBe('2026-09-24T21:00:00.000Z') // 9am NZST (UTC+12)
    expect(mondayFirst.start).toBe('2026-09-27T20:00:00.000Z') // 9am NZDT (UTC+13)
  })
})

describe('buildKickoffSlots: busy blocks', () => {
  it('removes only the slots a busy block overlaps', () => {
    // Friday 9:00-10:00 NZST busy -> removes the 9:00 and 9:30 chips, keeps 10:00.
    const slots = buildKickoffSlots({
      now: NOW,
      busy: [{ start: '2026-09-24T21:00:00.000Z', end: '2026-09-24T22:00:00.000Z' }],
    })
    const fridayTimes = slots.filter(s => s.studioDate === '2026-09-25').map(s => s.start)
    expect(fridayTimes).not.toContain('2026-09-24T21:00:00.000Z')
    expect(fridayTimes).not.toContain('2026-09-24T21:30:00.000Z')
    expect(fridayTimes).toContain('2026-09-24T22:00:00.000Z')
    // Only the busy day loses slots; the rest of the window is untouched.
    expect(slots).toHaveLength(KICKOFF_WORKING_DAYS * SLOTS_PER_DAY - 2)
  })

  it('a busy block covering the whole day removes every slot on it', () => {
    const slots = buildKickoffSlots({
      now: NOW,
      busy: [{ start: '2026-09-24T21:00:00.000Z', end: '2026-09-25T05:00:00.000Z' }],
    })
    expect(slots.some(s => s.studioDate === '2026-09-25')).toBe(false)
    expect(slots).toHaveLength((KICKOFF_WORKING_DAYS - 1) * SLOTS_PER_DAY)
  })

  it('an empty busy list is the honest "unsynced" fallback: the full window, nothing hidden', () => {
    const withEmptyBusy = buildKickoffSlots({ now: NOW, busy: [] })
    const withNoBusyOption = buildKickoffSlots({ now: NOW })
    expect(withEmptyBusy).toEqual(withNoBusyOption)
  })

  it('ignores an unparseable busy block rather than throwing', () => {
    const slots = buildKickoffSlots({
      now: NOW,
      busy: [{ start: 'not-a-date', end: 'also-not-a-date' }],
    })
    expect(slots).toHaveLength(KICKOFF_WORKING_DAYS * SLOTS_PER_DAY)
  })
})
