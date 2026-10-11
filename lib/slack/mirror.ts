/**
 * lib/slack/mirror.ts
 *
 * The Slack half of one suggestion, kept in step with the row.
 *
 * A call's suggestions go to BOTH founders' DMs, so one suggestion can have
 * two messages in two channels. When either founder decides, on either
 * surface, every copy has to stop offering buttons: a message that still says
 * Approve after the task exists is a second task waiting to happen. That is
 * what the copies table is for, and what rewriteEverywhere does.
 *
 * Nothing here is allowed to fail the thing that called it. Slack being down,
 * uninstalled, or not migrated yet is a Slack problem; the sweep still writes
 * its suggestions and a decision still decides (CN.2 contract section 3).
 *
 * THE CLIENT COPY POLICY (CN.3 contract section 2). The copies table only
 * ever holds studio channels: a founder's DM, or a member's own. A client's
 * "Is this the request?" card is never recorded, not when it is posted
 * (lib/slack/dispatch-dm.ts) and not when it is pressed
 * (lib/slack/dispatch-actions.ts), so nothing that walks the copies (the
 * decided rewrite, the undecided rewrite, a snooze coming back, the work-sync
 * thread lines) can find a client's DM. The one thing that ever changes a
 * client's card is that client's own press, and it goes through
 * rewriteClientCard below, which rewrites that ONE message from fixed client
 * wording. As a second fence, the three studio rewrites refuse a contact row
 * outright, so a copy recorded by some older code path still hears nothing.
 *
 * The copies table belongs to migration 0110, which slice S1 owns. Its shape,
 * for whoever writes that file:
 *
 *   CREATE TABLE IF NOT EXISTS slack_suggestion_messages (
 *     id text PRIMARY KEY,
 *     suggestion_id text NOT NULL,
 *     channel_id text NOT NULL,
 *     ts text NOT NULL,
 *     created_at text NOT NULL
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_suggestion_messages_copy
 *     ON slack_suggestion_messages(suggestion_id, channel_id, ts);
 *   CREATE INDEX IF NOT EXISTS idx_slack_suggestion_messages_suggestion
 *     ON slack_suggestion_messages(suggestion_id);
 *
 * Read and written through raw SQL for the same reason lib/slack/identity.ts
 * is: the Drizzle entry lands with S1's migration, and two declarations of one
 * table would be a merge conflict for nothing.
 */

import { eq, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { publicUrl } from '@/lib/app-url'
import { STUDIO_TIME_ZONE } from '@/lib/call-time'
import { SIMILAR_BLOCK } from '@/lib/text-similarity'
import { openDm, postMessage, slackBotToken, updateMessage, type SlackMessageRef } from '@/lib/slack/api'
import { listFounderIdentities, type SlackIdentity } from '@/lib/slack/identity'
import {
  callHeaderMessage,
  clientDecidedMessage,
  decidedMessage,
  suggestionMessage,
  type SlackMessagePayload,
  type SuggestionMessageInput,
  type SuggestionOutcome,
} from '@/lib/slack/blocks'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** One posted copy of one suggestion. */
export interface SuggestionMessageCopy {
  suggestionId: string
  channelId: string
  ts: string
}

interface CopyRow {
  suggestion_id: string
  channel_id: string
  ts: string
}

export interface StudioRecipient {
  id: string
  slackUserId: string
  teamMemberId: string
  level: 'founder' | 'member'
  dmChannelId: string | null
}

/** A cached channel or user must identify exactly one current studio person. */
export async function currentStudioRecipient(
  drizzle: Drizzle,
  selector: { channelId: string } | { slackUserId: string },
): Promise<StudioRecipient | null> {
  try {
    const condition = 'channelId' in selector
      ? sql`dm_channel_id = ${selector.channelId}`
      : sql`slack_user_id = ${selector.slackUserId}`
    const rows = await drizzle.all<StudioRecipient>(sql`
      SELECT id, slack_user_id AS slackUserId, team_member_id AS teamMemberId,
             level, dm_channel_id AS dmChannelId
      FROM slack_identities WHERE ${condition} LIMIT 2
    `)
    if (rows.length !== 1) return null
    const recipient = rows[0]
    if (!recipient.teamMemberId || !recipient.slackUserId
      || (recipient.level !== 'founder' && recipient.level !== 'member')) return null
    if ('slackUserId' in selector && recipient.dmChannelId) {
      const channelRecipient = await currentStudioRecipient(drizzle, { channelId: recipient.dmChannelId })
      if (!channelRecipient || channelRecipient.id !== recipient.id) return null
    }
    return recipient
  } catch {
    return null
  }
}

/** Unknown kinds never acquire a feature grant by falling into a default. */
export function suggestionFeature(kind: string): 'tasks' | 'requests' | null {
  if (REQUEST_KIND_NAMES.has(kind)) return 'requests'
  return ['create_task', 'update_task', 'complete_task', 'add_subtasks', 'note'].includes(kind) ? 'tasks' : null
}

async function mayDeliverSuggestion(
  drizzle: Drizzle,
  suggestionId: string,
  selector: { channelId: string } | { slackUserId: string },
): Promise<boolean> {
  try {
    const recipient = await currentStudioRecipient(drizzle, selector)
    if (!recipient) return false
    const [row] = await drizzle.all<{
      kind: string; orgId: string | null; approverType: string; approverId: string | null
    }>(sql`
      SELECT kind, org_id AS orgId, approver_type AS approverType, approver_id AS approverId
      FROM task_suggestions WHERE id = ${suggestionId} LIMIT 1
    `)
    if (!row) return false
    const feature = suggestionFeature(row.kind)
    if (!feature) return false
    if (row.approverType === 'founders') {
      if (recipient.level !== 'founder') return false
    } else if (row.approverType === 'member') {
      if (recipient.teamMemberId !== row.approverId) return false
    } else return false
    const { studioReachesOrg } = await import('@/lib/slack/entitlement')
    return await studioReachesOrg(drizzle, recipient.teamMemberId, row.orgId, [feature], {
      founderOnly: row.approverType === 'founders' || recipient.level === 'founder',
    })
  } catch {
    return false
  }
}

/** Every channel and timestamp holding a copy of this suggestion. Empty when
 *  the table is not there yet, so a caller reads "no copies" rather than
 *  throwing at a founder who is waiting on a decision. */
export async function listSuggestionMessages(
  drizzle: Drizzle,
  suggestionId: string,
): Promise<SuggestionMessageCopy[]> {
  try {
    const rows = await drizzle.all<CopyRow>(sql`
      SELECT suggestion_id, channel_id, ts
      FROM slack_suggestion_messages
      WHERE suggestion_id = ${suggestionId}
    `)
    return (rows ?? []).map(row => ({ suggestionId: row.suggestion_id, channelId: row.channel_id, ts: row.ts }))
  } catch {
    return []
  }
}

/** Remember a copy. INSERT OR IGNORE so a retried post does not file the same
 *  message twice. Returns whether the row landed. */
export async function recordSuggestionMessage(
  drizzle: Drizzle,
  copy: SuggestionMessageCopy,
): Promise<boolean> {
  if (!copy.channelId || !copy.ts) return false
  try {
    await drizzle.run(sql`
      INSERT OR IGNORE INTO slack_suggestion_messages (id, suggestion_id, channel_id, ts, created_at)
      VALUES (${crypto.randomUUID()}, ${copy.suggestionId}, ${copy.channelId}, ${copy.ts}, ${new Date().toISOString()})
    `)
    return true
  } catch {
    return false
  }
}

/**
 * Rewrite every copy of one suggestion to the same message.
 *
 * Per copy, not per batch: one channel the bot was removed from must not stop
 * the other founder's message from losing its buttons. Returns how many were
 * rewritten, which is a number a cron log can read.
 */
export async function rewriteEverywhere(
  drizzle: Drizzle,
  suggestionId: string,
  payload: SlackMessagePayload,
): Promise<number> {
  if (!slackBotToken()) return 0
  const copies = await listSuggestionMessages(drizzle, suggestionId)
  let rewritten = 0
  for (const copy of copies) {
    try {
      if (!await mayDeliverSuggestion(drizzle, suggestionId, { channelId: copy.channelId })) continue
      await updateMessage({ channel: copy.channelId, ts: copy.ts, text: payload.text, blocks: payload.blocks })
      rewritten++
    } catch {
      // A copy that cannot be rewritten stays as it was. The gate still
      // refuses the second click, so the worst case is a stale button, not a
      // second task.
    }
  }
  return rewritten
}

/**
 * Rewrite every copy of one suggestion to the row as it now stands, buttons
 * and all.
 *
 * This is the undecided rewrite, which is the one the duplicate answer and an
 * attach need: the row is still pending, so the message still has to offer
 * the five things a founder can do about it, only saying something different
 * about what it proposes (contract section 3).
 *
 * A client's row is refused before anything is read: this message carries the
 * Tweak link and the duplicate line, and a client's card is never recorded to
 * be rewritten in the first place (the policy in the header).
 */
export async function rewriteSuggestionMessage(
  drizzle: Drizzle,
  row: SuggestionMessageInput & { approverType: string },
  options: { duplicate?: boolean } = {},
): Promise<number> {
  if (row.approverType === 'contact') return 0
  const duplicate = options.duplicate ?? opensAsDuplicate(row)
  return rewriteEverywhere(drizzle, row.id, suggestionMessage(row, { duplicate }))
}

// ── Posting a call's suggestions ────────────────────────────────────────────

/** Whether the duplicate answer is what this row should open with: the best
 *  match already scores at or above the block threshold, so Approve would be
 *  refused anyway (CN.1d section 5). */
function opensAsDuplicate(row: SuggestionMessageInput): boolean {
  const best = (row.similar ?? [])[0]
  return !!best && best.score >= SIMILAR_BLOCK
}

export interface PostSuggestionsResult {
  /** Suggestion messages that landed, counted across every founder. */
  posted: number
  /** Founders whose DM could not be written to at all. */
  failed: number
  /** Founders the run actually reached. */
  founders: number
}

export interface PostSuggestionsInput {
  /** The rows to post, oldest first: the order the call said them in. */
  rows: readonly SuggestionMessageInput[]
  /** Injected in tests, and by a caller that already read them. */
  founders?: readonly SlackIdentity[]
  /**
   * Post a row that already has a copy in Slack. Off by default, and the
   * default is the load bearing one: the sweep hands this function the
   * PENDING rows for a call, which on the next run still includes everything
   * nobody has decided yet. Without the skip a founder's DM fills with the
   * same suggestion every thirty minutes.
   */
  repost?: boolean
}

/** The rows that have never been posted, in the order they came in. */
async function unposted(
  drizzle: Drizzle,
  rows: readonly SuggestionMessageInput[],
): Promise<readonly SuggestionMessageInput[]> {
  const fresh: SuggestionMessageInput[] = []
  for (const row of rows) {
    const copies = await listSuggestionMessages(drizzle, row.id)
    if (copies.length === 0) fresh.push(row)
  }
  return fresh
}

/**
 * One header message then one message per suggestion, in every founder's DM
 * (contract section 3).
 *
 * Both founders get their own copy; each copy is remembered so a decision by
 * either can rewrite both. The first copy is also stamped onto the suggestion
 * row's slack_channel_id and slack_message_ts, which is the pointer CN.1
 * reserved on the table.
 */
export async function postSuggestionsForCall(
  drizzle: Drizzle,
  input: PostSuggestionsInput,
): Promise<PostSuggestionsResult> {
  const result: PostSuggestionsResult = { posted: 0, failed: 0, founders: 0 }
  if (input.rows.length === 0) return result
  if (!slackBotToken()) return result

  const founders = input.founders ?? await listFounderIdentities(drizzle)
  if (founders.length === 0) return result

  const rows = input.repost === true ? input.rows : await unposted(drizzle, input.rows)
  if (rows.length === 0) return result

  const firstCopy = new Map<string, SlackMessageRef>()

  for (const founder of founders) {
    let channel: string
    const current = await currentStudioRecipient(drizzle, { slackUserId: founder.slackUserId })
    if (!current || current.id !== founder.id || current.teamMemberId !== founder.teamMemberId
      || current.level !== 'founder') continue
    const allowed: SuggestionMessageInput[] = []
    for (const row of rows) {
      if (await mayDeliverSuggestion(drizzle, row.id, { slackUserId: current.slackUserId })) allowed.push(row)
    }
    if (allowed.length === 0) continue
    try {
      channel = current.dmChannelId ?? await openDm(current.slackUserId)
      if (!current.dmChannelId && channel) {
        await drizzle.run(sql`
          UPDATE slack_identities SET dm_channel_id = ${channel}
          WHERE id = ${current.id} AND dm_channel_id IS NULL
        `)
      }
    } catch {
      result.failed++
      continue
    }
    if (!channel) {
      result.failed++
      continue
    }
    result.founders++

    try {
      const first = allowed[0]
      const header = callHeaderMessage({
        callTitle: first.callTitle ?? null,
        orgName: first.orgName ?? null,
        callScheduledAt: first.callScheduledAt ?? null,
        count: allowed.length,
      })
      if (!await mayDeliverSuggestion(drizzle, first.id, { channelId: channel })) continue
      await postMessage({ channel, text: header.text, blocks: header.blocks })
    } catch {
      // The header is context, not the thing being approved. Losing it is not
      // a reason to withhold the suggestions themselves.
    }

    for (const row of allowed) {
      try {
        const payload = suggestionMessage(row, { duplicate: opensAsDuplicate(row) })
        if (!await mayDeliverSuggestion(drizzle, row.id, { channelId: channel })) continue
        const ref = await postMessage({ channel, text: payload.text, blocks: payload.blocks })
        await recordSuggestionMessage(drizzle, { suggestionId: row.id, channelId: ref.channel, ts: ref.ts })
        if (!firstCopy.has(row.id)) firstCopy.set(row.id, ref)
        result.posted++
      } catch {
        result.failed++
      }
    }
  }

  for (const [suggestionId, ref] of firstCopy) {
    try {
      await drizzle
        .update(schema.taskSuggestions)
        .set({ slackChannelId: ref.channel, slackMessageTs: ref.ts })
        .where(eq(schema.taskSuggestions.id, suggestionId))
    } catch {
      // The copies table is the load-bearing record; this column is a
      // convenience pointer, and a failure to stamp it costs nothing.
    }
  }

  return result
}

/**
 * A snoozed suggestion whose time has come, back in the same DMs (contract
 * section 3). A fresh message rather than a rewrite, because the point of a
 * snooze ending is the notification.
 *
 * Never a client's row: a client cannot snooze their own card, and a studio
 * snooze of a client's draft ends in the inbox, not in the client's DM with
 * the studio's Tweak link and duplicate line on it.
 */
export async function repostSuggestion(
  drizzle: Drizzle,
  row: SuggestionMessageInput & { approverType: string },
): Promise<number> {
  if (row.approverType === 'contact') return 0
  if (!slackBotToken()) return 0
  const copies = await listSuggestionMessages(drizzle, row.id)
  const channels = Array.from(new Set(copies.map(copy => copy.channelId)))
  if (channels.length === 0) return 0

  const payload = suggestionMessage(row, { duplicate: opensAsDuplicate(row) })
  let posted = 0
  for (const channel of channels) {
    try {
      if (!await mayDeliverSuggestion(drizzle, row.id, { channelId: channel })) continue
      const ref = await postMessage({ channel, text: payload.text, blocks: payload.blocks })
      await recordSuggestionMessage(drizzle, { suggestionId: row.id, channelId: ref.channel, ts: ref.ts })
      posted++
    } catch {
      // Same rule as everywhere else here: Slack is never the reason a
      // resurfaced row stops existing in the dashboard.
    }
  }
  return posted
}

// ── The decision rewrite ────────────────────────────────────────────────────

/** The studio wall clock, "09:41", which is the only time a founder reads. */
export function studioClock(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: STUDIO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
}

/** "Fri 09:00" for a snooze, which says when it comes back rather than when
 *  it was put down. */
export function studioWhen(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: STUDIO_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
}

/** The row's status, as the word the message will carry. Null for a status
 *  that is not a decision, which is a row nobody needs told about. */
export function outcomeForStatus(status: string): SuggestionOutcome | null {
  switch (status) {
    case 'applied': return 'approved'
    case 'rejected': return 'rejected'
    case 'snoozed': return 'snoozed'
    case 'expired': return 'expired'
    case 'failed': return 'failed'
    default: return null
  }
}

function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? trimmed
}

/**
 * The decider's first name, which is what "Approved by Liam" wants.
 *
 * A team member only. This line is only ever written on a studio card (a
 * founders' call card or a member's own note), which only a studio person
 * decides; a client's own card names the client through rewriteClientCard.
 */
async function actorName(drizzle: Drizzle, actorId: string | null): Promise<string | null> {
  if (!actorId) return null
  try {
    const [member] = await drizzle
      .select({ name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, actorId))
      .limit(1)
    return firstName(member?.name)
  } catch {
    return null
  }
}

/** The subset of a suggestion row the rewrite reads. */
export interface DecidedSuggestionRow {
  id: string
  status: string
  snoozeUntil: string | null
  decidedById: string | null
  decidedAt: string | null
  updatedAt: string | null
  applyError: string | null
  /** Optional so an older caller still fits; decideSuggestion hands the
   *  whole row, which carries all three. */
  kind?: string
  appliedTaskId?: string | null
  appliedRequestId?: string | null
  /**
   * 'founders' | 'member' | 'contact'. REQUIRED, because it is the fence:
   * a contact row is never rewritten by the studio's decided line (which
   * names who snoozed it and carries the apply error), only by
   * rewriteClientCard. A caller that could forget it is a caller that could
   * leak, so the type does not let it.
   */
  approverType: string
  /** The contact a client row belongs to. Read by rewriteClientCard to tell
   *  the client's own decision from the studio's. */
  approverId?: string | null
  /** The row's client. A client's card links only a request at this client. */
  orgId?: string | null
}

/** The request half of the suggestion kinds. Spelled out here rather than
 *  imported, because lib/task-suggestions.ts imports this module. */
const REQUEST_KIND_NAMES: ReadonlySet<string> = new Set([
  'create_request', 'update_request', 'request_note', 'hand_off_request',
])

interface LinkedRequest {
  number: number | null
  isInternal: boolean
  orgId: string | null
}

/** The fields a link to a request needs, and whose client it is, or null when
 *  the row cannot be read. */
async function readLinkedRequest(drizzle: Drizzle, requestId: string): Promise<LinkedRequest | null> {
  try {
    const [row] = await drizzle
      .select({
        requestNumber: schema.requests.requestNumber,
        isInternal: schema.requests.isInternal,
        orgId: schema.requests.orgId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1)
    if (!row) return null
    const number = row.requestNumber
    return {
      number: typeof number === 'number' && Number.isFinite(number) ? number : null,
      isInternal: !!row.isInternal,
      orgId: typeof row.orgId === 'string' ? row.orgId : null,
    }
  } catch {
    return null
  }
}

/** "Open #231", or "Open request" when there is no number to show. */
function requestLinkLabel(request: LinkedRequest | null): string {
  return request?.number != null ? `Open #${request.number}` : 'Open request'
}

function requestLink(requestId: string, request: LinkedRequest | null): { url: string; label: string } {
  return { url: publicUrl(`/requests/${encodeURIComponent(requestId)}`), label: requestLinkLabel(request) }
}

/**
 * Where an approved card points: the request or the task the suggestion
 * made or changed (CN.3 contract section 1). Null for every other outcome,
 * and for an applied row that names nothing, which is a row this function
 * has no business guessing about.
 *
 * applySuggestion stamps exactly one of the two ids, by kind; the kind is
 * read first anyway so a row carrying both would still link the thing its
 * kind is about.
 *
 * A client's own card (rewriteClientCard) links to their request and nothing
 * else (contract section 2). A founder can attach a client's draft to a
 * task, or to an internal request, from the dashboard, and neither is
 * anything the client's portal shows. So a contact row links only a request
 * that reads back as not internal and at the row's own client, and a request
 * that cannot be read (or a row whose client is not known) gets no link.
 */
export async function decidedLinkFor(
  drizzle: Drizzle,
  row: Pick<DecidedSuggestionRow, 'status' | 'kind' | 'appliedTaskId' | 'appliedRequestId' | 'orgId'> & { approverType?: string },
): Promise<{ url: string; label: string } | null> {
  if (outcomeForStatus(row.status) !== 'approved') return null
  const requestId = row.appliedRequestId ?? null
  const taskId = row.appliedTaskId ?? null

  if (row.approverType === 'contact') {
    if (!requestId || !row.orgId) return null
    const request = await readLinkedRequest(drizzle, requestId)
    if (!request || request.isInternal || request.orgId !== row.orgId) return null
    return requestLink(requestId, request)
  }

  const preferRequest = row.kind ? REQUEST_KIND_NAMES.has(row.kind) : !!requestId
  if (preferRequest && requestId) {
    return requestLink(requestId, await readLinkedRequest(drizzle, requestId))
  }
  if (taskId) {
    return { url: publicUrl(`/tasks/${encodeURIComponent(taskId)}`), label: 'Open task' }
  }
  if (requestId) {
    return requestLink(requestId, await readLinkedRequest(drizzle, requestId))
  }
  return null
}

/**
 * The hook lib/task-suggestions.ts decideSuggestion calls after it has
 * written: every Slack copy of this row becomes one line with no buttons.
 *
 * Returns the number of copies rewritten, and NEVER throws. A decision made
 * in the dashboard is a fact about the database; whether Slack heard about it
 * is a separate and lesser question.
 *
 * A client's own draft (approver_type 'contact') is refused before anything
 * is read or rewritten. This line names who snoozed a row and carries the raw
 * apply error, both written for the studio, and a client's card is never on
 * the copies table anyway (the policy in the header). A studio decision on a
 * client's draft therefore changes nothing in the client's DM: no Slack
 * message reaches a client that the client did not trigger.
 */
export async function mirrorSuggestionDecision(
  drizzle: Drizzle,
  row: DecidedSuggestionRow,
): Promise<number> {
  try {
    if (row.approverType === 'contact') return 0
    if (!slackBotToken()) return 0
    const outcome = outcomeForStatus(row.status)
    if (!outcome) return 0
    const payload = decidedMessage({
      outcome,
      actorName: await actorName(drizzle, row.decidedById),
      at: studioClock(row.decidedAt ?? row.updatedAt ?? null),
      until: outcome === 'snoozed' ? studioWhen(row.snoozeUntil) : null,
      error: row.applyError,
      link: await decidedLinkFor(drizzle, row),
    })
    return await rewriteEverywhere(drizzle, row.id, payload)
  } catch {
    return 0
  }
}

// ── A client's own card ─────────────────────────────────────────────────────

/** A contact's first name, read from contacts only: a client's card never
 *  names anybody but that client. */
async function contactFirstName(drizzle: Drizzle, contactId: string | null | undefined): Promise<string | null> {
  if (!contactId) return null
  try {
    const [contact] = await drizzle
      .select({ name: schema.contacts.name })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contactId))
      .limit(1)
    return firstName(contact?.name)
  } catch {
    return null
  }
}

/**
 * The one message in a client's DM that a decision may change: the card the
 * client just pressed, identified by the channel and ts Slack sent with the
 * press. Never recorded, never looked up, never any other message.
 *
 * Written by clientDecidedMessage from fixed client wording: the client's own
 * first name when the decision was theirs (nobody's name when it was the
 * studio's), the studio clock, and on an approval a link to the request only
 * when it reads back as not internal (decidedLinkFor's contact rule). Never
 * the apply error, never who snoozed it, never a task, never a Tweak link.
 *
 * Only for a contact row; anything else answers false before a read. No bot
 * token, no rewrite. Never throws.
 */
export async function rewriteClientCard(
  drizzle: Drizzle,
  card: { channelId: string | null; ts: string | null },
  row: DecidedSuggestionRow,
): Promise<boolean> {
  try {
    if (row.approverType !== 'contact') return false
    if (!card.channelId || !card.ts) return false
    if (!slackBotToken()) return false
    const outcome = outcomeForStatus(row.status)
    if (!outcome) return false
    const own = !!row.decidedById && !!row.approverId && row.decidedById === row.approverId
    const payload = clientDecidedMessage({
      outcome,
      ownName: own ? await contactFirstName(drizzle, row.approverId) : null,
      at: studioClock(row.decidedAt ?? row.updatedAt ?? null),
      link: outcome === 'approved' ? await decidedLinkFor(drizzle, row) : null,
    })
    if (!payload) return false
    await updateMessage({ channel: card.channelId, ts: card.ts, text: payload.text, blocks: payload.blocks })
    return true
  } catch {
    return false
  }
}
