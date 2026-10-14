import { describe, expect, it } from 'vitest'
import {
  descriptionBeyondTitle,
  enrichNoteProposal,
  matchOrgsFromText,
  orgAliases,
  relativeDueDate,
  studioDate,
} from '../note-quality'

const AT = new Date('2026-10-14T00:00:00Z')
const ELEVATE = { id: 'elevate', name: 'Telcom Networks Limited trading as Elevate' }

describe('client matching', () => {
  it('matches the legal name and trading name on word boundaries', () => {
    expect(matchOrgsFromText('Send Elevate their invoice', [ELEVATE])).toEqual([ELEVATE])
    expect(matchOrgsFromText(`Send ${ELEVATE.name} their invoice`, [ELEVATE])).toEqual([ELEVATE])
    expect(matchOrgsFromText('Send Elevatesomething an invoice', [ELEVATE])).toEqual([])
  })

  it('matches explicit CRM aliases, short names, brands and full contact names', () => {
    const aliases = orgAliases('{"aliases":["ENZ"],"short_name":"Telcom","industry":"Telecoms"}', '["Elevate NZ"]')
    expect(aliases).toEqual(['ENZ', 'Telcom', 'Elevate NZ'])
    const org = { ...ELEVATE, aliases, contactNames: ['Sam Smith'] }
    for (const mention of ['ENZ', 'Telcom', 'Elevate NZ', 'Sam Smith']) {
      expect(matchOrgsFromText(`Follow up with ${mention}`, [org])).toEqual([ELEVATE])
    }
    expect(matchOrgsFromText('Sam needs an invoice', [org])).toEqual([])
    expect(matchOrgsFromText('Telecoms needs an invoice', [org])).toEqual([])
  })

  it('ignores single-word contact names even when they match the note exactly', () => {
    expect(matchOrgsFromText('Will needs to review', [{ ...ELEVATE, contactNames: ['Will'] }])).toEqual([])
  })

  it('keeps multiple candidates when aliases or contact names collide', () => {
    const other = { id: 'other', name: 'Other Limited', aliases: ['Elevate'], contactNames: ['Sam Smith'] }
    expect(matchOrgsFromText('Send Elevate an invoice', [ELEVATE, other])).toEqual([ELEVATE, { id: 'other', name: 'Other Limited' }])
    expect(matchOrgsFromText('Send Sam Smith the invoice', [{ ...ELEVATE, contactNames: ['Sam Smith'] }, other])).toHaveLength(2)
  })

  it('prefers a fully named organisation but keeps unrelated mentions ambiguous', () => {
    const giant = { id: 'giant', name: 'Giant' }
    const group = { id: 'group', name: 'Giant Group' }
    expect(matchOrgsFromText('Giant Group wants the deck', [giant, group])).toEqual([group])
    expect(matchOrgsFromText('Giant Group and Elevate want the deck', [giant, group, ELEVATE])).toEqual([group, ELEVATE])
  })

  it('suppresses contained names only inside the same mention span', () => {
    const elevate = { id: 'elevate', name: 'Elevate' }
    const health = { id: 'health', name: 'Elevate Health' }
    expect(matchOrgsFromText('Elevate Health wants the deck', [elevate, health])).toEqual([health])
    expect(matchOrgsFromText('Elevate and Elevate Health want the deck', [elevate, health])).toEqual([elevate, health])
    expect(matchOrgsFromText('Elevate Health and Elevate want the deck', [elevate, health])).toEqual([elevate, health])
  })
})

describe('Pacific/Auckland due dates', () => {
  it.each([
    ['by Friday', '2026-10-16'], ['tomorrow', '2026-10-15'],
    ['next week', '2026-10-19'], ['end of month', '2026-10-31'],
    ['by the end of the month', '2026-10-31'],
    ['next  week', '2026-10-19'], ['next\nweek', '2026-10-19'],
  ])('resolves %s', (phrase, expected) => {
    expect(relativeDueDate(`Send the invoice ${phrase}`, AT)).toBe(expected)
  })

  it('uses the NZ date across UTC midnight and the daylight savings transition', () => {
    const localThursday = new Date('2026-10-14T12:30:00Z')
    expect(studioDate(localThursday)).toBe('2026-10-15')
    expect(relativeDueDate('tomorrow', localThursday)).toBe('2026-10-16')
    expect(relativeDueDate('tomorrow', new Date('2026-09-26T12:30:00Z'))).toBe('2026-09-28')
  })

  it('keeps this Friday inclusive and rolls a past Friday forward', () => {
    expect(relativeDueDate('by Friday', new Date('2026-10-16T00:00:00Z'))).toBe('2026-10-16')
    expect(relativeDueDate('by Friday', new Date('2026-10-17T00:00:00Z'))).toBe('2026-10-23')
  })

  it('starts next week on Monday, including on a Monday', () => {
    expect(relativeDueDate('next week', new Date('2026-10-18T00:00:00Z'))).toBe('2026-10-19')
    expect(relativeDueDate('next week', new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-26')
  })

  it.each([
    ['next Monday', '2026-10-19'], ['next Tuesday', '2026-10-20'],
    ['next Wednesday', '2026-10-21'], ['next Thursday', '2026-10-22'],
    ['next Friday', '2026-10-23'], ['next Saturday', '2026-10-24'],
    ['next Sunday', '2026-10-25'],
  ])('resolves %s into the following studio week', (phrase, expected) => {
    expect(relativeDueDate(phrase, AT)).toBe(expected)
  })

  it('keeps next weekday dates in the following week across the Sunday boundary', () => {
    expect(relativeDueDate('next Sunday', new Date('2026-10-17T00:00:00Z'))).toBe('2026-10-25')
    expect(relativeDueDate('next Sunday', new Date('2026-10-18T00:00:00Z'))).toBe('2026-10-25')
    expect(relativeDueDate('next Monday', new Date('2026-10-18T00:00:00Z'))).toBe('2026-10-19')
    expect(relativeDueDate('next Friday', new Date('2026-10-18T00:00:00Z'))).toBe('2026-10-23')
    expect(relativeDueDate('next Friday', new Date('2026-10-16T00:00:00Z'))).toBe('2026-10-23')
  })

  it('handles leap years, year boundaries and conflicting dates', () => {
    expect(relativeDueDate('end of month', new Date('2028-02-13T00:00:00Z'))).toBe('2028-02-29')
    expect(relativeDueDate('tomorrow', new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-01')
    expect(relativeDueDate('tomorrow or by Friday', AT)).toBeNull()
    expect(relativeDueDate('send the invoice', AT)).toBeNull()
  })
})

describe('proposal quality', () => {
  it('drops the repeated invoice sentence while retaining extra detail', () => {
    const title = 'Send Elevate October invoice'
    expect(descriptionBeyondTitle(title, 'Send Elevate their October invoice by Friday.')).toBe('')
    expect(descriptionBeyondTitle(title, 'Send Elevate their October invoice by Friday. Include the PO number from Sam.'))
      .toBe('Include the PO number from Sam.')
    expect(descriptionBeyondTitle(title, 'Send Elevate October invoice: include the PO number.')).toBe('include the PO number.')
    expect(descriptionBeyondTitle(title, 'Use their new billing address.')).toBe('Use their new billing address.')
  })

  it('stores the resolved client and date on a create proposal without duplicated description', () => {
    const proposal = enrichNoteProposal({ kind: 'create_task', at: AT, orgId: ELEVATE.id, choices: [ELEVATE],
      quote: 'send Elevate their October invoice by Friday',
      proposal: { title: 'Send Elevate October invoice', description: 'Send Elevate their October invoice by Friday.', type: 'tahi_internal', orgId: 'invented' },
    })
    expect(proposal).toMatchObject({ orgId: ELEVATE.id, type: 'internal_client_task', dueDate: '2026-10-16', description: '' })
  })

  it('never trusts candidate metadata from the model and preserves server ambiguity', () => {
    const choices = [ELEVATE, { id: 'other', name: 'Other Elevate' }]
    const proposal = enrichNoteProposal({ kind: 'create_task', at: AT, orgId: null, choices,
      quote: 'send Elevate their invoice', proposal: { title: 'Send invoice', slackClientChoices: [{ id: 'invented', name: 'Invented' }] },
    })
    expect(proposal).toMatchObject({ orgId: null, type: 'tahi_internal', slackClientChoices: choices })
  })

  it('stores even one unresolved contact-name choice for sender confirmation', () => {
    const proposal = enrichNoteProposal({ kind: 'create_task', at: AT, orgId: null, choices: [ELEVATE],
      quote: 'Send Sam Smith the invoice', proposal: { title: 'Send invoice', orgId: 'invented' },
    })
    expect(proposal).toMatchObject({ orgId: null, type: 'tahi_internal', slackClientChoices: [ELEVATE] })
  })

  it('parses dates into update fields and does not invent one without relative date words', () => {
    expect(enrichNoteProposal({ kind: 'update_task', at: AT, orgId: null, choices: [], quote: 'Move this to Friday',
      proposal: { fields: { status: 'in_progress' } } })).toMatchObject({ fields: { status: 'in_progress', dueDate: '2026-10-16' } })
    expect(enrichNoteProposal({ kind: 'create_task', at: AT, orgId: null, choices: [], quote: 'Send invoice',
      proposal: { title: 'Send invoice' } }).dueDate).toBeUndefined()
  })

  it('removes a guessed model date if the note contains conflicting relative dates', () => {
    for (const kind of ['create_task', 'update_task']) {
      const proposal = enrichNoteProposal({ kind, at: AT, orgId: null, choices: [],
        quote: 'Send invoice tomorrow or Friday', proposal: { title: 'Send invoice', dueDate: '2026-10-15', fields: { dueDate: '2026-10-15' } },
      })
      if (kind === 'create_task') expect(proposal.dueDate).toBeUndefined()
      else expect((proposal.fields as Record<string, unknown>).dueDate).toBeUndefined()
    }
  })
})
