import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRecordingGroupAudio, encodeRecordingPcmWav, parseRecordingGroupResult, parseRecordingPcmWav,
  MAX_RECORDING_GROUP_DURATION_MS, RECORDING_GROUP_MODEL, splitRecordingPcmWav, transcribeRecordingGroup, type RecordingGroupChunk,
} from '@/lib/recording-group-audio'

function chunk(sequence: number, startMs = sequence * 1000, samples = new Float32Array(16_000).fill(0.5)) {
  const audio = encodeRecordingPcmWav(samples)
  return { audio, metadata: { sequence, startMs, durationMs: Math.round(samples.length / 16), mimeType: 'audio/wav', size: audio.byteLength } }
}

async function readAudio(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(stream).arrayBuffer()
}

function response(words: unknown[], transcript = 'Hello there.') {
  return { results: { channels: [{ alternatives: [{ transcript, words }] }] } }
}

afterEach(() => { vi.useRealTimers() })

describe('group recording audio', () => {
  it('encodes portable mono 16 kHz PCM with clipped signed samples and a complete container', () => {
    const audio = encodeRecordingPcmWav(new Float32Array([-2, -0.5, 0, 0.5, 2]))
    const pcm = parseRecordingPcmWav(audio)
    const values = new DataView(pcm.data.buffer, pcm.data.byteOffset, pcm.data.byteLength)
    expect(pcm.sampleCount).toBe(5)
    expect(Array.from({ length: 5 }, (_, index) => values.getInt16(index * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767])
    expect(audio.byteLength).toBe(54)
  })

  it('rejects corrupt, truncated and unsupported WAV files and invalid samples', () => {
    expect(() => encodeRecordingPcmWav(new Float32Array([Number.NaN]))).toThrow('invalid sample')
    expect(() => parseRecordingPcmWav(new ArrayBuffer(4))).toThrow('incomplete WAV')
    for (const offset of [0, 20, 22, 24, 28, 32, 34, 40]) {
      const audio = chunk(0).audio
      const view = new DataView(audio)
      view.setUint8(offset, view.getUint8(offset) ^ 0xff)
      expect(() => parseRecordingPcmWav(audio)).toThrow('mono 16 kHz PCM WAV')
    }
    const truncated = chunk(0).audio.slice(0, -2)
    expect(() => parseRecordingPcmWav(truncated)).toThrow('mono 16 kHz PCM WAV')
  })

  it('streams one whole track with one header, silence for call gaps and small overlap removed', async () => {
    const first = chunk(0, 100, new Float32Array(16_000).fill(0.5))
    const second = chunk(1, 1050, new Float32Array(16_000).fill(-0.5))
    const third = chunk(2, 2200, new Float32Array(16_000).fill(0.25))
    const files = [first, second, third]
    const load = vi.fn(async (entry: RecordingGroupChunk) => files[entry.sequence].audio)
    const combined = createRecordingGroupAudio(files.map(file => file.metadata), load)
    expect(load).not.toHaveBeenCalled()
    expect(combined.durationSeconds).toBe(3.2)
    const audio = await readAudio(combined.body)
    const pcm = parseRecordingPcmWav(audio)
    const values = new DataView(pcm.data.buffer, pcm.data.byteOffset, pcm.data.byteLength)
    const at = (milliseconds: number): number => values.getInt16(milliseconds * 16 * 2, true)
    expect(at(0)).toBe(0)
    expect(at(100)).toBe(16384)
    expect(at(1099)).toBe(16384)
    expect(at(1100)).toBe(-16384)
    expect(at(2050)).toBe(0)
    expect(at(2200)).toBe(8192)
    expect(pcm.sampleCount).toBe(51_200)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('honours stream backpressure without fetching subsequent chunks early', async () => {
    const files = [chunk(0), chunk(1)]
    const load = vi.fn(async (entry: RecordingGroupChunk) => files[entry.sequence].audio)
    const { body } = createRecordingGroupAudio(files.map(file => file.metadata), load)
    const reader = body.getReader()
    await reader.read()
    expect(load).not.toHaveBeenCalled()
    await reader.read()
    expect(load).toHaveBeenCalledTimes(1)
    await reader.cancel()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('validates missing sequences, non-finite times, excessive durations, unsupported formats and overlapping clocks', () => {
    const first = chunk(0).metadata
    for (const invalid of [
      { ...first, sequence: 1 }, { ...first, startMs: Number.NaN }, { ...first, startMs: -1 },
      { ...first, durationMs: 180_001 }, { ...first, size: 45 }, { ...first, mimeType: 'audio/webm' },
      { ...first, durationMs: 500 }, { ...first, startMs: 43_200_001 },
    ]) {
      expect(() => createRecordingGroupAudio([invalid], async () => chunk(0).audio)).toThrow()
    }
    expect(() => createRecordingGroupAudio([], async () => chunk(0).audio)).toThrow('No system audio')
    expect(() => createRecordingGroupAudio([first, { ...first, sequence: 1, startMs: 500 }], async () => chunk(0).audio)).toThrow('timing')
  })

  it('refuses stored bytes that do not match reserved size or canonical header', async () => {
    const file = chunk(0)
    const missing = createRecordingGroupAudio([file.metadata], async () => file.audio.slice(0, -2))
    await expect(readAudio(missing.body)).rejects.toThrow('different size')
    new DataView(file.audio).setUint16(22, 2, true)
    const stereo = createRecordingGroupAudio([file.metadata], async () => file.audio)
    await expect(readAudio(stereo.body)).rejects.toThrow('mono 16 kHz PCM WAV')
  })
})

describe('Cloudflare group speaker results', () => {
  it('retains whole-call speaker ids and timed punctuated words, including word fallback', () => {
    const parsed = parseRecordingGroupResult(response([
      { start: 1, end: 1.5, word: 'there', punctuated_word: 'there.', speaker: 1 },
      { start: 0.1, end: 0.4, word: 'Hello', punctuated_word: '', speaker: 0 },
    ]), 2)
    expect(parsed).toEqual({ text: 'Hello there.', segments: [
      { start: 0.1, end: 0.4, text: 'Hello', speaker: 0 }, { start: 1, end: 1.5, text: 'there.', speaker: 1 },
    ] })
  })

  it('fails nonempty text without diarization labels rather than silently using Them', () => {
    expect(() => parseRecordingGroupResult(response([]), 2)).toThrow('without speaker labels')
    expect(() => parseRecordingGroupResult(response([{ start: 0, end: 1, word: 'Hello' }]), 2)).toThrow('missing speaker labels')
    expect(() => parseRecordingGroupResult({ results: { channels: [{ alternatives: [{ transcript: 'Hello' }] }] } }, 2)).toThrow('without speaker labels')
    expect(parseRecordingGroupResult(response([], ''), 2)).toEqual({ text: '', segments: [] })
  })

  it('rejects invalid speaker ids, impossible timings and malformed responses', () => {
    const word = { start: 0, end: 1, word: 'Hello', speaker: 0 }
    for (const invalid of [
      { ...word, speaker: -1 }, { ...word, speaker: 0.5 }, { ...word, start: Number.NaN },
      { ...word, start: -1 }, { ...word, end: -1 }, { ...word, end: 4 }, { ...word, word: '' },
    ]) expect(() => parseRecordingGroupResult(response([invalid]), 2)).toThrow()
    expect(() => parseRecordingGroupResult({}, 2)).toThrow('invalid transcript')
    expect(() => parseRecordingGroupResult(response([word]), Number.POSITIVE_INFINITY)).toThrow('duration')
  })

  it('runs Nova once over the complete streamed system track with no separate speaker renumbering', async () => {
    const files = [chunk(0), chunk(1)]
    const run = vi.fn(async (_model: string, input: { audio: { body: ReadableStream<Uint8Array> } }) => {
      expect(parseRecordingPcmWav(await readAudio(input.audio.body)).sampleCount).toBe(32_000)
      return response([{ start: 1.2, end: 1.5, word: 'Hello', speaker: 3 }], 'Hello')
    })
    const result = await transcribeRecordingGroup({ run }, files.map(file => file.metadata), async entry => files[entry.sequence].audio)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(RECORDING_GROUP_MODEL, expect.objectContaining({ diarize: true, language: 'en', punctuate: true, audio: expect.objectContaining({ contentType: 'audio/wav' }) }))
    expect(result.segments[0]).toEqual({ start: 1.2, end: 1.5, text: 'Hello', speaker: 3 })
  })

  it('retains a late inference before parsing and reuses it after a parse failure', async () => {
    vi.useFakeTimers()
    const file = chunk(0)
    let cached: { value: unknown } | null = null
    const raw = response([{ start: 0, end: 1, word: 'Hello' }])
    const create = vi.fn(async (value: unknown) => { cached = { value }; return value })
    const store = { read: async () => cached, create }
    const run = vi.fn(() => new Promise(resolve => { setTimeout(() => resolve(raw), 180_000) }))
    const pending = transcribeRecordingGroup({ run }, [file.metadata], async () => file.audio, store)
    const rejected = expect(pending).rejects.toThrow('missing speaker labels')
    await vi.advanceTimersByTimeAsync(180_000)
    await rejected
    expect(create).toHaveBeenCalledWith(raw)
    await expect(transcribeRecordingGroup({ run }, [file.metadata], async () => file.audio, store)).rejects.toThrow('missing speaker labels')
    expect(run).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it('limits the padded system timeline to two hours, including gaps', () => {
    const files = Array.from({ length: 40 }, (_, sequence) => ({
      sequence, startMs: sequence * 180_000, durationMs: 180_000, mimeType: 'audio/wav', size: 44 + 180 * 32_000,
    }))
    const audio = createRecordingGroupAudio(files, async () => new ArrayBuffer(0))
    expect(audio.durationSeconds).toBe(MAX_RECORDING_GROUP_DURATION_MS / 1000)
    void audio.body.cancel()
    expect(() => createRecordingGroupAudio([...files, { ...files[0], sequence: 40, startMs: MAX_RECORDING_GROUP_DURATION_MS }], async () => new ArrayBuffer(0))).toThrow('two hours')
  })

  it('splits the maximum stored PCM chunk into complete sub-1 MB WAV inputs without changing samples', () => {
    const source = encodeRecordingPcmWav(new Float32Array(180 * 16_000).fill(0.5))
    const parts = splitRecordingPcmWav(source)
    expect(parts).toHaveLength(6)
    expect(parts.map(part => part.startMs)).toEqual([0, 30_000, 60_000, 90_000, 120_000, 150_000])
    for (const part of parts) {
      expect(part.audio.byteLength).toBeLessThan(1024 * 1024)
      expect(part.durationMs).toBe(30_000)
      const pcm = parseRecordingPcmWav(part.audio)
      expect(pcm.sampleCount).toBe(30 * 16_000)
      expect(new DataView(pcm.data.buffer, pcm.data.byteOffset).getInt16(0, true)).toBe(16384)
    }
  })

  it.each([
    { seconds: 30.02, durations: [30_020] },
    { seconds: 60.01, durations: [30_000, 30_010] },
    { seconds: 31.999, durations: [31_999] },
    { seconds: 32, durations: [30_000, 2000] },
  ])('keeps a $seconds-second chunk below 1 MiB with no part shorter than two seconds', ({ seconds, durations }) => {
    const samples = new Float32Array(Math.round(seconds * 16_000)).fill(0.5)
    samples[samples.length - 1] = -0.5
    const parts = splitRecordingPcmWav(encodeRecordingPcmWav(samples))
    expect(parts.map(part => part.durationMs)).toEqual(durations)
    let sampleCount = 0
    for (const part of parts) {
      expect(part.audio.byteLength).toBeLessThan(1024 * 1024)
      expect(part.durationMs).toBeGreaterThanOrEqual(2000)
      expect(part.startMs).toBe(sampleCount / 16)
      sampleCount += parseRecordingPcmWav(part.audio).sampleCount
    }
    expect(sampleCount).toBe(samples.length)
    const last = parseRecordingPcmWav(parts[parts.length - 1].audio)
    expect(new DataView(last.data.buffer, last.data.byteOffset).getInt16(last.data.byteLength - 2, true)).toBe(-16384)
  })
})
