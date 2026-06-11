/**
 * Pure event helpers for "The Wire" cross-dashboard ticker.
 *
 * Extracted out of app/api/admin/overview/wire/route.ts so the
 * mapping / sort / cap logic can be unit tested without a live D1
 * (Next.js forbids exporting non-route helpers from a route.ts file).
 * The route gathers raw rows per source, each wrapped in its own
 * try/catch, then hands the flat candidate list to mergeWireEvents.
 *
 * No currency conversion happens here; callers pass display-ready text
 * in (e.g. "Payment cleared NZ$4,800") so this stays free of the rate
 * map and the permission resolver.
 */

/** The closed set of domains a Wire event can belong to. Maps 1:1 to a
 *  --domain-* ink token in the component. */
export type WireDomain = 'content' | 'social' | 'sales' | 'money' | 'client' | 'ops'

export interface WireEvent {
  id: string
  type: WireDomain
  text: string
  /** ISO timestamp the event occurred. Newest first after merge. */
  at: string
}

/** How many events the ticker ever holds. The component shows one at a
 *  time and cycles; more than this is noise. */
export const WIRE_CAP = 20

/**
 * Parse an ISO timestamp to epoch ms, returning null for anything that
 * does not parse. Used to drop candidates with no usable time rather
 * than letting an Invalid Date sort to the top.
 */
function epoch(at: string | null | undefined): number | null {
  if (!at) return null
  const ms = new Date(at).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Merge raw candidate events from every source into the final Wire
 * payload: drop ones with no parseable timestamp, sort newest first,
 * and cap. Pure + total (never throws) so a malformed row from one
 * source can never break the rail.
 *
 * Ties (identical timestamps) keep their incoming order, which is
 * stable in V8's sort, so the caller can pre-order within a source.
 */
export function mergeWireEvents(candidates: WireEvent[], cap: number = WIRE_CAP): WireEvent[] {
  const dated = candidates
    .map(e => ({ e, ms: epoch(e.at) }))
    .filter((x): x is { e: WireEvent; ms: number } => x.ms !== null)

  dated.sort((a, b) => b.ms - a.ms)

  return dated.slice(0, Math.max(0, cap)).map(x => x.e)
}

/**
 * Lower bound (ISO) for the Wire lookback window: events older than
 * this are not gathered. Default 7 days. Pure so the route and the
 * test agree on the cutoff.
 */
export function wireSince(now: Date = new Date(), days = 7): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return cutoff.toISOString()
}

/**
 * Short, human label for an AI lead score event, e.g. "Lead scored 85".
 * Clamps to 0..100 and drops the decimals SQLite may hand back.
 */
export function leadScoreText(score: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  return `Lead scored ${clamped}`
}

/**
 * Short label for an automation run event. Uses the rule name when we
 * have one ("Automation ran: overdue nudge"), else a generic line.
 */
export function automationRanText(ruleName: string | null | undefined): string {
  const name = ruleName?.trim()
  return name ? `Automation ran: ${name}` : 'Automation ran'
}
