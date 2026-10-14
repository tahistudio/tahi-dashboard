import type { RecordingTrack } from '@/lib/meeting-recordings-types'

export interface RecordingOptions {
  tracks: RecordingTrack[]
  separateSpeakers: boolean
}

/** Older recordings store a track array; opt-in recordings use a versioned object. */
export function readRecordingOptions(value: string): RecordingOptions {
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch { parsed = null }
  const config = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown> : null
  const rawTracks = Array.isArray(parsed) ? parsed : config?.tracks
  const tracks = Array.isArray(rawTracks)
    ? rawTracks.filter((track): track is RecordingTrack => track === 'mic' || track === 'system') : []
  return { tracks, separateSpeakers: config?.version === 1 && config.separateSpeakers === true && tracks.includes('system') }
}

export function writeRecordingOptions(tracks: RecordingTrack[], separateSpeakers: boolean): string {
  return JSON.stringify(separateSpeakers ? { version: 1, tracks, separateSpeakers: true } : tracks)
}
