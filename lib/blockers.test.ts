import { describe, it, expect } from 'vitest'
import {
  BLOCKER_SUBJECT_TYPES,
  ORPHAN_STATUS,
  blockedWarningLabel,
  isBlockerOpen,
  isBlockerSubjectType,
  isFamilyPair,
  parseSubjectKey,
  rejectObviousPair,
  requestRef,
  subjectKey,
  wouldCycle,
  type BlockerSubject,
} from './blockers'

describe('subject types', () => {
  it('has exactly task and request', () => {
    expect(BLOCKER_SUBJECT_TYPES).toEqual(['task', 'request'])
  })

  it('narrows an unknown value', () => {
    expect(isBlockerSubjectType('task')).toBe(true)
    expect(isBlockerSubjectType('checklist_item')).toBe(false)
    expect(isBlockerSubjectType(undefined)).toBe(false)
  })

  it('round-trips a composite key', () => {
    expect(subjectKey('request', 'r1')).toBe('request:r1')
    expect(parseSubjectKey('request:r1')).toEqual({ type: 'request', id: 'r1' })
    expect(parseSubjectKey('nonsense')).toBeNull()
    expect(parseSubjectKey('note:n1')).toBeNull()
  })

  it('keeps an id containing a colon intact', () => {
    expect(parseSubjectKey('task:a:b')).toEqual({ type: 'task', id: 'a:b' })
  })
})

describe('isBlockerOpen', () => {
  it('closes a task only on done', () => {
    expect(isBlockerOpen('task', 'todo')).toBe(true)
    expect(isBlockerOpen('task', 'blocked')).toBe(true)
    expect(isBlockerOpen('task', 'done')).toBe(false)
  })

  it('closes a request on delivered, cancelled and archived', () => {
    expect(isBlockerOpen('request', 'in_progress')).toBe(true)
    expect(isBlockerOpen('request', 'on_hold')).toBe(true)
    expect(isBlockerOpen('request', 'delivered')).toBe(false)
    expect(isBlockerOpen('request', 'cancelled')).toBe(false)
    expect(isBlockerOpen('request', 'archived')).toBe(false)
  })

  it('treats a missing status as closed, because an orphan blocks nothing', () => {
    expect(isBlockerOpen('task', null)).toBe(false)
    expect(isBlockerOpen('request', null)).toBe(false)
  })

  it('treats the orphan sentinel as closed too, so both readers agree', () => {
    // The server counts an orphan by looking its status up and getting null.
    // The card counts the same row by reading the sentinel hydrateSubjects
    // substitutes. Both have to answer "closed" or the header count and the
    // list glyph disagree about a row nobody can explain.
    expect(ORPHAN_STATUS).toBe('unknown')
    expect(isBlockerOpen('task', ORPHAN_STATUS)).toBe(false)
    expect(isBlockerOpen('request', ORPHAN_STATUS)).toBe(false)
  })
})

describe('requestRef', () => {
  it('pads to three digits', () => {
    expect(requestRef(42)).toBe('#042')
    expect(requestRef(7)).toBe('#007')
    expect(requestRef(1234)).toBe('#1234')
  })

  it('is null when the request has no number', () => {
    expect(requestRef(null)).toBeNull()
    expect(requestRef(undefined)).toBeNull()
  })
})

describe('blockedWarningLabel', () => {
  it('says nothing when there is nothing to say', () => {
    expect(blockedWarningLabel(0, false)).toBeUndefined()
  })

  it('counts items, not tasks, because a blocker can be a request', () => {
    expect(blockedWarningLabel(1, false)).toBe('Blocked by 1 item')
    expect(blockedWarningLabel(3, false)).toBe('Blocked by 3 items')
  })

  it('keeps the scope flag when both apply', () => {
    expect(blockedWarningLabel(0, true)).toBe('Flagged for scope creep')
    expect(blockedWarningLabel(2, true)).toBe('Blocked by 2 items, and flagged for scope creep')
  })
})

describe('rejectObviousPair', () => {
  const task: BlockerSubject = { type: 'task', id: 't1' }

  it('rejects a subject blocking itself', () => {
    expect(rejectObviousPair(task, { type: 'task', id: 't1' })).toBe('self')
  })

  it('allows the same id across two types, which are different rows', () => {
    expect(rejectObviousPair(task, { type: 'request', id: 't1' })).toBeNull()
  })

  it('allows an ordinary pair', () => {
    expect(rejectObviousPair(task, { type: 'request', id: 'r1' })).toBeNull()
  })
})

describe('isFamilyPair', () => {
  const parents = { r2: 'r1', r3: 'r1', r1: null }

  it('rejects a parent blocked by its own sub-request, either way round', () => {
    expect(isFamilyPair({ type: 'request', id: 'r1' }, { type: 'request', id: 'r2' }, parents)).toBe(true)
    expect(isFamilyPair({ type: 'request', id: 'r2' }, { type: 'request', id: 'r1' }, parents)).toBe(true)
  })

  it('allows two siblings, which are genuinely separate work', () => {
    expect(isFamilyPair({ type: 'request', id: 'r2' }, { type: 'request', id: 'r3' }, parents)).toBe(false)
  })

  it('never applies to tasks', () => {
    expect(isFamilyPair({ type: 'task', id: 'r1' }, { type: 'request', id: 'r2' }, parents)).toBe(false)
  })
})

describe('wouldCycle', () => {
  /** edges[key] = what that subject is already blocked by, matching what
   *  loadBlockers returns in lib/blockers-server.ts. The walk therefore
   *  starts at the proposed BLOCKER and looks for the subject being blocked. */
  function loaderFor(edges: Record<string, BlockerSubject[]>) {
    const calls: number[] = []
    const load = async (batch: readonly BlockerSubject[]): Promise<BlockerSubject[]> => {
      calls.push(batch.length)
      return batch.flatMap(s => edges[subjectKey(s.type, s.id)] ?? [])
    }
    return { load, calls }
  }

  it('is true when the proposed blocker already waits on the subject', async () => {
    // t2 is blocked by t1. Adding "t1 blocked by t2" closes the loop.
    const { load } = loaderFor({ 'task:t2': [{ type: 'task', id: 't1' }] })
    const cycle = await wouldCycle({ type: 'task', id: 't1' }, { type: 'task', id: 't2' }, load)
    expect(cycle).toBe(true)
  })

  it('catches a loop that crosses the two surfaces', async () => {
    // request rA is blocked by task tB, which is blocked by request rA again.
    const { load } = loaderFor({
      'task:tB': [{ type: 'request', id: 'rA' }],
    })
    const cycle = await wouldCycle({ type: 'request', id: 'rA' }, { type: 'task', id: 'tB' }, load)
    expect(cycle).toBe(true)
  })

  it('is false for an unrelated pair', async () => {
    const { load } = loaderFor({ 'task:t2': [{ type: 'task', id: 't9' }] })
    expect(await wouldCycle({ type: 'task', id: 't1' }, { type: 'task', id: 't2' }, load)).toBe(false)
  })

  it('is true when the two ends are the same subject', async () => {
    const { load } = loaderFor({})
    expect(await wouldCycle({ type: 'task', id: 't1' }, { type: 'task', id: 't1' }, load)).toBe(true)
  })

  it('loads one batch per level, not one per node', async () => {
    const { load, calls } = loaderFor({
      'task:a': [{ type: 'task', id: 'b' }, { type: 'task', id: 'c' }],
      'task:b': [{ type: 'task', id: 'd' }],
      'task:c': [{ type: 'task', id: 'e' }],
    })
    await wouldCycle({ type: 'task', id: 'zz' }, { type: 'task', id: 'a' }, load)
    // level 1: [a]; level 2: [b, c]; level 3: [d, e]; level 4: [] stops.
    expect(calls).toEqual([1, 2, 2])
  })

  it('terminates on a pre-existing loop in the data', async () => {
    const { load } = loaderFor({
      'task:a': [{ type: 'task', id: 'b' }],
      'task:b': [{ type: 'task', id: 'a' }],
    })
    expect(await wouldCycle({ type: 'task', id: 'zz' }, { type: 'task', id: 'a' }, load)).toBe(false)
  })
})
