-- Migration 0106: task_comments (the task thread, F2)
--
-- A task has no conversation row of its own, so this is a purpose-built
-- second thread rather than a reuse of `messages`. See the runner entry in
-- app/api/admin/db/migrate/route.ts for the description.

CREATE TABLE IF NOT EXISTS task_comments (
  id text PRIMARY KEY NOT NULL,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_type text NOT NULL,
  author_id text,
  body text NOT NULL,
  quote text,
  source_ref text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
