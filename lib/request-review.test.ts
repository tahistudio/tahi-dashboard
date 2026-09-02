import { describe, it, expect } from 'vitest'
import {
  buildReviewMessageHtml,
  canReview,
  isReviewDecision,
  reviewDecisionLabel,
  reviewDecisionToStatus,
  REVIEWABLE_STATUS,
  REVIEW_NOTE_LIMIT,
} from './request-review'

describe('reviewDecisionToStatus', () => {
  it('sends an approval to delivered', () => {
    expect(reviewDecisionToStatus('approve')).toBe('delivered')
  })

  it('sends a change request back to in_progress', () => {
    expect(reviewDecisionToStatus('changes')).toBe('in_progress')
  })
})

describe('isReviewDecision', () => {
  it('accepts the two decisions', () => {
    expect(isReviewDecision('approve')).toBe(true)
    expect(isReviewDecision('changes')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const bad of ['delivered', 'approved', '', null, undefined, 0, {}]) {
      expect(isReviewDecision(bad)).toBe(false)
    }
  })
})

describe('canReview', () => {
  it('only allows a request sitting in client review', () => {
    expect(canReview(REVIEWABLE_STATUS)).toBe(true)
  })

  it('blocks every other status', () => {
    for (const s of ['draft', 'submitted', 'in_review', 'in_progress', 'on_hold', 'delivered', 'cancelled', 'archived']) {
      expect(canReview(s)).toBe(false)
    }
  })
})

describe('reviewDecisionLabel', () => {
  it('labels each decision', () => {
    expect(reviewDecisionLabel('approve')).toBe('Approved this delivery')
    expect(reviewDecisionLabel('changes')).toBe('Requested changes')
  })
})

describe('buildReviewMessageHtml', () => {
  it('returns a heading only when there is no note', () => {
    expect(buildReviewMessageHtml('approve')).toBe('<p><strong>Approved this delivery</strong></p>')
    expect(buildReviewMessageHtml('changes', '   ')).toBe('<p><strong>Requested changes</strong></p>')
    expect(buildReviewMessageHtml('changes', null)).toBe('<p><strong>Requested changes</strong></p>')
  })

  it('wraps the note in a paragraph after the heading', () => {
    expect(buildReviewMessageHtml('changes', 'The headline is too long.')).toBe(
      '<p><strong>Requested changes</strong></p><p>The headline is too long.</p>',
    )
  })

  it('splits blank-line-separated blocks into paragraphs and single newlines into breaks', () => {
    const html = buildReviewMessageHtml('changes', 'One\ntwo\n\nthree')
    expect(html).toBe('<p><strong>Requested changes</strong></p><p>One<br>two</p><p>three</p>')
  })

  it('escapes HTML in the note so a client cannot inject markup', () => {
    const html = buildReviewMessageHtml('changes', '<script>alert("x")</script> & more')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&amp; more')
  })

  it('truncates a note past the limit', () => {
    const html = buildReviewMessageHtml('changes', 'a'.repeat(REVIEW_NOTE_LIMIT + 500))
    expect(html).toBe(`<p><strong>Requested changes</strong></p><p>${'a'.repeat(REVIEW_NOTE_LIMIT)}</p>`)
  })
})
