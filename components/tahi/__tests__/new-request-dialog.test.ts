import { describe, it, expect } from 'vitest'
import {
  isoDatePlusDays,
  canSubmitRequest,
  submitBlockedReason,
  nextCategoryIndex,
  parseIntakeQuestions,
  DUE_DATE_DEFAULT_DAYS,
  DUE_DATE_MIN_DAYS,
  type SubmitGateInput,
} from '@/components/tahi/new-request-dialog'
import { richBriefPlainText, richBriefIsEmpty, normaliseBriefHtml } from '@/components/tahi/rich-brief'
import { aiWizardProgress, openerForCategory, AI_MIN_STEPS } from '@/components/tahi/ai-request-wizard'

// The repo's Vitest runs in the `node` environment with no DOM, so these cover
// the pure rules the dialog delegates its decisions to. The interactive half
// (the modal opening, the tiles, the segmented size control) is covered in
// e2e/requests-dialog.spec.ts.

describe('isoDatePlusDays', () => {
  it('defaults the ideal due date to a week out', () => {
    const from = new Date(2026, 8, 3) // 3 September 2026, local
    expect(isoDatePlusDays(DUE_DATE_DEFAULT_DAYS, from)).toBe('2026-09-10')
  })

  it('floors the picker at tomorrow', () => {
    const from = new Date(2026, 8, 3)
    expect(isoDatePlusDays(DUE_DATE_MIN_DAYS, from)).toBe('2026-09-04')
  })

  it('rolls over a month end', () => {
    expect(isoDatePlusDays(7, new Date(2026, 8, 28))).toBe('2026-10-05')
  })

  it('rolls over a year end', () => {
    expect(isoDatePlusDays(1, new Date(2026, 11, 31))).toBe('2027-01-01')
  })

  it('pads single-digit months and days', () => {
    expect(isoDatePlusDays(0, new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('reads the local calendar, not UTC, so late-evening dates do not slip', () => {
    const lateEvening = new Date(2026, 8, 3, 23, 30, 0)
    expect(isoDatePlusDays(1, lateEvening)).toBe('2026-09-04')
  })
})

describe('canSubmitRequest', () => {
  const team = (over: Partial<SubmitGateInput> = {}): SubmitGateInput => ({
    title: 'Homepage refresh',
    brief: '',
    audience: 'team',
    clientChosen: true,
    ...over,
  })
  const client = (over: Partial<SubmitGateInput> = {}): SubmitGateInput => ({
    title: 'Homepage refresh',
    brief: '<p>Our hero looks tired.</p>',
    audience: 'client',
    clientChosen: true,
    ...over,
  })

  it('needs a title on both paths', () => {
    expect(canSubmitRequest(team({ title: '   ' }))).toBe(false)
    expect(canSubmitRequest(client({ title: '' }))).toBe(false)
  })

  it('lets the team file with an empty brief', () => {
    expect(canSubmitRequest(team())).toBe(true)
  })

  it('blocks the team until a client is chosen', () => {
    expect(canSubmitRequest(team({ clientChosen: false }))).toBe(false)
  })

  it('blocks a client until the brief has words', () => {
    expect(canSubmitRequest(client({ brief: '' }))).toBe(false)
    expect(canSubmitRequest(client({ brief: '<p></p>' }))).toBe(false)
    expect(canSubmitRequest(client({ brief: '<ul><li>  </li></ul>' }))).toBe(false)
    expect(canSubmitRequest(client())).toBe(true)
  })

  it('counts a bulleted brief with no paragraph as written', () => {
    expect(canSubmitRequest(client({ brief: '<ul><li>New hero image</li></ul>' }))).toBe(true)
  })

  it('does not ask a client for a client', () => {
    expect(canSubmitRequest(client({ clientChosen: false }))).toBe(true)
  })
})

describe('submitBlockedReason', () => {
  it('says nothing when submit is live', () => {
    expect(submitBlockedReason({ title: 'A', brief: '', audience: 'team', clientChosen: true })).toBeUndefined()
  })

  it('asks for the title before anything else', () => {
    expect(submitBlockedReason({ title: '', brief: '', audience: 'team', clientChosen: false }))
      .toBe('Add a title first')
  })

  it('asks the team for a client', () => {
    expect(submitBlockedReason({ title: 'A', brief: '', audience: 'team', clientChosen: false }))
      .toBe('Pick a client first')
  })

  it('asks a client for the brief', () => {
    expect(submitBlockedReason({ title: 'A', brief: '', audience: 'client', clientChosen: true }))
      .toBe('Tell us a little about what you need')
  })
})

describe('nextCategoryIndex', () => {
  it('cycles right and wraps', () => {
    expect(nextCategoryIndex(6, 0, 'ArrowRight')).toBe(1)
    expect(nextCategoryIndex(6, 5, 'ArrowRight')).toBe(0)
  })

  it('cycles left and wraps', () => {
    expect(nextCategoryIndex(6, 0, 'ArrowLeft')).toBe(5)
  })

  it('maps the vertical arrows onto the same cycle', () => {
    expect(nextCategoryIndex(6, 2, 'ArrowDown')).toBe(3)
    expect(nextCategoryIndex(6, 2, 'ArrowUp')).toBe(1)
  })

  it('jumps to the ends', () => {
    expect(nextCategoryIndex(6, 3, 'Home')).toBe(0)
    expect(nextCategoryIndex(6, 3, 'End')).toBe(5)
  })

  it('ignores keys it does not own', () => {
    expect(nextCategoryIndex(6, 3, 'Enter')).toBeNull()
    expect(nextCategoryIndex(6, 3, 'a')).toBeNull()
  })
})

describe('parseIntakeQuestions', () => {
  const question = { id: 'q1', type: 'text', label: 'Which page?', required: true }

  it('takes the questions already parsed', () => {
    expect(parseIntakeQuestions([question])).toEqual([question])
  })

  it('takes them as a JSON string', () => {
    expect(parseIntakeQuestions(JSON.stringify([question]))).toEqual([question])
  })

  it('renders nothing rather than throwing on broken JSON', () => {
    expect(parseIntakeQuestions('{not json')).toEqual([])
  })

  it('renders nothing when the form resolves to something that is not a list', () => {
    expect(parseIntakeQuestions('{"a":1}')).toEqual([])
    expect(parseIntakeQuestions(undefined)).toEqual([])
    expect(parseIntakeQuestions('')).toEqual([])
  })
})

describe('richBriefPlainText', () => {
  it('drops tags and collapses whitespace', () => {
    expect(richBriefPlainText('<p>Hello <strong>there</strong></p>')).toBe('Hello there')
  })

  it('decodes the entities Tiptap emits', () => {
    expect(richBriefPlainText('<p>Tea &amp; toast</p>')).toBe('Tea & toast')
    expect(richBriefPlainText('<p>&lt;script&gt;</p>')).toBe('<script>')
  })

  it('treats nullish as empty', () => {
    expect(richBriefPlainText(null)).toBe('')
    expect(richBriefPlainText(undefined)).toBe('')
  })

  it('reads an empty Tiptap document as empty', () => {
    expect(richBriefIsEmpty('<p></p>')).toBe(true)
    expect(richBriefIsEmpty('<p>&nbsp;</p>')).toBe(true)
    expect(richBriefIsEmpty('<p>x</p>')).toBe(false)
  })
})

describe('normaliseBriefHtml', () => {
  it('flattens an empty document to the empty string', () => {
    expect(normaliseBriefHtml('<p></p>')).toBe('')
  })

  it('leaves a real brief alone', () => {
    expect(normaliseBriefHtml('<p>Real</p>')).toBe('<p>Real</p>')
  })
})

describe('aiWizardProgress', () => {
  it('starts empty over the minimum interview length', () => {
    expect(aiWizardProgress(0, false)).toEqual({ percent: 0, label: `0 / ${AI_MIN_STEPS}` })
  })

  it('always leaves a step to go while the model is still asking', () => {
    expect(aiWizardProgress(1, false).label).toBe('1 / 3')
    expect(aiWizardProgress(3, false).label).toBe('3 / 4')
    expect(aiWizardProgress(3, false).percent).toBe(75)
  })

  it('fills once a draft lands', () => {
    expect(aiWizardProgress(2, true)).toEqual({ percent: 100, label: 'Draft ready' })
  })

  it('clamps nonsense input', () => {
    expect(aiWizardProgress(-4, false)).toEqual({ percent: 0, label: `0 / ${AI_MIN_STEPS}` })
  })
})

describe('openerForCategory', () => {
  it('seeds the opener from the category chosen in the form', () => {
    expect(openerForCategory('design')).toContain('designing')
    expect(openerForCategory('bug')).toContain('going wrong')
  })

  it('falls back for an unknown or missing category', () => {
    expect(openerForCategory('nonsense')).toBe(openerForCategory(undefined))
    expect(openerForCategory(null)).toBe(openerForCategory(undefined))
  })
})
