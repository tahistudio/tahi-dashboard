import { describe, it, expect } from 'vitest'
import { callPrepFocusTarget, parseCallFocusParams } from './call-deep-link'

describe('callPrepFocusTarget', () => {
  it('builds a relative calls target with the call id and focus=prep', () => {
    expect(callPrepFocusTarget('call_1')).toBe('calls?call=call_1&focus=prep')
  })

  it('encodes special characters in the call id', () => {
    expect(callPrepFocusTarget('call 1/2')).toBe('calls?call=call%201%2F2&focus=prep')
  })
})

describe('parseCallFocusParams', () => {
  it('reads a call id and focus=prep', () => {
    const params = new URLSearchParams('call=call_1&focus=prep')
    expect(parseCallFocusParams(params)).toEqual({ callId: 'call_1', focusPrep: true })
  })

  it('reads a call id with no focus param', () => {
    const params = new URLSearchParams('call=call_1')
    expect(parseCallFocusParams(params)).toEqual({ callId: 'call_1', focusPrep: false })
  })

  it('treats a blank call param as absent', () => {
    const params = new URLSearchParams('call=&focus=prep')
    expect(parseCallFocusParams(params)).toEqual({ callId: null, focusPrep: true })
  })

  it('returns null/false when neither param is present', () => {
    const params = new URLSearchParams('')
    expect(parseCallFocusParams(params)).toEqual({ callId: null, focusPrep: false })
  })

  it('only treats focus=prep as a focus request, never another value', () => {
    const params = new URLSearchParams('call=call_1&focus=something-else')
    expect(parseCallFocusParams(params)).toEqual({ callId: 'call_1', focusPrep: false })
  })
})
