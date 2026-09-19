/**
 * lib/calls.ts: MEETING_TYPES / MEETING_TYPE_META / isMeetingType.
 *
 * MEETING_TYPE_META is the single source of truth for the label + Badge
 * tone shown on both /calls (calls-content.tsx) and every
 * <DiscoveryCallsCard> (discovery-calls.tsx), and the vocabulary
 * MEETING_TYPES drives the PATCH /api/admin/discovery-calls/[id]
 * validation message. A meta entry missing for any vocabulary value would
 * mean one of those UIs renders 'undefined' instead of a label.
 */
import { describe, expect, it } from 'vitest'
import { isMeetingType, MEETING_TYPE_META, MEETING_TYPES } from '@/lib/calls'

describe('MEETING_TYPES', () => {
  it('carries all six current values in the documented order', () => {
    expect(MEETING_TYPES).toEqual([
      'discovery', 'client', 'partnership', 'mentoring', 'other', 'unclassified',
    ])
  })

  it('accepts every vocabulary value and rejects anything else', () => {
    for (const value of MEETING_TYPES) {
      expect(isMeetingType(value)).toBe(true)
    }
    expect(isMeetingType('coffee')).toBe(false)
    expect(isMeetingType(null)).toBe(false)
    expect(isMeetingType(undefined)).toBe(false)
  })
})

describe('MEETING_TYPE_META', () => {
  it('has a label + tone entry for every MEETING_TYPES value, with no extras', () => {
    expect(Object.keys(MEETING_TYPE_META).sort()).toEqual([...MEETING_TYPES].sort())
  })

  it('gives mentoring and other a distinct, non-empty label and tone', () => {
    expect(MEETING_TYPE_META.mentoring.label).toBe('Mentoring')
    expect(MEETING_TYPE_META.mentoring.tone).toBeTruthy()
    expect(MEETING_TYPE_META.other.label).toBe('Other')
    expect(MEETING_TYPE_META.other.tone).toBeTruthy()
    expect(MEETING_TYPE_META.mentoring.tone).not.toBe(MEETING_TYPE_META.other.tone)
  })
})
