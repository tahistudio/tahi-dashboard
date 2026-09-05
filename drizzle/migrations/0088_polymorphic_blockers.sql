-- 0088: polymorphic blockers.
--
-- A blocker is now an edge between two subjects, each of which is a task or a
-- request. task_dependencies is copied in and then left alone: it is a frozen
-- snapshot for one release, not a second live table. Nothing dual-writes.
--
-- Every statement is idempotent. INSERT OR IGNORE covers both a repeated id
-- and a repeated pair, so re-running the whole file is safe.

CREATE TABLE IF NOT EXISTS work_blockers (
  id text PRIMARY KEY NOT NULL,
  blocked_type text NOT NULL,
  blocked_id text NOT NULL,
  blocker_type text NOT NULL,
  blocker_id text NOT NULL,
  created_by_id text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_blockers_blocked ON work_blockers(blocked_type, blocked_id);
CREATE INDEX IF NOT EXISTS idx_work_blockers_blocker ON work_blockers(blocker_type, blocker_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_blockers_pair
  ON work_blockers(blocked_type, blocked_id, blocker_type, blocker_id);

INSERT OR IGNORE INTO work_blockers
  (id, blocked_type, blocked_id, blocker_type, blocker_id, created_by_id, created_at)
SELECT d.id, 'task', d.task_id, 'task', d.depends_on_task_id, NULL, d.created_at
FROM task_dependencies AS d;
