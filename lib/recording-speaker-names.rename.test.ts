import { describe, expect, it } from 'vitest'
import {
  applySpeakerRenames, cleanSpeakerName, MAX_SPEAKER_NAME_LENGTH, MAX_SPEAKER_OVERRIDES, parseSpeakerRenames, readSpeakerOverrides,
} from './recording-speaker-names'
import { readRecordingOptions, writeRecordingOptions } from './recording-options'
import { removeMicEcho, type EchoLine } from './recording-echo'

describe('speaker name cleaning', () => {
  it('collapses whitespace, strips control characters and bounds the length', () => {
    expect(cleanSpeakerName('  Michael \n\t Day  ')).toBe('Michael Day')
    expect(cleanSpeakerName(`A${String.fromCharCode(0)}B${String.fromCharCode(0x2028)}C`)).toBe('A B C')
    expect(cleanSpeakerName('x'.repeat(200))).toHaveLength(MAX_SPEAKER_NAME_LENGTH)
    expect(cleanSpeakerName(42)).toBe('')
  })
})

describe('speaker rename parsing', () => {
  it('accepts mic, system and indexed system keys and treats empty or null as a reset', () => {
    expect(parseSpeakerRenames({ mic: ' Liam ', system: null, 'system:0': '', 'system:12': 'Priya' })).toEqual({
      ok: true, value: { mic: 'Liam', system: null, 'system:0': null, 'system:12': 'Priya' },
    })
  })

  it.each([null, undefined, 'mic', [], {}, { mic: 'a: b' }, { me: 'x' }, { 'system:': 'x' }, { 'system:1000': 'x' }, { mic: 5 }, { mic: {} }])('rejects %j', value => {
    expect(parseSpeakerRenames(value).ok).toBe(false)
  })

  it('refuses to create more overrides than the limit', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_SPEAKER_OVERRIDES + 1 }, (_, index) => [`system:${index}`, 'x']))
    expect(parseSpeakerRenames(many).ok).toBe(false)
    const current = Object.fromEntries(Array.from({ length: MAX_SPEAKER_OVERRIDES }, (_, index) => [`system:${index}`, 'x']))
    expect(applySpeakerRenames(current, { mic: 'y' }).ok).toBe(false)
    expect(applySpeakerRenames(current, { 'system:0': null, mic: 'y' }).ok).toBe(true)
  })

  it('merges, overwrites and removes without mutating the stored map', () => {
    const current = { mic: 'Liam', 'system:0': 'Michael' }
    const result = applySpeakerRenames(current, { 'system:0': null, 'system:1': 'Priya' })
    expect(result).toEqual({ ok: true, value: { mic: 'Liam', 'system:1': 'Priya' } })
    expect(current).toEqual({ mic: 'Liam', 'system:0': 'Michael' })
  })

  it('reads a stored map leniently', () => {
    expect(readSpeakerOverrides({ mic: ' Liam ', bad: 'x', 'system:0': '', 'system:1': 7 })).toEqual({ mic: 'Liam' })
    expect(readSpeakerOverrides('nope')).toEqual({})
  })
})

describe('recording options with speaker names', () => {
  it('keeps the legacy array when nothing is renamed', () => {
    expect(writeRecordingOptions(['mic', 'system'], false, {})).toBe('["mic","system"]')
    expect(readRecordingOptions('["mic","system"]')).toEqual({ tracks: ['mic', 'system'], separateSpeakers: false })
  })

  it('stores names with and without speaker separation and round-trips them', () => {
    for (const separate of [false, true]) {
      const stored = writeRecordingOptions(['mic', 'system'], separate, { mic: 'Liam', 'system:0': 'Michael Day' })
      expect(readRecordingOptions(stored)).toEqual({ tracks: ['mic', 'system'], separateSpeakers: separate, speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' } })
    }
  })

  it('ignores names inside an unknown future configuration and drops malformed entries', () => {
    expect(readRecordingOptions('{"version":2,"tracks":["mic"],"speakerNames":{"mic":"x"}}').speakerNames).toBeUndefined()
    expect(readRecordingOptions('{"version":1,"tracks":["mic"],"separateSpeakers":false,"speakerNames":{"mic":"Liam","evil":"x"}}').speakerNames).toEqual({ mic: 'Liam' })
  })
})

describe('echo removal at scale', () => {
  it('handles a two hour call quickly', () => {
    const lines: EchoLine[] = []
    for (let second = 0; second < 7200; second += 4) {
      lines.push({ at: second * 1000, end: second * 1000 + 3500, track: 'system', index: second, text: `remote point number ${second} about the launch plan and budget` })
      if (second % 8 === 0) lines.push({ at: second * 1000 + 600, end: second * 1000 + 3900, track: 'mic', index: second, text: `remote point number ${second} about the launch plan and budget` })
      else lines.push({ at: second * 1000 + 100, end: second * 1000 + 2500, track: 'mic', index: second, text: `my own different remark ${second} entirely` })
    }
    const started = performance.now()
    const kept = removeMicEcho(lines)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(kept.filter(line => line.track === 'mic').every(line => line.text.startsWith('my own'))).toBe(true)
    expect(kept.filter(line => line.track === 'system')).toHaveLength(1800)
  })
})
