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
 * about it. Approve, Tonight, This week and Reject decide the row. Tweak
 * opens the dashboard, or reveals the client choices for an ambiguous note.
 *
 * A client's own "Is this the request?" card is NOT this message. It has its
 * own two renderers below (clientDraftMessage and clientDecidedMessage),
 * built from a narrower input, because everything suggestionMessage and
 * decidedMessage can carry (the Tweak link, the duplicate line and its
 * internal titles, the suggested assignee, who snoozed it, the apply error)
 * was written for studio eyes (CN.3 contract section 2).
 *
 * Pure: it renders JSON and reads the deploy origin, nothing else. No
 * database, no fetch, no Slack call. Posting and rewriting live in
 * lib/slack/mirror.ts.
 */

import { publicUrl } from '@/lib/app-url'
import { asRecord } from '@/lib/suggestion-summary'
import { clientChoicesFromProposal, MAX_CLIENT_CHOICES } from './note-quality'
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
  | { type: 'section'; text: SlackTextObject; accessory?: SlackButtonElement }
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
  | 'choose_client'

const ACTION_NAMES: readonly SuggestionActionName[] = [
  'approve', 'approve_anyway', 'tweak', 'snooze_tonight', 'snooze_week', 'reject', 'attach', 'choose_client',
]

/**
 * The Monday digest's one button (CN.3 contract section 5). It is a url
 * button, so Slack opens the inbox by itself; the interaction Slack still
 * sends is claimed under this prefix and answered with nothing, rather than
 * drawing the "not switched on yet" line from the dispatcher.
 */
export const DIGEST_ACTION_PREFIX = 'digest'

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

/**
 * A mrkdwn link, `<url|label>`.
 *
 * The label is escaped like any other text. The url keeps its meaning but
 * loses the three characters that would end the link early: an ampersand in
 * a query string becomes the entity Slack itself writes, and a pipe or an
 * angle bracket is percent encoded, which a browser reads back as the same
 * character.
 */
export function slackLink(url: string, label: string): string {
  const safeUrl = url
    .replace(/&/g, '&amp;')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\|/g, '%7C')
  return `<${safeUrl}|${escapeSlackText(label)}>`
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
  const choices = clientChoicesFromProposal(input.proposal)
  parts.push(input.orgName ? `*${escapeSlackText(input.orgName)}*` : choices.length > 1 ? '*Client?*' : '*Studio*')
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

/** A due date is a calendar day, never an instant shifted by the Slack user's zone. */
export function dueDateLine(proposal: unknown): string | null {
  const record = asRecord(proposal)
  const dueDate = record.dueDate ?? asRecord(record.fields).dueDate
  if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null
  const day = new Date(`${dueDate}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== dueDate) return null
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getUTCDay()]
  return `Due ${weekday} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`
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
  /** Tweak on an unresolved client reveals only the server-derived candidates. */
  chooseClient?: boolean
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
  const choices = clientChoicesFromProposal(input.proposal)

  blocks.push({ type: 'section', text: mrkdwn(headerLine(input)) })

  const chip: string[] = [suggestionKindLabel(input.kind)]
  const target = targetRequestLine({
    targetRequestNumber: input.targetRequestNumber ?? null,
    targetRequestTitle: input.targetRequestTitle ?? null,
  })
  if (target) chip.push(escapeSlackText(target))
  const confidence = confidenceLabel(input.confidence ?? null)
  if (confidence) chip.push(confidence)
  const due = dueDateLine(input.proposal)
  if (due) chip.push(due)
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

  if (choices.length < 2) buttons.push({
    type: 'button',
    text: plain(duplicate ? 'Approve anyway' : 'Approve'),
    action_id: suggestionActionId(duplicate ? 'approve_anyway' : 'approve', input.id),
    style: 'primary',
  })
  const tweakUrl = options.tweakUrl === undefined ? suggestionTweakUrl(input.id) : options.tweakUrl
  if (choices.length > 1) {
    buttons.push({ type: 'button', text: plain('Tweak'), action_id: suggestionActionId('tweak', input.id), value: 'choose_client' })
  } else if (tweakUrl) {
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

  if (choices.length > 1 && options.chooseClient) {
    blocks.push({ type: 'context', elements: [mrkdwn('Client? Choose one, then approve the updated card.')] })
    for (const [index, choice] of choices.slice(0, MAX_CLIENT_CHOICES).entries()) {
      blocks.push({ type: 'section', text: mrkdwn(escapeSlackText(choice.name)), accessory: {
        type: 'button', text: plain(`Choose ${index + 1}`),
        action_id: suggestionActionId('choose_client', input.id), value: choice.id,
      } })
    }
  }

  return { text: fallbackText(input), blocks }
}

// ── A client's own card ─────────────────────────────────────────────────────

/**
 * Everything a client's own card may be built from (CN.3 contract section 2).
 *
 * Deliberately narrower than SuggestionMessageInput: the client's own words
 * (the quote, and the title drafted from them), their own client's name and
 * the kind. No similar matches, no target request, no suggested assignee, no
 * confidence, no call. A field that is not on this type cannot reach a
 * client's DM, whatever the row carries.
 */
export interface ClientDraftInput {
  id: string
  kind: string
  proposal: unknown
  quote: string
  orgName?: string | null
}

/**
 * "Is this the request?", as the card in a client's own DM.
 *
 * Two buttons. Approve files the request; Reject says no. There is no Tweak
 * (/tasks is not a page a client can open) and no Tonight or This week: a
 * client's card is never filed as a copy, so a snoozed draft could never come
 * back to them, and a button that makes their ask vanish from Slack for good
 * is worse than no button.
 */
export function clientDraftMessage(input: ClientDraftInput): SlackMessagePayload {
  const due = dueDateLine(input.proposal)
  const blocks: SlackBlock[] = [
    { type: 'section', text: mrkdwn(input.orgName ? `*${escapeSlackText(input.orgName)}*` : '*Your request*') },
    { type: 'context', elements: [mrkdwn(escapeSlackText([suggestionKindLabel(input.kind), due].filter(Boolean).join(' · ')))] },
    { type: 'section', text: mrkdwn(escapeSlackText(summariseProposal(input.kind, input.proposal))) },
  ]
  if (input.quote.trim()) {
    blocks.push({ type: 'section', text: mrkdwn(quoteBlock(input.quote)) })
  }
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', text: plain('Approve'), action_id: suggestionActionId('approve', input.id), style: 'primary' },
      { type: 'button', text: plain('Reject'), action_id: suggestionActionId('reject', input.id), style: 'danger' },
    ],
  })
  return {
    text: `${suggestionKindLabel(input.kind)}: ${summariseProposal(input.kind, input.proposal)}`,
    blocks,
  }
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
  /**
   * What an approved card points at once the thing exists: "Open #231" to
   * the request, "Open task" to the task (CN.3 contract section 1). The card
   * is the parent of the thread the dashboard's later changes reply in, so
   * the parent names the thing the replies are about. Only the blocks carry
   * it; the notification text stays the bare line.
   */
  link?: { url: string; label: string } | null
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

/** The whole message a decided suggestion becomes: the line, a link to what
 *  it made when there is one, and nothing else to press. */
export function decidedMessage(input: DecidedLineInput): SlackMessagePayload {
  return lineMessage(decidedLine(input), input.link ?? null)
}

function lineMessage(line: string, link: { url: string; label: string } | null): SlackMessagePayload {
  const tail = link && link.url && link.label ? ` · ${slackLink(link.url, link.label)}` : ''
  return { text: line, blocks: [{ type: 'section', text: mrkdwn(`${escapeSlackText(line)}${tail}`) }] }
}

/** What a client's decided card is written from. Fixed words plus these four
 *  values; nothing else about the row reaches it. */
export interface ClientDecidedInput {
  outcome: SuggestionOutcome
  /** The client's own first name when THEY made this decision; null otherwise. */
  ownName: string | null
  /** The studio wall-clock time, already formatted: "09:41". */
  at: string | null
  /** Their own request, once approved. The caller only ever passes a request
   *  that reads back as the client's and not internal. */
  link?: { url: string; label: string } | null
}

/** The notice a client's own approval that did not land reads. */
export const CLIENT_CARD_FAILED_LINE = 'Could not file this request just now. The studio can see it on their side.'

/**
 * What a client's own card becomes once it is decided (CN.3 contract
 * section 2). The only decided rewrite a client's DM ever gets, and it is
 * written from fixed words, never from the row's studio fields:
 *
 *   approved  "Approved by Tim, 09:41" and a link to their own request
 *   rejected  "Rejected by Tim, 09:41"
 *   failed    one plain sentence, never the apply error
 *
 * The name is the client's own and only ever theirs: when somebody at the
 * studio made the decision the line names nobody ("Approved, 09:41", "Not
 * filed, 09:41"), so who triages what stays on the studio's side. A snooze,
 * an expiry or a pending row has no client wording and answers null, which
 * leaves the card as it is.
 */
export function clientDecidedLine(input: ClientDecidedInput): string | null {
  const name = input.ownName?.trim() || null
  const when = input.at ? `, ${input.at}` : ''
  switch (input.outcome) {
    case 'approved':
      return name ? `Approved by ${name}${when}` : `Approved${when}`
    case 'rejected':
      return name ? `Rejected by ${name}${when}` : `Not filed${when}`
    case 'failed':
      return CLIENT_CARD_FAILED_LINE
    case 'snoozed':
    case 'expired':
      return null
  }
}

export function clientDecidedMessage(input: ClientDecidedInput): SlackMessagePayload | null {
  const line = clientDecidedLine(input)
  if (!line) return null
  return lineMessage(line, input.outcome === 'approved' ? input.link ?? null : null)
}
