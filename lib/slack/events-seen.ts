/**
 * lib/slack/events-seen.ts
 *
 * Keeping slack_events_seen small.
 *
 * Every Slack delivery the bot acts on claims its id in slack_events_seen
 * (lib/slack/dispatch.ts#rememberSlackEvent: Slack's event_id for an event,
 * trigger_id for a click or a submit). That claim is the retry guard, the
 * thing that stops a re-delivered Approve from deciding a suggestion twice.
 * Nothing ever deleted a row, so the table grew by one row per DM, button
 * press and mention, forever. This is the sweep.
 *
 * WHY SEVEN DAYS. A row only protects anything while Slack might still send
 * the same id again, and that window is minutes: Slack retries a failed event
 * three times, the last one five minutes after the first, and
 * lib/slack/verify.ts refuses any delivery signed more than five minutes ago,
 * so a captured request replayed later never reaches the dedupe at all. A
 * week is that window more than a thousand times over, which leaves no doubt
 * about clock drift between the worker and D1, and it keeps a week of
 * delivery ids to look up when somebody reports the bot answering twice.
 * Anything longer buys nothing the guard can use.
 *
 * NO NEW INDEX. Migration 0110 created idx_slack_events_seen_at on seen_at
 * alongside the table, so the delete below walks the index from the oldest
 * row up to the cutoff instead of scanning the table.
 *
 * Fired once a day as its own step of /api/admin/cron/snapshot-metrics
 * (workers/cron-trigger, 18:00 UTC), where a failure is reported on the step
 * and never fails the snapshot.
 */

import { lt } from 'drizzle-orm'
import { schema } from '@/db/d1'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How long a claimed delivery id is kept. See the header for why a week. */
export const SLACK_EVENTS_SEEN_RETENTION_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface SlackEventsSweepResult {
  /** Rows removed, as D1 reports them. */
  deleted: number
  /** Every row whose seen_at sorted before this was removed. */
  cutoff: string
}

/**
 * Delete every claimed delivery id older than the retention window.
 *
 * seen_at is an ISO string (rememberSlackEvent writes toISOString, the
 * column default writes the same shape without milliseconds), so a string
 * comparison against an ISO cutoff is a time comparison. Throws on a database
 * failure: the caller is a cron step that reports it, and a sweep that
 * swallowed "no such table" would look healthy forever.
 */
export async function sweepSlackEventsSeen(
  database: Drizzle,
  options: { now?: Date; retentionDays?: number } = {},
): Promise<SlackEventsSweepResult> {
  const now = options.now ?? new Date()
  const days = options.retentionDays ?? SLACK_EVENTS_SEEN_RETENTION_DAYS
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString()

  const result = await database
    .delete(schema.slackEventsSeen)
    .where(lt(schema.slackEventsSeen.seenAt, cutoff))

  const changes = result?.meta?.changes
  return { deleted: typeof changes === 'number' ? changes : 0, cutoff }
}
