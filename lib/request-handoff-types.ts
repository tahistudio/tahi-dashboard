/**
 * lib/request-handoff-types.ts
 *
 * A request keeps its Tahi owner, but at any moment can be handed to one
 * named client contact with a reason and an optional due date. This file is
 * the shared vocabulary the UI reads: the reason copy, the one action verb
 * each reason maps to, and the pure math (days waiting, chip text) that has
 * to agree everywhere it is printed.
 *
 * H1 (schema + API) owns the real `lib/request-handoff.ts` that the routes,
 * notifications and MCP layer import from. Until that lands, this file types
 * the same field names locally so the UI slice can build and test against
 * the agreed contract; the lead reconciles the two on merge. Keep every name
 * here identical to the contract so that reconciliation is a delete, not a
 * rewrite.
 */

export type WaitingReason = 'approval' | 'content' | 'access' | 'decision' | 'file' | 'other'

export const WAITING_REASONS: readonly WaitingReason[] = [
  'approval', 'content', 'access', 'decision', 'file', 'other',
]

/** One place for the reason sentence, exactly as agreed in the contract. */
export const WAITING_REASON_SENTENCE: Record<WaitingReason, string> = {
  approval: 'Needs your approval',
  content: 'Needs content from you',
  access: 'Needs access from you',
  decision: 'Needs a decision from you',
  file: 'Needs a file from you',
  other: 'Needs something from you',
}

/** Short word for chips and selects, where the full sentence would not fit. */
export const WAITING_REASON_SHORT_LABEL: Record<WaitingReason, string> = {
  approval: 'approval',
  content: 'content',
  access: 'access',
  decision: 'decision',
  file: 'file',
  other: 'other',
}

/** The one client action verb each reason maps to. Approval routes through
 *  the existing client review approve; every other reason is a reply
 *  (content and file additionally invite an upload). */
export type WaitingActionVerb = 'Approve' | 'Upload or reply' | 'Reply'

export const WAITING_REASON_ACTION_VERB: Record<WaitingReason, WaitingActionVerb> = {
  approval: 'Approve',
  content: 'Upload or reply',
  access: 'Reply',
  decision: 'Reply',
  file: 'Upload or reply',
  other: 'Reply',
}

export function waitingReasonSentence(reason: WaitingReason): string {
  return WAITING_REASON_SENTENCE[reason]
}

export function waitingReasonShortLabel(reason: WaitingReason): string {
  return WAITING_REASON_SHORT_LABEL[reason]
}

export function waitingActionVerb(reason: WaitingReason): WaitingActionVerb {
  return WAITING_REASON_ACTION_VERB[reason]
}

/** Reason options for a select control, in contract order. */
export const WAITING_REASON_OPTIONS: ReadonlyArray<{ value: WaitingReason; label: string; sentence: string }> =
  WAITING_REASONS.map(reason => ({
    value: reason,
    label: WAITING_REASON_SHORT_LABEL[reason].replace(/^[a-z]/, c => c.toUpperCase()),
    sentence: WAITING_REASON_SENTENCE[reason],
  }))

/** The shape every request payload that already returns a request row gains,
 *  computed server-side. `reasonLabel` is the full sentence, so a consumer
 *  that only has the summary never has to re-derive it. */
export interface WaitingOnSummary {
  contactId: string
  contactName: string
  contactEmail?: string | null
  reason: WaitingReason
  reasonLabel?: string
  since: string
  dueAt: string | null
  note: string | null
  daysWaiting?: number
  nudgedAt?: string | null
}

/** A "waiting on you" item as it appears in the client's personal panel or
 *  the org admin's "also waiting on your team" list: a request plus the
 *  waiting-on summary that points at it. */
export interface WaitingOnRequestItem {
  requestId: string
  requestNumber: number | null
  requestTitle: string
  orgId?: string
  orgName?: string | null
  waitingOn: WaitingOnSummary
}

/** First name only, for the chip and the client panel's addressed line.
 *  Falls back to the full string when there is no space to split on. */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim()
  if (!trimmed) return trimmed
  const [first] = trimmed.split(/\s+/)
  return first
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days elapsed since an ISO timestamp, floored at zero. Floor (not
 *  round) so "since this morning" reads as 0d rather than jumping to 1d
 *  a few hours in, which is what the nudge cadence and the chip both key
 *  off. */
export function daysWaiting(sinceIso: string, now: Date = new Date()): number {
  const since = new Date(sinceIso).getTime()
  if (Number.isNaN(since)) return 0
  const diff = now.getTime() - since
  if (diff <= 0) return 0
  return Math.floor(diff / DAY_MS)
}

/** The row and board card chip text: "Waiting on <first name> · <reason
 *  short> · <n>d". */
export function waitingChipText(waitingOn: WaitingOnSummary, now: Date = new Date()): string {
  const days = waitingOn.daysWaiting ?? daysWaiting(waitingOn.since, now)
  return `Waiting on ${firstName(waitingOn.contactName)} · ${waitingReasonShortLabel(waitingOn.reason)} · ${days}d`
}

/** The Blocked by card's synthetic line: "Waiting on <name> for <reason>
 *  since <date>". Date formatting is left to the caller (it already has a
 *  locale-aware formatter), so this returns the reason clause only. */
export function waitingBlockedByLine(waitingOn: WaitingOnSummary): string {
  return `Waiting on ${waitingOn.contactName} for ${waitingReasonShortLabel(waitingOn.reason)}`
}

/** The client detail banner: "This is with you: <reason sentence>". */
export function waitingBannerText(reason: WaitingReason): string {
  return `This is with you: ${waitingReasonSentence(reason)}`
}

export function isWaitingReason(value: string): value is WaitingReason {
  return (WAITING_REASONS as readonly string[]).includes(value)
}
