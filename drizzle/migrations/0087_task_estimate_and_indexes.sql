-- Migration 0087: task estimate, plus the indexes the default lens needs
--
-- estimated_hours is the ONLY column the Tasks port adds. Every other field
-- the prototype shows already has a home: level -> type, client -> org_id,
-- request -> request_id, subtasks -> task_subtasks, time -> time_entries,
-- blockedBy -> task_dependencies.
--
-- The two indexes are not new capability, they are the cost of the surface:
-- ?assignee=me is the default lens for every teammate and for the teammate
-- Overview home, and both the list sort and the week planner read due_date.
--
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite; the runtime
-- runner (app/api/admin/db/migrate) swallows the "duplicate column name"
-- error so re-running is safe. Index CREATEs are IF NOT EXISTS.
ALTER TABLE tasks ADD COLUMN estimated_hours real;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
