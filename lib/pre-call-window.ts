/**
 * lib/pre-call-window.ts
 *
 * "Is this call due to start in N-M minutes?" as a pure, D1-free
 * predicate, so the pre-call digest cron can filter on real instants
 * instead of trusting SQL's TEXT comparison on scheduledAt.
 *
 * app/api/admin/discovery-calls/upcoming/route.ts already carries this
 * exact lesson in a comment: Google Calendar's event.start.dateTime is
 * RFC3339 WITH an offset ("...+12:00"), and lexicographic comparison
 * against a Z-suffixed window bound breaks once the offsets differ. The
 * pre-call digest cron used a raw gte/lte SQL filter with no such
 * re-check, which is what let "Pre-call: X in ~30 min" emails fire
 * roughly the NZ UTC offset (12h NZST / 13h NZDT) late.
 *
 * The SQL query stays as a coarse, generous pre-filter (cheap row-count
 * guard); this function is the actual decision.
 */

/**
 * True when `scheduledAt` (any format `Date` can parse, including a
 * non-Z offset like Google Calendar's) names an instant between
 * `startMin` and `endMin` minutes after `nowMs`.
 *
 * An unparseable scheduledAt is never "in window": better to skip a
 * malformed row than to accidentally email about it.
 */
export function isWithinPreCallWindow(
  scheduledAt: string,
  nowMs: number,
  startMin: number,
  endMin: number,
): boolean {
  const callMs = new Date(scheduledAt).getTime()
  if (!Number.isFinite(callMs)) return false
  const deltaMin = (callMs - nowMs) / 60_000
  return deltaMin >= startMin && deltaMin <= endMin
}

/**
 * Filter a list of rows down to the ones whose scheduledAt instant
 * falls in the [startMin, endMin] pre-call window. Generic over any row
 * shape that carries a scheduledAt string, so callers don't need to
 * strip fields down first.
 */
export function filterInPreCallWindow<T extends { scheduledAt: string }>(
  rows: readonly T[],
  nowMs: number,
  startMin: number,
  endMin: number,
): T[] {
  return rows.filter(row => isWithinPreCallWindow(row.scheduledAt, nowMs, startMin, endMin))
}
