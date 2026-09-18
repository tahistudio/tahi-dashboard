/**
 * lib/request-handoff-copy.ts
 *
 * The client hand-off's pure vocabulary and payload shapes: the reason copy,
 * the verb, the participant role, the day math and the payload builders. No
 * server import lives here, on purpose.
 *
 * A 'use client' component (the Waiting on card, the requests list's chip,
 * the request detail rail, the client portal home) needs this before any of
 * them touch a database. They used to reach into lib/request-handoff.ts for
 * it, which pulled drizzle-orm and the D1 schema into the browser bundle for
 * nothing they read. lib/request-handoff.ts imports this file and
 * re-exports it in full (`export * from './request-handoff-copy'`), so every
 * server-side importer keeps the same names at the same path; the client
 * components below import straight from here instead.
 *
 * ONE reason maps to exactly one sentence, one short word, one verb and one
 * participant role, defined once and nowhere else: see the longer version of
 * that argument at the top of lib/request-handoff.ts.
 */

// ─── The vocabulary ──────────────────────────────────────────────────────────

/** Why a request is with a client. Closed set; the column stores the slug. */
export const HANDOFF_REASONS = [
  'approval',
  'content',
  'access',
  'decision',
  'file',
  'other',
] as const

export type HandoffReason = (typeof HANDOFF_REASONS)[number]

export function isHandoffReason(value: unknown): value is HandoffReason {
  return typeof value === 'string' && (HANDOFF_REASONS as readonly string[]).includes(value)
}

/**
 * The sentence the CLIENT reads, written to them in the second person.
 *
 * Not the studio's words for the same thing. "Awaiting client approval" is
 * how the studio would say it and it tells the person reading it nothing
 * about what they are supposed to do.
 */
export const HANDOFF_REASON_SENTENCE: Record<HandoffReason, string> = {
  approval: 'Needs your approval',
  content: 'Needs content from you',
  access: 'Needs access from you',
  decision: 'Needs a decision from you',
  file: 'Needs a file from you',
  other: 'Needs something from you',
}

/**
 * The same reason compressed for the studio's chip, where it sits between a
 * name and a day count and has room for one or two words.
 */
export const HANDOFF_REASON_SHORT: Record<HandoffReason, string> = {
  approval: 'approval',
  content: 'content',
  access: 'access',
  decision: 'a decision',
  file: 'a file',
  other: 'something',
}

/**
 * ONE verb per reason, and only one.
 *
 * A client who is shown three buttons is a client who closes the tab. Approval
 * routes to the review control that already exists (POST
 * /api/portal/requests/[id]/review), because approving there is what marks the
 * delivery done; everything else routes to the thread, where a reply and an
 * attachment are the same control.
 */
export type HandoffActionVerb = 'Approve' | 'Upload or reply' | 'Reply'

export const HANDOFF_ACTION_VERB: Record<HandoffReason, HandoffActionVerb> = {
  approval: 'Approve',
  content: 'Upload or reply',
  file: 'Upload or reply',
  access: 'Reply',
  decision: 'Reply',
  other: 'Reply',
}

/**
 * The request_participants role a hand-off writes beside the pointer.
 *
 * The pointer alone would make the person invisible to everything that reads
 * the cast (the people row on the card, the thread's audience). The role says
 * what they are there for: somebody asked to sign something off is an
 * approver, everyone else is contributing. 'watcher' stays available for a
 * person who only follows, and is never written by a hand-off.
 */
export type HandoffParticipantRole = 'approver' | 'contributor'

export function handoffParticipantRole(reason: HandoffReason): HandoffParticipantRole {
  return reason === 'approval' ? 'approver' : 'contributor'
}

/** The reason as the client reads it. Unknown slugs read as 'other'. */
export function handoffReasonLabel(reason: string | null | undefined): string {
  return HANDOFF_REASON_SENTENCE[isHandoffReason(reason) ? reason : 'other']
}

/** The short word for chips and selects, where the full sentence would not fit. */
export function handoffReasonShortLabel(reason: HandoffReason): string {
  return HANDOFF_REASON_SHORT[reason]
}

/** The one client action verb a reason maps to. */
export function handoffActionVerb(reason: HandoffReason): HandoffActionVerb {
  return HANDOFF_ACTION_VERB[reason]
}

/** The client detail banner: "This is with you: <reason sentence>". */
export function waitingBannerText(reason: HandoffReason): string {
  return `This is with you: ${handoffReasonLabel(reason)}`
}

/** Reason options for a select control, in contract order. Labelled off the
 *  slug itself (Approval, Decision, File, ...) rather than off
 *  HANDOFF_REASON_SHORT: that record carries the grammatical article the chip
 *  needs ("a decision", "a file"), which reads oddly as a standalone picker
 *  item. */
export const HANDOFF_REASON_OPTIONS: ReadonlyArray<{ value: HandoffReason; label: string; sentence: string }> =
  HANDOFF_REASONS.map(reason => ({
    value: reason,
    label: reason.charAt(0).toUpperCase() + reason.slice(1),
    sentence: HANDOFF_REASON_SENTENCE[reason],
  }))

// ─── The pointer ─────────────────────────────────────────────────────────────

/** The pointer columns, as any request row carries them. */
export interface WaitingOnRow {
  waitingOnContactId: string | null
  waitingReason: string | null
  waitingSince: string | null
  waitingDueAt: string | null
  waitingNote: string | null
}

/**
 * The pointer as every request payload returns it.
 *
 * `contactEmail` is only ever present on POST
 * /api/admin/requests/[id]/handoff's own response, stamped on top of this
 * shape for the hand-off dialog that just picked the contact and already
 * knows it. Every read path (loadWaitingOn, loadWaitingOnOne) leaves it out,
 * so it stays optional here rather than promising a field most payloads do
 * not carry.
 */
export interface WaitingOnPayload {
  contactId: string
  contactName: string | null
  contactEmail?: string | null
  reason: HandoffReason
  reasonLabel: string
  since: string
  dueAt: string | null
  note: string | null
  daysWaiting: number
}

/** A "waiting on you" item as it appears in the client's personal panel or
 *  the org admin's "also waiting on your team" list: a request plus the
 *  waiting-on pointer that points at it. */
export interface WaitingOnRequestItem {
  requestId: string
  requestNumber: number | null
  requestTitle: string
  orgId?: string
  orgName?: string | null
  waitingOn: WaitingOnPayload
}

const DAY_MS = 86_400_000

/**
 * Whole days elapsed since a stamp. Never negative and never NaN: this number
 * is printed on a chip and compared against the nudge window, and both would
 * rather read 0 than "NaNd" or "-1d" if a clock or a column disagrees.
 */
export function daysWaiting(since: string | null | undefined, now: Date = new Date()): number {
  if (!since) return 0
  const started = Date.parse(since)
  if (Number.isNaN(started)) return 0
  const elapsed = now.getTime() - started
  if (elapsed <= 0) return 0
  return Math.floor(elapsed / DAY_MS)
}

/**
 * The pointer, resolved for a payload. Null means the request is with the
 * studio, which is every request's normal state.
 *
 * Tolerant of a reason slug it does not recognise (falls back to 'other')
 * rather than dropping the whole pointer: a request that IS with somebody must
 * keep saying so even if the vocabulary moves under it.
 */
export function buildWaitingOn(
  row: WaitingOnRow,
  contactName: string | null,
  now: Date = new Date(),
): WaitingOnPayload | null {
  if (!row.waitingOnContactId) return null
  const reason: HandoffReason = isHandoffReason(row.waitingReason) ? row.waitingReason : 'other'
  return {
    contactId: row.waitingOnContactId,
    contactName: contactName?.trim() || null,
    reason,
    reasonLabel: HANDOFF_REASON_SENTENCE[reason],
    since: row.waitingSince ?? '',
    dueAt: row.waitingDueAt ?? null,
    note: row.waitingNote ?? null,
    daysWaiting: daysWaiting(row.waitingSince, now),
  }
}

/** First name only, for the chip. A full name eats the whole chip. */
function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? null
}

/**
 * The studio's chip: "Waiting on Ngaire · approval · 3d". One string, built
 * here, so the list row and the kanban card cannot word it differently.
 */
export function waitingChipLabel(
  contactName: string | null | undefined,
  reason: string | null | undefined,
  days: number,
): string {
  const who = firstName(contactName) ?? 'a client'
  const what = HANDOFF_REASON_SHORT[isHandoffReason(reason) ? reason : 'other']
  return `Waiting on ${who} · ${what} · ${days}d`
}

/**
 * The row and board card chip text, over a whole payload rather than its
 * three loose fields. Reads a precomputed `daysWaiting` when the caller
 * already has one rather than recomputing it from `since`.
 */
export function waitingChipText(
  waitingOn: { contactName: string | null; reason: string | null | undefined; since: string; daysWaiting?: number },
  now: Date = new Date(),
): string {
  const days = waitingOn.daysWaiting ?? daysWaiting(waitingOn.since, now)
  return waitingChipLabel(waitingOn.contactName, waitingOn.reason, days)
}

/** The Blocked by card's synthetic line: "Waiting on <name> for <reason>". */
export function waitingBlockedByLine(waitingOn: { contactName: string | null; reason: string | null | undefined }): string {
  const who = waitingOn.contactName?.trim() || 'a client'
  const what = HANDOFF_REASON_SHORT[isHandoffReason(waitingOn.reason) ? waitingOn.reason : 'other']
  return `Waiting on ${who} for ${what}`
}
