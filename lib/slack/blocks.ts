/**
 * lib/slack/blocks.ts
 *
 * One suggestion, as a Block Kit message in a founder's DM (CN.2 contract
 * section 3).
 *
 * The message says exactly what the inbox row says, because it is built from
 * the same summariser (lib/suggestion-summary.ts): the client and the call,
 * the kind in words, the proposal in one line, the exact words from the call
 * as a quote, who it suggests does it, and the five things a founder can do
 * about it. Approve, Tonight, This week and Reject decide the row; Tweak is a
 * link into the dashboard, because editing a proposal is a screen, not a
 * button.
 *
 * Pure: it renders JSON and reads the deploy origin, nothing else. No
 * database, no fetch, no Slack call. Posting and rewriting live in
 * lib/slack/mirror.ts.
 */

import { publicUrl } from '@/lib/app-url'
import {
  attachButtonLabel,
  confidenceLabel,
  suggestedAssigneeLine,
  suggestionKindLabel,
  summariseProposal,
  similarMatchLine,
  targetRequestLine,
  type SummarySimilarMatch,
} from '@/lib/suggestion-summary'

// ── Block Kit, only the shapes this file writes ─────────────────────────────

export interface SlackTextObject {
  type: 'mrkdwn' | 'plain_text'
  text: string
  emoji?: boolean
}

export interface SlackButtonElement {
  type: 'button'
  text: SlackTextObject
  action_id: string
  value?: string
  url?: string
  style?: 'primary' | 'danger'
}

export type SlackBlock =
  | { type: 'section'; text: SlackTextObject }
  | { type: 'context'; elements: SlackTextObject[] }
  | { type: 'actions'; elements: SlackButtonElement[] }
  | { type: 'divider' }

export interface SlackMessagePayload {
  /** The notification fallback: what a phone shows before the blocks render. */
  text: string
  blocks: SlackBlock[]
}

// ── Action ids ──────────────────────────────────────────────────────────────

/** Every button this file writes is namespaced, so S1's interactive route can
 *  hand a payload to one handler by prefix without knowing the verbs. */
export const SUGGESTION_ACTION_PREFIX = 'sugg'

export type SuggestionActionName =
  | 'approve'
  | 'approve_anyway'
  | 'tweak'
  | 'snooze_tonight'
  | 'snooze_week'
  | 'reject'
  | 'attach'

const ACTION_NAMES: readonly SuggestionActionName[] = [
  'approve', 'approve_anyway', 'tweak', 'snooze_tonight', 'snooze_week', 'reject', 'attach',
]

/** `sugg:<action>:<id>`. A suggestion id is a uuid, so the third segment
 *  never carries a colon of its own. */
export function suggestionActionId(action: SuggestionActionName, suggestionId: string): string {
  return `${SUGGESTION_ACTION_PREFIX}:${action}:${suggestionId}`
}

export interface ParsedSuggestionAction {
  action: SuggestionActionName
  suggestionId: string
}

/** The reverse, strictly. Anything that is not one of this file's own buttons
 *  parses as null and is somebody else's action to handle. */
export function parseSuggestionActionId(actionId: string): ParsedSuggestionAction | null {
  const parts = actionId.split(':')
  if (parts.length !== 3) return null
  const [prefix, action, suggestionId] = parts
  if (prefix !== SUGGESTION_ACTION_PREFIX) return null
  if (!ACTION_NAMES.includes(action as SuggestionActionName)) return null
  if (!suggestionId) return null
  return { action: action as SuggestionActionName, suggestionId }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function mrkdwn(text: string): SlackTextObject {
  return { type: 'mrkdwn', text }
}

function plain(text: string): SlackTextObject {
  return { type: 'plain_text', text, emoji: true }
}

/** Slack mrkdwn is not markdown: *bold*, _italic_, and these four characters
 *  are the whole escape list. A client name with an ampersand in it should
 *  not become a stray entity. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A quote block: every line prefixed, empty lines kept so a two-paragraph
 *  quote still reads as two. Trimmed to a length a DM can hold. */
export function quoteBlock(quote: string, limit = 600): string {
  const trimmed = quote.trim()
  const clipped = trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}...` : trimmed
  return escapeSlackText(clipped)
    .split('\n')
    .map(line => `>${line ? ` ${line}` : ''}`)
    .join('\n')
}

/** "Nga Motu, Kickoff call, 18 Sep" and whatever of it is known. */
function headerLine(input: SuggestionMessageInput): string {
  const parts: string[] = []
  parts.push(input.orgName ? `*${escapeSlackText(input.orgName)}*` : '*Studio*')
  if (input.callTitle) parts.push(escapeSlackText(input.callTitle))
  const day = formatCallDay(input.callScheduledAt ?? null)
  if (day) parts.push(day)
  return parts.join(' · ')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "18 Sep" from an ISO timestamp, or null when there is not one. Deliberately
 *  date only: the DM says which call, not which minute. */
export function formatCallDay(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** The row a Slack message is built from. Structural, so the decorated row
 *  the inbox reads and the raw table row a decision hands back both fit. */
export interface SuggestionMessageInput {
  id: string
  kind: string
  proposal: unknown
  quote: string
  rationale?: string | null
  confidence?: number | null
  orgName?: string | null
  callTitle?: string | null
  callScheduledAt?: string | null
  targetRequestNumber?: number | null
  targetRequestTitle?: string | null
  similar?: readonly SummarySimilarMatch[]
  /**
   * Slice A1's owner suggestion, when the caller has already read it off the
   * proposal (lib/slack/dispatch-dm.ts does). Optional because most callers
   * hand over the whole proposal and let the line be read out of it; an
   * explicit name here WINS, because a caller that went to the trouble of
   * resolving one has better information than the raw JSON does.
   */
  suggestedAssigneeName?: string | null
  assigneeReason?: string | null
}

export interface SuggestionMessageOptions {
  /**
   * Render the duplicate answer: the "Looks like #226 ..." line, "Use #226
   * instead" beside it, and Approve reading "Approve anyway". Set when the
   * gate refused an approve with possible_duplicate, or when the best match
   * already scores at or above the block threshold (CN.1d section 5).
   */
  duplicate?: boolean
  /**
   * Where Tweak goes. Left out for the dashboard's own link, which is what a
   * studio card wants. Set to NULL to drop the button entirely, which is what
   * a client's card wants: /tasks is not a page they can open, and a button
   * that lands somebody on a permission error is worse than no button.
   */
  tweakUrl?: string | null
}

/**
 * "Suggested: Staci, said she would send the headers" (contract section 5).
 *
 * The explicit fields first, the proposal second, so a card reads the same
 * line whether the caller resolved the owner itself or handed over the stored
 * JSON. No name at all renders no line: "Suggested: nobody" is worse than
 * silence.
 */
function assigneeLine(input: SuggestionMessageInput): string | null {
  const name = input.suggestedAssigneeName?.trim()
  if (!name) return suggestedAssigneeLine(input.proposal)
  const reason = input.assigneeReason?.trim()
  return reason ? `Suggested: ${name}, ${reason}` : `Suggested: ${name}`
}

/** The one-line fallback a notification shows: the kind and the summary. */
function fallbackText(input: SuggestionMessageInput): string {
  return `${suggestionKindLabel(input.kind)}: ${summariseProposal(input.kind, input.proposal)}`
}

/** The dashboard link behind Tweak, which is where a proposal gets edited. */
export function suggestionTweakUrl(suggestionId: string): string {
  return publicUrl(`/tasks?view=suggestions&focus=${encodeURIComponent(suggestionId)}`)
}

/**
 * One suggestion, with its buttons. Action ids are `sugg:<action>:<id>`; the
 * attach button carries the target as its value because the id has room for
 * one id only.
 */
export function suggestionMessage(
  input: SuggestionMessageInput,
  options: SuggestionMessageOptions = {},
): SlackMessagePayload {
  const similar = input.similar ?? []
  const duplicate = options.duplicate === true && similar.length > 0
  const blocks: SlackBlock[] = []

  blocks.push({ type: 'section', text: mrkdwn(headerLine(input)) })

  const chip: string[] = [suggestionKindLabel(input.kind)]
  const target = targetRequestLine({
    targetRequestNumber: input.targetRequestNumber ?? null,
    targetRequestTitle: input.targetRequestTitle ?? null,
  })
  if (target) chip.push(escapeSlackText(target))
  const confidence = confidenceLabel(input.confidence ?? null)
  if (confidence) chip.push(confidence)
  blocks.push({ type: 'context', elements: [mrkdwn(chip.join(' · '))] })

  blocks.push({ type: 'section', text: mrkdwn(escapeSlackText(summariseProposal(input.kind, input.proposal))) })

  if (input.quote.trim()) {
    blocks.push({ type: 'section', text: mrkdwn(quoteBlock(input.quote)) })
  }

  const assignee = assigneeLine(input)
  if (assignee) {
    blocks.push({ type: 'context', elements: [mrkdwn(escapeSlackText(assignee))] })
  }

  const duplicateLine = duplicate ? similarMatchLine(similar) : null
  if (duplicateLine) {
    blocks.push({ type: 'context', elements: [mrkdwn(escapeSlackText(duplicateLine))] })
  }

  const buttons: SlackButtonElement[] = []
  const attachLabel = duplicate ? attachButtonLabel(similar) : null
  const best = similar[0]
  if (attachLabel && best) {
    buttons.push({
      type: 'button',
      text: plain(attachLabel),
      action_id: suggestionActionId('attach', input.id),
      value: JSON.stringify({ kind: best.kind, id: best.id }),
    })
  }

  buttons.push({
    type: 'button',
    text: plain(duplicate ? 'Approve anyway' : 'Approve'),
    action_id: suggestionActionId(duplicate ? 'approve_anyway' : 'approve', input.id),
    style: 'primary',
  })
  const tweakUrl = options.tweakUrl === undefined ? suggestionTweakUrl(input.id) : options.tweakUrl
  if (tweakUrl) {
    buttons.push({
      type: 'button',
      text: plain('Tweak'),
      action_id: suggestionActionId('tweak', input.id),
      url: tweakUrl,
    })
  }
  buttons.push({ type: 'button', text: plain('Tonight'), action_id: suggestionActionId('snooze_tonight', input.id) })
  buttons.push({ type: 'button', text: plain('This week'), action_id: suggestionActionId('snooze_week', input.id) })
  buttons.push({ type: 'button', text: plain('Reject'), action_id: suggestionActionId('reject', input.id), style: 'danger' })

  blocks.push({ type: 'actions', elements: buttons })

  return { text: fallbackText(input), blocks }
}

/** The header message that opens a call's run of suggestions in the DM. */
export function callHeaderMessage(input: {
  callTitle: string | null
  orgName: string | null
  callScheduledAt: string | null
  count: number
}): SlackMessagePayload {
  const who = input.orgName ? escapeSlackText(input.orgName) : 'Studio'
  const what = input.callTitle ? escapeSlackText(input.callTitle) : 'a call'
  const day = formatCallDay(input.callScheduledAt)
  const noun = input.count === 1 ? 'suggestion' : 'suggestions'
  const text = `*${who}* · ${input.count} ${noun} from ${what}${day ? ` (${day})` : ''}`
  return {
    text: `${input.count} ${noun} from ${what}`,
    blocks: [{ type: 'section', text: mrkdwn(text) }],
  }
}

// ── The decided rewrite ─────────────────────────────────────────────────────

export type SuggestionOutcome = 'approved' | 'rejected' | 'snoozed' | 'expired' | 'failed'

export interface DecidedLineInput {
  outcome: SuggestionOutcome
  /** Who decided, as a first name. "someone" when the actor cannot be named. */
  actorName: string | null
  /** The studio wall-clock time, already formatted: "09:41". */
  at: string | null
  /** For a snooze: when it comes back, already formatted. */
  until?: string | null
  /** For a failure: the one line explaining what did not land. */
  error?: string | null
}

/** "Approved by Liam, 09:41". One line, no buttons: the decision is made and
 *  the message is now a record of it (contract section 3). */
export function decidedLine(input: DecidedLineInput): string {
  const who = input.actorName?.trim() ? input.actorName.trim() : 'someone'
  const when = input.at ? `, ${input.at}` : ''
  switch (input.outcome) {
    case 'approved':
      return `Approved by ${who}${when}`
    case 'rejected':
      return `Rejected by ${who}${when}`
    case 'snoozed':
      return input.until ? `Snoozed by ${who} until ${input.until}` : `Snoozed by ${who}${when}`
    case 'expired':
      return 'Expired, rebuilt from the call'
    case 'failed':
      return input.error ? `Could not apply: ${input.error}` : 'Could not apply'
  }
}

/** The whole message a decided suggestion becomes: the line, and nothing
 *  else to press. */
export function decidedMessage(input: DecidedLineInput): SlackMessagePayload {
  const line = decidedLine(input)
  return { text: line, blocks: [{ type: 'section', text: mrkdwn(escapeSlackText(line)) }] }
}
