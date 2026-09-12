import { describe, expect, it } from 'vitest'
import { filterInPreCallWindow, isWithinPreCallWindow } from './pre-call-window'

const WINDOW_START_MIN = 25
const WINDOW_END_MIN = 35

/**
 * Replicates app/api/admin/cron/pre-call-digest/route.ts's ORIGINAL
 * candidate filter exactly: build windowStart/windowEnd as Z-suffixed
 * ISO strings from `now`, then keep rows whose scheduledAt TEXT column
 * is lexicographically >= windowStart and <= windowEnd. This is what
 * SQLite's default (BINARY) collation does to two TEXT columns, so a
 * plain JS string comparison is a faithful stand-in for the SQL
 * gte()/lte() the route actually ran.
 */
function matchesOldSqlWindow(scheduledAt: string, nowMs: number): boolean {
  const windowStart = new Date(nowMs + WINDOW_START_MIN * 60_000).toISOString()
  const windowEnd = new Date(nowMs + WINDOW_END_MIN * 60_000).toISOString()
  return scheduledAt >= windowStart && scheduledAt <= windowEnd
}

describe('reproduction: pre-call digest fired at the wrong time (2026-09-12)', () => {
  // A call scheduled for 10:00 Pacific/Auckland on 15 Sept 2026 (NZST,
  // UTC+12) is a real instant of 2026-09-14T22:00:00Z. Google Calendar's
  // sync route wrote it into discovery_calls.scheduledAt verbatim, in
  // Calendar's own RFC3339 shape: an offset, not a Z.
  const scheduledAtAsGoogleWroteIt = '2026-09-15T10:00:00+12:00'
  const realCallInstantMs = Date.UTC(2026, 8, 14, 22, 0, 0) // 2026-09-14T22:00:00Z

  it('the real pre-call moment (30 min before the call) does NOT match the old SQL-style window', () => {
    const nowMs = realCallInstantMs - 30 * 60_000 // exactly 30 min before the call
    expect(matchesOldSqlWindow(scheduledAtAsGoogleWroteIt, nowMs)).toBe(false)
  })

  it('the old SQL-style window instead fires ~12 hours later (the NZST offset), reproducing "hours off"', () => {
    // 12 hours after the correct trigger time, the runtime's own ISO
    // window bound has rolled onto "2026-09-15", which lexicographically
    // catches up to the "2026-09-15T10:00:00+12:00" row.
    const twelveHoursLate = realCallInstantMs - 30 * 60_000 + 12 * 60 * 60_000
    expect(matchesOldSqlWindow(scheduledAtAsGoogleWroteIt, twelveHoursLate)).toBe(true)
  })

  it('the new instant-based check fires at the real 25-35 min window and nowhere else', () => {
    const at30MinBefore = realCallInstantMs - 30 * 60_000
    const at12HoursLate = at30MinBefore + 12 * 60 * 60_000
    expect(isWithinPreCallWindow(scheduledAtAsGoogleWroteIt, at30MinBefore, WINDOW_START_MIN, WINDOW_END_MIN)).toBe(true)
    expect(isWithinPreCallWindow(scheduledAtAsGoogleWroteIt, at12HoursLate, WINDOW_START_MIN, WINDOW_END_MIN)).toBe(false)
  })

  it('a properly normalised (Z) row matches at the same real moment old or new', () => {
    const normalised = '2026-09-14T22:00:00.000Z'
    const at30MinBefore = realCallInstantMs - 30 * 60_000
    expect(matchesOldSqlWindow(normalised, at30MinBefore)).toBe(true)
    expect(isWithinPreCallWindow(normalised, at30MinBefore, WINDOW_START_MIN, WINDOW_END_MIN)).toBe(true)
  })
})

describe('isWithinPreCallWindow', () => {
  const nowMs = Date.UTC(2026, 8, 14, 21, 30, 0)

  it('true at the middle of the window', () => {
    const at30Min = new Date(nowMs + 30 * 60_000).toISOString()
    expect(isWithinPreCallWindow(at30Min, nowMs, 25, 35)).toBe(true)
  })
  it('false just before the window opens', () => {
    const at24Min = new Date(nowMs + 24 * 60_000).toISOString()
    expect(isWithinPreCallWindow(at24Min, nowMs, 25, 35)).toBe(false)
  })
  it('false just after the window closes', () => {
    const at36Min = new Date(nowMs + 36 * 60_000).toISOString()
    expect(isWithinPreCallWindow(at36Min, nowMs, 25, 35)).toBe(false)
  })
  it('false for unparseable input', () => {
    expect(isWithinPreCallWindow('not a date', nowMs, 25, 35)).toBe(false)
  })
})

describe('filterInPreCallWindow', () => {
  it('keeps only the rows inside the window', () => {
    const nowMs = Date.UTC(2026, 8, 14, 21, 30, 0)
    const rows = [
      { id: 'in-window', scheduledAt: new Date(nowMs + 30 * 60_000).toISOString() },
      { id: 'too-soon', scheduledAt: new Date(nowMs + 5 * 60_000).toISOString() },
      { id: 'too-far', scheduledAt: new Date(nowMs + 3 * 60 * 60_000).toISOString() },
    ]
    const kept = filterInPreCallWindow(rows, nowMs, 25, 35)
    expect(kept.map(r => r.id)).toEqual(['in-window'])
  })
})
