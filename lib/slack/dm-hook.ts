/**
 * lib/slack/dm-hook.ts
 *
 * The seam between S1's events route and S3's DM handler (CN.2 sections 2
 * and 4).
 *
 * STUB NOTE (slice S3). The registry belongs to slice S1, which owns
 * app/api/webhooks/slack/events/route.ts and calls `dispatchSlackDm` from the
 * work it hands to waitUntil. It is here so S3's handler has something to
 * register through while S1 is still in flight, and so the route never has to
 * import the handler directly: a route that imports the world is a route that
 * cannot be tested.
 *
 * The default is a lazy import rather than a throw, so a route that forgets to
 * register anything still reaches the handler that exists. Registration is for
 * tests and for whatever S1 decides to put in front of it.
 */

import type { SlackDmDeps, SlackDmEvent, SlackDmOutcome } from './dispatch-dm'

export type SlackDmHandler = (event: SlackDmEvent, deps: SlackDmDeps) => Promise<SlackDmOutcome>

let registered: SlackDmHandler | null = null

export function registerSlackDmHandler(handler: SlackDmHandler): void {
  registered = handler
}

/** Tests only. Production registers once per isolate and leaves it. */
export function resetSlackDmHandler(): void {
  registered = null
}

export async function dispatchSlackDm(event: SlackDmEvent, deps: SlackDmDeps): Promise<SlackDmOutcome> {
  if (!registered) {
    const fallback = await import('./dispatch-dm')
    registered = fallback.handleSlackDm
  }
  return registered(event, deps)
}
