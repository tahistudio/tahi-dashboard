-- Migration 0081: Notification preferences + client-admin portal role
--
-- All statements use IF NOT EXISTS / are idempotent so this is safe to
-- re-run. The runtime runner (app/api/admin/db/migrate) also swallows
-- "duplicate column name" / "already exists" so the ALTER is re-run-safe.

-- contacts.portal_role: the client-admin authority signal. Deny-by-default
-- ('member'); 'admin' can administer the org's portal. Kept separate from
-- is_primary (email-targeting flag) and role (free-text job title).
ALTER TABLE contacts ADD COLUMN portal_role text NOT NULL DEFAULT 'member';

-- Backfill: current primary contacts keep working as client-admins.
UPDATE contacts SET portal_role = 'admin' WHERE is_primary = 1;

-- notification_preferences: per-user x per-event x per-channel toggle.
-- Resolution: exact (user_id, user_type, event_type, channel) row ->
-- the event_type = '*' default row for that user/channel -> hardcoded
-- default in code. event_type is a NotificationEventType value or '*'.
-- channel is 'in_app' | 'email' | 'slack'. user_type is
-- 'team_member' | 'contact' (mirrors the notifications table).
CREATE TABLE IF NOT EXISTS notification_preferences (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  user_type text NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notif_pref ON notification_preferences (user_id, user_type, event_type, channel);
CREATE INDEX IF NOT EXISTS idx_notif_pref_user ON notification_preferences (user_id, user_type);
