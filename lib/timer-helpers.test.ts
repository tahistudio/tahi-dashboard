import { describe, it, expect } from 'vitest'
import { isGeneralTimer, generalTimerNotes, GENERAL_KINDS } from './timer-helpers'
import { INTERNAL_ORG_ID } from './internal-org'

describe('generalTimerNotes', () => {
  it('labels each general kind in plain words', () => {
    expect(generalTimerNotes('request')).toBe('General requests time')
    expect(generalTimerNotes('task')).toBe('General tasks time')
    expect(generalTimerNotes('client')).toBe('General client time')
  })
  it('lists exactly the three kinds the picker offers', () => {
    expect(GENERAL_KINDS).toEqual(['request', 'task', 'client'])
  })
})

describe('isGeneralTimer', () => {
  it('is true only when the timer points at the internal org and nothing else', () => {
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: INTERNAL_ORG_ID })).toBe(true)
    expect(isGeneralTimer({ requestId: 'r1', taskId: null, orgId: INTERNAL_ORG_ID })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: 'some-client' })).toBe(false)
    expect(isGeneralTimer({ requestId: null, taskId: null, orgId: null })).toBe(false)
  })
})
