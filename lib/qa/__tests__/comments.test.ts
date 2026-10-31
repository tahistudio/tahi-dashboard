import { describe, it, expect } from 'vitest'
import {
  clampUnit,
  commentUpdateFields,
  numberComments,
  parseCommentInput,
  pageUrlFor,
  parseCommentPatch,
  parseElementContext,
  parseStoredContext,
  rowToComment,
  toCommentDetail,
  viewportInfoFor,
  type CommentRow,
} from '@/lib/qa/comments'
import { QA_COMMENT_BODY_MAX, QA_CONTEXT_MAX_BYTES } from '@/lib/qa/types'

const validInput = {
  viewport: 'desktop',
  selector: '#hero > h1',
  ox: 0.25,
  oy: 0.75,
  elementTag: 'h1',
  elementText: 'Welcome',
  body: '  Heading is too low  ',
}

function row(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'c1',
    roundPageId: 'rp1',
    viewport: 'desktop',
    browser: 'chromium',
    selector: 'div.card',
    ox: 0.5,
    oy: 0.5,
    elementTag: 'div',
    elementText: null,
    body: 'Fix spacing',
    status: 'open',
    requestId: null,
    authorId: 'user_1',
    authorName: 'Liam',
    createdAt: '2026-10-27T10:00:00.000Z',
    updatedAt: '2026-10-27T10:00:00.000Z',
    resolvedAt: null,
    elementContext: null,
    ...overrides,
  }
}

const goodContext = {
  id: 'hero-title',
  classes: ['heading-style-h1', 'u-center'],
  ancestors: [{ tag: 'div', id: null, classes: ['container-large'] }, { tag: 'section', id: 'hero', classes: ['section_hero'] }],
  html: '<h1 class="heading-style-h1">Hi</h1>',
  box: { x: 10.4, y: 20.6, width: 300, height: 60 },
  scrollY: 120,
  pageHeight: 4000,
  viewportWidth: 1440,
  viewportHeight: 900,
}

describe('parseElementContext', () => {
  it('keeps a good context and rounds numbers', () => {
    expect(parseElementContext(goodContext)).toEqual({ ...goodContext, box: { x: 10, y: 21, width: 300, height: 60 } })
  })

  it('returns null for anything that is not an object', () => {
    for (const v of [null, undefined, 'x', 4, [], true]) expect(parseElementContext(v)).toBeNull()
  })

  it('drops invalid parts instead of rejecting', () => {
    const ctx = parseElementContext({
      id: 5,
      classes: ['ok', 7, '', null, 'also-ok'],
      ancestors: [{ tag: 'div', classes: 'nope' }, 'bad', { tag: '' }, { tag: 'SECTION', id: 'a', classes: ['x'] }],
      html: 12,
      box: { x: Number.NaN, y: Infinity, width: '5', height: 7 },
      scrollY: 'far',
      pageHeight: Number.NaN,
      viewportWidth: -Infinity,
    })
    expect(ctx).toEqual({
      id: null,
      classes: ['ok', 'also-ok'],
      ancestors: [{ tag: 'div', id: null, classes: [] }, { tag: 'section', id: 'a', classes: ['x'] }],
      html: '',
      box: { x: 0, y: 0, width: 0, height: 7 },
      scrollY: 0,
      pageHeight: 0,
      viewportWidth: 0,
      viewportHeight: 0,
    })
  })

  it('clamps classes, ancestors and html to the limits', () => {
    const ctx = parseElementContext({
      ...goodContext,
      classes: Array.from({ length: 40 }, (_, i) => (i === 0 ? 'x'.repeat(300) : `c${i}`)),
      ancestors: Array.from({ length: 20 }, () => ({ tag: 'div', id: null, classes: [] })),
      html: 'h'.repeat(5000),
    })
    expect(ctx?.classes).toHaveLength(20)
    expect(ctx?.classes[0]).toHaveLength(100)
    expect(ctx?.ancestors).toHaveLength(8)
    expect(ctx?.html).toHaveLength(600)
  })

  it('keeps the stored JSON within 8 KB, shedding html then ancestors', () => {
    const fat = { tag: 'div', id: 'i'.repeat(200), classes: Array.from({ length: 20 }, () => 'y'.repeat(100)) }
    const ctx = parseElementContext({
      ...goodContext,
      classes: Array.from({ length: 20 }, () => 'z'.repeat(100)),
      ancestors: Array.from({ length: 8 }, () => fat),
      html: 'h'.repeat(600),
    })
    expect(ctx).not.toBeNull()
    expect(new TextEncoder().encode(JSON.stringify(ctx)).length).toBeLessThanOrEqual(QA_CONTEXT_MAX_BYTES)
    expect(ctx?.html).toBe('')
    expect(ctx?.ancestors).toEqual([])
    expect(ctx?.classes).toHaveLength(20)
  })

  it('parseStoredContext tolerates missing and broken JSON', () => {
    expect(parseStoredContext(null)).toBeNull()
    expect(parseStoredContext('{not json')).toBeNull()
    expect(parseStoredContext(JSON.stringify(goodContext))?.classes).toEqual(['heading-style-h1', 'u-center'])
  })

  it('parseCommentInput carries a valid context and ignores a bad one', () => {
    const ok = parseCommentInput({ ...validInput, elementContext: goodContext })
    expect(ok.ok && ok.value.elementContext?.classes).toEqual(['heading-style-h1', 'u-center'])
    const bad = parseCommentInput({ ...validInput, elementContext: 'junk' })
    expect(bad.ok && bad.value.elementContext).toBeNull()
    const none = parseCommentInput(validInput)
    expect(none.ok && none.value.elementContext).toBeNull()
  })

  it('rowToComment parses the stored column', () => {
    expect(rowToComment(row({ elementContext: JSON.stringify(goodContext) })).elementContext?.id).toBe('hero-title')
    expect(rowToComment(row()).elementContext).toBeNull()
  })
})

describe('viewport info and comment detail', () => {
  it('maps every viewport to its Webflow breakpoint guidance', () => {
    expect(viewportInfoFor('xl')).toEqual({ key: 'xl', label: 'XL', width: 1920, height: 1080, webflowBreakpoint: '1920px breakpoint if enabled, else 1440px, else 1280px, else Desktop (base)' })
    expect(viewportInfoFor('desktop').webflowBreakpoint).toBe('1440px breakpoint if enabled, else 1280px, else Desktop (base)')
    expect(viewportInfoFor('tablet').webflowBreakpoint).toBe('Tablet (991px and below)')
    expect(viewportInfoFor('mobile_l')).toMatchObject({ width: 425, webflowBreakpoint: 'Mobile portrait (479px and below); this frame is 425px wide' })
    expect(viewportInfoFor('mobile_p')).toMatchObject({ width: 375, webflowBreakpoint: 'Mobile portrait (479px and below); this frame is 375px wide' })
  })

  it('builds the page URL from the site origin and path', () => {
    expect(pageUrlFor('https://acme.webflow.io', '/about')).toBe('https://acme.webflow.io/about')
    expect(pageUrlFor('https://acme.webflow.io/ignored/path', 'about')).toBe('https://acme.webflow.io/about')
    expect(pageUrlFor(null, '/about')).toBeNull()
    expect(pageUrlFor('not a url', '/about')).toBeNull()
  })

  it('toCommentDetail is a superset of the plain comment', () => {
    const r = row({ viewport: 'tablet', elementContext: JSON.stringify(goodContext) })
    const detail = toCommentDetail(r, 3, '/about', {
      roundId: 'r1', roundName: 'Launch QA', siteName: 'Acme', target: 'staging', siteUrl: 'https://acme.webflow.io',
    })
    expect(detail).toMatchObject({ ...rowToComment(r), n: 3, path: '/about', pageUrl: 'https://acme.webflow.io/about', target: 'staging', roundId: 'r1', roundName: 'Launch QA', siteName: 'Acme' })
    expect(detail.viewportInfo).toMatchObject({ key: 'tablet', width: 768, height: 1024 })
  })
})

describe('clampUnit', () => {
  it('clamps into 0..1', () => {
    expect(clampUnit(-0.2)).toBe(0)
    expect(clampUnit(1.7)).toBe(1)
    expect(clampUnit(0.4)).toBe(0.4)
  })
})

describe('rowToComment', () => {
  it('maps every field and casts the viewport and status', () => {
    const out = rowToComment(row({ status: 'resolved', resolvedAt: '2026-10-27T11:00:00.000Z', requestId: 'req_1' }))
    expect(out).toEqual({
      id: 'c1',
      roundPageId: 'rp1',
      viewport: 'desktop',
      browser: 'chromium',
      browserLabel: 'Chrome',
      selector: 'div.card',
      ox: 0.5,
      oy: 0.5,
      elementTag: 'div',
      elementText: null,
      body: 'Fix spacing',
      status: 'resolved',
      requestId: 'req_1',
      authorId: 'user_1',
      authorName: 'Liam',
      createdAt: '2026-10-27T10:00:00.000Z',
      updatedAt: '2026-10-27T10:00:00.000Z',
      resolvedAt: '2026-10-27T11:00:00.000Z',
      elementContext: null,
      notes: [],
      noteCount: 0,
    })
  })
})

describe('parseCommentInput', () => {
  it('accepts a valid body and trims the comment text', () => {
    const r = parseCommentInput(validInput)
    expect(r).toEqual({
      ok: true,
      value: {
        viewport: 'desktop',
        browser: null,
        selector: '#hero > h1',
        ox: 0.25,
        oy: 0.75,
        elementTag: 'h1',
        elementText: 'Welcome',
        body: 'Heading is too low',
        elementContext: null,
      },
    })
  })

  it('rejects a non-object body', () => {
    for (const input of [null, undefined, 'x', 5, [], true]) {
      const r = parseCommentInput(input)
      expect(r.ok).toBe(false)
    }
  })

  it('rejects an unknown viewport', () => {
    const r = parseCommentInput({ ...validInput, viewport: 'watch' })
    expect(r).toEqual({ ok: false, error: 'viewport is not a known QA viewport' })
  })

  it('rejects a missing viewport', () => {
    const rest: Record<string, unknown> = { ...validInput }
    delete rest.viewport
    expect(parseCommentInput(rest).ok).toBe(false)
  })

  it('rejects a blank or over-long selector', () => {
    expect(parseCommentInput({ ...validInput, selector: '   ' }).ok).toBe(false)
    expect(parseCommentInput({ ...validInput, selector: 'a'.repeat(1001) }).ok).toBe(false)
    expect(parseCommentInput({ ...validInput, selector: 'a'.repeat(1000) }).ok).toBe(true)
  })

  it('rejects a non-text selector', () => {
    expect(parseCommentInput({ ...validInput, selector: 7 }).ok).toBe(false)
  })

  it('rejects non-finite or missing ox and oy', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0.5', null, undefined]) {
      expect(parseCommentInput({ ...validInput, ox: bad }).ok).toBe(false)
      expect(parseCommentInput({ ...validInput, oy: bad }).ok).toBe(false)
    }
  })

  it('clamps ox and oy into 0..1', () => {
    const r = parseCommentInput({ ...validInput, ox: -3, oy: 9 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.ox).toBe(0)
      expect(r.value.oy).toBe(1)
    }
  })

  it('truncates elementTag to 40 and elementText to 200 rather than rejecting', () => {
    const r = parseCommentInput({ ...validInput, elementTag: 'x'.repeat(60), elementText: 'y'.repeat(500) })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.elementTag).toHaveLength(40)
      expect(r.value.elementText).toHaveLength(200)
    }
  })

  it('stores null for missing or blank element fields', () => {
    const r = parseCommentInput({ ...validInput, elementTag: undefined, elementText: '   ' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.elementTag).toBeNull()
      expect(r.value.elementText).toBeNull()
    }
  })

  it('rejects non-text element fields', () => {
    expect(parseCommentInput({ ...validInput, elementTag: 4 }).ok).toBe(false)
    expect(parseCommentInput({ ...validInput, elementText: {} }).ok).toBe(false)
  })

  it('rejects an empty body after trimming', () => {
    expect(parseCommentInput({ ...validInput, body: '    ' }).ok).toBe(false)
  })

  it('accepts a body of exactly QA_COMMENT_BODY_MAX and rejects one more character', () => {
    expect(parseCommentInput({ ...validInput, body: 'a'.repeat(QA_COMMENT_BODY_MAX) }).ok).toBe(true)
    expect(parseCommentInput({ ...validInput, body: 'a'.repeat(QA_COMMENT_BODY_MAX + 1) }).ok).toBe(false)
  })
})

describe('parseCommentPatch', () => {
  it('accepts each field on its own', () => {
    expect(parseCommentPatch({ body: ' New text ' })).toEqual({ ok: true, value: { body: 'New text' } })
    expect(parseCommentPatch({ status: 'resolved' })).toEqual({ ok: true, value: { status: 'resolved' } })
    expect(parseCommentPatch({ status: 'open' })).toEqual({ ok: true, value: { status: 'open' } })
    expect(parseCommentPatch({ requestId: 'req_9' })).toEqual({ ok: true, value: { requestId: 'req_9' } })
    expect(parseCommentPatch({ requestId: null })).toEqual({ ok: true, value: { requestId: null } })
  })

  it('rejects an empty patch', () => {
    expect(parseCommentPatch({}).ok).toBe(false)
    expect(parseCommentPatch({ unrelated: 1 }).ok).toBe(false)
  })

  it('rejects a non-object body', () => {
    expect(parseCommentPatch(null).ok).toBe(false)
    expect(parseCommentPatch([]).ok).toBe(false)
  })

  it('rejects an unknown status', () => {
    expect(parseCommentPatch({ status: 'closed' }).ok).toBe(false)
  })

  it('rejects a blank or over-long body', () => {
    expect(parseCommentPatch({ body: '  ' }).ok).toBe(false)
    expect(parseCommentPatch({ body: 'a'.repeat(QA_COMMENT_BODY_MAX + 1) }).ok).toBe(false)
  })

  it('rejects a blank or over-long requestId and a non-text requestId', () => {
    expect(parseCommentPatch({ requestId: '' }).ok).toBe(false)
    expect(parseCommentPatch({ requestId: 'r'.repeat(65) }).ok).toBe(false)
    expect(parseCommentPatch({ requestId: 12 }).ok).toBe(false)
  })

  it('ignores unknown keys alongside a valid one', () => {
    expect(parseCommentPatch({ status: 'open', roundPageId: 'other' })).toEqual({ ok: true, value: { status: 'open' } })
  })
})

describe('commentUpdateFields', () => {
  const now = '2026-10-27T12:00:00.000Z'

  it('sets resolvedAt to now when resolving', () => {
    expect(commentUpdateFields({ status: 'resolved' }, now)).toEqual({
      status: 'resolved',
      resolvedAt: now,
      updatedAt: now,
    })
  })

  it('clears resolvedAt when reopening', () => {
    expect(commentUpdateFields({ status: 'open' }, now)).toEqual({
      status: 'open',
      resolvedAt: null,
      updatedAt: now,
    })
  })

  it('leaves resolvedAt out when status is not in the patch', () => {
    const fields = commentUpdateFields({ body: 'Edited' }, now)
    expect(fields).toEqual({ body: 'Edited', updatedAt: now })
    expect('resolvedAt' in fields).toBe(false)
    expect('status' in fields).toBe(false)
  })

  it('writes a null requestId when unlinking and always bumps updatedAt', () => {
    expect(commentUpdateFields({ requestId: null }, now)).toEqual({ requestId: null, updatedAt: now })
  })
})

describe('numberComments', () => {
  it('numbers per round page in created_at order', () => {
    const rows = [
      { id: 'b', roundPageId: 'p1', createdAt: '2026-10-27T10:02:00.000Z' },
      { id: 'a', roundPageId: 'p1', createdAt: '2026-10-27T10:01:00.000Z' },
      { id: 'z', roundPageId: 'p2', createdAt: '2026-10-27T09:00:00.000Z' },
      { id: 'c', roundPageId: 'p1', createdAt: '2026-10-27T10:03:00.000Z' },
    ]
    const n = numberComments(rows)
    expect(n.get('a')).toBe(1)
    expect(n.get('b')).toBe(2)
    expect(n.get('c')).toBe(3)
    expect(n.get('z')).toBe(1)
  })

  it('breaks created_at ties by id', () => {
    const same = '2026-10-27T10:00:00.000Z'
    const n = numberComments([
      { id: 'm', roundPageId: 'p1', createdAt: same },
      { id: 'k', roundPageId: 'p1', createdAt: same },
    ])
    expect(n.get('k')).toBe(1)
    expect(n.get('m')).toBe(2)
  })

  it('does not mutate the input order', () => {
    const rows = [
      { id: 'b', roundPageId: 'p1', createdAt: '2026-10-27T10:02:00.000Z' },
      { id: 'a', roundPageId: 'p1', createdAt: '2026-10-27T10:01:00.000Z' },
    ]
    numberComments(rows)
    expect(rows.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('returns an empty map for no rows', () => {
    expect(numberComments([]).size).toBe(0)
  })
})

describe('comment browser', () => {
  it('rowToComment carries the browser and its label, and reads an unknown value as Chrome', () => {
    const firefox = rowToComment(row({ browser: 'firefox' }))
    expect(firefox.browser).toBe('firefox')
    expect(firefox.browserLabel).toBe('Firefox')
    const odd = rowToComment(row({ browser: 'netscape' }))
    expect(odd.browser).toBe('chromium')
    expect(odd.browserLabel).toBe('Chrome')
  })

  it('toCommentDetail keeps the browser', () => {
    const detail = toCommentDetail(row({ browser: 'webkit' }), 1, '/about', {
      roundId: 'r1', roundName: 'Round', siteName: 'Site', target: 'staging', siteUrl: 'https://x.webflow.io',
    })
    expect(detail.browser).toBe('webkit')
    expect(detail.browserLabel).toBe('Safari')
  })

  it('parseCommentInput leaves the browser null when none is sent (the route uses the round first browser) and accepts the known ones', () => {
    const base = { viewport: 'desktop', selector: '#a', ox: 0.5, oy: 0.5, body: 'x' }
    const plain = parseCommentInput(base)
    expect(plain.ok && plain.value.browser).toBeNull()
    const ff = parseCommentInput({ ...base, browser: 'firefox' })
    expect(ff.ok && ff.value.browser).toBe('firefox')
  })

  it('parseCommentInput rejects an unknown browser', () => {
    const bad = parseCommentInput({ viewport: 'desktop', selector: '#a', ox: 0.5, oy: 0.5, body: 'x', browser: 'edge' })
    expect(bad.ok).toBe(false)
  })
})
