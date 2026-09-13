import { describe, it, expect } from 'vitest'
import { formatCallPrepBriefRow } from './call-brief-item'

describe('formatCallPrepBriefRow', () => {
  it('says "no prep note yet" with a "Prep note" verb when the note is empty', () => {
    const row = formatCallPrepBriefRow({ id: 'call_1', title: 'Kickoff call', prepNote: null }, '9:30 am')
    expect(row.tone).toBe('warn')
    expect(row.verb).toBe('Prep note')
    expect(row.text).toBe('Kickoff call · 9:30 am: no prep note yet')
    expect(row.to).toBe('calls?call=call_1&focus=prep')
  })

  it('treats a whitespace-only note as empty', () => {
    const row = formatCallPrepBriefRow({ id: 'call_1', title: 'Kickoff call', prepNote: '   ' }, '9:30 am')
    expect(row.verb).toBe('Prep note')
    expect(row.text).toContain('no prep note yet')
  })

  it('shows the note and an "Edit prep note" verb when present', () => {
    const row = formatCallPrepBriefRow(
      { id: 'call_2', title: 'Elevate x Tahi Studio', prepNote: 'Bring the scope doc' },
      '9:00 pm',
    )
    expect(row.verb).toBe('Edit prep note')
    expect(row.text).toBe('Elevate x Tahi Studio · 9:00 pm: Bring the scope doc')
    expect(row.to).toBe('calls?call=call_2&focus=prep')
  })

  it('shows the first 80 characters with an ellipsis when the note is longer', () => {
    const longNote = 'x'.repeat(120)
    const row = formatCallPrepBriefRow({ id: 'call_3', title: 'Call', prepNote: longNote }, '10:00 am')
    expect(row.text).toBe(`Call · 10:00 am: ${'x'.repeat(80)}...`)
  })

  it('does not add an ellipsis when the note is exactly 80 characters', () => {
    const note = 'x'.repeat(80)
    const row = formatCallPrepBriefRow({ id: 'call_4', title: 'Call', prepNote: note }, '10:00 am')
    expect(row.text).toBe(`Call · 10:00 am: ${note}`)
  })

  it('never carries an em or en dash in its copy', () => {
    // Built from code points so this file never carries one either.
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)
    const empty = formatCallPrepBriefRow({ id: 'call_5', title: 'Call', prepNote: null }, '10:00 am')
    const present = formatCallPrepBriefRow({ id: 'call_6', title: 'Call', prepNote: 'Note' }, '10:00 am')
    expect(empty.text).not.toMatch(dashes)
    expect(present.text).not.toMatch(dashes)
  })
})
