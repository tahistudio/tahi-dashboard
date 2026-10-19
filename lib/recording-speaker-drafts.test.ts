import { describe, expect, it } from 'vitest'
import { applySavedDetail, speakerDraftKey, speakerDraftProblem } from './recording-speaker-drafts'
import type { MeetingRecordingDetail, RecordingSpeaker } from './meeting-recordings-types'

const speakers: RecordingSpeaker[] = [
  { key: 'mic', track: 'mic', defaultLabel: 'Liam Miller', label: 'Liam Miller', custom: false },
  { key: 'system:0', track: 'system', defaultLabel: 'Them 1', label: 'Them 1', custom: false },
]

function detail(id: string, text: string): MeetingRecordingDetail {
  return { recording: { id } as MeetingRecordingDetail['recording'], chunks: [], transcript: { id, text } }
}

describe('speaker draft key', () => {
  it('differs between two recordings that share identical default labels', () => {
    expect(speakerDraftKey('rec-a', speakers)).not.toBe(speakerDraftKey('rec-b', speakers))
  })

  it('changes when a saved label changes and is stable otherwise', () => {
    expect(speakerDraftKey('rec-a', speakers)).toBe(speakerDraftKey('rec-a', speakers.map(speaker => ({ ...speaker }))))
    expect(speakerDraftKey('rec-a', speakers)).not.toBe(speakerDraftKey('rec-a', [{ ...speakers[0], label: 'Liam' }, speakers[1]]))
  })
})

describe('applying a finished save', () => {
  it('replaces the open recording when it is the one that was saved', () => {
    const saved = detail('rec-a', 'new')
    expect(applySavedDetail(detail('rec-a', 'old'), saved)).toBe(saved)
  })

  it('ignores a slow save once another recording is selected or nothing is open', () => {
    const other = detail('rec-b', 'other')
    expect(applySavedDetail(other, detail('rec-a', 'late'))).toBe(other)
    expect(applySavedDetail(null, detail('rec-a', 'late'))).toBeNull()
  })
})

describe('speaker draft validation', () => {
  it('refuses a colon and allows ordinary names', () => {
    expect(speakerDraftProblem('Michael: Day')).toMatch(/colon/)
    expect(speakerDraftProblem('Michael Day')).toBeNull()
  })
})
