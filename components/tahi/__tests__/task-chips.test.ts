import { describe, it, expect } from 'vitest'
import {
  checklistCountLabel,
  checklistProgressLabel,
} from '@/components/tahi/tasks/task-chips'

// The repo's Vitest runs in the `node` environment with no DOM, so this covers
// the counting vocabulary the chips and the create dialog print rather than
// the chips themselves. The studio's words are fixed: a REQUEST is client
// work, a SUB-REQUEST is a request nested under another, a TASK is the
// studio's own to-do, and the short tick-off items under either are a
// CHECKLIST. The word "subtask" survives only in the table name and the API
// path, so it must never come back out of these two functions.

describe('checklistCountLabel', () => {
  it('says checklist item, never subtask', () => {
    expect(checklistCountLabel(3)).not.toContain('subtask')
    expect(checklistCountLabel(3)).toContain('checklist item')
  })

  it('is singular at one', () => {
    expect(checklistCountLabel(1)).toBe('1 checklist item')
  })

  it('is plural at nought and above one', () => {
    expect(checklistCountLabel(0)).toBe('0 checklist items')
    expect(checklistCountLabel(2)).toBe('2 checklist items')
    expect(checklistCountLabel(12)).toBe('12 checklist items')
  })
})

describe('checklistProgressLabel', () => {
  it('reads as a sentence, with the total carrying the noun', () => {
    expect(checklistProgressLabel(2, 5)).toBe('2 of 5 checklist items done')
  })

  it('follows the total, not the done count, into the singular', () => {
    expect(checklistProgressLabel(0, 1)).toBe('0 of 1 checklist item done')
    expect(checklistProgressLabel(1, 1)).toBe('1 of 1 checklist item done')
  })

  it('never says subtask', () => {
    expect(checklistProgressLabel(1, 4)).not.toContain('subtask')
  })
})
