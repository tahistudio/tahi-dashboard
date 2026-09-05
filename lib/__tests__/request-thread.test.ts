/**
 * Pure helpers behind the request thread.
 *
 * Written before lib/request-thread.ts. The three rules under test are the
 * ones the page kept getting wrong by hand:
 *  1. a request has ONE thread conversation, and which one is a deterministic
 *     choice over whatever rows already exist (duplicates were minted on every
 *     page load, because conversationId was never hydrated),
 *  2. a request_thread conversation is ALWAYS external, whatever the first
 *     message's visibility happened to be, because per-message isInternal is
 *     what hides a note from a client,
 *  3. "Seen by" reads the client's receipts only, never the studio's.
 */
import { describe, it, expect } from 'vitest'
import {
  buildRequestThreadConversationPayload,
  chunkThreadIds,
  formatClientSeenBy,
  latestClientReadAt,
  pickThreadConversationId,
  THREAD_ID_CHUNK,
  type ThreadConversationRow,
  type ThreadReadReceipt,
} from '@/lib/request-thread'

const NOW = new Date('2026-09-05T12:00:00.000Z')

function conv(over: Partial<ThreadConversationRow>): ThreadConversationRow {
  return {
    id: 'c1',
    type: 'request_thread',
    visibility: 'external',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

describe('pickThreadConversationId', () => {
  it('is null when the request has no conversation yet', () => {
    expect(pickThreadConversationId([])).toBeNull()
  })

  it('returns the only request_thread row', () => {
    expect(pickThreadConversationId([conv({ id: 'only' })])).toBe('only')
  })

  it('ignores conversations of other types attached to the same request', () => {
    const rows = [
      conv({ id: 'dm', type: 'direct' }),
      conv({ id: 'thread' }),
    ]
    expect(pickThreadConversationId(rows)).toBe('thread')
  })

  it('prefers an external row over an internal one, whatever the order', () => {
    const rows = [
      conv({ id: 'internal', visibility: 'internal', createdAt: '2026-08-01T00:00:00.000Z' }),
      conv({ id: 'external', visibility: 'external', createdAt: '2026-09-01T00:00:00.000Z' }),
    ]
    expect(pickThreadConversationId(rows)).toBe('external')
    expect(pickThreadConversationId([...rows].reverse())).toBe('external')
  })

  it('collapses duplicates onto the oldest row of the same visibility', () => {
    const rows = [
      conv({ id: 'newer', createdAt: '2026-09-03T00:00:00.000Z' }),
      conv({ id: 'oldest', createdAt: '2026-09-01T00:00:00.000Z' }),
      conv({ id: 'middle', createdAt: '2026-09-02T00:00:00.000Z' }),
    ]
    expect(pickThreadConversationId(rows)).toBe('oldest')
  })

  it('is stable when timestamps are missing or identical', () => {
    const rows = [
      conv({ id: 'b', createdAt: null }),
      conv({ id: 'a', createdAt: null }),
    ]
    expect(pickThreadConversationId(rows)).toBe('a')
    expect(pickThreadConversationId([...rows].reverse())).toBe('a')
  })

  it('drops rows with no id', () => {
    expect(pickThreadConversationId([conv({ id: '' })])).toBeNull()
  })
})

describe('buildRequestThreadConversationPayload', () => {
  it('is always external, even when the first message is an internal note', () => {
    const payload = buildRequestThreadConversationPayload({
      requestId: 'r1', orgId: 'org1', title: 'Homepage refresh',
    })
    expect(payload.visibility).toBe('external')
    expect(payload.type).toBe('request_thread')
    expect(payload.requestId).toBe('r1')
    expect(payload.orgId).toBe('org1')
    expect(payload.name).toBe('Homepage refresh')
    expect(payload.participantIds).toEqual([])
  })

  it('carries participants in the shape POST /api/admin/conversations reads', () => {
    // The route turns participantIds into conversation_participants rows from
    // { id, type }, not from bare ids, so the helper's type has to agree with
    // it or the next caller that actually seeds a thread builds the wrong body
    // and the compiler agrees with them.
    const payload = buildRequestThreadConversationPayload({ requestId: 'r1', orgId: 'o', title: 'x' })
    const seeded: typeof payload.participantIds = [{ id: 'tm1', type: 'team_member' }]
    expect(seeded[0].type).toBe('team_member')
    expect(payload.participantIds).toEqual([])
  })

  it('falls back to a generic name when the request has no usable title', () => {
    expect(buildRequestThreadConversationPayload({ requestId: 'r1', orgId: 'o', title: '   ' }).name)
      .toBe('Request thread')
    expect(buildRequestThreadConversationPayload({ requestId: 'r1', orgId: 'o', title: null }).name)
      .toBe('Request thread')
  })
})

describe('chunkThreadIds', () => {
  it('stays inside D1 bound-parameter budget', () => {
    expect(THREAD_ID_CHUNK).toBeLessThan(100)
  })

  it('is empty for no ids, so a caller can loop without a length guard', () => {
    expect(chunkThreadIds([])).toEqual([])
  })

  it('keeps a short thread in one statement', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`)
    expect(chunkThreadIds(ids)).toEqual([ids])
  })

  it('slices a long thread and loses nothing', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `m${i}`)
    const chunks = chunkThreadIds(ids)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.length <= THREAD_ID_CHUNK)).toBe(true)
    expect(chunks.flat()).toEqual(ids)
  })

  it('does not emit a trailing empty chunk on an exact multiple', () => {
    const ids = Array.from({ length: THREAD_ID_CHUNK * 2 }, (_, i) => `m${i}`)
    expect(chunkThreadIds(ids)).toHaveLength(2)
  })
})

describe('latestClientReadAt', () => {
  it('is null when only the studio has read it', () => {
    expect(latestClientReadAt([
      { userId: 'tm1', userType: 'team_member', name: 'Liam', lastReadAt: '2026-09-05T10:00:00.000Z' },
    ])).toBeNull()
  })

  it('returns the most recent contact receipt, whatever the row order', () => {
    const reads: ThreadReadReceipt[] = [
      { userId: 'u1', userType: 'contact', name: 'Sam', lastReadAt: '2026-09-04T12:00:00.000Z' },
      { userId: 'u2', userType: 'contact', name: 'Jo', lastReadAt: '2026-09-05T10:00:00.000Z' },
      { userId: 'tm1', userType: 'team_member', name: 'Liam', lastReadAt: '2026-09-05T11:00:00.000Z' },
    ]
    expect(latestClientReadAt(reads)).toBe('2026-09-05T10:00:00.000Z')
    expect(latestClientReadAt([...reads].reverse())).toBe('2026-09-05T10:00:00.000Z')
  })

  it('skips a receipt whose timestamp cannot be parsed', () => {
    expect(latestClientReadAt([
      { userId: 'u1', userType: 'contact', name: 'Sam', lastReadAt: 'not-a-date' },
    ])).toBeNull()
  })
})

describe('formatClientSeenBy', () => {
  const twoHoursAgo = '2026-09-05T10:00:00.000Z'
  const yesterday = '2026-09-04T12:00:00.000Z'

  function read(over: Partial<ThreadReadReceipt>): ThreadReadReceipt {
    return { userId: 'u1', userType: 'contact', name: 'Sam', lastReadAt: twoHoursAgo, ...over }
  }

  it('is null when nobody has read it', () => {
    expect(formatClientSeenBy([], NOW)).toBeNull()
  })

  it('ignores the studio own read receipts', () => {
    const reads = [read({ userId: 'tm1', userType: 'team_member', name: 'Liam' })]
    expect(formatClientSeenBy(reads, NOW)).toBeNull()
  })

  it('names a single client reader with how long ago', () => {
    expect(formatClientSeenBy([read({})], NOW)).toBe('Seen by Sam about 2 hours ago')
  })

  it('names two readers, most recent first', () => {
    const reads = [
      read({ userId: 'u2', name: 'Jo', lastReadAt: yesterday }),
      read({ userId: 'u1', name: 'Sam', lastReadAt: twoHoursAgo }),
    ]
    expect(formatClientSeenBy(reads, NOW)).toBe('Seen by Sam and Jo about 2 hours ago')
  })

  it('collapses three or more into a count', () => {
    const reads = [
      read({ userId: 'u1', name: 'Sam', lastReadAt: twoHoursAgo }),
      read({ userId: 'u2', name: 'Jo', lastReadAt: yesterday }),
      read({ userId: 'u3', name: 'Kim', lastReadAt: yesterday }),
      read({ userId: 'u4', name: 'Ash', lastReadAt: yesterday }),
    ]
    expect(formatClientSeenBy(reads, NOW)).toBe('Seen by Sam, Jo and 2 others about 2 hours ago')
  })

  it('keeps only the most recent receipt per person', () => {
    const reads = [
      read({ userId: 'u1', name: 'Sam', lastReadAt: yesterday }),
      read({ userId: 'u1', name: 'Sam', lastReadAt: twoHoursAgo }),
    ]
    expect(formatClientSeenBy(reads, NOW)).toBe('Seen by Sam about 2 hours ago')
  })

  it('falls back to a neutral label when the contact name is missing', () => {
    expect(formatClientSeenBy([read({ name: null })], NOW))
      .toBe('Seen by the client about 2 hours ago')
  })

  it('skips receipts whose timestamp cannot be parsed', () => {
    expect(formatClientSeenBy([read({ lastReadAt: 'not-a-date' })], NOW)).toBeNull()
  })
})
