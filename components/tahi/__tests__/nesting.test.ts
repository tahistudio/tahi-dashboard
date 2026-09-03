import { describe, it, expect } from 'vitest'
import { dropNestedDuplicates } from '../requests/nesting'

interface Row { id: string; parentRequestId?: string | null; title?: string }

const row = (id: string, parentRequestId: string | null = null): Row => ({ id, parentRequestId })

describe('dropNestedDuplicates', () => {
  it('drops a child whose parent is in the same set', () => {
    const rows = [row('p1'), row('c1', 'p1'), row('top')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['p1', 'top'])
  })

  it('KEEPS a child whose parent was filtered out', () => {
    // The search matched the child's title but not the parent's. The child has
    // no expanded group to appear in, so its own row is the only one it gets.
    const rows = [row('c1', 'p1'), row('top')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['c1', 'top'])
  })

  it('keeps every row when nothing is nested', () => {
    const rows = [row('a'), row('b'), row('c')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps an orphan whose parent id no longer resolves', () => {
    expect(dropNestedDuplicates([row('c1', 'deleted-parent')]).map(r => r.id)).toEqual(['c1'])
  })

  it('treats an undefined parentRequestId as top level', () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b', parentRequestId: undefined }]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['a', 'b'])
  })

  it('preserves the incoming order', () => {
    const rows = [row('orphan', 'gone'), row('p1'), row('c1', 'p1'), row('top')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['orphan', 'p1', 'top'])
  })

  it('drops a child listed BEFORE its parent, not just after it', () => {
    // The sort is by due date or priority, so a child can precede its parent.
    const rows = [row('c2', 'p2'), row('p1'), row('p2')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['p1', 'p2'])
  })

  it('drops several children of one parent and leaves the rest', () => {
    const rows = [row('p1'), row('c1', 'p1'), row('c2', 'p1'), row('c3', 'p9')]
    expect(dropNestedDuplicates(rows).map(r => r.id)).toEqual(['p1', 'c3'])
  })

  it('returns an empty array unchanged', () => {
    expect(dropNestedDuplicates([])).toEqual([])
  })

  it('does not mutate the input', () => {
    const rows = [row('p1'), row('c1', 'p1')]
    const copy = [...rows]
    dropNestedDuplicates(rows)
    expect(rows).toEqual(copy)
  })
})
