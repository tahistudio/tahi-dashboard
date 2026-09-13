/**
 * lib/call-deep-link.ts
 *
 * Pure helpers for the /calls page deep link that opens a specific call's
 * slide-over with its Prep note field focused, e.g. from the studio home
 * daily brief ("Prep note" / "Edit prep note"). Kept framework-free so the
 * brief route (server) and the calls page (client) share the exact same
 * query-string shape instead of one drifting from the other.
 */

/**
 * Build the /calls target that opens `callId`'s slide-over with the Prep
 * note field focused. Relative (no leading slash) so it doubles as the
 * daily brief's logical `to` id: the overview home switcher's go() prefixes
 * anything not in its ROUTE_MAP with '/' (see
 * components/tahi/overview/overview-home.tsx), so `calls?call=...` becomes
 * `/calls?call=...` exactly as intended.
 */
export function callPrepFocusTarget(callId: string): string {
  return `calls?call=${encodeURIComponent(callId)}&focus=prep`
}

export interface CallFocusParams {
  /** The call id to open, or null when the param is absent/blank. */
  callId: string | null
  /** True only when focus=prep, so an unrelated `focus` value never
   *  steals keyboard focus onto a field the caller didn't ask for. */
  focusPrep: boolean
}

/**
 * Parse the `call` + `focus` query params the /calls page reads on load to
 * open a specific call's slide-over, optionally with its Prep note field
 * focused.
 */
export function parseCallFocusParams(searchParams: URLSearchParams): CallFocusParams {
  const rawId = searchParams.get('call')
  const callId = rawId && rawId.trim() ? rawId.trim() : null
  return {
    callId,
    focusPrep: searchParams.get('focus') === 'prep',
  }
}
