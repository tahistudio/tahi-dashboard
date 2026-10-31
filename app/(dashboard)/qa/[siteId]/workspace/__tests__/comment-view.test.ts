import { describe, expect, it } from 'vitest'
import type { QaComment, QaViewportKey } from '@/lib/qa/types'
import {
  DEFAULT_COMMENT_VIEW,
  commentViewCount,
  isStaleLoad,
  mergeLoadedComments,
  isDefaultCommentView,
  numberComments,
  parseCommentView,
  pinsFor,
  pinsForView,
  toggleViewBrowser,
  toggleViewViewport,
  type CommentView,
} from '../comments-helpers'

function comment(over: Partial<QaComment> & { id: string; viewport: QaViewportKey }): QaComment {
  return {
    roundPageId: 'rp-1',
    browser: 'chromium',
    browserLabel: 'Chrome',
    selector: '#hero',
    ox: 0.5,
    oy: 0.5,
    elementTag: 'button',
    elementText: 'Book a call',
    body: 'Fix this',
    status: 'open',
    requestId: null,
    authorId: 'user_1',
    authorName: 'Liam',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    resolvedAt: null,
    elementContext: null,
    notes: [],
    noteCount: 0,
    ...over,
  }
}

const ALL_VIEWPORTS: QaViewportKey[] = ['xl', 'desktop', 'tablet', 'mobile_l', 'mobile_p']

const all = numberComments([
  comment({ id: 'a', viewport: 'desktop', createdAt: '2026-10-27T10:00:00.000Z' }),
  comment({ id: 'b', viewport: 'desktop', status: 'resolved', createdAt: '2026-10-27T10:01:00.000Z' }),
  comment({ id: 'c', viewport: 'mobile_p', browser: 'firefox', browserLabel: 'Firefox', createdAt: '2026-10-27T10:02:00.000Z' }),
  comment({ id: 'd', viewport: 'tablet', createdAt: '2026-10-27T10:03:00.000Z' }),
])

function drawn(view: CommentView, keep: string | null = null): string[] {
  return ALL_VIEWPORTS.flatMap(v => pinsForView(all, v, view, 'chromium', keep)).map(p => p.id).sort()
}

describe('comment view filter', () => {
  it('the default view draws the same pins as before: every status, the browser being tested', () => {
    expect(isDefaultCommentView(DEFAULT_COMMENT_VIEW)).toBe(true)
    expect(drawn(DEFAULT_COMMENT_VIEW)).toEqual(['a', 'b', 'd'])
    const before = ALL_VIEWPORTS.flatMap(v => pinsFor(all, v, 'chromium')).map(p => p.id).sort()
    expect(drawn(DEFAULT_COMMENT_VIEW)).toEqual(before)
  })

  it('hide comments draws nothing, even a selected comment', () => {
    const hidden = { ...DEFAULT_COMMENT_VIEW, show: false }
    expect(drawn(hidden, 'a')).toEqual([])
    expect(commentViewCount(all, hidden, 'chromium', null)).toEqual({ shown: 0, total: 4 })
  })

  it('filters by status, browser and viewport', () => {
    expect(drawn({ ...DEFAULT_COMMENT_VIEW, status: 'open' })).toEqual(['a', 'd'])
    expect(drawn({ ...DEFAULT_COMMENT_VIEW, status: 'resolved' })).toEqual(['b'])
    expect(drawn({ ...DEFAULT_COMMENT_VIEW, browsers: ['firefox'] })).toEqual(['c'])
    expect(drawn({ ...DEFAULT_COMMENT_VIEW, browsers: ['chromium', 'firefox'] })).toEqual(['a', 'b', 'c', 'd'])
    expect(drawn({ ...DEFAULT_COMMENT_VIEW, hiddenViewports: ['desktop'] })).toEqual(['d'])
  })

  it('keeps pin numbers as the server numbers them when others are filtered out', () => {
    const view: CommentView = { ...DEFAULT_COMMENT_VIEW, status: 'open', hiddenViewports: ['desktop'] }
    const pins = pinsForView(all, 'tablet', view, 'chromium', null)
    expect(pins).toHaveLength(1)
    expect(pins[0].n).toBe(4)
  })

  it('a selected comment stays visible through the filters', () => {
    const view: CommentView = { ...DEFAULT_COMMENT_VIEW, status: 'open', browsers: ['chromium'], hiddenViewports: ['desktop'] }
    expect(drawn(view)).toEqual(['d'])
    expect(drawn(view, 'b')).toEqual(['b', 'd'])
    expect(drawn(view, 'c')).toEqual(['c', 'd'])
  })

  it('counts shown of total', () => {
    expect(commentViewCount(all, DEFAULT_COMMENT_VIEW, 'chromium', null)).toEqual({ shown: 3, total: 4 })
    expect(commentViewCount(all, { ...DEFAULT_COMMENT_VIEW, status: 'open' }, 'chromium', 'b')).toEqual({ shown: 3, total: 4 })
  })

  it('does not change the comments it is given', () => {
    const copy = JSON.stringify(all)
    drawn({ ...DEFAULT_COMMENT_VIEW, status: 'open' })
    expect(JSON.stringify(all)).toBe(copy)
  })

  it('toggles browsers and viewports; an emptied browser list returns to the tested browser', () => {
    const v1 = toggleViewBrowser(DEFAULT_COMMENT_VIEW, 'firefox', 'chromium')
    expect(v1.browsers).toEqual(['chromium', 'firefox'])
    expect(toggleViewBrowser(v1, 'firefox', 'chromium').browsers).toEqual(['chromium'])
    expect(toggleViewBrowser({ ...DEFAULT_COMMENT_VIEW, browsers: ['firefox'] }, 'firefox', 'chromium').browsers).toBeNull()
    const v2 = toggleViewViewport(DEFAULT_COMMENT_VIEW, 'tablet')
    expect(v2.hiddenViewports).toEqual(['tablet'])
    expect(toggleViewViewport(v2, 'tablet').hiddenViewports).toEqual([])
  })

  it('parses a stored view and falls back to defaults for bad data', () => {
    expect(parseCommentView(null)).toEqual(DEFAULT_COMMENT_VIEW)
    expect(parseCommentView('{')).toEqual(DEFAULT_COMMENT_VIEW)
    expect(parseCommentView('[]')).toEqual(DEFAULT_COMMENT_VIEW)
    expect(parseCommentView(JSON.stringify({ show: false, status: 'open', browsers: ['webkit', 'nope'], hiddenViewports: ['tablet', 'bogus'] })))
      .toEqual({ show: false, status: 'open', browsers: ['webkit'], hiddenViewports: ['tablet'] })
    expect(parseCommentView(JSON.stringify({ status: 'odd', browsers: [] }))).toEqual(DEFAULT_COMMENT_VIEW)
    const view: CommentView = { show: true, status: 'resolved', browsers: ['firefox'], hiddenViewports: ['xl'] }
    expect(parseCommentView(JSON.stringify(view))).toEqual(view)
  })
})

describe('refresh versus local writes', () => {
  it('a load is stale only when a local write happened after it started', () => {
    expect(isStaleLoad(3, 3)).toBe(false)
    expect(isStaleLoad(3, 4)).toBe(true)
  })

  it('keeps the optimistic version of a comment whose write is still in flight', () => {
    const server = [comment({ id: 'a', viewport: 'desktop', body: 'old' }), comment({ id: 'b', viewport: 'desktop' })]
    const optimistic = comment({ id: 'a', viewport: 'desktop', body: 'edited' })
    const merged = mergeLoadedComments(server, new Map([['a', optimistic]]))
    expect(merged.map(c => c.body)).toEqual(['edited', 'Fix this'])
    expect(mergeLoadedComments(server, new Map())).toEqual(server)
  })
})
