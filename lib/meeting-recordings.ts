import type { MeetingRecordingChunk, RecordingSegment, RecordingSpeaker, ReserveRecordingChunk } from './meeting-recordings-types'
import type { RecordingSpeakerNames, RecordingSpeakerOverrides } from './recording-speaker-names'
import { removeMicEcho } from './recording-echo'
import { splitRecordingPcmWav } from './recording-group-audio'

export const RECORDING_MODEL = '@cf/openai/whisper-large-v3-turbo' as const
export const MAX_RECORDING_CHUNK_BYTES = 6 * 1024 * 1024
export const MAX_COMPRESSED_RECORDING_CHUNK_BYTES = 2 * 1024 * 1024
// Hidden Chromium tabs can delay recorder rotation while a desktop call runs.
export const MAX_RECORDING_CHUNK_MS = 180_000
export const MAX_RECORDING_DURATION_MS = 12 * 60 * 60 * 1000
export const RECORDING_LEASE_MS = 3 * 60 * 1000

export class RecordingError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code?: string) {
    super(message)
    this.name = 'RecordingError'
  }
}

export function recordingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new RecordingError('Invalid recording or call id.')
  }
  return value
}

export function validateChunk(value: unknown): ReserveRecordingChunk {
  if (!value || typeof value !== 'object') throw new RecordingError('Chunk metadata is required.')
  const body = value as Record<string, unknown>
  const { track, sequence, startMs, durationMs, mimeType, size } = body
  if (track !== 'mic' && track !== 'system') throw new RecordingError('Track must be mic or system.')
  if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 0 || sequence > 1500) {
    throw new RecordingError('Sequence must be a non-negative integer up to 1500.')
  }
  if (typeof startMs !== 'number' || !Number.isInteger(startMs) || startMs < 0 || startMs > MAX_RECORDING_DURATION_MS) {
    throw new RecordingError('Chunk start time is invalid.')
  }
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_RECORDING_CHUNK_MS) {
    throw new RecordingError('Audio chunks must be no longer than three minutes.')
  }
  if (startMs + durationMs > MAX_RECORDING_DURATION_MS) throw new RecordingError('Recording is too long.')
  if (typeof mimeType !== 'string' || !/^audio\/(webm|ogg|wav|mp4)(;codecs=[A-Za-z0-9., -]+)?$/i.test(mimeType)) {
    throw new RecordingError('Unsupported audio chunk format.')
  }
  const sizeLimit = mimeType === 'audio/wav' ? MAX_RECORDING_CHUNK_BYTES : MAX_COMPRESSED_RECORDING_CHUNK_BYTES
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > sizeLimit) {
    throw new RecordingError(`Audio chunks must be between one byte and ${sizeLimit / 1024 / 1024} MB.`)
  }
  return { track, sequence, startMs, durationMs, mimeType, size }
}

export function parseSegments(value: unknown, durationMs: number): RecordingSegment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(segment => {
    if (!segment || typeof segment !== 'object') return []
    const row = segment as Record<string, unknown>
    if (typeof row.start !== 'number' || !Number.isFinite(row.start) || row.start < 0
      || typeof row.end !== 'number' || !Number.isFinite(row.end) || row.end < row.start
      || typeof row.text !== 'string' || !row.text.trim()) return []
    const ceiling = durationMs / 1000
    if (row.start > ceiling) return []
    const speaker = typeof row.speaker === 'number' && Number.isInteger(row.speaker) && row.speaker >= 0 ? row.speaker : undefined
    return [{ start: row.start, end: Math.min(row.end, ceiling), text: row.text.trim(), ...(speaker === undefined ? {} : { speaker }) }]
  })
}

interface TranscriptLine {
  at: number
  end: number
  track: 'mic' | 'system'
  speaker: number | undefined
  sequence: number
  index: number
  text: string
}

type MergeChunk = Pick<MeetingRecordingChunk, 'track' | 'sequence' | 'startMs' | 'durationMs' | 'state' | 'text' | 'segments'>

function transcriptLines(chunks: readonly MergeChunk[]): TranscriptLine[] {
  return chunks.filter(chunk => chunk.state === 'ready').flatMap(chunk => {
    const segments: RecordingSegment[] = chunk.segments.length ? chunk.segments : chunk.text?.trim()
      ? [{ start: 0, end: chunk.durationMs / 1000, text: chunk.text.trim() }] : []
    return segments.map((segment, index) => ({
      at: chunk.startMs + segment.start * 1000,
      end: chunk.startMs + segment.end * 1000,
      track: chunk.track,
      speaker: chunk.track === 'system' ? segment.speaker : undefined,
      sequence: chunk.sequence,
      index,
      text: segment.text.trim(),
    }))
  })
}

/** Stable rename key for a voice. */
export function speakerKey(track: 'mic' | 'system', speaker: number | undefined): string {
  return track === 'mic' ? 'mic' : speaker === undefined ? 'system' : `system:${speaker}`
}

function defaultSpeakerLabel(track: 'mic' | 'system', speaker: number | undefined, names: RecordingSpeakerNames): string {
  return track === 'system' && speaker !== undefined ? `Them ${speaker + 1}` : names[track]
}

/**
 * Voices present in the transcript, mic first. Listed before echo removal so a voice whose
 * words were all echo can still be renamed.
 */
export function recordingTranscriptSpeakers(
  chunks: readonly MergeChunk[],
  names: RecordingSpeakerNames = { mic: 'Me', system: 'Them' },
  overrides: RecordingSpeakerOverrides = {},
): RecordingSpeaker[] {
  const found = new Map<string, RecordingSpeaker>()
  for (const line of transcriptLines(chunks)) {
    if (!line.text) continue
    const key = speakerKey(line.track, line.speaker)
    if (found.has(key)) continue
    const defaultLabel = defaultSpeakerLabel(line.track, line.speaker, names)
    const label = overrides[key] || defaultLabel
    found.set(key, { key, track: line.track, defaultLabel, label, custom: label !== defaultLabel || key in overrides })
  }
  return [...found.values()].sort((a, b) => {
    if (a.track !== b.track) return a.track === 'mic' ? -1 : 1
    return a.key.localeCompare(b.key, undefined, { numeric: true })
  })
}

/**
 * Use absolute segment times; chunk sequence alone cannot order two tracks.
 * Mic words that merely repeat the system track (speaker bleed) are removed on every render.
 */
export function mergeRecordingTranscript(
  chunks: readonly MergeChunk[],
  names: RecordingSpeakerNames = { mic: 'Me', system: 'Them' },
  overrides: RecordingSpeakerOverrides = {},
): string {
  const lines = removeMicEcho(transcriptLines(chunks))
  lines.sort((a, b) => a.at - b.at || (a.track === b.track ? 0 : a.track === 'mic' ? -1 : 1)
    || a.sequence - b.sequence || a.index - b.index)
  const paragraphs: typeof lines = []
  for (const line of lines) {
    if (!line.text) continue
    const previous = paragraphs.at(-1)
    if (previous && previous.track === line.track && previous.speaker === line.speaker && line.at - previous.end <= 4000) {
      previous.text += ` ${line.text}`
      previous.end = Math.max(previous.end, line.end)
    } else paragraphs.push({ ...line })
  }
  return paragraphs.map(line => {
    const seconds = Math.floor(line.at / 1000)
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds / 60) % 60
    const stamp = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    const name = overrides[speakerKey(line.track, line.speaker)] || defaultSpeakerLabel(line.track, line.speaker, names)
    return `[${stamp}] ${name}: ${line.text}`
  }).join('\n')
}

export interface RecordingAiBinding {
  run(model: typeof RECORDING_MODEL, input: {
    audio: string
    task: 'transcribe'
    language: 'en'
    vad_filter: true
    condition_on_previous_text: false
  }): Promise<{ text?: string; segments?: unknown }>
}

export async function loadRecordingAi(): Promise<RecordingAiBinding | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const { env } = await getCloudflareContext({ async: true })
    return env?.AI && typeof env.AI.run === 'function' ? env.AI as unknown as RecordingAiBinding : null
  } catch { return null }
}

export async function transcribeRecordingAudio(audio: ArrayBuffer, durationMs: number, ai: RecordingAiBinding | null, mimeType?: string): Promise<{ text: string; segments: RecordingSegment[] }> {
  if (!ai) throw new RecordingError('Transcription is unavailable. The audio is saved; retry when Workers AI is available.', 503)
  if (!audio.byteLength || audio.byteLength > MAX_RECORDING_CHUNK_BYTES) throw new RecordingError('Audio chunk size is invalid.')
  if (mimeType === 'audio/wav') {
    const results = []
    for (const part of splitRecordingPcmWav(audio)) {
      const result = await transcribeRecordingAudio(part.audio, part.durationMs, ai)
      results.push({ text: result.text, segments: result.segments.length ? result.segments.map(segment => ({
        ...segment, start: segment.start + part.startMs / 1000, end: segment.end + part.startMs / 1000,
      })) : result.text ? [{ start: part.startMs / 1000, end: (part.startMs + part.durationMs) / 1000, text: result.text }] : [] })
    }
    return { text: results.map(result => result.text).filter(Boolean).join(' '), segments: parseSegments(results.flatMap(result => result.segments), durationMs) }
  }
  const bytes = new Uint8Array(audio)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const output = await Promise.race([
      ai.run(RECORDING_MODEL, {
        audio: btoa(binary), task: 'transcribe', language: 'en', vad_filter: true, condition_on_previous_text: false,
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new RecordingError('Transcription timed out. Retry the saved chunk.', 504)), 75_000) }),
    ])
    if (typeof output.text !== 'string') throw new RecordingError('Transcription returned no usable text. Retry the saved audio chunk.', 503)
    return { text: output.text.trim(), segments: parseSegments(output.segments, durationMs) }
  } finally { if (timeout) clearTimeout(timeout) }
}
