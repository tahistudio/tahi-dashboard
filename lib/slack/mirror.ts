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
import { STUDIO_TIME_ZONE } from '@/lib/call-time'
import { SIMILAR_BLOCK } from '@/lib/text-similarity'
import { openDm, postMessage, slackBotToken, updateMessage, type SlackMessageRef } from '@/lib/slack/api'
import { listFounderIdentities, type SlackIdentity } from '@/lib/slack/identity'
import {
  callHeaderMessage,
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
 */
export async function rewriteSuggestionMessage(
  drizzle: Drizzle,
  row: SuggestionMessageInput,
  options: { duplicate?: boolean } = {},
): Promise<number> {
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

  const first = rows[0]
  const header = callHeaderMessage({
    callTitle: first.callTitle ?? null,
    orgName: first.orgName ?? null,
    callScheduledAt: first.callScheduledAt ?? null,
    count: rows.length,
  })

  const firstCopy = new Map<string, SlackMessageRef>()

  for (const founder of founders) {
    let channel: string
    try {
      channel = founder.dmChannelId ?? await openDm(founder.slackUserId)
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
      await postMessage({ channel, text: header.text, blocks: header.blocks })
    } catch {
      // The header is context, not the thing being approved. Losing it is not
      // a reason to withhold the suggestions themselves.
    }

    for (const row of rows) {
      try {
        const payload = suggestionMessage(row, { duplicate: opensAsDuplicate(row) })
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
 */
export async function repostSuggestion(
  drizzle: Drizzle,
  row: SuggestionMessageInput,
): Promise<number> {
  if (!slackBotToken()) return 0
  const copies = await listSuggestionMessages(drizzle, row.id)
  const channels = Array.from(new Set(copies.map(copy => copy.channelId)))
  if (channels.length === 0) return 0

  const payload = suggestionMessage(row, { duplicate: opensAsDuplicate(row) })
  let posted = 0
  for (const channel of channels) {
    try {
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

/** A team member's first name, which is what "Approved by Liam" wants. */
async function actorName(drizzle: Drizzle, actorId: string | null): Promise<string | null> {
  if (!actorId) return null
  try {
    const [row] = await drizzle
      .select({ name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, actorId))
      .limit(1)
    const name = row?.name?.trim()
    if (!name) return null
    return name.split(/\s+/)[0] ?? name
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
}

/**
 * The hook lib/task-suggestions.ts decideSuggestion calls after it has
 * written: every Slack copy of this row becomes one line with no buttons.
 *
 * Returns the number of copies rewritten, and NEVER throws. A decision made
 * in the dashboard is a fact about the database; whether Slack heard about it
 * is a separate and lesser question.
 */
export async function mirrorSuggestionDecision(
  drizzle: Drizzle,
  row: DecidedSuggestionRow,
): Promise<number> {
  try {
    if (!slackBotToken()) return 0
    const outcome = outcomeForStatus(row.status)
    if (!outcome) return 0
    const payload = decidedMessage({
      outcome,
      actorName: await actorName(drizzle, row.decidedById),
      at: studioClock(row.decidedAt ?? row.updatedAt ?? null),
      until: outcome === 'snoozed' ? studioWhen(row.snoozeUntil) : null,
      error: row.applyError,
    })
    return await rewriteEverywhere(drizzle, row.id, payload)
  } catch {
    return 0
  }
}
