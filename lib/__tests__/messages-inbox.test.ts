/**
 * lib/messages-inbox.ts: the rules the Messages inbox is made of.
 *
 * Pure over their arguments, so these run with no database and no mocks. The
 * things asserted here are the ones that were WRONG in the code this replaces:
 *
 *   - a never-opened room counted the reader's OWN messages as unread
 *     (app/api/admin/conversations/route.ts), so every room a two-person studio
 *     had ever posted in showed a badge nobody could clear;
 *   - a client could be shown an internal note's existence through a count;
 *   - a deleted message kept driving a badge that nothing could clear.
 */
import { describe, it, expect } from 'vitest'
import {
  countUnread,
  filterInboxThreads,
  inboxRowTitle,
  inboxSnippet,
  inboxThreadHref,
  isInboxSource,
  parseThreadKey,
  sortInboxThreads,
  threadKey,
  totalUnread,
  type InboxThread,
} from '@/lib/messages-inbox'

function thread(over: Partial<InboxThread> = {}): InboxThread {
  return {
    key: threadKey('request', 'r1'),
    source: 'request',
    id: 'r1',
    title: 'Brand palette extension',
    requestNumber: 1049,
    status: 'client_review',
    orgId: 'org_1',
    orgName: null,
    lastMessage: null,
    unreadCount: 0,
    href: '/requests/r1',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

describe('thread identity', () => {
  it('round-trips a key through both stores', () => {
    expect(parseThreadKey(threadKey('channel', 'conv_1'))).toEqual({ source: 'channel', id: 'conv_1' })
    expect(parseThreadKey(threadKey('request', 'req_1'))).toEqual({ source: 'request', id: 'req_1' })
  })

  it('refuses a key it did not mint, rather than guessing a store', () => {
    expect(parseThreadKey('conv_1')).toBeNull()
    expect(parseThreadKey('org:org_1')).toBeNull()
    expect(parseThreadKey('channel:')).toBeNull()
    expect(parseThreadKey(':req_1')).toBeNull()
  })

  it('accepts exactly the two sources a route segment may carry', () => {
    expect(isInboxSource('channel')).toBe(true)
    expect(isInboxSource('request')).toBe(true)
    expect(isInboxSource('org')).toBe(false)
    expect(isInboxSource('direct')).toBe(false)
    expect(isInboxSource(undefined)).toBe(false)
  })

  it('gives a channel no request to open, so no caller can invent one', () => {
    expect(inboxThreadHref('request', 'r1')).toBe('/requests/r1')
    expect(inboxThreadHref('channel', 'conv_1')).toBeNull()
  })

  it('titles a request row with the number the client has been shown', () => {
    expect(inboxRowTitle(thread())).toBe('TR-1049 Brand palette extension')
    expect(inboxRowTitle(thread({ requestNumber: null }))).toBe('Brand palette extension')
    expect(inboxRowTitle(thread({ source: 'channel', title: 'Tahi Studio' }))).toBe('Tahi Studio')
  })
})

describe('countUnread', () => {
  const rows = [
    { authorId: 'them', createdAt: '2026-09-01T10:00:00.000Z' },
    { authorId: 'me', createdAt: '2026-09-01T11:00:00.000Z' },
    { authorId: 'them', createdAt: '2026-09-01T12:00:00.000Z' },
  ]

  it('counts only what arrived after the cursor', () => {
    expect(countUnread(rows, {
      lastReadAt: '2026-09-01T10:30:00.000Z',
      selfIds: ['me'],
      excludeInternal: true,
    })).toBe(1)
  })

  it('treats a null cursor as "everything visible except my own", not everything', () => {
    // The bug this replaces: the admin conversations route counted every
    // message in a never-opened room, the caller's own included, so a room the
    // studio had posted in and nobody had opened showed a badge for its own
    // messages.
    expect(countUnread(rows, { lastReadAt: null, selfIds: ['me'], excludeInternal: true })).toBe(2)
  })

  it('recognises my own message under either of my two ids', () => {
    // A request thread stamps contacts.id / teamMembers.id; a row written
    // before the person had a domain row carries their Clerk id.
    const mixed = [
      { authorId: 'user_me', createdAt: '2026-09-01T10:00:00.000Z' },
      { authorId: 'tm_me', createdAt: '2026-09-01T11:00:00.000Z' },
      { authorId: 'them', createdAt: '2026-09-01T12:00:00.000Z' },
    ]
    expect(countUnread(mixed, {
      lastReadAt: null,
      selfIds: ['user_me', 'tm_me'],
      excludeInternal: true,
    })).toBe(1)
  })

  it('never counts an internal note for a client', () => {
    const withNote = [
      { authorId: 'them', createdAt: '2026-09-01T10:00:00.000Z', isInternal: true },
      { authorId: 'them', createdAt: '2026-09-01T11:00:00.000Z', isInternal: false },
    ]
    expect(countUnread(withNote, { lastReadAt: null, selfIds: ['me'], excludeInternal: true })).toBe(1)
    // The studio sees the whole room, so the same rows count differently.
    expect(countUnread(withNote, { lastReadAt: null, selfIds: ['me'], excludeInternal: false })).toBe(2)
  })

  it('never counts a message the studio retracted, for either audience', () => {
    const withDeleted = [
      { authorId: 'them', createdAt: '2026-09-01T10:00:00.000Z', deletedAt: '2026-09-02T00:00:00.000Z' },
      { authorId: 'them', createdAt: '2026-09-01T11:00:00.000Z', deletedAt: null },
    ]
    expect(countUnread(withDeleted, { lastReadAt: null, selfIds: ['me'], excludeInternal: true })).toBe(1)
    expect(countUnread(withDeleted, { lastReadAt: null, selfIds: ['me'], excludeInternal: false })).toBe(1)
  })

  it('ignores a row with no timestamp instead of counting it forever', () => {
    expect(countUnread(
      [{ authorId: 'them', createdAt: null }],
      { lastReadAt: '2026-09-01T00:00:00.000Z', selfIds: [], excludeInternal: true },
    )).toBe(0)
  })

  it('excludes a message posted exactly on the cursor', () => {
    expect(countUnread(
      [{ authorId: 'them', createdAt: '2026-09-01T10:00:00.000Z' }],
      { lastReadAt: '2026-09-01T10:00:00.000Z', selfIds: [], excludeInternal: true },
    )).toBe(0)
  })
})

describe('sortInboxThreads', () => {
  const preview = (at: string) => ({
    snippet: 'hi', at, authorName: 'Liam', authorType: 'team_member',
    isVoice: false, isInternal: false,
  })

  it('pins the standing studio line above every request thread', () => {
    const sorted = sortInboxThreads([
      thread({ key: 'request:r1', id: 'r1', lastMessage: preview('2026-09-06T09:00:00.000Z') }),
      thread({ key: 'channel:c1', source: 'channel', id: 'c1', lastMessage: preview('2026-08-01T09:00:00.000Z') }),
    ])
    expect(sorted.map(t => t.key)).toEqual(['channel:c1', 'request:r1'])
  })

  it('orders request threads by their last message, newest first', () => {
    const sorted = sortInboxThreads([
      thread({ key: 'request:old', id: 'old', lastMessage: preview('2026-09-01T09:00:00.000Z') }),
      thread({ key: 'request:new', id: 'new', lastMessage: preview('2026-09-06T09:00:00.000Z') }),
    ])
    expect(sorted.map(t => t.id)).toEqual(['new', 'old'])
  })

  it('sorts a silent room by its own updatedAt rather than dropping it to the floor', () => {
    const sorted = sortInboxThreads([
      thread({ key: 'request:quiet', id: 'quiet', lastMessage: null, updatedAt: '2026-09-06T09:00:00.000Z' }),
      thread({ key: 'request:loud', id: 'loud', lastMessage: preview('2026-09-01T09:00:00.000Z') }),
    ])
    expect(sorted.map(t => t.id)).toEqual(['quiet', 'loud'])
  })
})

describe('filterInboxThreads', () => {
  const rows = [
    thread({ key: 'channel:c1', source: 'channel', id: 'c1', title: 'Mahana Orchards', requestNumber: null, orgName: 'Mahana Orchards', unreadCount: 2 }),
    thread({ key: 'request:r1', id: 'r1', title: 'Brand palette extension', requestNumber: 1049, orgName: 'Mahana Orchards' }),
    thread({ key: 'request:r2', id: 'r2', title: 'Autumn campaign landing page', requestNumber: 1047, orgName: 'Northwind', unreadCount: 1 }),
  ]

  it('narrows to unread', () => {
    expect(filterInboxThreads(rows, { lens: 'unread', query: '' }).map(t => t.id)).toEqual(['c1', 'r2'])
  })

  it('narrows to request threads, dropping the channel', () => {
    expect(filterInboxThreads(rows, { lens: 'requests', query: '' }).map(t => t.id)).toEqual(['r1', 'r2'])
  })

  it('searches the number the way the reader sees it, and the bare digits', () => {
    expect(filterInboxThreads(rows, { lens: 'all', query: 'TR-1049' }).map(t => t.id)).toEqual(['r1'])
    expect(filterInboxThreads(rows, { lens: 'all', query: '1047' }).map(t => t.id)).toEqual(['r2'])
  })

  it('searches the client name, which is the studio inbox only column', () => {
    expect(filterInboxThreads(rows, { lens: 'all', query: 'northwind' }).map(t => t.id)).toEqual(['r2'])
  })

  it('composes the lens with the query rather than replacing it', () => {
    expect(filterInboxThreads(rows, { lens: 'unread', query: 'mahana' }).map(t => t.id)).toEqual(['c1'])
  })

  it('totals unread over the whole list, not the filtered one', () => {
    expect(totalUnread(rows)).toBe(3)
  })
})

describe('inboxSnippet', () => {
  it('flattens composer HTML to one line', () => {
    expect(inboxSnippet('<p>Round three is up.</p><p>Both tones are checked.</p>'))
      .toBe('Round three is up. Both tones are checked.')
  })

  it('decodes the entities a composer emits', () => {
    expect(inboxSnippet('<p>Liam &amp; Staci said &quot;yes&quot;</p>')).toBe('Liam & Staci said "yes"')
  })

  it('truncates on a word boundary and marks it', () => {
    const long = `<p>${'word '.repeat(60)}</p>`
    const out = inboxSnippet(long, 40)
    expect(out.length).toBeLessThanOrEqual(43)
    expect(out.endsWith('...')).toBe(true)
  })

  it('is empty for an empty body, so a voice note can say so instead', () => {
    expect(inboxSnippet('')).toBe('')
    expect(inboxSnippet(null)).toBe('')
    expect(inboxSnippet('<p></p>')).toBe('')
  })
})
