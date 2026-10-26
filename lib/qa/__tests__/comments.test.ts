import { describe, it, expect } from 'vitest'
import {
  clampUnit,
  commentUpdateFields,
  numberComments,
  parseCommentInput,
  parseCommentPatch,
  rowToComment,
  type CommentRow,
} from '@/lib/qa/comments'
import { QA_COMMENT_BODY_MAX } from '@/lib/qa/types'

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
    ...overrides,
  }
}

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
        selector: '#hero > h1',
        ox: 0.25,
        oy: 0.75,
        elementTag: 'h1',
        elementText: 'Welcome',
        body: 'Heading is too low',
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
