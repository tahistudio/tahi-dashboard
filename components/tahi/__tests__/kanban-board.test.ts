import { describe, it, expect } from 'vitest'
import { subtaskRollup } from '../kanban-board'

describe('subtaskRollup', () => {
  it('is undefined when there is nothing to roll up', () => {
    expect(subtaskRollup(0, 0)).toBeUndefined()
    expect(subtaskRollup(null, null)).toBeUndefined()
    expect(subtaskRollup(undefined, 3)).toBeUndefined()
    expect(subtaskRollup(-2, 1)).toBeUndefined()
  })

  it('passes a real count straight through', () => {
    expect(subtaskRollup(4, 2)).toEqual({ done: 2, total: 4 })
  })

  it('treats a missing done count as none done', () => {
    // The list payload carried no done count before this pass, so a stale
    // client must read as "0 of N" rather than crashing the bar.
    expect(subtaskRollup(3, null)).toEqual({ done: 0, total: 3 })
    expect(subtaskRollup(3, undefined)).toEqual({ done: 0, total: 3 })
  })

  it('clamps done into the range', () => {
    expect(subtaskRollup(2, 5)).toEqual({ done: 2, total: 2 })
    expect(subtaskRollup(2, -1)).toEqual({ done: 0, total: 2 })
  })

  it('truncates fractional counts a SQL COUNT should never send', () => {
    expect(subtaskRollup(3.9, 1.7)).toEqual({ done: 1, total: 3 })
  })
})
