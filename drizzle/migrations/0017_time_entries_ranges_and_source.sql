-- 0017_time_entries_ranges_and_source.sql
--
-- Phase 1.5 of Request V3 : extend time_entries so three logging modes
-- are supported without losing fidelity :
--   1. Scalar    : "I spent 6h on this" — only `hours` + `date` set.
--   2. Range     : "From 10:15 to 13:29" — both started_at + ended_at set,
--                  hours derived from the range.
--   3. Live-tracked : started when user clicked Track, ended when they
--                     clicked Stop + Log. source='live_timer'.
--
-- Also adds `task_id` so timers (and manual entries) can target a task.
--
-- IF NOT EXISTS-safe per D1 migration rule. Drizzle's applied-state
-- tracking handles idempotency for the ALTER TABLE statements.

ALTER TABLE time_entries ADD COLUMN task_id text;
ALTER TABLE time_entries ADD COLUMN started_at text;
ALTER TABLE time_entries ADD COLUMN ended_at text;
ALTER TABLE time_entries ADD COLUMN source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_time_request ON time_entries(request_id);
CREATE INDEX IF NOT EXISTS idx_time_task ON time_entries(task_id);
