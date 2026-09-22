/**
 * lib/slack/action-registry.ts
 *
 * Which handler answers which button (CN.2 contract section 2).
 *
 * app/api/webhooks/slack/interactive/route.ts verifies the delivery and acks
 * it; lib/slack/dispatch.ts#handleAction resolves who the presser is and then
 * asks this registry for the handler. The route therefore never learns a
 * single verb, and a feature that adds buttons adds them by registering a
 * prefix rather than by editing a route.
 *
 * Handlers are keyed by the first segment of the action id, which is why
 * every button this codebase writes is namespaced (`sugg:approve:<id>`).
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

const handlers = new Map<string, SlackBlockActionHandler>()

/** Register a handler for every action id starting `<prefix>:`. */
export function registerBlockActionHandler(prefix: string, handler: SlackBlockActionHandler): void {
  handlers.set(prefix, handler)
}

/** The handler for one action id, or null when nothing has claimed it. */
export function resolveBlockActionHandler(actionId: string): SlackBlockActionHandler | null {
  const prefix = actionId.split(':')[0]
  if (!prefix) return null
  return handlers.get(prefix) ?? null
}

/** Tests only: start from an empty registry. */
export function clearBlockActionHandlers(): void {
  handlers.clear()
}
