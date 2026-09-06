/**
 * Which currency a session pins, and what a stored column is allowed to mean.
 *
 * The pin decides the shell a CLIENT reads their own money in, so it may not
 * be talked into a currency nobody chose. `organisations.preferred_currency`
 * is `DEFAULT 'USD'` and the New client dialog's route used to omit it, so on
 * the staging snapshot 22 of 28 active orgs hold a bare 'USD' while every one
 * of them records its MRR in NZD. Reading that column on its own is therefore
 * the bug, not the feature, and these cases are the rule that replaces it.
 *
 * The resolver lives in lib/currency.ts, not in the provider module: the
 * dashboard layout is a server component and calls it, and a server module may
 * never import a value from a 'use client' file.
 */
import { describe, it, expect } from 'vitest'
import {
  asCurrencyCode,
  BASE_CURRENCY,
  resolvePinnedCurrency,
  UNCHOSEN_PREFERRED_CURRENCY,
} from '@/lib/currency'

describe('resolvePinnedCurrency', () => {
  it('leaves a studio session unpinned: preference, switcher, conversions', () => {
    expect(resolvePinnedCurrency({ preferredCurrency: 'USD' }, false)).toBeNull()
    expect(resolvePinnedCurrency({ preferredCurrency: 'GBP' }, false)).toBeNull()
    expect(resolvePinnedCurrency({}, false)).toBeNull()
  })

  it('pins a client to a currency somebody actually chose', () => {
    // Anything other than the schema default had to be written by hand.
    expect(resolvePinnedCurrency({ preferredCurrency: 'aud' }, true)).toBe('AUD')
    expect(resolvePinnedCurrency({ preferredCurrency: '  GBP  ' }, true)).toBe('GBP')
  })

  it('refuses to read the schema default as a decision', () => {
    // The exact shape of a row created by the New client dialog before the
    // route started writing the column: a bare 'USD' over NZD money.
    expect(UNCHOSEN_PREFERRED_CURRENCY).toBe('USD')
    expect(resolvePinnedCurrency({ preferredCurrency: 'USD' }, true)).toBe(BASE_CURRENCY)
    expect(
      resolvePinnedCurrency({ preferredCurrency: 'USD', customMrrCurrency: 'NZD' }, true),
    ).toBe(BASE_CURRENCY)
  })

  it('trusts a bare USD once the MRR currency corroborates it', () => {
    expect(
      resolvePinnedCurrency({ preferredCurrency: 'USD', customMrrCurrency: 'USD' }, true),
    ).toBe('USD')
  })

  it('lets a non-base MRR currency name the pin on its own', () => {
    // custom_mrr_currency defaults to the base, so a non-base value there is
    // something a person typed into the client's Money card.
    expect(resolvePinnedCurrency({ customMrrCurrency: 'GBP' }, true)).toBe('GBP')
    expect(
      resolvePinnedCurrency({ preferredCurrency: 'USD', customMrrCurrency: 'gbp' }, true),
    ).toBe('GBP')
  })

  it('falls back to the NZD base, never to USD and never to unpinned', () => {
    // An unreadable row is the same case as an unset one: pin the base, do not
    // hand the client a switcher over their own money or leave it on whatever
    // this browser last chose.
    expect(resolvePinnedCurrency({}, true)).toBe('NZD')
    expect(resolvePinnedCurrency({ preferredCurrency: null }, true)).toBe('NZD')
    expect(resolvePinnedCurrency({ preferredCurrency: undefined }, true)).toBe('NZD')
    expect(resolvePinnedCurrency({ preferredCurrency: '' }, true)).toBe('NZD')
  })

  it('falls back to the base for a code we do not understand', () => {
    expect(resolvePinnedCurrency({ preferredCurrency: 'XYZ' }, true)).toBe('NZD')
    expect(resolvePinnedCurrency({ customMrrCurrency: 'XYZ' }, true)).toBe('NZD')
    expect(asCurrencyCode('XYZ')).toBeNull()
  })
})
