import { sql, type SQL } from 'drizzle-orm'

/** Only a finished recording and an explicit client choice can propose work. */
export function recordingClientOrgExpression(): SQL<string | null> {
  return sql<string | null>`(
    SELECT r.org_id FROM meeting_recordings r
    WHERE r.transcript_id = "call_transcripts"."id"
      AND "call_transcripts"."source" = 'manual'
      AND "call_transcripts"."external_id" = 'recording:' || r.id
      AND r.state = 'ready' AND r.org_id IS NOT NULL
    LIMIT 1
  )`
}

/** Recorder rows may exist before finalization commits their ready state. */
export function recordingTranscriptReadyCondition(): SQL<boolean> {
  return sql<boolean>`(
    "call_transcripts"."source" <> 'manual'
    OR "call_transcripts"."external_id" NOT LIKE 'recording:%'
    OR EXISTS (
      SELECT 1 FROM meeting_recordings r
      WHERE r.transcript_id = "call_transcripts"."id"
        AND "call_transcripts"."external_id" = 'recording:' || r.id
        AND r.state = 'ready'
    )
  )`
}
