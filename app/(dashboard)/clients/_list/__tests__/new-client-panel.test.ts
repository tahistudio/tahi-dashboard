import { describe, it, expect } from 'vitest'
import {
  EMPTY_CLIENT_DRAFT,
  canSubmitDraft,
  draftContactName,
  isDraftEmailValid,
  type NewClientDraft,
} from '../new-client-panel'

function draft(over: Partial<NewClientDraft> = {}): NewClientDraft {
  return { ...EMPTY_CLIENT_DRAFT, name: 'Kowtow', ...over }
}

describe('draftContactName', () => {
  it('joins the two fields into the one name the endpoint takes', () => {
    expect(draftContactName(draft({
      primaryContactFirstName: 'Jane',
      primaryContactLastName: 'Smith',
    }))).toBe('Jane Smith')
  })

  it('trims each side, so the greeting never opens on a space', () => {
    expect(draftContactName(draft({
      primaryContactFirstName: '  Jane ',
      primaryContactLastName: ' Smith  ',
    }))).toBe('Jane Smith')
  })

  it('sends a first name on its own, which is all the email actually greets on', () => {
    expect(draftContactName(draft({ primaryContactFirstName: 'Jane' }))).toBe('Jane')
  })

  it('sends a surname on its own without a leading gap', () => {
    expect(draftContactName(draft({ primaryContactLastName: 'Smith' }))).toBe('Smith')
  })

  it('returns an empty string when neither is filled, so the route still falls back to the address', () => {
    expect(draftContactName(draft())).toBe('')
    expect(draftContactName(draft({ primaryContactFirstName: '   ' }))).toBe('')
  })

  it('keeps a two-part surname together rather than dropping it', () => {
    expect(draftContactName(draft({
      primaryContactFirstName: 'Aroha',
      primaryContactLastName: 'Te Rangi',
    }))).toBe('Aroha Te Rangi')
  })
})

describe('what the panel will let you submit', () => {
  it('still asks for a client name and nothing else', () => {
    expect(canSubmitDraft(draft({ name: '' }))).toBe(false)
    expect(canSubmitDraft(draft())).toBe(true)
  })

  it('does not make either name field a condition of creating a client', () => {
    expect(canSubmitDraft(draft({
      primaryContactFirstName: '',
      primaryContactLastName: '',
      primaryContactEmail: 'jane@kowtow.co.nz',
    }))).toBe(true)
  })

  it('still refuses an address that is not one', () => {
    expect(isDraftEmailValid(draft({ primaryContactEmail: 'jane@kowtow' }))).toBe(false)
    expect(canSubmitDraft(draft({ primaryContactEmail: 'jane@kowtow' }))).toBe(false)
    expect(isDraftEmailValid(draft({ primaryContactEmail: '' }))).toBe(true)
  })
})
