/**
 * The sentence a screen reader hears when suggestions land.
 *
 * What matters here is that it says how many, which ones, and how to undo,
 * in a stable order, and that an empty batch says nothing at all rather than
 * announcing a change that did not happen.
 */
import { describe, it, expect } from 'vitest'
import { FIELD_LABELS, suggestionAnnouncement } from '@/lib/predict/announce'
import { PREDICTABLE_FIELDS } from '@/lib/predict/types'

describe('suggestionAnnouncement', () => {
  it('says nothing for an empty batch', () => {
    expect(suggestionAnnouncement([])).toBe('')
  })

  it('reads a single field in the singular, with the way back', () => {
    const said = suggestionAnnouncement(['dueDate'])
    expect(said).toContain('1 field')
    expect(said).toContain('due date')
    expect(said).toContain('It is marked Suggested and can be cleared.')
  })

  it('reads a batch as one sentence, not three', () => {
    const said = suggestionAnnouncement(['dueDate', 'priority', 'estimatedHours'])
    expect(said).toBe(
      "Filled 3 fields from this client's recent work: due date, priority and estimated hours. Each is marked Suggested and can be cleared.",
    )
  })

  it('names fields in the canonical order whatever order they arrived in', () => {
    const forwards = suggestionAnnouncement(['dueDate', 'priority', 'category'])
    const backwards = suggestionAnnouncement(['category', 'priority', 'dueDate'])
    expect(backwards).toBe(forwards)
  })

  it('drops a repeated field rather than saying it twice', () => {
    expect(suggestionAnnouncement(['priority', 'priority'])).toContain('1 field')
  })

  it('has a spoken label for every field that can be suggested', () => {
    for (const field of PREDICTABLE_FIELDS) {
      expect(FIELD_LABELS[field]).toBeTruthy()
    }
  })

  it('never leaks a camelCase field name into the sentence', () => {
    const said = suggestionAnnouncement([...PREDICTABLE_FIELDS])
    expect(said).not.toContain('estimatedHours')
    expect(said).not.toContain('assigneeId')
    expect(said).not.toContain('dueDate')
  })
})
