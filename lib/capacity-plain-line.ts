/**
 * lib/capacity-plain-line.ts
 *
 * Turns the numbers behind the capacity card into one sentence a person can
 * read at a glance, for example "Free about 60 hours a month, can start
 * 8 Sep". Pure, so every wording state is unit tested without a clock, a
 * network or a D1 handle.
 *
 * Inputs mirror what POST /api/admin/capacity/start-date already returns, so
 * there is no second computation of capacity or start dates here. When the
 * numbers needed for a sentence are missing the result is an honest "unknown"
 * line instead of a guess.
 */

/** Average weeks in a month (52 / 12), used to turn weekly hours into monthly. */
const WEEKS_PER_MONTH = 52 / 12

/** At or above this share of capacity committed, the studio reads as nearly full. */
const NEARLY_FULL_SHARE = 0.9

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface CapacityLineInput {
  /** Sum of every active team member's weekly hours. */
  totalTeamCapacity: number | null | undefined
  /** Weekly hours still unbooked (total capacity minus subscription hours). */
  availableHoursPerWeek: number | null | undefined
  /** Earliest week an engagement of the asked-for size fits, ISO, or null if none in the window. */
  earliestDate: string | null | undefined
}

export type CapacityLineState = 'plenty' | 'nearly_full' | 'full' | 'unknown'

export interface CapacityLine {
  state: CapacityLineState
  /** The sentence to show. Always a complete, plain-words sentence. */
  text: string
}

/** "hour" or "hours" for a whole number. */
function hoursWord(n: number): string {
  return n === 1 ? 'hour' : 'hours'
}

/**
 * Weekly hours to a rounded monthly figure. Small numbers stay exact so
 * "about 7 hours" is not rounded to 5 or 10; larger ones round to the nearest
 * 5 so the sentence does not claim false precision.
 */
export function monthlyFreeHours(weeklyHours: number): number {
  const monthly = weeklyHours * WEEKS_PER_MONTH
  if (monthly < 20) return Math.max(0, Math.round(monthly))
  return Math.round(monthly / 5) * 5
}

/**
 * Formats a start date the way the app reads dates in New Zealand: day first,
 * short month, "8 Sep". The year is added only when it differs from `now`'s
 * year ("5 Jan 2027"). Uses UTC fields because the start-date route stamps
 * midnight UTC for a Monday; reading local fields would slip a day for anyone
 * west of UTC. Returns null for anything that does not parse.
 */
export function formatStartDate(iso: string, now: Date = new Date()): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const base = `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`
}

/** True when the date is today or earlier, so "can start now" is the honest wording. */
function isStartableNow(iso: string, now: Date): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  return d.getTime() <= endOfToday
}

/** Builds the plain-words capacity sentence. */
export function buildCapacityLine(input: CapacityLineInput, now: Date = new Date()): CapacityLine {
  const total = input.totalTeamCapacity
  const available = input.availableHoursPerWeek

  if (
    typeof total !== 'number' || !Number.isFinite(total) || total <= 0 ||
    typeof available !== 'number' || !Number.isFinite(available)
  ) {
    return { state: 'unknown', text: 'Not enough information yet to say how much room there is.' }
  }

  const startLabel = input.earliestDate ? formatStartDate(input.earliestDate, now) : null
  const startNow = input.earliestDate ? isStartableNow(input.earliestDate, now) : false
  const startPhrase = startLabel ? (startNow ? 'can start now' : `can start ${startLabel}`) : null

  const free = Math.max(0, available)
  const monthly = monthlyFreeHours(free)

  if (free <= 0 || monthly < 1) {
    return {
      state: 'full',
      text: startPhrase
        ? `Fully booked right now, ${startPhrase}.`
        : 'Fully booked, with no room to start new work in the next 12 weeks.',
    }
  }

  const committedShare = (total - free) / total
  const state: CapacityLineState = committedShare >= NEARLY_FULL_SHARE ? 'nearly_full' : 'plenty'
  const freePhrase = `Free about ${monthly} ${hoursWord(monthly)} a month`

  if (startPhrase) return { state, text: `${freePhrase}, ${startPhrase}.` }
  return { state, text: `${freePhrase}, but no start date fits in the next 12 weeks.` }
}
