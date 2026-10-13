/** Additive REC.0 migration, mirrored in drizzle/migrations/0113. */
export const MEETING_RECORDING_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS meeting_recordings (
    id text PRIMARY KEY NOT NULL, title text NOT NULL, org_id text,
    call_kind text, call_id text, created_by_id text NOT NULL,
    tracks text NOT NULL, state text NOT NULL, started_at text NOT NULL,
    stopped_at text, duration_ms integer NOT NULL DEFAULT 0, expected_chunks text,
    transcript_id text, error text, lease_token text, lease_until text,
    deleted_at text, created_at text NOT NULL, updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_recordings_transcript ON meeting_recordings(transcript_id)`,
  `CREATE INDEX IF NOT EXISTS idx_meeting_recordings_org_created ON meeting_recordings(org_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS meeting_recording_chunks (
    id text PRIMARY KEY NOT NULL, recording_id text NOT NULL REFERENCES meeting_recordings(id),
    track text NOT NULL, sequence integer NOT NULL, start_ms integer NOT NULL,
    duration_ms integer NOT NULL, mime_type text NOT NULL, size integer NOT NULL,
    storage_key text NOT NULL, upload_token text NOT NULL, state text NOT NULL,
    text text, segments text, error text, attempts integer NOT NULL DEFAULT 0,
    uploaded_at text, created_at text NOT NULL, updated_at text NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_chunks_sequence ON meeting_recording_chunks(recording_id, track, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_meeting_chunks_recording_state ON meeting_recording_chunks(recording_id, state)`,
] as const
