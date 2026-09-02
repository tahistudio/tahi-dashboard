import { describe, it, expect } from 'vitest'
import {
  toggleExpandedId,
  pruneExpandedIds,
  areAllExpanded,
  toggleExpandAll,
} from '@/components/tahi/data-table-expand'

// The repo's Vitest runs in the `node` environment and has no
// @testing-library/react, so these cover the pure expand-state rules that
// <DataTable>'s multi-expand API delegates to rather than a render pass.

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
