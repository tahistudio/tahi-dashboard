/**
 * The AI request wizard's pure rules.
 *
 * The outbound create body is the interesting one: the panel used to send the
 * client org under `orgId`, which POST /api/admin/requests never reads, so
 * every AI create 400d with "clientOrgId and title are required" and nothing
 * was ever written. It also posted the model's plain prose straight into
 * `requests.description`, which the detail page renders as HTML, collapsing
 * every paragraph break. Both are asserted here so the field names cannot
 * drift again without a red test.
 */
import { describe, it, expect } from 'vitest'
import {
  buildCreateRequestBody,
  draftBriefHtml,
  DEGRADED_PREFIX,
  type RequestDraft,
} from '@/components/tahi/ai-request-wizard'

const DRAFT: RequestDraft = {
  id: 'draft_abc12345',
  title: 'Redesign the homepage hero',
  description: 'Replace the hero image and headline.\n\nCopy comes from the client.',
  category: 'design',
  type: 'small_task',
  priority: 'standard',
  estimatedHours: 8,
}

describe('draftBriefHtml', () => {
  it('wraps plain prose into paragraphs so the brief keeps its breaks', () => {
    expect(draftBriefHtml('One line.\n\nTwo lines.')).toBe('<p>One line.</p><p>Two lines.</p>')
  })

  it('keeps a single newline as a line break inside one paragraph', () => {
    expect(draftBriefHtml('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>')
  })

  it('leaves a value that is already brief HTML alone', () => {
    expect(draftBriefHtml('<p>Already HTML</p>')).toBe('<p>Already HTML</p>')
  })

  it('escapes markup the model may have written as text', () => {
    expect(draftBriefHtml('a < b & c')).toBe('<p>a &lt; b &amp; c</p>')
  })

  it('returns an empty string for an empty draft', () => {
    expect(draftBriefHtml('')).toBe('')
    expect(draftBriefHtml(null)).toBe('')
  })
})

describe('buildCreateRequestBody, admin flow', () => {
  it('sends the client org under clientOrgId, the key the route reads', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'admin', clientOrgId: 'org_1' })
    expect(body.clientOrgId).toBe('org_1')
    expect(body).not.toHaveProperty('orgId')
  })

  it('converts the brief to HTML rather than posting raw prose', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'admin', clientOrgId: 'org_1' })
    expect(body.description).toBe(
      '<p>Replace the hero image and headline.</p><p>Copy comes from the client.</p>',
    )
  })

  it('carries the rest of the draft through unchanged', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'admin', clientOrgId: 'org_1' })
    expect(body.title).toBe('Redesign the homepage hero')
    expect(body.category).toBe('design')
    expect(body.priority).toBe('standard')
    expect(body.estimatedHours).toBe(8)
  })

  it('does not mark the request internal unless the person ticked it', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'admin', clientOrgId: 'org_1' })
    expect(body).not.toHaveProperty('isInternal')
  })

  it('marks it internal when the person did tick it', () => {
    const body = buildCreateRequestBody({
      draft: DRAFT, speaker: 'admin', clientOrgId: 'org_1', internalOnly: true,
    })
    expect(body.isInternal).toBe(true)
  })

  it('maps every size above a small task onto large', () => {
    for (const type of ['large_task', 'new_feature'] as const) {
      const body = buildCreateRequestBody({ draft: { ...DRAFT, type }, speaker: 'admin', clientOrgId: 'o' })
      expect(body.type).toBe('large_task')
    }
    for (const type of ['small_task', 'bug_fix'] as const) {
      const body = buildCreateRequestBody({ draft: { ...DRAFT, type }, speaker: 'admin', clientOrgId: 'o' })
      expect(body.type).toBe('small_task')
    }
  })
})

describe('buildCreateRequestBody, portal flow', () => {
  it('sends no org at all: the route derives it from the caller session', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'client' })
    expect(body).not.toHaveProperty('clientOrgId')
    expect(body).not.toHaveProperty('orgId')
  })

  it('never marks a client request internal, even if asked to', () => {
    const body = buildCreateRequestBody({ draft: DRAFT, speaker: 'client', internalOnly: true })
    expect(body).not.toHaveProperty('isInternal')
  })
})

describe('DEGRADED_PREFIX', () => {
  it('says the model was not reached, in plain words and with no dashes', () => {
    expect(DEGRADED_PREFIX).toMatch(/unavailable/i)
    // House rule: no em or en dash anywhere, including in copy the client reads.
    expect(DEGRADED_PREFIX.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(DEGRADED_PREFIX.includes(String.fromCharCode(0x2013))).toBe(false)
  })
})
