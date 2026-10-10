import { normalizeCallInstant, STUDIO_TIME_ZONE } from '@/lib/call-time'

/** Date-only studio deadlines close at the end of that New Zealand day. */
export function normalizeContractExpiry(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const input = value.trim()
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(input)
  if (!date) return null
  const day = `${date[1]}-${date[2]}-${date[3]}`
  const parsedDay = new Date(`${day}T00:00:00Z`)
  if (!Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day) return null
  if (input === day) {
    const end = normalizeCallInstant(`${day}T23:59:59`)
    return end ? new Date(new Date(end).getTime() + 999).toISOString() : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(input)) return null
  // Normalize naive fractional seconds separately: the shared time-zone
  // converter derives whole-second offsets from Intl parts.
  const naiveFraction = /\.(\d{1,3})$/.exec(input)
  if (naiveFraction) {
    const whole = normalizeCallInstant(input.slice(0, -naiveFraction[0].length))
    return whole ? new Date(new Date(whole).getTime() + Number(naiveFraction[1].padEnd(3, '0'))).toISOString() : null
  }
  return normalizeCallInstant(input)
}

export function contractExpiryDay(value: string | null): string {
  if (!value) return ''
  // Older builder dates were stored as 23:59:59Z on the selected day.
  // Keep their selected date visible without rewriting their legal deadline.
  if (/T23:59:59(?:\.000)?Z$/.test(value)) return value.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function contractExpiryLabel(value: string): string {
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: STUDIO_TIME_ZONE, dateStyle: 'long', timeStyle: 'short',
  }).format(new Date(value)) + ' (New Zealand time)'
}
