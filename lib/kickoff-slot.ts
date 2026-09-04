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
