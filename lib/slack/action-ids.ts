/**
 * lib/slack/action-ids.ts
 *
 * `sugg:<action>:<id>` (CN.2 section 3), in one place.
 *
 * STUB NOTE (slice S3). Slice S2 owns the interactive route that parses these
 * and slice S3 owns the DM that renders them, so the format itself is split
 * out here rather than living in either. Whichever slice lands second keeps
 * this file as it is.
 */

export const SUGGESTION_ACTION_PREFIX = 'sugg'

/** The five buttons on a suggestion card, in the order they are rendered. */
export const SUGGESTION_ACTIONS = ['approve', 'tweak', 'tonight', 'this_week', 'reject'] as const

export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number]

export function buildActionId(action: SuggestionAction, suggestionId: string): string {
  return `${SUGGESTION_ACTION_PREFIX}:${action}:${suggestionId}`
}

/**
 * The reverse. Returns null rather than throwing for anything that is not one
 * of ours, because an interactive payload carries every button on the message
 * and a strange one is a thing to ignore, not a 500.
 */
export function parseActionId(actionId: string): { action: SuggestionAction; suggestionId: string } | null {
  const parts = actionId.split(':')
  if (parts.length < 3) return null
  const [prefix, action, ...rest] = parts
  if (prefix !== SUGGESTION_ACTION_PREFIX) return null
  if (!(SUGGESTION_ACTIONS as readonly string[]).includes(action)) return null
  const suggestionId = rest.join(':')
  if (!suggestionId) return null
  return { action: action as SuggestionAction, suggestionId }
}
