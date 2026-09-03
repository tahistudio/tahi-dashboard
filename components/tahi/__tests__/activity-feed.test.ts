import { describe, it, expect } from 'vitest'
import {
  EXCERPT_LIMIT,
  buildActivityEvents,
  filterActivityEvents,
  messageExcerpt,
  stripHtmlToText,
  type ActivityFileSource,
  type ActivityMessageSource,
  type ActivityRequestSource,
} from '@/components/tahi/requests/activity-feed'

const REQUEST: ActivityRequestSource = {
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  deliveredAt: null,
  statusLabel: 'In progress',
  assigneeName: 'Liam Miller',
}

function msg(over: Partial<ActivityMessageSource> = {}): ActivityMessageSource {
  return {
    id: 'm1',
    body: '<p>Looks good, ship it.</p>',
    isInternal: false,
    createdAt: '2026-09-02T09:00:00.000Z',
    authorName: 'Staci Bonnie',
    ...over,
  }
}

function file(over: Partial<ActivityFileSource> = {}): ActivityFileSource {
  return {
    id: 'f1',
    filename: 'hero.png',
    createdAt: '2026-09-03T09:00:00.000Z',
    uploaderName: 'Liam Miller',
    ...over,
  }
}

describe('stripHtmlToText', () => {
  it('drops tags and decodes the entities Tiptap writes', () => {
    expect(stripHtmlToText('<p>Fish &amp; chips</p>')).toBe('Fish & chips')
    expect(stripHtmlToText('<p>a&nbsp;b</p>')).toBe('a b')
    expect(stripHtmlToText('<p>&lt;script&gt;</p>')).toBe('<script>')
  })
})

describe('messageExcerpt', () => {
  it('flattens a multi-paragraph body to one line', () => {
    const out = messageExcerpt('<p>First para.</p><p>Second para.</p>')
    expect(out).toBe('First para. Second para.')
    expect(out).not.toContain('\n')
  })

  it('leaves a short body untouched', () => {
    expect(messageExcerpt('<p>Short.</p>')).toBe('Short.')
  })

  it('cuts on a word boundary past the limit', () => {
    const body = `<p>${'alpha '.repeat(60).trim()}</p>`
    const out = messageExcerpt(body)
    expect(out.length).toBeLessThanOrEqual(EXCERPT_LIMIT + 1)
    expect(out.endsWith('…')).toBe(true)
    // Never cuts mid-word when a boundary is available.
    expect(out.slice(0, -1).endsWith('alpha')).toBe(true)
  })

  it('hard-cuts a single very long token rather than returning nothing', () => {
    const out = messageExcerpt(`<p>${'x'.repeat(400)}</p>`, 20)
    expect(out).toBe(`${'x'.repeat(20)}…`)
  })
})

describe('buildActivityEvents', () => {
  it('always emits a created event', () => {
    const events = buildActivityEvents(REQUEST, [], [])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'created', type: 'created', author: null })
  })

  it('adds a status change only when updatedAt moved', () => {
    expect(buildActivityEvents(REQUEST, [], []).some(e => e.id === 'status-update')).toBe(false)
    const moved = buildActivityEvents(
      { ...REQUEST, updatedAt: '2026-09-04T09:00:00.000Z' }, [], [],
    )
    expect(moved.find(e => e.id === 'status-update')).toMatchObject({
      description: 'Status changed to In progress',
      author: 'Liam Miller',
    })
  })

  it('merges thread messages in as comment events with an excerpt', () => {
    const events = buildActivityEvents(REQUEST, [msg()], [])
    const comment = events.find(e => e.id === 'msg-m1')
    expect(comment).toMatchObject({
      type: 'comment',
      author: 'Staci Bonnie',
      description: 'Looks good, ship it.',
      internal: false,
      timestamp: '2026-09-02T09:00:00.000Z',
    })
  })

  it('marks internal notes so the feed can tint them', () => {
    const events = buildActivityEvents(REQUEST, [msg({ isInternal: true })], [])
    expect(events.find(e => e.id === 'msg-m1')?.internal).toBe(true)
  })

  it('sorts newest first and breaks ties on id', () => {
    const sameTime = '2026-09-02T09:00:00.000Z'
    const events = buildActivityEvents(
      REQUEST,
      [msg({ id: 'b', createdAt: sameTime }), msg({ id: 'a', createdAt: sameTime })],
      [file()],
    )
    expect(events.map(e => e.id)).toEqual(['file-f1', 'msg-a', 'msg-b', 'created'])
  })

  it('counts a merged feed so the caller can auto-open a short one', () => {
    const short = buildActivityEvents(REQUEST, [msg()], [file()])
    expect(short.length).toBe(3)
    const long = buildActivityEvents(
      REQUEST,
      Array.from({ length: 6 }, (_, i) => msg({ id: `m${i}` })),
      [],
    )
    expect(long.length).toBeGreaterThan(5)
  })
})

describe('filterActivityEvents', () => {
  it('keeps only comments under the Comments filter', () => {
    const events = buildActivityEvents(REQUEST, [msg()], [file()])
    const comments = filterActivityEvents(events, 'comments')
    expect(comments.map(e => e.id)).toEqual(['msg-m1'])
  })

  it('keeps everything under All and does not mutate the source', () => {
    const events = buildActivityEvents(REQUEST, [msg()], [file()])
    const all = filterActivityEvents(events, 'all')
    expect(all).toHaveLength(events.length)
    expect(all).not.toBe(events)
  })
})
