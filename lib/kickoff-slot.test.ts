/**
 * Ship readiness Tier 1 item 19: the kickoff picker hands back a bookable
 * instant instead of an opaque "2-1:30 pm" id.
 */
import { describe, it, expect } from 'vitest'
import {
  parseSlotTime,
  slotDateTime,
  slotIso,
  formatSlotSummary,
  formatSlotTime,
  formatSlotLong,
  isValidTimeZone,
  resolveTimeZone,
  visitorTimeZone,
  groupKickoffSlotsByDay,
  kickoffBookingErrorMessage,
  STUDIO_TIME_ZONE,
} from '@/lib/kickoff-slot'

describe('parseSlotTime', () => {
  it('parses the picker labels', () => {
    expect(parseSlotTime('9:30 am')).toEqual({ hour: 9, minute: 30 })
    expect(parseSlotTime('11:00 am')).toEqual({ hour: 11, minute: 0 })
    expect(parseSlotTime('1:30 pm')).toEqual({ hour: 13, minute: 30 })
    expect(parseSlotTime('3:00 pm')).toEqual({ hour: 15, minute: 0 })
  })

  it('handles the midnight and noon edges', () => {
    expect(parseSlotTime('12:00 am')).toEqual({ hour: 0, minute: 0 })
    expect(parseSlotTime('12:30 pm')).toEqual({ hour: 12, minute: 30 })
  })

  it('tolerates casing, dots and a missing minute', () => {
    expect(parseSlotTime('9 AM')).toEqual({ hour: 9, minute: 0 })
    expect(parseSlotTime('  4:15p.m. ')).toEqual({ hour: 16, minute: 15 })
  })

  it('rejects anything it cannot read', () => {
    expect(parseSlotTime('')).toBeNull()
    expect(parseSlotTime('13:30 pm')).toBeNull()
    expect(parseSlotTime('9:75 am')).toBeNull()
    expect(parseSlotTime('half nine')).toBeNull()
    expect(parseSlotTime('09:30')).toBeNull()
  })
})

describe('slotDateTime', () => {
  it('sets the wall-clock time on the given day, in local time', () => {
    const day = new Date(2026, 8, 9, 17, 42, 13, 500) // 9 Sep 2026, junk time
    const dt = slotDateTime(day, '1:30 pm')
    expect(dt).not.toBeNull()
    expect(dt!.getFullYear()).toBe(2026)
    expect(dt!.getMonth()).toBe(8)
    expect(dt!.getDate()).toBe(9)
    expect(dt!.getHours()).toBe(13)
    expect(dt!.getMinutes()).toBe(30)
    expect(dt!.getSeconds()).toBe(0)
    expect(dt!.getMilliseconds()).toBe(0)
  })

  it('does not mutate the day it was handed', () => {
    const day = new Date(2026, 8, 9, 17, 42)
    const before = day.getTime()
    slotDateTime(day, '9:30 am')
    expect(day.getTime()).toBe(before)
  })

  it('returns null for an unreadable label or an invalid day', () => {
    expect(slotDateTime(new Date(2026, 8, 9), 'whenever')).toBeNull()
    expect(slotDateTime(new Date(Number.NaN), '9:30 am')).toBeNull()
  })
})

describe('slotIso', () => {
  it('round-trips to the same local wall-clock time', () => {
    const day = new Date(2026, 8, 9)
    const iso = slotIso(day, '3:00 pm')
    expect(iso).not.toBeNull()
    const back = new Date(iso!)
    expect(back.getHours()).toBe(15)
    expect(back.getMinutes()).toBe(0)
    expect(back.getDate()).toBe(9)
  })

  it('produces a distinct value per day and per time', () => {
    const a = slotIso(new Date(2026, 8, 9), '9:30 am')
    const b = slotIso(new Date(2026, 8, 10), '9:30 am')
    const c = slotIso(new Date(2026, 8, 9), '11:00 am')
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('returns null rather than an unbookable string', () => {
    expect(slotIso(new Date(2026, 8, 9), 'noon-ish')).toBeNull()
  })
})

describe('formatSlotSummary', () => {
  it('renders a short human summary', () => {
    const iso = slotIso(new Date(2026, 8, 9), '1:30 pm')!
    // Explicit zone: the picker builds a local instant, and the formatter now
    // defaults to the studio clock rather than to whatever the runtime is.
    const summary = formatSlotSummary(iso, { timeZone: visitorTimeZone() })
    expect(summary).toContain('9')
    expect(summary).toContain('Sep')
    expect(summary.length).toBeGreaterThan(0)
  })

  it('is empty for an unparseable timestamp', () => {
    expect(formatSlotSummary('not-a-date')).toBe('')
  })
})

/**
 * The confirmation email and the studio's bell row render on a Cloudflare
 * worker whose runtime clock is UTC. Without an explicit zone, the client who
 * picked 1:30 pm NZ was emailed "1:30 am UTC", which is the one mistake a
 * confirmation exists to prevent.
 */
describe('timezone resolution', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidTimeZone('Pacific/Auckland')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
  })

  it('rejects junk rather than throwing', () => {
    expect(isValidTimeZone('Middle/Earth')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('falls back to the studio clock, never to UTC', () => {
    expect(resolveTimeZone(null)).toBe(STUDIO_TIME_ZONE)
    expect(resolveTimeZone('Middle/Earth')).toBe(STUDIO_TIME_ZONE)
    expect(resolveTimeZone(undefined)).toBe(STUDIO_TIME_ZONE)
  })

  it('keeps a valid zone, trimmed', () => {
    expect(resolveTimeZone('  Europe/London ')).toBe('Europe/London')
  })

  it('always resolves the visitor zone to something formattable', () => {
    expect(isValidTimeZone(visitorTimeZone())).toBe(true)
  })
})

describe('zone-aware formatting', () => {
  // 2026-09-09T01:30:00Z is 1:30 pm in Auckland, still 8 September in New York.
  const iso = '2026-09-09T01:30:00.000Z'

  it('renders the summary in the requested zone', () => {
    const nz = formatSlotSummary(iso, { timeZone: 'Pacific/Auckland' })
    expect(nz).toContain('9')
    expect(nz).toContain('Sep')
    expect(nz).toMatch(/1:30/)
  })

  it('renders a different zone as a different wall clock', () => {
    const nz = formatSlotSummary(iso, { timeZone: 'Pacific/Auckland' })
    const ny = formatSlotSummary(iso, { timeZone: 'America/New_York' })
    expect(ny).not.toBe(nz)
    expect(ny).toContain('8')
  })

  it('appends the zone abbreviation on request', () => {
    const withZone = formatSlotSummary(iso, { timeZone: 'Pacific/Auckland', withZone: true })
    const without = formatSlotSummary(iso, { timeZone: 'Pacific/Auckland' })
    expect(withZone.length).toBeGreaterThan(without.length)
    expect(withZone.startsWith(without)).toBe(true)
  })

  it('long form names the day, the month and the zone', () => {
    const long = formatSlotLong(iso, { timeZone: 'Pacific/Auckland' })
    expect(long).toContain('September')
    expect(long).toContain(' at ')
    expect(long).toMatch(/1:30/)
  })

  it('does not fall back to the runtime clock when the zone is junk', () => {
    expect(formatSlotLong(iso, { timeZone: 'Middle/Earth' }))
      .toBe(formatSlotLong(iso, { timeZone: STUDIO_TIME_ZONE }))
  })

  it('is empty for an unparseable timestamp', () => {
    expect(formatSlotLong('not-a-date')).toBe('')
  })
})

describe('formatSlotTime', () => {
  const iso = '2026-09-09T01:30:00.000Z' // 1:30pm in Auckland

  it('renders just the time, no day', () => {
    const label = formatSlotTime(iso, { timeZone: 'Pacific/Auckland' })
    expect(label).toMatch(/1:30/)
    expect(label).not.toMatch(/Sep|Wed/)
  })

  it('is empty for an unparseable timestamp', () => {
    expect(formatSlotTime('not-a-date')).toBe('')
  })
})

describe('groupKickoffSlotsByDay', () => {
  it('groups slots onto the same calendar day in the requested zone', () => {
    const groups = groupKickoffSlotsByDay(
      [
        { start: '2026-09-24T21:00:00.000Z', label: '9:00 am' },
        { start: '2026-09-24T21:30:00.000Z', label: '9:30 am' },
        { start: '2026-09-27T20:00:00.000Z', label: '9:00 am' },
      ],
      'Pacific/Auckland',
    )
    expect(groups.map(g => g.dateKey)).toEqual(['2026-09-25', '2026-09-28'])
    expect(groups[0].slots).toHaveLength(2)
    expect(groups[1].slots).toHaveLength(1)
  })

  it('preserves the order the slots arrived in (earliest first)', () => {
    const groups = groupKickoffSlotsByDay(
      [
        { start: '2026-09-27T20:00:00.000Z', label: 'later day' },
        { start: '2026-09-24T21:00:00.000Z', label: 'earlier day' },
      ],
      'Pacific/Auckland',
    )
    expect(groups.map(g => g.dateKey)).toEqual(['2026-09-28', '2026-09-25'])
  })

  it('splits weekday and date so the picker keeps its two-line heading', () => {
    const [group] = groupKickoffSlotsByDay(
      [{ start: '2026-09-24T21:00:00.000Z', label: '9:00 am' }],
      'Pacific/Auckland',
    )
    expect(group.weekday).toBe('Fri')
    expect(group.date).toContain('25')
    expect(group.date).toContain('Sep')
  })

  it('the SAME instant can land on a different calendar day in a different zone', () => {
    const slots = [{ start: '2026-09-24T12:30:00.000Z', label: 'midnight-ish' }]
    const nz = groupKickoffSlotsByDay(slots, 'Pacific/Auckland')
    const ny = groupKickoffSlotsByDay(slots, 'America/New_York')
    expect(nz[0].dateKey).toBe('2026-09-25')
    expect(ny[0].dateKey).toBe('2026-09-24')
  })

  it('falls back to the studio zone for a junk timezone, never throws', () => {
    const groups = groupKickoffSlotsByDay(
      [{ start: '2026-09-24T21:00:00.000Z', label: '9:00 am' }],
      'Middle/Earth',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].dateKey).toBe('2026-09-25')
  })

  it('skips a slot with an unparseable start rather than throwing', () => {
    const groups = groupKickoffSlotsByDay(
      [
        { start: 'not-a-date', label: 'junk' },
        { start: '2026-09-24T21:00:00.000Z', label: '9:00 am' },
      ],
      'Pacific/Auckland',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].slots).toHaveLength(1)
  })

  it('is empty for an empty slot list', () => {
    expect(groupKickoffSlotsByDay([], 'Pacific/Auckland')).toEqual([])
  })
})

describe('kickoffBookingErrorMessage', () => {
  it('names the read-only client view specifically, for the exact contract POST /api/portal/calls returns', () => {
    expect(kickoffBookingErrorMessage(403, 'Read-only in client view'))
      .toBe('This is a read-only client view, so nothing was booked.')
  })

  it('keeps the generic line for any other 403 (e.g. no org, wrong org)', () => {
    expect(kickoffBookingErrorMessage(403, 'Forbidden'))
      .toBe('We could not hold that time. Try another slot, or we will follow up by email.')
  })

  it('keeps the generic line for a 500, a stale slot, or a network failure', () => {
    expect(kickoffBookingErrorMessage(500, 'Could not book that time'))
      .toBe('We could not hold that time. Try another slot, or we will follow up by email.')
    expect(kickoffBookingErrorMessage(0, null))
      .toBe('We could not hold that time. Try another slot, or we will follow up by email.')
  })

  it('does not match on the string alone without the 403', () => {
    expect(kickoffBookingErrorMessage(500, 'Read-only in client view'))
      .toBe('We could not hold that time. Try another slot, or we will follow up by email.')
  })
})
