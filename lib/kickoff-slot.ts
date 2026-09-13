/**
 * lib/kickoff-slot.ts
 *
 * Turn the onboarding kickoff picker's (day, time label) pair into a real
 * instant. The picker used to hand back an opaque "2-1:30 pm" id that nothing
 * could book against, so pressing "Book and enter your studio" wrote nothing
 * (ship readiness audit, Tier 1 item 19).
 *
 * The times are wall-clock in the visitor's own timezone, which is the promise
 * the picker makes ("9:30 am" means 9:30 their time). We therefore build the
 * Date in local time and let toISOString() convert, rather than assembling a
 * UTC string by hand.
 *
 * Pure and dependency-free so it is unit-testable and safe in a client bundle.
 */

/** '9:30 am' | '11:00 AM' | '1:30pm' -> 24h parts. Null when unparseable. */
export function parseSlotTime(label: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*$/i.exec(label)
  if (!m) return null
  const rawHour = Number(m[1])
  const minute = m[2] === undefined ? 0 : Number(m[2])
  if (!Number.isFinite(rawHour) || rawHour < 1 || rawHour > 12) return null
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null
  const pm = m[3].toLowerCase() === 'p'
  const hour = pm ? (rawHour === 12 ? 12 : rawHour + 12) : (rawHour === 12 ? 0 : rawHour)
  return { hour, minute }
}

/** Combine a calendar day with a time label into a local-time Date. */
export function slotDateTime(day: Date, label: string): Date | null {
  const time = parseSlotTime(label)
  if (!time) return null
  const ms = day.getTime()
  if (!Number.isFinite(ms)) return null
  const out = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute, 0, 0)
  return Number.isFinite(out.getTime()) ? out : null
}

/** The value the picker stores and the booking POSTs. Null when unparseable. */
export function slotIso(day: Date, label: string): string | null {
  const dt = slotDateTime(day, label)
  return dt ? dt.toISOString() : null
}

/**
 * The studio's own clock. Every artefact that outlives the picker (the
 * confirmation email, the studio's bell row) is rendered on a server whose
 * runtime timezone is UTC, so a formatter with no explicit zone would tell the
 * client "1:30 am" about the 1:30 pm they just clicked. When we do not know the
 * visitor's zone we fall back to this rather than to UTC.
 */
export const STUDIO_TIME_ZONE = 'Pacific/Auckland'

/** True when this runtime can format against the given IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-NZ', { timeZone: tz }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

/** Caller-supplied zone -> something safe to format with. Never throws. */
export function resolveTimeZone(tz: string | null | undefined): string {
  if (typeof tz === 'string' && isValidTimeZone(tz.trim())) return tz.trim()
  return STUDIO_TIME_ZONE
}

/** The zone the person in front of the picker is actually living in. */
export function visitorTimeZone(): string {
  try {
    return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return STUDIO_TIME_ZONE
  }
}

export interface SlotFormatOptions {
  /** IANA zone to render in. Defaults to the studio's own clock. */
  timeZone?: string | null
  locale?: string
  /** Append the zone abbreviation, e.g. "NZST". */
  withZone?: boolean
}

/** Human summary for the confirmation copy, e.g. "Tue 9 Sep, 1:30 pm". */
export function formatSlotSummary(iso: string, options: SlotFormatOptions = {}): string {
  const dt = new Date(iso)
  if (!Number.isFinite(dt.getTime())) return ''
  const { locale = 'en-NZ', withZone = false } = options
  const timeZone = resolveTimeZone(options.timeZone)
  const day = dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone })
  const time = dt.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  })
  return `${day}, ${time}`
}

/** Just the time, e.g. "1:30 pm". The chip label GET /api/portal/kickoff-slots
 *  returns per slot, and what the picker renders on each button. */
export function formatSlotTime(iso: string, options: SlotFormatOptions = {}): string {
  const dt = new Date(iso)
  if (!Number.isFinite(dt.getTime())) return ''
  const { locale = 'en-NZ', withZone = false } = options
  const timeZone = resolveTimeZone(options.timeZone)
  return dt.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    ...(withZone ? { timeZoneName: 'short' as const } : {}),
  })
}

/** Long form for the email, e.g. "Wednesday, 9 September at 1:30 pm NZST". */
export function formatSlotLong(iso: string, options: SlotFormatOptions = {}): string {
  const dt = new Date(iso)
  if (!Number.isFinite(dt.getTime())) return ''
  const { locale = 'en-NZ' } = options
  const timeZone = resolveTimeZone(options.timeZone)
  const day = dt.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  })
  const time = dt.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  })
  return `${day} at ${time}`
}

// ── grouping (GET /api/portal/kickoff-slots consumers) ─────────────────────

/** The minimum a slot needs to be grouped and rendered. */
export interface GroupableKickoffSlot {
  /** The bookable UTC instant, exactly what the booking POST sends. */
  start: string
  /** Pre-formatted time label, already rendered in the caller's zone. */
  label: string
}

export interface KickoffSlotDayGroup<T extends GroupableKickoffSlot = GroupableKickoffSlot> {
  /** Stable sort/dedupe key, "YYYY-MM-DD" in the grouping zone. */
  dateKey: string
  /** Short weekday, e.g. "Tue", in the grouping zone. */
  weekday: string
  /** Day + month, e.g. "9 Sep", in the grouping zone. */
  date: string
  slots: T[]
}

/**
 * Group a flat slot list into calendar days IN `timeZone`, the visitor's own
 * zone, not the studio's. A slot near midnight can land on a different
 * calendar day depending on whose clock is doing the grouping, which is
 * exactly why this cannot just reuse `studioDate` off the server payload.
 *
 * `weekday` / `date` come back split (rather than one combined string) so the
 * picker can keep its existing two-line day heading (bold weekday, muted
 * date) unchanged.
 *
 * Pure: no network, no DOM. Order is preserved (the route already returns
 * slots earliest-first), so callers get days in chronological order for free.
 */
export function groupKickoffSlotsByDay<T extends GroupableKickoffSlot>(
  slots: T[],
  timeZone: string | null | undefined,
): KickoffSlotDayGroup<T>[] {
  const zone = resolveTimeZone(timeZone)
  const groups = new Map<string, KickoffSlotDayGroup<T>>()
  const order: string[] = []

  for (const slot of slots) {
    const dt = new Date(slot.start)
    if (!Number.isFinite(dt.getTime())) continue
    // en-CA reliably renders YYYY-MM-DD, which sorts and dedupes correctly
    // with no extra parsing.
    const dateKey = dt.toLocaleDateString('en-CA', { timeZone: zone })
    let group = groups.get(dateKey)
    if (!group) {
      const weekday = dt.toLocaleDateString('en-NZ', { weekday: 'short', timeZone: zone })
      const date = dt.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: zone })
      group = { dateKey, weekday, date, slots: [] }
      groups.set(dateKey, group)
      order.push(dateKey)
    }
    group.slots.push(slot)
  }

  return order.map(key => groups.get(key) as KickoffSlotDayGroup<T>)
}

// ── booking outcome copy (components/tahi/onboarding-content.tsx) ──────────

/**
 * The kickoff step's fallback message on a failed booking POST.
 *
 * Liam walked the kickoff step as a dummy client from his own admin browser,
 * which is Client view (read-only by design): POST /api/portal/calls
 * correctly answered 403 { error: 'Read-only in client view' }, but the
 * wizard showed the generic "we could not hold that time" line, which reads
 * like a real outage rather than the read-only lens it actually was.
 *
 * Every other failure (a genuine 403/500, a network error, a slot that has
 * gone stale) keeps the generic copy: it is still true and still the right
 * next action (try another slot).
 */
export function kickoffBookingErrorMessage(status: number, apiError: string | null | undefined): string {
  if (status === 403 && apiError === 'Read-only in client view') {
    return 'This is a read-only client view, so nothing was booked.'
  }
  return 'We could not hold that time. Try another slot, or we will follow up by email.'
}
