import { describe, it, expect } from 'vitest'
import {
  isoDatePlusDays,
  canSubmitRequest,
  submitBlockedReason,
  nextCategoryIndex,
  parseIntakeQuestions,
  toBriefHtml,
  DUE_DATE_DEFAULT_DAYS,
  DUE_DATE_MIN_DAYS,
  type SubmitGateInput,
} from '@/components/tahi/new-request-dialog'
import {
  richBriefPlainText,
  richBriefIsEmpty,
  normaliseBriefHtml,
  plainTextToBriefHtml,
  looksLikeBriefHtml,
} from '@/components/tahi/rich-brief'
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

describe('plainTextToBriefHtml', () => {
  it('wraps a single line in a paragraph', () => {
    expect(plainTextToBriefHtml('Refresh the hero')).toBe('<p>Refresh the hero</p>')
  })

  it('splits blank-line-separated prose into paragraphs', () => {
    expect(plainTextToBriefHtml('First para.\n\nSecond para.'))
      .toBe('<p>First para.</p><p>Second para.</p>')
  })

  it('treats a run of blank lines as one break', () => {
    expect(plainTextToBriefHtml('One\n\n\n\nTwo')).toBe('<p>One</p><p>Two</p>')
  })

  it('keeps a single newline as a line break inside the paragraph', () => {
    expect(plainTextToBriefHtml('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>')
  })

  it('normalises Windows line endings', () => {
    expect(plainTextToBriefHtml('One\r\n\r\nTwo')).toBe('<p>One</p><p>Two</p>')
  })

  it('escapes markup so a stray angle bracket is shown, not parsed', () => {
    expect(plainTextToBriefHtml('Use <div> here')).toBe('<p>Use &lt;div&gt; here</p>')
    expect(plainTextToBriefHtml('Tea & toast')).toBe('<p>Tea &amp; toast</p>')
    expect(plainTextToBriefHtml('He said "go"')).toBe('<p>He said &quot;go&quot;</p>')
  })

  it('escapes the ampersand before the brackets, so entities are not doubled', () => {
    expect(plainTextToBriefHtml('<script>')).toBe('<p>&lt;script&gt;</p>')
  })

  it('reads nothing and whitespace-only as empty', () => {
    expect(plainTextToBriefHtml('')).toBe('')
    expect(plainTextToBriefHtml(null)).toBe('')
    expect(plainTextToBriefHtml(undefined)).toBe('')
    expect(plainTextToBriefHtml('   \n\n  ')).toBe('')
  })

  it('round-trips back through the plain-text reader', () => {
    expect(richBriefPlainText(plainTextToBriefHtml('One\n\nTwo & three'))).toBe('One Two & three')
  })
})

describe('looksLikeBriefHtml', () => {
  it('spots the tags the editor emits', () => {
    expect(looksLikeBriefHtml('<p>Hi</p>')).toBe(true)
    expect(looksLikeBriefHtml('<ul><li>Hi</li></ul>')).toBe(true)
  })

  it('does not mistake prose that mentions a tag for markup', () => {
    expect(looksLikeBriefHtml('Wrap it in a <container> please')).toBe(false)
    expect(looksLikeBriefHtml('Plain words')).toBe(false)
    expect(looksLikeBriefHtml('')).toBe(false)
  })
})

describe('toBriefHtml', () => {
  it('converts the plain text the AI wizard hands back', () => {
    expect(toBriefHtml('Draft one.\n\nDraft two.')).toBe('<p>Draft one.</p><p>Draft two.</p>')
  })

  it('leaves a brief that already carries markup alone', () => {
    expect(toBriefHtml('<p>Already rich</p>')).toBe('<p>Already rich</p>')
  })

  it('reads nothing as empty', () => {
    expect(toBriefHtml(undefined)).toBe('')
    expect(toBriefHtml('')).toBe('')
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
