import type { MeetingRecordingChunk, RecordingSegment, ReserveRecordingChunk } from './meeting-recordings-types'
import type { RecordingSpeakerNames } from './recording-speaker-names'

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

/** Use absolute segment times; chunk sequence alone cannot order two tracks. */
export function mergeRecordingTranscript(
  chunks: readonly Pick<MeetingRecordingChunk, 'track' | 'sequence' | 'startMs' | 'durationMs' | 'state' | 'text' | 'segments'>[],
  names: RecordingSpeakerNames = { mic: 'Me', system: 'Them' },
): string {
  const lines = chunks.filter(chunk => chunk.state === 'ready').flatMap(chunk => {
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
    const name = line.track === 'system' && line.speaker !== undefined ? `Them ${line.speaker + 1}` : names[line.track]
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

export async function transcribeRecordingAudio(audio: ArrayBuffer, durationMs: number, ai: RecordingAiBinding | null): Promise<{ text: string; segments: RecordingSegment[] }> {
  if (!ai) throw new RecordingError('Transcription is unavailable. The audio is saved; retry when Workers AI is available.', 503)
  if (!audio.byteLength || audio.byteLength > MAX_RECORDING_CHUNK_BYTES) throw new RecordingError('Audio chunk size is invalid.')
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
