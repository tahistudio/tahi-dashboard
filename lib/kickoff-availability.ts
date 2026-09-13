/**
 * lib/kickoff-availability.ts
 *
 * Turns the studio's business hours into real bookable half-hour slots for
 * the onboarding kickoff picker (GET /api/portal/kickoff-slots). Liam's
 * feedback walking the kickoff step as a dummy client: the picker offered
 * four fixed labels ('9:30 am', '11:00 am', '1:30 pm', '3:00 pm') on any of
 * the next four weekdays with no idea whether he actually had that hour
 * free.
 *
 * Everything here is computed from calendar civil dates in the studio's own
 * zone (Pacific/Auckland), never from the runtime's clock, so a slot always
 * lands on the studio's real working day regardless of which side of a DST
 * transition "now" happens to fall on. The zone maths is delegated to
 * lib/call-time.ts's `normalizeCallInstant`, the same function the booking
 * path and the calendar sync already trust to read the platform's own tz
 * database rather than a hardcoded NZST/NZDT table.
 *
 * Pure and D1-free: the caller (the route) does the Google Calendar lookup
 * and hands the busy blocks in as plain UTC instants. Nothing here makes a
 * network call, so it is safe to unit test without mocking anything.
 */

import { normalizeCallInstant } from './call-time'
import { STUDIO_TIME_ZONE } from './kickoff-slot'

export { STUDIO_TIME_ZONE }

export const KICKOFF_WORKING_DAYS = 5
export const KICKOFF_WINDOW_START_HOUR = 9
export const KICKOFF_WINDOW_END_HOUR = 17
export const KICKOFF_SLOT_MINUTES = 30

/** A busy block from the studio's calendar, as UTC instants. */
export interface KickoffBusyBlock {
  start: string
  end: string
}

/** One bookable half-hour. `start` is the exact value the booking POST sends
 *  as `scheduledAt`. */
export interface KickoffSlot {
  start: string
  end: string
  /** The studio's own calendar day this slot falls on, "YYYY-MM-DD" in
   *  Pacific/Auckland. Not what a visitor should group by: their own zone can
   *  put the same instant on a different calendar day. */
  studioDate: string
}

export interface BuildKickoffSlotsOptions {
  /** The instant "now" is evaluated at. Defaults to `new Date()`; overridable
   *  for tests. */
  now?: Date
  /** How many of the studio's working days (Mon-Fri, Pacific/Auckland) to
   *  build slots across. */
  workingDays?: number
  /** Studio opens, in NZ wall-clock hours (24h). */
  startHour?: number
  /** Studio closes, in NZ wall-clock hours (24h). The last slot always ends
   *  at or before this. */
  endHour?: number
  /** Slot length in minutes. */
  slotMinutes?: number
  /** Busy blocks pulled from the studio's calendar. Empty (the default) means
   *  every slot in the window is offered, the honest fallback when Google is
   *  not connected or the free/busy call failed. */
  busy?: KickoffBusyBlock[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

interface CivilDate {
  year: number
  month: number // 1-12
  day: number
}

function civilDateKey(d: CivilDate): string {
  return `${pad(d.year)}-${pad(d.month)}-${pad(d.day)}`
}

/** The civil (calendar) date `instant` falls on in `timeZone`. */
function civilDateAt(instant: Date, timeZone: string): CivilDate {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** `date` plus `delta` calendar days. Pure civil-date arithmetic: the UTC
 *  `Date` here is only ever used as a day counter, never read back as an
 *  instant, so it cannot be affected by any zone's DST rules. */
function addCivilDays(date: CivilDate, delta: number): CivilDate {
  const anchor = new Date(Date.UTC(date.year, date.month - 1, date.day))
  anchor.setUTCDate(anchor.getUTCDate() + delta)
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1, day: anchor.getUTCDate() }
}

/** 0 (Sunday) to 6 (Saturday) for this civil date, as a weekday IN `timeZone`.
 *  Resolved via `normalizeCallInstant` at NOON on that date (never near a
 *  midnight boundary) so it agrees with the booking path about exactly where
 *  the studio's day starts and ends across a DST transition. */
function weekdayOf(date: CivilDate, timeZone: string): number {
  const noon = normalizeCallInstant(`${civilDateKey(date)}T12:00:00`, timeZone)
  if (!noon) return -1
  const wd = new Date(noon).toLocaleDateString('en-US', { timeZone, weekday: 'short' })
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[wd] ?? -1
}

/** The next `count` working days (Mon-Fri) in `timeZone`, starting the day
 *  after `now`'s civil date. Today is deliberately never offered: the last
 *  screen of onboarding should not hand someone a slot minutes away. */
export function nextWorkingDays(now: Date, count: number, timeZone: string): CivilDate[] {
  const out: CivilDate[] = []
  let cursor = civilDateAt(now, timeZone)
  let guard = 0
  while (out.length < count && guard++ < count * 3 + 14) {
    cursor = addCivilDays(cursor, 1)
    const wd = weekdayOf(cursor, timeZone)
    if (wd === 0 || wd === 6) continue
    out.push(cursor)
  }
  return out
}

/**
 * The studio's bookable half-hours across its next working days, minus any
 * busy block that overlaps. Never throws and never returns a slot at or
 * before `now`.
 */
export function buildKickoffSlots(options: BuildKickoffSlotsOptions = {}): KickoffSlot[] {
  const now = options.now ?? new Date()
  const workingDays = options.workingDays ?? KICKOFF_WORKING_DAYS
  const startHour = options.startHour ?? KICKOFF_WINDOW_START_HOUR
  const endHour = options.endHour ?? KICKOFF_WINDOW_END_HOUR
  const slotMinutes = options.slotMinutes ?? KICKOFF_SLOT_MINUTES
  const busy = (options.busy ?? [])
    .map(b => ({ startMs: new Date(b.start).getTime(), endMs: new Date(b.end).getTime() }))
    .filter(b => Number.isFinite(b.startMs) && Number.isFinite(b.endMs))

  const days = nextWorkingDays(now, workingDays, STUDIO_TIME_ZONE)
  const nowMs = now.getTime()
  const slots: KickoffSlot[] = []

  for (const day of days) {
    const dateKey = civilDateKey(day)
    for (let m = startHour * 60; m + slotMinutes <= endHour * 60; m += slotMinutes) {
      const hh = Math.floor(m / 60)
      const mm = m % 60
      const start = normalizeCallInstant(`${dateKey}T${pad(hh)}:${pad(mm)}:00`, STUDIO_TIME_ZONE)
      if (!start) continue
      const startMs = new Date(start).getTime()
      if (startMs <= nowMs) continue
      const endMs = startMs + slotMinutes * 60_000
      const end = new Date(endMs).toISOString()

      const overlapsBusy = busy.some(b => startMs < b.endMs && b.startMs < endMs)
      if (overlapsBusy) continue

      slots.push({ start, end, studioDate: dateKey })
    }
  }
  return slots
}
