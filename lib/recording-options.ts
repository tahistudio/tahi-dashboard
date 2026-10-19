import type { RecordingTrack } from '@/lib/meeting-recordings-types'
import { readSpeakerOverrides, type RecordingSpeakerOverrides } from '@/lib/recording-speaker-names'

export interface RecordingOptions {
  tracks: RecordingTrack[]
  separateSpeakers: boolean
  /** Per-recording speaker renames. Absent when nothing has been renamed. */
  speakerNames?: RecordingSpeakerOverrides
}

/** Older recordings store a track array; opt-in or renamed recordings use a versioned object. */
export function readRecordingOptions(value: string): RecordingOptions {
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch { parsed = null }
  const config = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null
  const rawTracks = Array.isArray(parsed) ? parsed : config?.tracks
  const tracks = Array.isArray(rawTracks)
    ? rawTracks.filter((track): track is RecordingTrack => track === 'mic' || track === 'system') : []
  const speakerNames = config?.version === 1 ? readSpeakerOverrides(config.speakerNames) : {}
  return {
    tracks,
    separateSpeakers: config?.version === 1 && config.separateSpeakers === true && tracks.includes('system'),
    ...(Object.keys(speakerNames).length ? { speakerNames } : {}),
  }
}

export function writeRecordingOptions(tracks: RecordingTrack[], separateSpeakers: boolean, speakerNames?: RecordingSpeakerOverrides): string {
  const names = readSpeakerOverrides(speakerNames)
  if (Object.keys(names).length) return JSON.stringify({ version: 1, tracks, separateSpeakers, speakerNames: names })
  return JSON.stringify(separateSpeakers ? { version: 1, tracks, separateSpeakers: true } : tracks)
}
