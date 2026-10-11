-- Migration 0111: keeping in sync (CN.3)
--
-- task_suggestions.reject_reason   why a person turned a suggestion down,
--                                  read back to the suggester so the next
--                                  read of that client's calls does not
--                                  propose it again
-- three task_suggestions indexes   finding an item's card threads (applied
--                                  task, applied request) and a client's
--                                  rejections (org, status, decided_at)
-- slack_work_posts                 one row per threaded reply the bot posts
--                                  under a suggestion card when the item
--                                  changes on the dashboard: claimed before
--                                  posting so a change posts once, coalesced
--                                  within ten minutes, capped per thread per
--                                  day
-- slack_digests                    one claim per NZ week per Slack user for
--                                  the Monday digest
--
-- slack_work_posts.actor_key is who made the change, the coalescing key:
-- 'tm:<teamMemberId>', 'contact:<contactId>', 'acting:<teamMemberId>:<contactId>'
-- (the studio acting as that client), 'acting:<teamMemberId>' (acting, the
-- contact not resolved), 'service' (the MCP service user), 'unknown', or
-- 'cap' (the day's last line in a thread).
--
-- See the runner entry in app/api/admin/db/migrate/route.ts for the full
-- description. Everything is additive: the tables and indexes are IF NOT
-- EXISTS, and the ALTER is re-run safe through the runner's duplicate-column
-- catch, as 0109 is. Apply BEFORE deploying: db/schema.ts names
-- reject_reason, so every full-row select of task_suggestions reads it.
-- The runner deployed before this change does not know 0111, so the way to
-- apply it first is this file:
--   npx wrangler d1 execute tahi-db --remote --file=drizzle/migrations/0111_cn3_sync.sql
-- once. A second run of this file fails on the ALTER (the column exists);
-- the runner's '0111' after the deploy is the safe re-run.

ALTER TABLE task_suggestions ADD COLUMN reject_reason text;
CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_task ON task_suggestions(applied_task_id);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_request ON task_suggestions(applied_request_id);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_org_status ON task_suggestions(org_id, status, decided_at);

CREATE TABLE IF NOT EXISTS slack_work_posts (
  id text PRIMARY KEY NOT NULL,
  dedupe_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  suggestion_id text NOT NULL,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  ts text,
  actor_key text NOT NULL,
  changes text NOT NULL,
  posted_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_work_posts_dedupe ON slack_work_posts(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_slack_work_posts_thread ON slack_work_posts(channel_id, thread_ts, posted_at);

CREATE TABLE IF NOT EXISTS slack_digests (
  id text PRIMARY KEY NOT NULL,
  week_key text NOT NULL,
  slack_user_id text NOT NULL,
  channel_id text,
  ts text,
  summary text,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_digests_week_user ON slack_digests(week_key, slack_user_id);
