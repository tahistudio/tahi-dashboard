/**
 * lib/portal-calls.ts
 *
 * The client's "Next call" is assembled from two tables: `scheduled_calls`
 * (the row the portal booking owns) and `discovery_calls` (the mirror the
 * studio's own calls surfaces read). A booking writes both, so a plain concat
 * renders the same meeting twice and, worse, lets a stale twin sort ahead of
 * the row that moved when a client re-books.
 *
 * Collapsing on (title, instant) keeps one item per meeting. The scheduled row
 * wins the identity because it is the one the portal writes; the join link and
 * attendee list are back-filled from whichever twin actually has them, since
 * the Google sync writes the Meet URL onto the discovery side.
 *
 * Pure and D1-free so it is unit testable.
 */

export type CallSource = 'scheduled' | 'discovery'

export interface RawPortalCall {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number | null
  meetingUrl: string | null
  attendees: string | null
}

export interface MergedPortalCall extends RawPortalCall {
  source: CallSource
}

function instantOf(call: { scheduledAt: string }): number {
  return new Date(call.scheduledAt).getTime()
}

/** Two rows describe the same meeting when the title and the instant match. */
function mergeKey(call: RawPortalCall): string {
  return `${call.title.trim().toLowerCase()}|${instantOf(call)}`
}

export interface MergeUpcomingOptions {
  /** Anything starting before this instant is past. */
  cutoffMs: number
  /** Cap on the returned list. */
  limit: number
}

/**
 * Upcoming calls for one org, soonest first, one entry per real meeting.
 * Rows with an unparseable `scheduledAt` are dropped rather than sorted
 * arbitrarily.
 */
export function mergeUpcomingCalls(
  scheduled: RawPortalCall[],
  discovery: RawPortalCall[],
  { cutoffMs, limit }: MergeUpcomingOptions,
): MergedPortalCall[] {
  const all: MergedPortalCall[] = [
    ...scheduled.map(call => ({ ...call, source: 'scheduled' as const })),
    ...discovery.map(call => ({ ...call, source: 'discovery' as const })),
  ]
    .filter(call => {
      const ms = instantOf(call)
      return Number.isFinite(ms) && ms >= cutoffMs
    })
    .sort((a, b) => instantOf(a) - instantOf(b))

  const byKey = new Map<string, MergedPortalCall>()
  const order: string[] = []

  for (const call of all) {
    const key = mergeKey(call)
    const seen = byKey.get(key)
    if (!seen) {
      byKey.set(key, call)
      order.push(key)
      continue
    }
    const winner = seen.source === 'scheduled' ? seen : call
    const other = seen.source === 'scheduled' ? call : seen
    byKey.set(key, {
      ...winner,
      meetingUrl: winner.meetingUrl ?? other.meetingUrl ?? null,
      attendees: winner.attendees ?? other.attendees ?? null,
      durationMinutes: winner.durationMinutes ?? other.durationMinutes ?? null,
    })
  }

  return order.map(key => byKey.get(key) as MergedPortalCall).slice(0, limit)
}
