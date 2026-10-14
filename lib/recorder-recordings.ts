import { and, eq, sql } from 'drizzle-orm'
import { schema, type DB } from '@/db/d1'
import { RecordingError } from '@/lib/meeting-recordings'
import type { RecorderDeviceAuth } from '@/lib/recorder-device-auth'
import type { MeetingRecording, RecordingChunkState, RecordingState, RecordingTrack } from '@/lib/meeting-recordings-types'

export const RECORDER_DAILY_AUDIO_MS = 12 * 60 * 60 * 1000

export interface RecorderRecording {
  id: string
  state: RecordingState
  expectedChunks: { mic: number; system: number } | null
  error: string | null
}

export interface RecorderRecordingDetail {
  recording: RecorderRecording
  chunks: { track: RecordingTrack; sequence: number; uploaded: boolean; state: RecordingChunkState; error: string | null }[]
  pending?: boolean
}

export function recorderClientRef(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new RecordingError('A clientRef UUID is required.')
  }
  return value.toLowerCase()
}

export function recorderRecording(row: Pick<MeetingRecording, 'id' | 'state' | 'expectedChunks' | 'error'>): RecorderRecording {
  return { id: row.id, state: row.state, expectedChunks: row.expectedChunks, error: row.error }
}

/** Same member AND same device: a replacement device cannot read old transcripts or audio. */
export async function assertRecorderOwnership(database: DB, auth: RecorderDeviceAuth, recordingId: string): Promise<void> {
  const [owned] = await database.select({ id: schema.recorderRecordings.recordingId }).from(schema.recorderRecordings)
    .where(and(eq(schema.recorderRecordings.recordingId, recordingId), eq(schema.recorderRecordings.deviceId, auth.recorderDevice.id),
      eq(schema.recorderRecordings.teamMemberId, auth.recorderDevice.teamMemberId))).limit(1)
  if (!owned) throw new RecordingError('Recording not found.', 404)
}

export async function recorderRecordingDetail(database: DB, auth: RecorderDeviceAuth, recordingId: string): Promise<RecorderRecordingDetail> {
  await assertRecorderOwnership(database, auth, recordingId)
  const [row] = await database.select({
    id: schema.meetingRecordings.id, state: schema.meetingRecordings.state,
    expectedChunks: schema.meetingRecordings.expectedChunks, error: schema.meetingRecordings.error,
  }).from(schema.meetingRecordings).where(eq(schema.meetingRecordings.id, recordingId)).limit(1)
  if (!row) throw new RecordingError('Recording not found.', 404)
  const chunks = await database.select({
    track: schema.meetingRecordingChunks.track, sequence: schema.meetingRecordingChunks.sequence,
    uploadedAt: schema.meetingRecordingChunks.uploadedAt, state: schema.meetingRecordingChunks.state, error: schema.meetingRecordingChunks.error,
  }).from(schema.meetingRecordingChunks).where(eq(schema.meetingRecordingChunks.recordingId, recordingId))
  return {
    recording: { id: row.id, state: row.state, expectedChunks: row.expectedChunks ? JSON.parse(row.expectedChunks) as RecorderRecording['expectedChunks'] : null, error: row.error },
    chunks: chunks.map(({ uploadedAt, ...chunk }) => ({ ...chunk, uploaded: uploadedAt !== null })),
  }
}

export function recorderQuotaStart(now = new Date()): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
}

/** Reserved mic audio counts over a rolling 24 hours, independently of the system track. */
export function recorderAudioQuota(deviceId: string, additionalMs: number, cutoff = recorderQuotaStart()) {
  return sql`(SELECT COALESCE(SUM(c.duration_ms), 0) FROM meeting_recording_chunks c
    INNER JOIN recorder_recordings rr ON rr.recording_id = c.recording_id
    WHERE rr.device_id = ${deviceId} AND c.track = 'mic' AND c.created_at > ${cutoff}) + ${additionalMs} <= ${RECORDER_DAILY_AUDIO_MS}`
}
