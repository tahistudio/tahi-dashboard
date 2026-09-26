/**
 * lib/slack/action-registry.ts
 *
 * Which handler answers which button, and which answers which modal submit
 * (CN.2 contract section 2).
 *
 * app/api/webhooks/slack/interactive/route.ts verifies the delivery and acks
 * it; lib/slack/dispatch.ts resolves who the presser is and then asks this
 * registry for the handler. The route therefore never learns a single verb,
 * and a feature that adds buttons or a modal adds them by registering a
 * prefix rather than by editing a route.
 *
 * Handlers are keyed by the first segment of the id, which is why every
 * button this codebase writes is namespaced (`sugg:approve:<id>`), and why a
 * modal's callback_id has to be namespaced the same way (`tweak:<id>`).
 *
 * Buttons and modals are two maps, not one: a feature may well own both a
 * `sugg:*` button and a `sugg:*` modal, and those are different handlers
 * answering different payloads.
 */

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

import type { SlackIdentity } from '@/lib/slack/identity'

/** The fields S2 reads off one clicked button. S1's route fills them from
 *  Slack's block_actions envelope. */
export interface SlackBlockActionPayload {
  actionId: string
  /** The button's own `value`, when it carries one. */
  value: string | null
  slackUserId: string
  slackTeamId: string
  channelId: string | null
  messageTs: string | null
}

export interface SlackBlockActionContext {
  drizzle: Drizzle
  identity: SlackIdentity | null
  payload: SlackBlockActionPayload
}

export interface SlackBlockActionResult {
  /** False when the action id is not this handler's to answer. */
  handled: boolean
  /** One plain sentence to say back in the DM, or null to say nothing. */
  reply: string | null
}

export type SlackBlockActionHandler = (ctx: SlackBlockActionContext) => Promise<SlackBlockActionResult>

/**
 * One submitted modal, flattened.
 *
 * A modal is not in a channel, so a submit carries no channel and no message
 * to answer beside. Whatever the handler needs to answer with (the suggestion
 * id, the DM the modal was opened from) is what the opener stashed in
 * private_metadata when it called views.open.
 */
export interface SlackViewSubmissionPayload {
  /** The modal's callback_id, namespaced like a button: `<prefix>:<rest>`. */
  callbackId: string
  /** The view's private_metadata, exactly as the opener set it. */
  privateMetadata: string | null
  /** view.state.values: block_id, then action_id, then the element's state. */
  values: Record<string, Record<string, unknown>> | null
  slackUserId: string
  slackTeamId: string
}

export interface SlackViewSubmissionContext {
  drizzle: Drizzle
  /** Never 'unknown': a stranger's submit is dropped before this registry is
   *  asked, so a handler never has to repeat that check. */
  identity: SlackIdentity
  payload: SlackViewSubmissionPayload
}

/**
 * The work behind one modal's submit.
 *
 * It runs AFTER the interactive route has answered Slack, so by the time it
 * starts the modal is already closed (VIEW_SUBMISSION_ACK in
 * lib/slack/dispatch.ts says why). That is why it returns nothing: there is
 * no view left to answer in, and anything it wants to say it posts itself, to
 * the channel it carried in private_metadata.
 */
export type SlackViewSubmissionHandler = (ctx: SlackViewSubmissionContext) => Promise<void>

const handlers = new Map<string, SlackBlockActionHandler>()
const viewHandlers = new Map<string, SlackViewSubmissionHandler>()

function prefixOf(id: string): string | null {
  const prefix = id.split(':')[0]
  return prefix ? prefix : null
}

/** Register a handler for every action id starting `<prefix>:`. */
export function registerBlockActionHandler(prefix: string, handler: SlackBlockActionHandler): void {
  handlers.set(prefix, handler)
}

/** The handler for one action id, or null when nothing has claimed it. */
export function resolveBlockActionHandler(actionId: string): SlackBlockActionHandler | null {
  const prefix = prefixOf(actionId)
  if (!prefix) return null
  return handlers.get(prefix) ?? null
}

/**
 * Register the submit handler for every modal whose callback_id starts
 * `<prefix>:`. This is the one place a future modal plugs in: the route and
 * the dispatcher already send every view_submission here, and nothing else
 * has to change for a new one.
 */
export function registerViewSubmissionHandler(prefix: string, handler: SlackViewSubmissionHandler): void {
  viewHandlers.set(prefix, handler)
}

/** The submit handler for one callback_id, or null when nothing has claimed it. */
export function resolveViewSubmissionHandler(callbackId: string): SlackViewSubmissionHandler | null {
  const prefix = prefixOf(callbackId)
  if (!prefix) return null
  return viewHandlers.get(prefix) ?? null
}

/** Tests only: start from an empty registry, buttons and modals both. */
export function clearBlockActionHandlers(): void {
  handlers.clear()
  viewHandlers.clear()
}
