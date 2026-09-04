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

/** Human summary for the confirmation copy, e.g. "Tue 9 Sep, 1:30 pm". */
export function formatSlotSummary(iso: string, locale = 'en-NZ'): string {
  const dt = new Date(iso)
  if (!Number.isFinite(dt.getTime())) return ''
  const day = dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = dt.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  return `${day}, ${time}`
}
