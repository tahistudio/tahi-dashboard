-- 0016_requests_v3_architecture.sql
--
-- Phase 1 of the Request Detail V3 redesign. Schema-only. No UI changes
-- ride with this migration — old code keeps working because:
--   1. `assigneeId` and `type` columns remain on `requests`, new code
--      reads from `requestParticipants` and `size` in parallel.
--   2. New tables are additive.
--   3. Backfill populates `size` + `requestParticipants` so new code has
--      data the moment it ships.
--
-- IF NOT EXISTS everywhere per our D1 migration safety rule
-- (lib MEMORY.md "feedback_migration_safety").

-- ── requests : new columns ──────────────────────────────────────────────

ALTER TABLE requests ADD COLUMN size text DEFAULT 'small';
ALTER TABLE requests ADD COLUMN parent_request_id text;
ALTER TABLE requests ADD COLUMN sub_position integer;
ALTER TABLE requests ADD COLUMN scope_flag_reason text;

CREATE INDEX IF NOT EXISTS idx_requests_parent ON requests(parent_request_id);

-- Backfill `size` from the legacy `type` column. Everything that looks
-- small → 'small', everything else → 'large'.
UPDATE requests
  SET size = CASE
    WHEN type IN ('small_task', 'bug_fix', 'content_update', 'consultation') THEN 'small'
    ELSE 'large'
  END
  WHERE size IS NULL OR size = 'small';

-- ── request_participants ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS request_participants (
  id text PRIMARY KEY NOT NULL,
  request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  participant_type text NOT NULL,             -- 'team_member' | 'contact'
  role text NOT NULL,                         -- 'pm' | 'assignee' | 'follower'
  added_by_id text,
  added_by_type text,
  added_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  removed_at text
);

CREATE INDEX IF NOT EXISTS idx_req_part_request ON request_participants(request_id);
CREATE INDEX IF NOT EXISTS idx_req_part_participant ON request_participants(participant_id, participant_type);
CREATE INDEX IF NOT EXISTS idx_req_part_role ON request_participants(role);

-- Backfill : copy every existing requests.assignee_id into a participant
-- row with role='assignee'. Only rows that aren't already present.
INSERT INTO request_participants (id, request_id, participant_id, participant_type, role, added_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  r.id,
  r.assignee_id,
  'team_member',
  'assignee',
  r.created_at
FROM requests r
WHERE r.assignee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM request_participants rp
    WHERE rp.request_id = r.id
      AND rp.participant_id = r.assignee_id
      AND rp.participant_type = 'team_member'
      AND rp.role = 'assignee'
  );

-- ── request_reads ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS request_reads (
  id text PRIMARY KEY NOT NULL,
  request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  user_type text NOT NULL,                    -- 'team_member' | 'contact'
  last_read_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_req_reads_request ON request_reads(request_id);
CREATE INDEX IF NOT EXISTS idx_req_reads_user ON request_reads(user_id, user_type);

-- ── active_timers ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active_timers (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  request_id text REFERENCES requests(id) ON DELETE CASCADE,
  task_id text,
  started_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  paused_at text,
  paused_seconds integer NOT NULL DEFAULT 0,
  last_ping_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  notes text
);

-- One active timer per user, enforced at the unique-index level.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_timer_per_user ON active_timers(user_id);
CREATE INDEX IF NOT EXISTS idx_active_timers_request ON active_timers(request_id);
