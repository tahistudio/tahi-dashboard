-- Apply BEFORE deploying the tray recorder server code.
CREATE TABLE IF NOT EXISTS recorder_devices (
  id text PRIMARY KEY NOT NULL, team_member_id text NOT NULL, name text NOT NULL,
  token_hash text NOT NULL UNIQUE, created_at text NOT NULL, last_seen_at text NOT NULL,
  membership_checked_at text, revoked_at text, revoked_reason text
);
CREATE INDEX IF NOT EXISTS idx_recorder_devices_member ON recorder_devices(team_member_id);
CREATE TABLE IF NOT EXISTS recorder_pairing_codes (
  code_hash text PRIMARY KEY NOT NULL, team_member_id text NOT NULL,
  created_by_user_id text NOT NULL, expires_at text NOT NULL, used_at text, used_by_device_id text
);
CREATE INDEX IF NOT EXISTS idx_recorder_pairing_codes_member ON recorder_pairing_codes(team_member_id);
CREATE TABLE IF NOT EXISTS recorder_pairing_attempts (
  id text PRIMARY KEY NOT NULL, ip_hash text NOT NULL, attempted_at text NOT NULL,
  succeeded integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recorder_pairing_attempts_ip_time ON recorder_pairing_attempts(ip_hash, attempted_at);
CREATE TABLE IF NOT EXISTS recorder_recordings (
  recording_id text PRIMARY KEY NOT NULL REFERENCES meeting_recordings(id),
  device_id text NOT NULL, team_member_id text NOT NULL, client_ref text NOT NULL,
  call_id text, created_at text NOT NULL, UNIQUE(device_id, client_ref)
);
CREATE INDEX IF NOT EXISTS idx_recorder_recordings_member ON recorder_recordings(team_member_id);
CREATE INDEX IF NOT EXISTS idx_recorder_recordings_device ON recorder_recordings(device_id);
