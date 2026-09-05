/**
 * lib/predict/stats.ts
 *
 * The small arithmetic behind a grounded guess.
 *
 * `median` is lifted out of lib/calculator/compute.ts, where it was private,
 * because both callers want the same thing from it: null on an empty cohort
 * rather than a zero that reads like an answer. D1 has no percentile function,
 * so the deltas are selected raw under a bound and the middle is taken here.
 *
 * Pure, no dates from the environment unless one is handed in, so every rule
 * is testable without freezing the clock.
 */

import { COHORT_FLOOR } from './types'

/** Median of a number list. Null on empty, which is the whole point. */
export function median(nums: readonly number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * The usable turnaround deltas out of a cohort row set.
 *
 * A row whose delivered date precedes its created date is a data fault, not a
 * zero-day delivery, so it is dropped rather than clamped: one backdated row
 * would otherwise drag the median toward a promise the studio cannot keep.
 */
export function usableTurnarounds(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
}

/**
 * Days as a due date can express them. Always at least one: a median under a
 * day still means "not today", and today is the one date a due picker floors at.
 */
export function roundUpDays(days: number): number {
  if (!Number.isFinite(days)) return 1
  return Math.max(1, Math.ceil(days))
}

/** True when a cohort is big enough for its median to mean anything. */
export function meetsCohortFloor(count: number): boolean {
  return count >= COHORT_FLOOR
}

/** The most common value in a list, or null when the list is empty. */
export function modeOf<T extends string>(values: readonly (T | null | undefined)[]): T | null {
  const counts = new Map<T, number>()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: T | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** An ISO calendar date `days` after `from`, in `from`'s own calendar. */
export function isoDatePlusDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * An ISO calendar date `days` after a `YYYY-MM-DD` string, without going near
 * a timezone. The caller sends its own local date, so parsing it as UTC and
 * formatting it back would shift the answer by a day for half the world.
 */
export function isoDateAfter(baseIso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseIso)
  if (!match) return null
  const [, y, m, d] = match
  const base = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(base.getTime())) return null
  return isoDatePlusDays(days, base)
}

/** The ISO timestamp `days` ago, for a bounded lookback in a SQL comparison. */
export function isoDaysAgo(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * 86_400_000).toISOString()
}

/** Midnight today, in the shape createdAt is stored in. */
export function startOfTodayIso(from: Date = new Date()): string {
  return `${from.toISOString().slice(0, 10)}T00:00:00Z`
}

/** The ISO timestamp one hour ago, for the per-user call ceiling. */
export function isoHoursAgo(hours: number, from: Date = new Date()): string {
  return new Date(from.getTime() - hours * 3_600_000).toISOString()
}
