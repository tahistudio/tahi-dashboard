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
  buildCreateSubRequestBody,
  draftBriefHtml,
  planDraftCreation,
  siblingNote,
  withSiblingNote,
  summariseCreation,
  wizardSubmitControls,
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

describe('wizardSubmitControls', () => {
  const drawer = { isAdminFlow: true, hasContextOrg: false, handsBackToForm: false }

  it('offers both controls on the standalone drawer, which files the request itself', () => {
    expect(wizardSubmitControls(drawer)).toEqual({ clientPicker: true, internalOnly: true })
  })

  it('drops the picker once the caller has already named the client', () => {
    expect(wizardSubmitControls({ ...drawer, hasContextOrg: true }))
      .toEqual({ clientPicker: false, internalOnly: true })
  })

  it('offers neither when a form is waiting for the draft', () => {
    // Hand-back carries title, description, category and type. An internal tick
    // set here would never reach the dialog's submit body, and a client picked
    // here would sit next to the dialog's own empty client field with Create
    // still disabled. The caller owns both.
    expect(wizardSubmitControls({ ...drawer, handsBackToForm: true }))
      .toEqual({ clientPicker: false, internalOnly: false })
    expect(wizardSubmitControls({ ...drawer, hasContextOrg: true, handsBackToForm: true }))
      .toEqual({ clientPicker: false, internalOnly: false })
  })

  it('offers neither on the portal, where the route derives the org and nothing is internal', () => {
    expect(wizardSubmitControls({ ...drawer, isAdminFlow: false }))
      .toEqual({ clientPicker: false, internalOnly: false })
  })
})

describe('planDraftCreation', () => {
  it('files a single draft as itself, no batching machinery involved', () => {
    expect(planDraftCreation(1, true)).toEqual([{ index: 0, role: 'single' }])
    expect(planDraftCreation(1, false)).toEqual([{ index: 0, role: 'single' }])
  })

  it('returns nothing for an empty batch', () => {
    expect(planDraftCreation(0, true)).toEqual([])
  })

  it('nests an admin batch: first draft is the parent, the rest are its sub-requests', () => {
    expect(planDraftCreation(3, true)).toEqual([
      { index: 0, role: 'parent' },
      { index: 1, role: 'sub' },
      { index: 2, role: 'sub' },
    ])
  })

  it('never nests a client batch: the portal has no sub-requests POST, so every draft is a sibling', () => {
    expect(planDraftCreation(3, false)).toEqual([
      { index: 0, role: 'sibling' },
      { index: 1, role: 'sibling' },
      { index: 2, role: 'sibling' },
    ])
  })
})

describe('siblingNote and withSiblingNote', () => {
  const drafts: RequestDraft[] = [
    { ...DRAFT, id: 'a', title: 'Redesign homepage hero' },
    { ...DRAFT, id: 'b', title: 'Write launch blog post' },
    { ...DRAFT, id: 'c', title: 'Fix checkout bug' },
  ]

  it('names every other draft in the batch, not itself', () => {
    expect(siblingNote(drafts, 0)).toBe('Filed together with: Write launch blog post, Fix checkout bug.')
  })

  it('is empty for a lone draft, so a single create never grows an empty note', () => {
    expect(siblingNote([drafts[0]], 0)).toBe('')
  })

  it('folds the note into the description rather than replacing it', () => {
    const noted = withSiblingNote(drafts[0], drafts, 0)
    expect(noted.description).toBe(
      'Replace the hero image and headline.\n\nCopy comes from the client.\n\nFiled together with: Write launch blog post, Fix checkout bug.',
    )
  })

  it('leaves a lone draft unchanged', () => {
    expect(withSiblingNote(drafts[0], [drafts[0]], 0)).toEqual(drafts[0])
  })
})

describe('buildCreateSubRequestBody', () => {
  it('maps the wizard size vocabulary onto the sub-requests route small/large field', () => {
    expect(buildCreateSubRequestBody({ ...DRAFT, type: 'small_task' }).size).toBe('small')
    expect(buildCreateSubRequestBody({ ...DRAFT, type: 'bug_fix' }).size).toBe('small')
    expect(buildCreateSubRequestBody({ ...DRAFT, type: 'large_task' }).size).toBe('large')
    expect(buildCreateSubRequestBody({ ...DRAFT, type: 'new_feature' }).size).toBe('large')
  })

  it('converts the brief to HTML like the top-level create body does', () => {
    const body = buildCreateSubRequestBody(DRAFT)
    expect(body.description).toBe(
      '<p>Replace the hero image and headline.</p><p>Copy comes from the client.</p>',
    )
  })

  it('carries title, category, priority and hours through unchanged', () => {
    const body = buildCreateSubRequestBody(DRAFT)
    expect(body.title).toBe(DRAFT.title)
    expect(body.category).toBe(DRAFT.category)
    expect(body.priority).toBe(DRAFT.priority)
    expect(body.estimatedHours).toBe(DRAFT.estimatedHours)
  })
})

describe('summariseCreation', () => {
  it('reports a single success or failure exactly as before', () => {
    expect(summariseCreation([{ draft: DRAFT, ok: true }])).toBe('Done. Request has been created.')
    expect(summariseCreation([{ draft: DRAFT, ok: false }]))
      .toBe('Failed to create the request. Please try again.')
  })

  it('names every draft on a full batch success, so nobody has to count cards', () => {
    const a = { ...DRAFT, id: 'a', title: 'Redesign homepage hero' }
    const b = { ...DRAFT, id: 'b', title: 'Write launch blog post' }
    const c = { ...DRAFT, id: 'c', title: 'Fix checkout bug' }
    expect(summariseCreation([
      { draft: a, ok: true }, { draft: b, ok: true }, { draft: c, ok: true },
    ])).toBe(
      'Done. All 3 requests have been created: Redesign homepage hero, Write launch blog post, Fix checkout bug.',
    )
  })

  it('names exactly which drafts failed on a partial batch, instead of one generic apology', () => {
    const a = { ...DRAFT, id: 'a', title: 'Redesign homepage hero' }
    const b = { ...DRAFT, id: 'b', title: 'Write launch blog post' }
    expect(summariseCreation([{ draft: a, ok: true }, { draft: b, ok: false }]))
      .toBe('Created 1 of 2 requests. Could not file: Write launch blog post. Try again for those.')
  })

  it('says so plainly when every draft in the batch failed', () => {
    const a = { ...DRAFT, id: 'a' }
    const b = { ...DRAFT, id: 'b' }
    expect(summariseCreation([{ draft: a, ok: false }, { draft: b, ok: false }]))
      .toBe('None of the requests could be created. Try again or fall back to the standard form.')
  })

  it('never uses an em or en dash', () => {
    const a = { ...DRAFT, id: 'a' }
    const text = summariseCreation([{ draft: a, ok: true }])
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(text.includes(String.fromCharCode(0x2013))).toBe(false)
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
