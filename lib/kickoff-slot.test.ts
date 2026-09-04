/**
 * Ship readiness Tier 1 item 19: the kickoff picker hands back a bookable
 * instant instead of an opaque "2-1:30 pm" id.
 */
import { describe, it, expect } from 'vitest'
import { parseSlotTime, slotDateTime, slotIso, formatSlotSummary } from '@/lib/kickoff-slot'

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
    const summary = formatSlotSummary(iso)
    expect(summary).toContain('9')
    expect(summary).toContain('Sep')
    expect(summary.length).toBeGreaterThan(0)
  })

  it('is empty for an unparseable timestamp', () => {
    expect(formatSlotSummary('not-a-date')).toBe('')
  })
})
