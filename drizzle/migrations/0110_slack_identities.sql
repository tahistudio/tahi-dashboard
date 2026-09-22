-- Migration 0110: the Slack app's three tables (CN.2)
--
-- slack_identities        who a Slack user is, and therefore what the bot
--                         will do for them
-- slack_events_seen       every delivery already answered, so a Slack retry
--                         does not decide the same suggestion twice
-- slack_suggestion_messages  every Slack copy of one suggestion, so a
--                         decision made anywhere rewrites all of them
--
-- See the runner entry in app/api/admin/db/migrate/route.ts for the full
-- description. Everything here is CREATE ... IF NOT EXISTS, so re-running is
-- safe.

CREATE TABLE IF NOT EXISTS slack_identities (
  id text PRIMARY KEY NOT NULL,
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  email text,
  level text NOT NULL DEFAULT 'unknown',
  team_member_id text,
  contact_id text,
  org_id text,
  dm_channel_id text,
  last_seen_at text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_identities_user ON slack_identities(slack_team_id, slack_user_id);
CREATE INDEX IF NOT EXISTS idx_slack_identities_email ON slack_identities(email);

CREATE TABLE IF NOT EXISTS slack_events_seen (
  id text PRIMARY KEY NOT NULL,
  seen_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_slack_events_seen_at ON slack_events_seen(seen_at);

CREATE TABLE IF NOT EXISTS slack_suggestion_messages (
  id text PRIMARY KEY NOT NULL,
  suggestion_id text NOT NULL,
  channel_id text NOT NULL,
  ts text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_suggestion_messages_copy ON slack_suggestion_messages(suggestion_id, channel_id, ts);
CREATE INDEX IF NOT EXISTS idx_slack_suggestion_messages_suggestion ON slack_suggestion_messages(suggestion_id);
