import type { MeetingRecordingDetail, RecordingSpeaker } from '@/lib/meeting-recordings-types'

/** Drafts belong to one recording AND its saved labels; a different recording must never reuse them. */
export function speakerDraftKey(recordingId: string, speakers: readonly RecordingSpeaker[]): string {
  return `${recordingId}|${speakers.map(speaker => `${speaker.key}=${speaker.label}`).join('|')}`
}

/** A save that finishes after the person opened another recording must not overwrite that view. */
export function applySavedDetail(current: MeetingRecordingDetail | null, saved: MeetingRecordingDetail): MeetingRecordingDetail | null {
  return current && current.recording.id === saved.recording.id ? saved : current
}

/** Speaker names are written into "[mm:ss] Name: text" lines, so a colon is refused. */
export function speakerDraftProblem(draft: string): string | null {
  return draft.includes(':') ? 'Speaker names cannot contain a colon.' : null
}
