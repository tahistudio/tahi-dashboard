import { describe, it, expect } from 'vitest'
import {
  toggleExpandedId,
  pruneExpandedIds,
  areAllExpanded,
  toggleExpandAll,
  nextSortState,
  nextInternalSortState,
  applyRangeSelection,
} from '@/components/tahi/data-table-expand'

// The repo's Vitest runs in the `node` environment and has no
// @testing-library/react, so these cover the pure state rules that
// <DataTable> delegates to (expansion, the header sort cycle, shift-click
// range selection) rather than a render pass.

describe('toggleExpandedId', () => {
  it('opens a closed row', () => {
    expect([...toggleExpandedId(new Set(), 'a')]).toEqual(['a'])
  })

  it('closes an open row', () => {
    expect([...toggleExpandedId(new Set(['a', 'b']), 'a')]).toEqual(['b'])
  })

  it('never mutates the set it was given', () => {
    const before = new Set(['a'])
    toggleExpandedId(before, 'b')
    expect([...before]).toEqual(['a'])
  })
})

describe('pruneExpandedIds', () => {
  it('drops ids that are no longer visible', () => {
    const next = pruneExpandedIds(new Set(['a', 'b', 'c']), ['a', 'c'])
    expect([...next]).toEqual(['a', 'c'])
  })

  it('returns the same instance when every id is still valid', () => {
    const before = new Set(['a', 'b'])
    expect(pruneExpandedIds(before, ['a', 'b', 'c'])).toBe(before)
  })

  it('returns the same instance when nothing is expanded', () => {
    const before = new Set<string>()
    expect(pruneExpandedIds(before, [])).toBe(before)
  })

  it('empties out when the visible set no longer overlaps', () => {
    const next = pruneExpandedIds(new Set(['a']), ['z'])
    expect(next.size).toBe(0)
  })

  it('accepts a Set as the valid-id source', () => {
    const next = pruneExpandedIds(new Set(['a', 'b']), new Set(['b']))
    expect([...next]).toEqual(['b'])
  })
})

describe('areAllExpanded', () => {
  it('is false when nothing is expandable', () => {
    expect(areAllExpanded([], new Set(['a']))).toBe(false)
  })

  it('is false when only some expandable rows are open', () => {
    expect(areAllExpanded(['a', 'b'], new Set(['a']))).toBe(false)
  })

  it('is true when every expandable row is open', () => {
    expect(areAllExpanded(['a', 'b'], new Set(['a', 'b']))).toBe(true)
  })

  it('ignores open ids that are not expandable', () => {
    expect(areAllExpanded(['a'], new Set(['a', 'stale']))).toBe(true)
  })
})

describe('toggleExpandAll', () => {
  it('opens every expandable row from empty', () => {
    expect([...toggleExpandAll(['a', 'b'], new Set())]).toEqual(['a', 'b'])
  })

  it('opens the remainder when only some are open', () => {
    expect([...toggleExpandAll(['a', 'b'], new Set(['a']))]).toEqual(['a', 'b'])
  })

  it('collapses everything when all are already open', () => {
    expect(toggleExpandAll(['a', 'b'], new Set(['a', 'b'])).size).toBe(0)
  })

  it('drops stale open ids while expanding', () => {
    expect([...toggleExpandAll(['a'], new Set(['stale']))]).toEqual(['a'])
  })
})

describe('nextSortState', () => {
  it('starts a fresh column ascending', () => {
    expect(nextSortState(null, 'title')).toEqual({ key: 'title', dir: 'asc' })
  })

  it('goes ascending to descending on the second click', () => {
    expect(nextSortState({ key: 'title', dir: 'asc' }, 'title')).toEqual({ key: 'title', dir: 'desc' })
  })

  it('clears the sort on the third click', () => {
    expect(nextSortState({ key: 'title', dir: 'desc' }, 'title')).toBeNull()
  })

  it('cycles back to ascending on the fourth', () => {
    const third = nextSortState({ key: 'title', dir: 'desc' }, 'title')
    expect(nextSortState(third, 'title')).toEqual({ key: 'title', dir: 'asc' })
  })

  it('starts a different column ascending rather than inheriting a direction', () => {
    expect(nextSortState({ key: 'title', dir: 'desc' }, 'dueDate')).toEqual({ key: 'dueDate', dir: 'asc' })
  })

  it('treats undefined the same as no sort', () => {
    expect(nextSortState(undefined, 'status')).toEqual({ key: 'status', dir: 'asc' })
  })
})

describe('nextInternalSortState', () => {
  const byName = { key: 'name', dir: 'asc' } as const

  it('clears to nothing when the table declared no default', () => {
    expect(nextInternalSortState({ key: 'title', dir: 'desc' }, 'title', null)).toBeNull()
    expect(nextInternalSortState({ key: 'title', dir: 'desc' }, 'title', undefined)).toBeNull()
  })

  it('returns to the declared default instead of the raw row order', () => {
    expect(nextInternalSortState({ key: 'title', dir: 'desc' }, 'title', byName)).toEqual(byName)
  })

  it('sends a default column back to its declared direction rather than off', () => {
    // Third click on the column the table already sorts by: it lands back on
    // ascending, so aria-sort never reads "none" for a table that has an order
    // it is contractually meant to keep.
    expect(nextInternalSortState({ key: 'name', dir: 'desc' }, 'name', byName)).toEqual(byName)
  })

  it('matches nextSortState for the first two clicks', () => {
    expect(nextInternalSortState(null, 'title', byName)).toEqual({ key: 'title', dir: 'asc' })
    expect(nextInternalSortState({ key: 'title', dir: 'asc' }, 'title', byName))
      .toEqual({ key: 'title', dir: 'desc' })
  })

  it('starts a different column ascending even with a default in play', () => {
    expect(nextInternalSortState(byName, 'dueDate', byName)).toEqual({ key: 'dueDate', dir: 'asc' })
  })
})

describe('applyRangeSelection', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('selects the inclusive span downwards', () => {
    expect([...applyRangeSelection(new Set(), ids, 1, 3, true)]).toEqual(['b', 'c', 'd'])
  })

  it('selects the inclusive span upwards', () => {
    expect([...applyRangeSelection(new Set(), ids, 3, 1, true)]).toEqual(['b', 'c', 'd'])
  })

  it('deselects the span when the clicked row was already selected', () => {
    const before = new Set(['a', 'b', 'c', 'd'])
    expect([...applyRangeSelection(before, ids, 1, 3, false)]).toEqual(['a'])
  })

  it('leaves ids outside the span alone', () => {
    const before = new Set(['a', 'e'])
    expect([...applyRangeSelection(before, ids, 1, 2, true)]).toEqual(['a', 'e', 'b', 'c'])
  })

  it('selects a single row when the anchor is the clicked row', () => {
    expect([...applyRangeSelection(new Set(), ids, 2, 2, true)]).toEqual(['c'])
  })

  it('clamps a stale anchor past the end of the list', () => {
    expect([...applyRangeSelection(new Set(), ids, 99, 3, true)]).toEqual(['d', 'e'])
  })

  it('clamps a negative anchor', () => {
    expect([...applyRangeSelection(new Set(), ids, -4, 1, true)]).toEqual(['a', 'b'])
  })

  it('never mutates the set it was given', () => {
    const before = new Set(['a'])
    applyRangeSelection(before, ids, 1, 3, true)
    expect([...before]).toEqual(['a'])
  })

  it('does nothing on an empty row set', () => {
    expect(applyRangeSelection(new Set(), [], 0, 0, true).size).toBe(0)
  })
})
