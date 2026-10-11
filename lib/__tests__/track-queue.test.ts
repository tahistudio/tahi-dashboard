import { describe, expect, it } from 'vitest'
import { moveQueueItem, nextUpIds, reorderTrackId, unifiedQueue } from '@/lib/track-queue'

const request = (id: string, queueOrder: number | null, createdAt = '2026-09-01', type = 'small_task') => ({ id, queueOrder, createdAt, type })

describe('shared track queue', () => {
  it('deduplicates same-size lane queues and orders both sizes together', () => {
    const small = [request('s2', 2), request('s1', 0)]
    const large = [request('l1', 1, '2026-09-01', 'large_task')]
    expect(unifiedQueue([
      { id: 'small-1', queue: small },
      { id: 'small-2', queue: small },
      { id: 'large-1', queue: large },
    ]).map(r => r.id)).toEqual(['s1', 'l1', 's2'])
    expect(small.map(r => r.id)).toEqual(['s2', 's1'])
  })

  it('puts null positions last, then orders ties by creation time and ID', () => {
    const rows = [request('z', null, '2026-08-01'), request('b', 0), request('a', 0), request('early', 0, '2026-08-01'), request('n', null)]
    expect(unifiedQueue([{ id: 'real', queue: rows }]).map(r => r.id)).toEqual(['early', 'a', 'b', 'z', 'n'])
  })

  it('marks the first request of each size as next up', () => {
    expect([...nextUpIds([request('s1', 0), request('s2', 1), request('l1', 2, '', 'large_task')])]).toEqual(['s1', 'l1'])
  })

  it('selects one real track and refuses synthetic-only tracks, including legacy markers', () => {
    expect(reorderTrackId([{ id: 'synthetic-small-0' }, { id: 'fake', synthetic: true }, { id: 'real' }, { id: 'other' }])).toBe('real')
    expect(reorderTrackId([{ id: 'synthetic-small-0' }, { id: 'fake', synthetic: true }])).toBeNull()
    expect(reorderTrackId([])).toBeNull()
  })

  it('swaps adjacent items without mutating the original and rejects out-of-range moves', () => {
    const queue = ['a', 'b', 'c']
    expect(moveQueueItem(queue, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveQueueItem(queue, 1, 1)).toEqual(['a', 'c', 'b'])
    expect(queue).toEqual(['a', 'b', 'c'])
    expect(moveQueueItem(queue, 0, -1)).toBeNull()
    expect(moveQueueItem(queue, 2, 1)).toBeNull()
    expect(moveQueueItem(queue, -1, 1)).toBeNull()
  })
})
