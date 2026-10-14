import { describe, expect, it, vi } from 'vitest'
import { mergeRecordingTranscript, parseSegments, RECORDING_MODEL, transcribeRecordingAudio, validateChunk } from './meeting-recordings'
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
    expect(text).toBe('[00:00] Me: Liam first\n[00:05] Them: Them before Liam\n[00:12] Me: Liam later\n[00:12] Them: Overlap\n[00:30] Them: Later')
  })

  it('retains hour timestamps and skips silent chunks', () => {
    expect(mergeRecordingTranscript([chunk({ startMs: 3_601_000 }), chunk({ text: '' })])).toBe('[01:00:01] Me: Hello')
  })

  it('joins the real test across chunk boundaries, keeping the first timestamp and raw chunks', () => {
    const input = [
      chunk({ track: 'system', segments: [{ start: 29, end: 30, text: 'I tried like' }] }),
      chunk({ track: 'system', startMs: 30_000, sequence: 1, text: 'Raw unchanged', segments: [
        { start: 0, end: 6, text: 'Like Shopify, Squarespace, Wix, I tried WordPress, and then only when I found Webflow, I kind' },
        { start: 6, end: 10, text: "of found my zest that I can go in a platform and I don't know something, but I'm learning" },
        { start: 10, end: 11, text: "as I'm building." },
      ] }),
    ]
    const raw = structuredClone(input)
    const expected = "[00:29] Them: I tried like Like Shopify, Squarespace, Wix, I tried WordPress, and then only when I found Webflow, I kind of found my zest that I can go in a platform and I don't know something, but I'm learning as I'm building."
    expect(mergeRecordingTranscript(input)).toBe(expected)
    expect(mergeRecordingTranscript([...input].reverse())).toBe(expected)
    expect(mergeRecordingTranscript(input)).toBe(expected)
    expect(input).toEqual(raw)
  })

  it('uses end-time silence for the four-second threshold and breaks on speaker changes', () => {
    expect(mergeRecordingTranscript([
      chunk({ segments: [
        { start: 0, end: 15, text: 'Long sentence.' },
        { start: 19, end: 20, text: 'Exactly four seconds.' },
        { start: 24.001, end: 25, text: 'Longer pause.' },
      ] }),
      chunk({ track: 'system', segments: [{ start: 25, end: 26, text: 'Reply.' }] }),
      chunk({ sequence: 1, startMs: 26_000, segments: [{ start: 0, end: 1, text: 'New paragraph.' }] }),
    ], { mic: 'Staci Miller', system: 'Michael Day' })).toBe(
      '[00:00] Staci Miller: Long sentence. Exactly four seconds.\n[00:24] Staci Miller: Longer pause.\n[00:25] Michael Day: Reply.\n[00:26] Staci Miller: New paragraph.',
    )
  })

  it('keeps diarised remote speakers separate and uses the microphone name', () => {
    expect(mergeRecordingTranscript([
      chunk({ track: 'system', segments: [
        { start: 0, end: 1, text: 'One.', speaker: 0 },
        { start: 1, end: 2, text: 'Two.', speaker: 1 },
        { start: 2, end: 3, text: 'More.', speaker: 1 },
      ] }),
      chunk({ segments: [{ start: 4, end: 5, text: 'Mic.', speaker: 0 }] }),
    ], { mic: 'Staci', system: 'Them (Acme)' })).toBe('[00:00] Them 1: One.\n[00:01] Them 2: Two. More.\n[00:04] Staci: Mic.')
  })
})

describe('recording transcription input', () => {
  it('retains only valid numeric diarisation identities in saved segments', () => {
    expect(parseSegments([
      { start: 0, end: 1, text: 'Speaker', speaker: 1 },
      { start: 1, end: 2, text: 'Unknown', speaker: -1 },
      { start: 2, end: 3, text: 'Untyped', speaker: '2' },
    ], 30_000)).toEqual([
      { start: 0, end: 1, text: 'Speaker', speaker: 1 },
      { start: 1, end: 2, text: 'Unknown' },
      { start: 2, end: 3, text: 'Untyped' },
    ])
  })

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
