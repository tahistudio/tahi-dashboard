/** Browser and API contract for the manual call recorder. */
export type RecordingTrack = 'mic' | 'system'
export type RecordingState = 'recording' | 'uploading' | 'transcribing' | 'ready' | 'failed'
export type RecordingChunkState = 'reserved' | 'uploading' | 'uploaded' | 'transcribing' | 'ready' | 'failed'

export interface RecordingSegment {
  start: number
  end: number
  text: string
  speaker?: number
}

export interface MeetingRecording {
  id: string
  source?: 'browser' | 'tray'
  title: string
  orgId: string | null
  callKind: 'discovery' | 'scheduled' | null
  callId: string | null
  createdById: string
  tracks: RecordingTrack[]
  separateSpeakers?: boolean
  /** Speaker rename map keyed by mic, system or system:N. Empty when nothing was renamed. */
  speakerNames?: Record<string, string>
  state: RecordingState
  startedAt: string
  stoppedAt: string | null
  durationMs: number
  expectedChunks: { mic: number; system: number } | null
  transcriptId: string | null
  error: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MeetingRecordingChunk {
  id: string
  recordingId: string
  track: RecordingTrack
  sequence: number
  startMs: number
  durationMs: number
  mimeType: string
  size: number
  state: RecordingChunkState
  text: string | null
  segments: RecordingSegment[]
  error: string | null
  attempts: number
}

export interface RecordingTranscript {
  id: string | null
  text: string
}

export interface MeetingRecordingDetail {
  recording: MeetingRecording
  chunks: MeetingRecordingChunk[]
  transcript: RecordingTranscript
  /** Voices present in the transcript, for renaming. */
  speakers?: RecordingSpeaker[]
  pending?: boolean
}

export interface ReserveRecordingChunk {
  track: RecordingTrack
  sequence: number
  startMs: number
  durationMs: number
  mimeType: string
  size: number
}

/** One voice in the rendered transcript, with its default and current label. */
export interface RecordingSpeaker {
  /** Rename key: mic, system, or system:N for the Nth diarized voice (zero based). */
  key: string
  track: RecordingTrack
  defaultLabel: string
  label: string
  custom: boolean
}
