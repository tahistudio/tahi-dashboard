import { describe, expect, it } from 'vitest'
import type { QaComment, QaViewportKey } from '@/lib/qa/types'
import {
  commentsTabLabel,
  composerHasDraft,
  countByStatus,
  groupByViewport,
  numberComments,
  oneLine,
  openFirst,
  pickAction,
  pinsFor,
  commentsForBrowser,
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
    ...over,
  }
}

describe('numberComments', () => {
  it('numbers oldest first across viewports, ties broken by id', () => {
    const numbered = numberComments([
      comment({ id: 'c', viewport: 'mobile_p', createdAt: '2026-10-27T10:02:00.000Z' }),
      comment({ id: 'b', viewport: 'desktop', createdAt: '2026-10-27T10:00:00.000Z' }),
      comment({ id: 'a', viewport: 'xl', createdAt: '2026-10-27T10:00:00.000Z' }),
    ])
    expect(numbered.map(c => [c.id, c.n])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('does not mutate the input order', () => {
    const input = [
      comment({ id: 'z', viewport: 'xl', createdAt: '2026-10-27T10:05:00.000Z' }),
      comment({ id: 'y', viewport: 'xl', createdAt: '2026-10-27T10:01:00.000Z' }),
    ]
    numberComments(input)
    expect(input.map(c => c.id)).toEqual(['z', 'y'])
  })

  it('returns an empty list for no comments', () => {
    expect(numberComments([])).toEqual([])
  })
})

describe('pinsFor', () => {
  const numbered = numberComments([
    comment({ id: 'a', viewport: 'xl', createdAt: '2026-10-27T10:00:00.000Z', status: 'resolved' }),
    comment({ id: 'b', viewport: 'desktop', createdAt: '2026-10-27T10:01:00.000Z' }),
    comment({ id: 'c', viewport: 'xl', createdAt: '2026-10-27T10:02:00.000Z' }),
  ])

  it('returns only the pins for one viewport with resolved flags', () => {
    expect(pinsFor(numbered, 'xl')).toEqual([
      { id: 'a', n: 1, selector: '#hero', ox: 0.5, oy: 0.5, resolved: true },
      { id: 'c', n: 3, selector: '#hero', ox: 0.5, oy: 0.5, resolved: false },
    ])
  })

  it('returns no pins for a viewport without comments', () => {
    expect(pinsFor(numbered, 'tablet')).toEqual([])
  })
})

describe('groupByViewport', () => {
  const numbered = numberComments([
    comment({ id: 'm', viewport: 'mobile_p', createdAt: '2026-10-27T10:00:00.000Z' }),
    comment({ id: 'd', viewport: 'desktop', createdAt: '2026-10-27T10:01:00.000Z', status: 'resolved' }),
    comment({ id: 'd2', viewport: 'desktop', createdAt: '2026-10-27T10:02:00.000Z' }),
    comment({ id: 'x', viewport: 'xl', createdAt: '2026-10-27T10:03:00.000Z', status: 'resolved' }),
  ])

  it('orders groups in QA_VIEWPORTS order and drops empty groups', () => {
    const groups = groupByViewport(numbered, 'all')
    expect(groups.map(g => g.viewport)).toEqual(['xl', 'desktop', 'mobile_p'])
    expect(groups.map(g => g.label)).toEqual(['XL', 'Desktop', 'Mobile P'])
  })

  it('filters open comments', () => {
    const groups = groupByViewport(numbered, 'open')
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['d2'], ['m']])
  })

  it('filters resolved comments', () => {
    const groups = groupByViewport(numbered, 'resolved')
    expect(groups.map(g => g.items.map(i => i.id))).toEqual([['x'], ['d']])
  })

  it('keeps pin number order inside a group', () => {
    const groups = groupByViewport(numbered, 'all')
    const desktop = groups.find(g => g.viewport === 'desktop')
    expect(desktop?.items.map(i => i.n)).toEqual([2, 3])
  })
})

describe('counts and labels', () => {
  const comments = [
    comment({ id: 'a', viewport: 'xl', status: 'open' }),
    comment({ id: 'b', viewport: 'xl', status: 'resolved' }),
    comment({ id: 'c', viewport: 'desktop', status: 'open' }),
  ]

  it('counts open and resolved comments', () => {
    expect(countByStatus(comments)).toEqual({ open: 2, resolved: 1 })
  })

  it('builds the tab label from open comments', () => {
    expect(commentsTabLabel(comments)).toBe('Comments (2 open)')
    expect(commentsTabLabel([])).toBe('Comments (0 open)')
  })
})

describe('openFirst', () => {
  it('puts open comments before resolved, each in number order', () => {
    const numbered = numberComments([
      comment({ id: 'a', viewport: 'xl', createdAt: '2026-10-27T10:00:00.000Z', status: 'resolved' }),
      comment({ id: 'b', viewport: 'xl', createdAt: '2026-10-27T10:01:00.000Z' }),
      comment({ id: 'c', viewport: 'xl', createdAt: '2026-10-27T10:02:00.000Z' }),
    ])
    expect(openFirst(numbered).map(c => c.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('oneLine', () => {
  it('collapses whitespace and trims', () => {
    expect(oneLine('  Book\n   a \t call  ')).toBe('Book a call')
  })

  it('returns an empty string for null or undefined', () => {
    expect(oneLine(null)).toBe('')
    expect(oneLine(undefined)).toBe('')
  })
})

import {
  commentRequestPrefill,
  commentRequestTitle,
  composerPlacement,
  filterForSelection,
  parseEscapeMessage,
  REQUEST_DESCRIPTION_MAX,
  parseModeChangedMessage,
  parsePickMessage,
  parsePinClickMessage,
  viewportForSource,
} from '../comments-helpers'

const goodPick = { type: 'qa:pick', version: 1, url: 'https://x.webflow.io/about', selector: '#hero', ox: 0.25, oy: 1, tag: 'BUTTON', text: '  Book   a call ' }

describe('parsePickMessage', () => {
  it('accepts a good message and normalises tag and text', () => {
    expect(parsePickMessage(goodPick)).toEqual({ ...goodPick, tag: 'button', text: 'Book a call' })
  })

  it('rejects wrong type, version and missing fields', () => {
    expect(parsePickMessage(null)).toBeNull()
    expect(parsePickMessage('qa:pick')).toBeNull()
    expect(parsePickMessage({ ...goodPick, type: 'qa:scan' })).toBeNull()
    expect(parsePickMessage({ ...goodPick, version: 2 })).toBeNull()
    expect(parsePickMessage({ ...goodPick, url: 5 })).toBeNull()
    expect(parsePickMessage({ ...goodPick, selector: '' })).toBeNull()
    expect(parsePickMessage({ ...goodPick, selector: 'a'.repeat(1001) })).toBeNull()
    expect(parsePickMessage({ ...goodPick, tag: '' })).toBeNull()
    expect(parsePickMessage({ ...goodPick, text: 4 })).toBeNull()
  })

  it('rejects offsets outside 0 to 1 or not finite', () => {
    expect(parsePickMessage({ ...goodPick, ox: -0.1 })).toBeNull()
    expect(parsePickMessage({ ...goodPick, oy: 1.1 })).toBeNull()
    expect(parsePickMessage({ ...goodPick, ox: Number.NaN })).toBeNull()
    expect(parsePickMessage({ ...goodPick, oy: '0.5' })).toBeNull()
  })

  it('accepts an optional element context and clamps it', () => {
    const context = { id: null, classes: ['hero', 3], ancestors: [], html: '<h1></h1>', box: { x: 1.4, y: 2, width: 3, height: 4 }, scrollY: 0, pageHeight: 900, viewportWidth: 1440, viewportHeight: 900 }
    const parsed = parsePickMessage({ ...goodPick, context })
    expect(parsed?.context?.classes).toEqual(['hero'])
    expect(parsed?.context?.box.x).toBe(1)
  })

  it('drops a bad context but still accepts the pick', () => {
    for (const context of ['junk', 5, null, [], { classes: 'x', box: {} }, { classes: [] }]) {
      const parsed = parsePickMessage({ ...goodPick, context })
      expect(parsed).toEqual({ ...goodPick, tag: 'button', text: 'Book a call' })
      expect(parsed && 'context' in parsed).toBe(false)
    }
  })

  it('caps the text at 120 characters', () => {
    const parsed = parsePickMessage({ ...goodPick, text: 'x'.repeat(500) })
    expect(parsed?.text.length).toBe(120)
  })
})

describe('parsePinClickMessage and parseModeChangedMessage', () => {
  it('validates pin clicks', () => {
    expect(parsePinClickMessage({ type: 'qa:pin-click', version: 1, id: 'c1' })).toEqual({ type: 'qa:pin-click', version: 1, id: 'c1' })
    expect(parsePinClickMessage({ type: 'qa:pin-click', version: 1, id: '' })).toBeNull()
    expect(parsePinClickMessage({ type: 'qa:pin-click', version: 1, id: 3 })).toBeNull()
    expect(parsePinClickMessage({ type: 'qa:pin-click', version: 2, id: 'c1' })).toBeNull()
    expect(parsePinClickMessage(undefined)).toBeNull()
  })

  it('validates mode changes', () => {
    expect(parseModeChangedMessage({ type: 'qa:comment-mode-changed', version: 1, on: false })).toEqual({ type: 'qa:comment-mode-changed', version: 1, on: false })
    expect(parseModeChangedMessage({ type: 'qa:comment-mode-changed', version: 1, on: 'no' })).toBeNull()
    expect(parseModeChangedMessage({ type: 'qa:comment-mode-changed', version: 3, on: true })).toBeNull()
    expect(parseModeChangedMessage([])).toBeNull()
  })
})

describe('viewportForSource', () => {
  it('finds the frame by window and ignores unknown sources', () => {
    const winA = {}
    const winB = {}
    const frames = { desktop: { contentWindow: winA }, tablet: { contentWindow: winB }, xl: null }
    expect(viewportForSource(frames, winB)).toBe('tablet')
    expect(viewportForSource(frames, winA)).toBe('desktop')
    expect(viewportForSource(frames, {})).toBeNull()
    expect(viewportForSource(frames, null)).toBeNull()
  })

  it('does not match two frames whose window is missing', () => {
    expect(viewportForSource({ desktop: { contentWindow: null } }, null)).toBeNull()
  })
})

describe('composerPlacement', () => {
  it('centres over a frame that leaves room', () => {
    const p = composerPlacement({ left: 400, top: 100, width: 600, height: 500 }, 1600, 1000)
    expect(p.width).toBe(352)
    expect(p.left).toBe(400 + 300 - 176)
    expect(p.top).toBe(108)
  })

  it('stays on screen at the right edge and at the bottom', () => {
    const p = composerPlacement({ left: 1500, top: 900, width: 200, height: 400 }, 1600, 1000)
    expect(p.left + p.width).toBeLessThanOrEqual(1600 - 8)
    expect(p.top).toBeLessThanOrEqual(1000 - 336 - 8)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('fits a 375px window with margins', () => {
    const p = composerPlacement({ left: 0, top: 200, width: 375, height: 600 }, 375, 800)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + p.width).toBeLessThanOrEqual(375 - 8)
  })

  it('shrinks the card in a 320px window', () => {
    const p = composerPlacement({ left: 0, top: 200, width: 320, height: 600 }, 320, 800)
    expect(p.width).toBe(304)
    expect(p.left).toBe(8)
  })

  it('never goes negative when the window is tiny', () => {
    const p = composerPlacement({ left: -50, top: -50, width: 10, height: 10 }, 200, 200)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })
})

describe('comment to request prefill', () => {
  it('uses the first non-empty line as the title, capped at 120', () => {
    expect(commentRequestTitle('\n  Fix the hero\nsecond line')).toBe('Fix the hero')
    expect(commentRequestTitle('a'.repeat(300)).length).toBe(120)
    expect(commentRequestTitle('')).toBe('')
  })

  it('builds a description with viewport, element and page', () => {
    const out = commentRequestPrefill({ body: 'Fix this\nplease', elementTag: 'button', elementText: 'Book  a call' }, 'Desktop', '/about')
    expect(out.title).toBe('Fix this')
    expect(out.description).toBe('Fix this\nplease\n\nViewport: Desktop\nElement: <button> Book a call\nPage: /about')
  })

  it('handles a missing element', () => {
    const out = commentRequestPrefill({ body: 'x', elementTag: null, elementText: null }, 'Mobile P', '/')
    expect(out.description).toContain('Element: <element>')
  })
})

describe('composerHasDraft', () => {
  it('is true only for non-blank text', () => {
    expect(composerHasDraft('Fix this')).toBe(true)
    expect(composerHasDraft('  \n ')).toBe(false)
    expect(composerHasDraft('')).toBe(false)
    expect(composerHasDraft(null)).toBe(false)
    expect(composerHasDraft(undefined)).toBe(false)
  })
})

describe('pickAction', () => {
  it('opens a composer when none is open', () => {
    expect(pickAction(false, '')).toBe('open')
    expect(pickAction(false, 'stale')).toBe('open')
  })
  it('replaces an empty or blank composer', () => {
    expect(pickAction(true, '')).toBe('replace')
    expect(pickAction(true, '   ')).toBe('replace')
  })
  it('ignores the pick when text was typed', () => {
    expect(pickAction(true, 'Needs a bigger button')).toBe('ignore')
  })
})

describe('filterForSelection', () => {
  const list = [
    comment({ id: 'o', viewport: 'desktop', status: 'open' }),
    comment({ id: 'r', viewport: 'desktop', status: 'resolved' }),
  ]
  it('keeps the filter when nothing is selected or the selection is unknown', () => {
    expect(filterForSelection(list, null, 'open')).toBe('open')
    expect(filterForSelection(list, 'missing', 'open')).toBe('open')
  })
  it('keeps the filter when the selected comment is already visible', () => {
    expect(filterForSelection(list, 'o', 'open')).toBe('open')
    expect(filterForSelection(list, 'r', 'resolved')).toBe('resolved')
    expect(filterForSelection(list, 'r', 'all')).toBe('all')
  })
  it('widens to all when the selected comment is hidden by the filter', () => {
    expect(filterForSelection(list, 'r', 'open')).toBe('all')
    expect(filterForSelection(list, 'o', 'resolved')).toBe('all')
  })
})

describe('parseEscapeMessage', () => {
  it('accepts only the exact message', () => {
    expect(parseEscapeMessage({ type: 'qa:escape', version: 1 })).toEqual({ type: 'qa:escape', version: 1 })
    expect(parseEscapeMessage({ type: 'qa:escape', version: 2 })).toBeNull()
    expect(parseEscapeMessage({ type: 'qa:pick', version: 1 })).toBeNull()
    expect(parseEscapeMessage(null)).toBeNull()
    expect(parseEscapeMessage('qa:escape')).toBeNull()
  })
})

describe('commentRequestPrefill length cap', () => {
  it('keeps a long comment within the 4000 character description cap with an ellipsis', () => {
    const body = 'word '.repeat(2000)
    const out = commentRequestPrefill({ body, elementTag: 'button', elementText: 'Book a call' }, 'Desktop', '/about')
    expect(out.description.length).toBeLessThanOrEqual(REQUEST_DESCRIPTION_MAX)
    expect(out.description).toContain('…\n\nViewport: Desktop')
    expect(out.description.endsWith('Page: /about')).toBe(true)
  })
  it('leaves a short comment untouched', () => {
    const out = commentRequestPrefill({ body: 'Short', elementTag: 'p', elementText: null }, 'Desktop', '/')
    expect(out.description.startsWith('Short\n\nViewport: Desktop')).toBe(true)
    expect(out.description).not.toContain('…')
  })
})

describe('browser scoping', () => {
  const mixed = numberComments([
    comment({ id: 'a', viewport: 'desktop', createdAt: '2026-10-27T10:00:00.000Z' }),
    comment({ id: 'b', viewport: 'desktop', browser: 'firefox', browserLabel: 'Firefox', createdAt: '2026-10-27T10:01:00.000Z' }),
    comment({ id: 'c', viewport: 'tablet', browser: 'firefox', browserLabel: 'Firefox', createdAt: '2026-10-27T10:02:00.000Z' }),
  ])

  it('pinsFor draws only the pins of the browser being tested, keeping the page wide numbers', () => {
    expect(pinsFor(mixed, 'desktop', 'firefox').map(p => [p.id, p.n])).toEqual([['b', 2]])
    expect(pinsFor(mixed, 'desktop', 'chromium').map(p => [p.id, p.n])).toEqual([['a', 1]])
    expect(pinsFor(mixed, 'desktop').map(p => p.id)).toEqual(['a', 'b'])
  })

  it('commentsForBrowser keeps one browser, or all of them for null', () => {
    expect(commentsForBrowser(mixed, 'firefox').map(c => c.id)).toEqual(['b', 'c'])
    expect(commentsForBrowser(mixed, 'webkit')).toEqual([])
    expect(commentsForBrowser(mixed, null).map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})
