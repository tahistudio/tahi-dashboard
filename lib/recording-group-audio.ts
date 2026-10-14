import type { RecordingSegment } from '@/lib/meeting-recordings-types'

export const RECORDING_GROUP_MODEL = '@cf/deepgram/nova-3'
export const RECORDING_PCM_SAMPLE_RATE = 16_000
export const RECORDING_PCM_HEADER_BYTES = 44
export const MAX_RECORDING_GROUP_DURATION_MS = 2 * 60 * 60 * 1000
export const RECORDING_GROUP_LEASE_MS = 15 * 60 * 1000
const PCM_BYTES_PER_SAMPLE = 2
const MAX_CHUNK_DURATION_MS = 180_000
const MAX_RECORDING_DURATION_MS = 12 * 60 * 60 * 1000
const MAX_TIMING_DRIFT_MS = 250
const STREAM_BLOCK_BYTES = 64 * 1024

export interface RecordingGroupChunk {
  sequence: number
  startMs: number
  durationMs: number
  mimeType: string
  size: number
}

export interface RecordingDiarizedSegment extends RecordingSegment {
  speaker: number
}

export interface RecordingGroupAiBinding {
  run(model: string, input: {
    audio: { body: ReadableStream<Uint8Array>; contentType: 'audio/wav' }
    diarize: true
    language: 'en'
    punctuate: true
  }): Promise<unknown>
}

export interface RecordingGroupResultStore {
  read(): Promise<{ value: unknown } | null>
  create(value: unknown): Promise<unknown>
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}

function wavHeader(sampleCount: number): Uint8Array {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0 || sampleCount > (0xffffffff - 36) / PCM_BYTES_PER_SAMPLE) {
    throw new Error('Recording audio is too large for a WAV file.')
  }
  const bytes = new Uint8Array(RECORDING_PCM_HEADER_BYTES)
  const view = new DataView(bytes.buffer)
  const dataSize = sampleCount * PCM_BYTES_PER_SAMPLE
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RECORDING_PCM_SAMPLE_RATE, true)
  view.setUint32(28, RECORDING_PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE, true)
  view.setUint16(32, PCM_BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  return bytes
}

/** Group capture uses a canonical mono 16 kHz, signed 16-bit PCM WAV. */
export function encodeRecordingPcmWav(samples: Float32Array): ArrayBuffer {
  const bytes = new Uint8Array(RECORDING_PCM_HEADER_BYTES + samples.length * PCM_BYTES_PER_SAMPLE)
  bytes.set(wavHeader(samples.length))
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) throw new Error('Recording audio contains an invalid sample.')
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(RECORDING_PCM_HEADER_BYTES + index * PCM_BYTES_PER_SAMPLE, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }
  return bytes.buffer
}

/** Refuse other encodings rather than sending a corrupted combined track. */
export function parseRecordingPcmWav(audio: ArrayBuffer): { data: Uint8Array; sampleCount: number } {
  if (audio.byteLength < RECORDING_PCM_HEADER_BYTES) throw new Error('Group recording audio has an incomplete WAV header.')
  const view = new DataView(audio)
  const ascii = (offset: number, length: number): string => String.fromCharCode(...new Uint8Array(audio, offset, length))
  const dataSize = view.getUint32(40, true)
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE' || ascii(12, 4) !== 'fmt ' || ascii(36, 4) !== 'data'
    || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== RECORDING_PCM_SAMPLE_RATE || view.getUint32(28, true) !== RECORDING_PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE
    || view.getUint16(32, true) !== PCM_BYTES_PER_SAMPLE || view.getUint16(34, true) !== 16
    || dataSize % PCM_BYTES_PER_SAMPLE !== 0 || dataSize !== audio.byteLength - RECORDING_PCM_HEADER_BYTES
    || view.getUint32(4, true) !== audio.byteLength - 8) {
    throw new Error('Group recording audio must be a complete mono 16 kHz PCM WAV file.')
  }
  return { data: new Uint8Array(audio, RECORDING_PCM_HEADER_BYTES), sampleCount: dataSize / PCM_BYTES_PER_SAMPLE }
}

/** Keep fallback inputs independently decodable and below 1 MiB without tiny trailing parts. */
export function splitRecordingPcmWav(audio: ArrayBuffer): Array<{ audio: ArrayBuffer; startMs: number; durationMs: number }> {
  const pcm = parseRecordingPcmWav(audio)
  const samplesPerPart = 30 * RECORDING_PCM_SAMPLE_RATE
  const minimumRemainderSamples = 2 * RECORDING_PCM_SAMPLE_RATE
  const parts = []
  for (let start = 0; start < pcm.sampleCount;) {
    const remaining = pcm.sampleCount - start
    const count = remaining > samplesPerPart && remaining - samplesPerPart < minimumRemainderSamples
      ? remaining : Math.min(samplesPerPart, remaining)
    const bytes = new Uint8Array(RECORDING_PCM_HEADER_BYTES + count * PCM_BYTES_PER_SAMPLE)
    bytes.set(wavHeader(count))
    bytes.set(pcm.data.subarray(start * PCM_BYTES_PER_SAMPLE, (start + count) * PCM_BYTES_PER_SAMPLE), RECORDING_PCM_HEADER_BYTES)
    parts.push({ audio: bytes.buffer, startMs: start * 1000 / RECORDING_PCM_SAMPLE_RATE, durationMs: count * 1000 / RECORDING_PCM_SAMPLE_RATE })
    start += count
  }
  return parts
}

interface TimelineChunk<T extends RecordingGroupChunk> {
  chunk: T
  startSample: number
  sampleCount: number
}

function groupTimeline<T extends RecordingGroupChunk>(chunks: readonly T[]): { chunks: TimelineChunk<T>[]; sampleCount: number } {
  if (chunks.length === 0) throw new Error('No system audio is available for speaker separation.')
  const ordered = [...chunks].sort((left, right) => left.sequence - right.sequence)
  let endSample = 0
  const timeline = ordered.map((chunk, index) => {
    if (chunk.sequence !== index || !Number.isSafeInteger(chunk.startMs) || chunk.startMs < 0
      || !Number.isSafeInteger(chunk.durationMs) || chunk.durationMs <= 0 || chunk.durationMs > MAX_CHUNK_DURATION_MS
      || !Number.isSafeInteger(chunk.size) || chunk.size <= RECORDING_PCM_HEADER_BYTES
      || (chunk.size - RECORDING_PCM_HEADER_BYTES) % PCM_BYTES_PER_SAMPLE !== 0 || chunk.mimeType !== 'audio/wav') {
      throw new Error('System audio chunks are incomplete or invalid for speaker separation.')
    }
    const startSample = Math.round(chunk.startMs * RECORDING_PCM_SAMPLE_RATE / 1000)
    const sampleCount = (chunk.size - RECORDING_PCM_HEADER_BYTES) / PCM_BYTES_PER_SAMPLE
    const actualDurationMs = sampleCount * 1000 / RECORDING_PCM_SAMPLE_RATE
    if (Math.abs(actualDurationMs - chunk.durationMs) > MAX_TIMING_DRIFT_MS
      || actualDurationMs > MAX_CHUNK_DURATION_MS + MAX_TIMING_DRIFT_MS
      || chunk.startMs + actualDurationMs > MAX_RECORDING_DURATION_MS
      || startSample < endSample - MAX_TIMING_DRIFT_MS * RECORDING_PCM_SAMPLE_RATE / 1000) {
      throw new Error('System audio timing is invalid for speaker separation.')
    }
    endSample = Math.max(endSample, startSample + sampleCount)
    if (endSample * 1000 / RECORDING_PCM_SAMPLE_RATE > MAX_RECORDING_GROUP_DURATION_MS) {
      throw new Error('Speaker separation is limited to two hours of system audio. Transcribe without speaker separation.')
    }
    return { chunk, startSample, sampleCount }
  })
  return { chunks: timeline, sampleCount: endSample }
}

/** Load one chunk at a time. Silence preserves real gaps on the call timeline. */
export function createRecordingGroupAudio<T extends RecordingGroupChunk>(
  chunks: readonly T[],
  loadAudio: (chunk: T) => Promise<ArrayBuffer>,
): { body: ReadableStream<Uint8Array>; durationSeconds: number } {
  const timeline = groupTimeline(chunks)
  async function* bytes(): AsyncGenerator<Uint8Array> {
    yield wavHeader(timeline.sampleCount)
    let position = 0
    for (const { chunk, startSample, sampleCount } of timeline.chunks) {
      const audio = await loadAudio(chunk)
      if (audio.byteLength !== chunk.size) throw new Error('Stored system audio has a different size than the saved chunk.')
      const decoded = parseRecordingPcmWav(audio)
      if (decoded.sampleCount !== sampleCount) throw new Error('Stored system audio has invalid timing.')
      let silenceBytes = Math.max(0, startSample - position) * PCM_BYTES_PER_SAMPLE
      while (silenceBytes > 0) {
        const blockSize = Math.min(silenceBytes, STREAM_BLOCK_BYTES)
        yield new Uint8Array(blockSize)
        silenceBytes -= blockSize
      }
      const skipBytes = Math.max(0, position - startSample) * PCM_BYTES_PER_SAMPLE
      for (let offset = skipBytes; offset < decoded.data.byteLength; offset += STREAM_BLOCK_BYTES) {
        yield decoded.data.subarray(offset, Math.min(offset + STREAM_BLOCK_BYTES, decoded.data.byteLength))
      }
      position = Math.max(position, startSample + sampleCount)
    }
  }
  const iterator = bytes()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) { controller.error(error) }
    },
    async cancel() { await iterator.return(undefined) },
  }, { highWaterMark: 0 })
  return { body, durationSeconds: timeline.sampleCount / RECORDING_PCM_SAMPLE_RATE }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseRecordingGroupResult(value: unknown, durationSeconds: number): { text: string; segments: RecordingDiarizedSegment[] } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_RECORDING_DURATION_MS / 1000) {
    throw new Error('Speaker separation audio duration is invalid.')
  }
  const result = record(record(value)?.results)
  const channel = Array.isArray(result?.channels) ? record(result.channels[0]) : null
  const alternative = Array.isArray(channel?.alternatives) ? record(channel.alternatives[0]) : null
  if (!alternative || typeof alternative.transcript !== 'string') throw new Error('Speaker separation returned an invalid transcript.')
  const text = alternative.transcript.trim()
  if (!Array.isArray(alternative.words)) {
    if (text) throw new Error('Speaker separation returned text without speaker labels. Retry the recording.')
    return { text, segments: [] }
  }
  const segments = alternative.words.map((value): RecordingDiarizedSegment => {
    const word = record(value)
    const token = (typeof word?.punctuated_word === 'string' ? word.punctuated_word.trim() : '')
      || (typeof word?.word === 'string' ? word.word.trim() : '')
    if (!word || !token || typeof word.start !== 'number' || !Number.isFinite(word.start) || word.start < 0
      || typeof word.end !== 'number' || !Number.isFinite(word.end) || word.end < word.start || word.end > durationSeconds + 1
      || typeof word.speaker !== 'number' || !Number.isSafeInteger(word.speaker) || word.speaker < 0 || word.speaker > 1000) {
      throw new Error('Speaker separation returned invalid timing or missing speaker labels. Retry the recording.')
    }
    return { start: word.start, end: word.end, text: token, speaker: word.speaker }
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.speaker - right.speaker)
  if (text && segments.length === 0) throw new Error('Speaker separation returned text without speaker labels. Retry the recording.')
  return { text: text || segments.map(segment => segment.text).join(' '), segments }
}

/** One inference keeps remote speaker identities stable across chunk edges. */
export async function transcribeRecordingGroup<T extends RecordingGroupChunk>(
  ai: RecordingGroupAiBinding | null,
  chunks: readonly T[],
  loadAudio: (chunk: T) => Promise<ArrayBuffer>,
  store?: RecordingGroupResultStore,
): Promise<{ text: string; segments: RecordingDiarizedSegment[] }> {
  const audio = createRecordingGroupAudio(chunks, loadAudio)
  try {
    const cached = await store?.read()
    if (cached) return parseRecordingGroupResult(cached.value, audio.durationSeconds)
    if (!ai) throw new Error('Speaker separation is unavailable. Your saved audio is retained; retry when Workers AI is available.')
    // Await the binding itself: a local timeout must not abandon a billable late result.
    const raw = await ai.run(RECORDING_GROUP_MODEL, { audio: { body: audio.body, contentType: 'audio/wav' }, diarize: true, language: 'en', punctuate: true })
    // Store before parsing or any result writes so every retry reuses this inference.
    const result = store ? await store.create(raw) : raw
    return parseRecordingGroupResult(result, audio.durationSeconds)
  } finally {
    void audio.body.cancel().catch(() => {})
  }
}
