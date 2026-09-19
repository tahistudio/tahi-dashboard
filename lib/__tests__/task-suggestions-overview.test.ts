import { describe, it, expect } from 'vitest'
import { summariseTaskSuggestionsOverview } from '../task-suggestions-overview'

describe('summariseTaskSuggestionsOverview', () => {
  it('reads a populated row', () => {
    expect(summariseTaskSuggestionsOverview({ pending: 6, calls: 2 })).toEqual({ pending: 6, calls: 2 })
  })

  it('reads D1 counts that come back as strings', () => {
    expect(summariseTaskSuggestionsOverview({ pending: '6', calls: '2' })).toEqual({ pending: 6, calls: 2 })
  })

  it('falls back to zero for an undefined row (missing table)', () => {
    expect(summariseTaskSuggestionsOverview(undefined)).toEqual({ pending: 0, calls: 0 })
  })

  it('falls back to zero for a null row', () => {
    expect(summariseTaskSuggestionsOverview(null)).toEqual({ pending: 0, calls: 0 })
  })

  it('falls back to zero for null or unreadable fields', () => {
    expect(summariseTaskSuggestionsOverview({ pending: null, calls: null })).toEqual({ pending: 0, calls: 0 })
    expect(summariseTaskSuggestionsOverview({ pending: 'not a number', calls: 3 })).toEqual({ pending: 0, calls: 3 })
  })
})
