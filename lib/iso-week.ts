/**
 * ISO week label utilities for content-engine week-bucketing.
 *
 * Lives in lib/ not in a route file because Next.js 15 App Router only
 * permits HTTP-method exports + specific config exports from route
 * handlers. Non-route exports from route.ts are a hard build error
 * (`next build` rejects even though `tsc --noEmit` accepts).
 */

/** ISO week label like "2026-W22". Matches the format the ideation cron
 *  writes to content_ideas.week_label. */
export function isoWeekLabel(date = new Date()): string {
  // Copy + roll to Thursday in current week (ISO week-of-Thursday rule).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
