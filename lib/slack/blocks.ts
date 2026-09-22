/**
 * lib/slack/blocks.ts
 *
 * One suggestion, rendered as one Block Kit message (CN.2 section 3).
 *
 * STUB NOTE (slice S3). This file belongs to slice S2, which renders the full
 * card: the client and call header, the kind chip, the shared summariser from
 * lib/suggestion-summary.ts, the suggested assignee line from slice A1, the
 * duplicate answer from CN.1d, and the in place rewrite after a decision.
 * S3 only needs a message it can post back into a DM, so what is here is the
 * smallest honest version of that: the words, the quote, and the five buttons
 * with the action ids S2's interactive route already parses. When S2 lands,
 * its version replaces this one and every caller keeps working, because the
 * only thing S3 depends on is the exported signature.
 */

import { SUGGESTION_ACTIONS, buildActionId, type SuggestionAction } from './action-ids'

/** The Block Kit subset this file emits. Narrow on purpose: no `any`. */
export interface SlackTextObject {
  type: 'mrkdwn' | 'plain_text'
  text: string
  emoji?: boolean
}

export interface SlackSectionBlock {
  type: 'section'
  text: SlackTextObject
}

export interface SlackContextBlock {
  type: 'context'
  elements: SlackTextObject[]
}

export interface SlackButtonElement {
  type: 'button'
  text: SlackTextObject
  action_id: string
  value?: string
  url?: string
  style?: 'primary' | 'danger'
}

export interface SlackActionsBlock {
  type: 'actions'
  elements: SlackButtonElement[]
}

export type SlackBlock = SlackSectionBlock | SlackContextBlock | SlackActionsBlock

/** A message as lib/slack/api.ts postMessage takes it. */
export interface SlackMessage {
  text: string
  blocks: SlackBlock[]
}

/** What a card needs to render. A subset of DecoratedSuggestion, by design. */
export interface SuggestionMessageInput {
  id: string
  kind: string
  proposal: unknown
  quote: string
  orgName?: string | null
  callTitle?: string | null
  suggestedAssigneeName?: string | null
}

/** The chip, in words rather than a code name. */
const KIND_LABELS: Record<string, string> = {
  create_task: 'New task',
  update_task: 'Update task',
  complete_task: 'Mark done',
  add_subtasks: 'Checklist',
  note: 'Note',
  create_request: 'New request',
  update_request: 'Update request',
  request_note: 'Request note',
  hand_off_request: 'Hand off',
}

/** The button label per action, in the order the contract lists them. */
const BUTTON_LABELS: Record<SuggestionAction, string> = {
  approve: 'Approve',
  tweak: 'Tweak',
  tonight: 'Tonight',
  this_week: 'This week',
  reject: 'Reject',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The one line that says what would change.
 *
 * Deliberately thin: S2 moves the dashboard's summariser into
 * lib/suggestion-summary.ts and both sides share it. Until then this covers
 * the shapes a DM can actually produce (a create from a note, a create from a
 * client) and falls back to the kind label for the rest, which is wrong in
 * detail but never wrong in kind.
 */
export function summariseForSlack(kind: string, proposal: unknown): string {
  const p = record(proposal)
  const title = str(p.title)
  if (title) return title
  const body = str(p.body)
  if (body) return body
  const contactName = str(p.contactName)
  if (contactName) return `Waiting on ${contactName}`
  return KIND_LABELS[kind] ?? kind
}

/** Block Kit truncates hard; a quote that runs past this reads as noise anyway. */
const MAX_QUOTE = 600

function quoteBlock(quote: string): string {
  const trimmed = quote.trim().replace(/\s+/g, ' ')
  const clipped = trimmed.length > MAX_QUOTE ? `${trimmed.slice(0, MAX_QUOTE - 1)}...` : trimmed
  return `> ${clipped}`
}

/**
 * The card.
 *
 * `text` is the notification fallback and the plain text a client without
 * Block Kit sees, so it carries the summary rather than "New message".
 */
export function suggestionMessage(input: SuggestionMessageInput, options: { tweakUrl?: string } = {}): SlackMessage {
  const label = KIND_LABELS[input.kind] ?? input.kind
  const summary = summariseForSlack(input.kind, input.proposal)

  const headerParts = [label]
  if (input.orgName) headerParts.push(input.orgName)
  if (input.callTitle) headerParts.push(input.callTitle)

  const blocks: SlackBlock[] = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: headerParts.join('  |  ') }] },
    { type: 'section', text: { type: 'mrkdwn', text: `*${summary}*` } },
  ]

  if (input.quote.trim()) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: quoteBlock(input.quote) }] })
  }

  if (input.suggestedAssigneeName) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Suggested: ${input.suggestedAssigneeName}` }],
    })
  }

  blocks.push({
    type: 'actions',
    elements: SUGGESTION_ACTIONS.map(action => {
      const element: SlackButtonElement = {
        type: 'button',
        text: { type: 'plain_text', text: BUTTON_LABELS[action], emoji: false },
        action_id: buildActionId(action, input.id),
        value: input.id,
      }
      if (action === 'approve') element.style = 'primary'
      if (action === 'reject') element.style = 'danger'
      if (action === 'tweak' && options.tweakUrl) element.url = options.tweakUrl
      return element
    }),
  })

  return { text: `${label}: ${summary}`, blocks }
}
