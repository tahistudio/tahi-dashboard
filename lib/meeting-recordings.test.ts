import { describe, expect, it, vi } from 'vitest'
import { mergeRecordingTranscript, RECORDING_MODEL, transcribeRecordingAudio, validateChunk } from './meeting-recordings'
import type { MeetingRecordingChunk } from './meeting-recordings-types'

function chunk(value: Partial<MeetingRecordingChunk>): MeetingRecordingChunk {
  return { id: 'chunk', recordingId: 'rec', track: 'mic', sequence: 0, startMs: 0, durationMs: 30_000,
    mimeType: 'audio/webm', size: 4, state: 'ready', text: 'Hello', segments: [], error: null, attempts: 1, ...value }
}

describe('recording transcript merge', () => {
  it('orders offset segments across separate streams and preserves overlap labels', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', startMs: 30_000, sequence: 1, text: 'Later' }),
      chunk({ track: 'mic', segments: [{ start: 12, end: 15, text: 'Liam later' }, { start: 0, end: 2, text: 'Liam first' }] }),
      chunk({ track: 'system', segments: [{ start: 5, end: 8, text: 'Them before Liam' }, { start: 12, end: 14, text: 'Overlap' }] }),
      chunk({ state: 'failed', text: 'Never publish a failed chunk' }),
    ])
    expect(text).toBe('[00:00] Liam: Liam first\n[00:05] Them: Them before Liam\n[00:12] Liam: Liam later\n[00:12] Them: Overlap\n[00:30] Them: Later')
  })

  it('retains hour timestamps and skips silent chunks', () => {
    expect(mergeRecordingTranscript([chunk({ startMs: 3_601_000 }), chunk({ text: '' })])).toBe('[01:00:01] Liam: Hello')
  })
})

describe('recording transcription input', () => {
  it('uses turbo base64 input and retains valid timestamp segments', async () => {
    const run = vi.fn().mockResolvedValue({ text: ' Hello ', segments: [{ start: 1, end: 2, text: ' Hello ' }, { start: -2, end: 3, text: 'bad' }] })
    expect(await transcribeRecordingAudio(Uint8Array.from([1, 2, 3]).buffer, 30_000, { run })).toEqual({ text: 'Hello', segments: [{ start: 1, end: 2, text: 'Hello' }] })
    expect(run).toHaveBeenCalledWith(RECORDING_MODEL, { audio: 'AQID', task: 'transcribe', language: 'en', vad_filter: true, condition_on_previous_text: false })
  })

  it('rejects missing binding and invalid model output without losing the audio', async () => {
    await expect(transcribeRecordingAudio(new ArrayBuffer(1), 30_000, null)).rejects.toThrow('audio is saved')
    await expect(transcribeRecordingAudio(new ArrayBuffer(1), 30_000, { run: vi.fn().mockResolvedValue({}) })).rejects.toThrow('no usable text')
  })

  it('bounds bytes and tolerates delayed background tab rotation', () => {
    const input = { track: 'mic', sequence: 0, startMs: 0, durationMs: 120_000, mimeType: 'audio/webm;codecs=opus', size: 900_000 }
    expect(validateChunk(input).durationMs).toBe(120_000)
    expect(() => validateChunk({ ...input, size: 2 * 1024 * 1024 + 1 })).toThrow('2 MB')
    expect(() => validateChunk({ ...input, durationMs: 180_001 })).toThrow('three minutes')
  })
})
