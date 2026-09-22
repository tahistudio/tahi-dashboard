/**
 * lib/slack/dm-hook.ts
 *
 * The seam between S1's events route and S3's DM handler (CN.2 sections 2
 * and 4).
 *
 * lib/slack/dispatch.ts#handleDm calls `dispatchSlackDm` once it knows who is
 * talking, and this is what stands between it and the handler. The seam is
 * here rather than as a direct import so a test of the inbound path can
 * replace the whole of the note and voice machinery with two lines.
 *
 * The default is a lazy import rather than a throw, so a caller that registers
 * nothing still reaches the handler that exists. Registration is for tests and
 * for anything that wants to sit in front of the default.
 */

import type { SlackDmDeps, SlackDmEvent, SlackDmOutcome } from './dispatch-dm'

// Re-exported so a caller wiring the hook up (lib/slack/dispatch.ts) imports
// the event shape from the same module it imports the dispatcher from.
export type { SlackDmDeps, SlackDmEvent, SlackDmOutcome }

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
