import { describe, expect, it } from 'vitest'
import { readRecordingOptions, writeRecordingOptions } from './recording-options'

describe('persisted recording options', () => {
  it('keeps legacy track arrays compatible and off by default', () => {
    expect(readRecordingOptions('["mic","system"]')).toEqual({ tracks: ['mic', 'system'], separateSpeakers: false })
    expect(writeRecordingOptions(['mic', 'system'], false)).toBe('["mic","system"]')
  })

  it('persists the explicit system-track opt-in across retries', () => {
    expect(readRecordingOptions(writeRecordingOptions(['mic', 'system'], true)))
      .toEqual({ tracks: ['mic', 'system'], separateSpeakers: true })
    expect(readRecordingOptions(writeRecordingOptions(['mic'], true)).separateSpeakers).toBe(false)
  })

  it('fails closed for malformed or future configuration', () => {
    expect(readRecordingOptions('bad')).toEqual({ tracks: [], separateSpeakers: false })
    expect(readRecordingOptions('{"version":2,"tracks":["mic","system"],"separateSpeakers":true}').separateSpeakers).toBe(false)
    expect(readRecordingOptions('["mic","unknown"]')).toEqual({ tracks: ['mic'], separateSpeakers: false })
  })
})
