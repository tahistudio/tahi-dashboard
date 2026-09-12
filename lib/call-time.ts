/**
 * lib/call-time.ts
 *
 * Normalise any call-time input (discovery_calls.scheduledAt,
 * scheduled_calls.scheduledAt) to an absolute instant: a UTC ISO string
 * with a trailing Z.
 *
 * Why this exists (2026-09-12, Liam): "Pre-call: <email> in ~30 min"
 * emails were arriving hours off the real call. Root cause was a mix of
 * formats reaching the scheduledAt columns:
 *
 *   - Google Calendar's event.start.dateTime is RFC3339 WITH the
 *     calendar's own offset, e.g. "2026-09-15T10:00:00+12:00". The
 *     Calendar sync route wrote this straight into the DB.
 *   - Manual scheduling forms send `new Date(...).toISOString()`, which
 *     is already a real UTC instant (a "Z" string).
 *   - MCP tools / hand-typed values can arrive as a naive local string
 *     with no offset at all, e.g. "2026-09-15T10:00:00".
 *
 * app/api/admin/discovery-calls/upcoming/route.ts already documents the
 * failure mode this causes: SQLite (and JS) compare TEXT columns
 * lexicographically, so "...+12:00" sorts AFTER "...Z" strings on the
 * same calendar day (offsets are read as more digits, not subtracted),
 * and a "gte(windowStart) AND lte(windowEnd)" filter silently excludes
 * the row until roughly the NZ UTC offset (12h NZST / 13h NZDT) has
 * passed. That route works around it with a JS re-check; the pre-call
 * digest cron did not, which is the bug this file fixes at the source.
 *
 * Pure, D1-free, dependency-free: safe to import from any writer and
 * from the client bundle. Uses Intl.DateTimeFormat against the IANA
 * zone rather than a fixed UTC+12/+13 table, so it is correct across
 * the NZST/NZDT transition without a hardcoded date.
 */

import { STUDIO_TIME_ZONE, resolveTimeZone } from './kickoff-slot'

export { STUDIO_TIME_ZONE }

/**
 * True when the string already carries its own offset (a trailing Z, or
 * a +HH:MM / -HH:MM / +HHMM). These describe an absolute instant on
 * their own: parsing them never depends on which timezone the reader
 * assumes.
 */
export function hasExplicitOffset(input: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(input.trim())
}

interface NaiveDateTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  ms: number
}

/**
 * Parse a naive (no offset) date-time string into its wall-clock parts.
 * Accepts "YYYY-MM-DDTHH:mm", "YYYY-MM-DDTHH:mm:ss[.sss]", and a plain
 * space instead of "T" (what `datetime-local` inputs and hand-typed
 * values tend to produce). Returns null for anything else.
 */
function parseNaiveDateTime(input: string): NaiveDateTimeParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, frac] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = s ? Number(s) : 0
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  return { year, month, day, hour, minute, second, ms }
}

/**
 * The offset (in ms, positive = ahead of UTC) `timeZone` is at
 * approximately the given UTC instant. Computed by formatting that
 * instant in the zone and comparing the wall-clock result back against
 * UTC. No hardcoded transition table: NZST (+12h) vs NZDT (+13h) is
 * resolved from the platform's own tz database.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - utcMs
}

/**
 * Convert wall-clock parts meant to be read in `timeZone` to the real
 * UTC instant they describe. Two passes: the first guess treats the
 * wall-clock as if it were already UTC to get a rough offset, the
 * second re-derives the offset at the corrected instant, which only
 * matters for the handful of minutes around a DST transition.
 */
function zonedPartsToUtcMs(parts: NaiveDateTimeParts, timeZone: string): number {
  const guessUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.ms)
  const offset1 = zoneOffsetMs(guessUtc, timeZone)
  const corrected = guessUtc - offset1
  const offset2 = zoneOffsetMs(corrected, timeZone)
  return offset2 === offset1 ? corrected : guessUtc - offset2
}

/**
 * Normalise a call-time input to an absolute instant: a UTC ISO string
 * with a trailing Z (`Date.prototype.toISOString()` shape).
 *
 * - Already-absolute input (has a Z or a +/-HH:MM offset, including
 *   Google Calendar's own offset form) is parsed and re-serialised to
 *   the same instant in canonical Z form. The instant it names never
 *   changes.
 * - Naive input (no offset at all) is treated as wall-clock time in
 *   `timeZone` (default: the studio's own zone, Pacific/Auckland) and
 *   converted to the matching UTC instant. A bare "10:00" always means
 *   10am there, never 10am UTC.
 * - Anything else `Date` can still parse (e.g. an epoch-ms numeric
 *   string) falls back to `new Date(input).toISOString()`.
 *
 * Returns null when the input is empty or cannot be parsed as a date at
 * all: callers should treat that as a validation error, not silently
 * store garbage.
 */
export function normalizeCallInstant(
  input: string | null | undefined,
  timeZone: string = STUDIO_TIME_ZONE,
): string | null {
  const trimmed = input?.trim()
  if (!trimmed) return null

  if (hasExplicitOffset(trimmed)) {
    const d = new Date(trimmed)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }

  const naive = parseNaiveDateTime(trimmed)
  if (naive) {
    const utcMs = zonedPartsToUtcMs(naive, resolveTimeZone(timeZone))
    return Number.isFinite(utcMs) ? new Date(utcMs).toISOString() : null
  }

  const fallback = new Date(trimmed)
  return Number.isFinite(fallback.getTime()) ? fallback.toISOString() : null
}

/**
 * True when `input` is already in the exact canonical form
 * `normalizeCallInstant` produces (`...Z`, milliseconds, nothing else).
 * Used by the maintenance backfill to decide which rows are untouched
 * rather than merely "close enough".
 */
export function isCanonicalInstant(input: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.trim())
}
