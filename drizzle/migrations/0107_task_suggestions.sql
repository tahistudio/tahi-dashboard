-- Migration 0107: task_suggestions (the approval gate, call notes to tasks Phase 1)
--
-- One row per thing a call said should happen to a task, held until a founder
-- approves it. See the runner entry in app/api/admin/db/migrate/route.ts for
-- the full description.

CREATE TABLE IF NOT EXISTS task_suggestions (
  id text PRIMARY KEY NOT NULL,
  org_id text,
  source_kind text NOT NULL,
  transcript_id text,
  call_kind text,
  call_id text,
  kind text NOT NULL,
  target_task_id text,
  proposal text NOT NULL,
  quote text NOT NULL,
  rationale text,
  confidence real,
  status text NOT NULL DEFAULT 'pending',
  snooze_until text,
  approver_type text NOT NULL DEFAULT 'founders',
  approver_id text,
  decided_by_id text,
  decided_via text,
  decided_at text,
  applied_at text,
  applied_task_id text,
  apply_error text,
  dedupe_key text NOT NULL,
  slack_channel_id text,
  slack_message_ts text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_suggestions_dedupe ON task_suggestions(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_status ON task_suggestions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_transcript ON task_suggestions(transcript_id);
CREATE INDEX IF NOT EXISTS idx_task_suggestions_target ON task_suggestions(target_task_id);
