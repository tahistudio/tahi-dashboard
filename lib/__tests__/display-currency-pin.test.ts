/**
 * Which currency a session pins, and what that pin is allowed to mean.
 *
 * Pinning the DISPLAY currency does not make an NZD-base amount a native one.
 * `format()` takes an amount already expressed in NZD (plan rates, catalogue
 * prices, totals), so a pinned client reads it converted into their currency
 * with an approximate marker in front of it, never as a bare figure and never
 * as two currencies in one string. The rule this file can test without a
 * render is the one that picks the pin; the marker is covered by
 * display-currency-format.test.ts.
 *
 * The resolver lives in lib/currency.ts, not in the provider module: the
 * dashboard layout is a server component and calls it, and a server module may
 * never import a value from a 'use client' file.
 */
import { describe, it, expect } from 'vitest'
import { resolvePinnedCurrency, asCurrencyCode } from '@/lib/currency'

describe('resolvePinnedCurrency', () => {
  it('leaves a studio session unpinned: preference, switcher, conversions', () => {
    expect(resolvePinnedCurrency('USD', false)).toBeNull()
    expect(resolvePinnedCurrency(null, false)).toBeNull()
  })

  it('pins a client to the currency they are billed in', () => {
    expect(resolvePinnedCurrency('USD', true)).toBe('USD')
    expect(resolvePinnedCurrency('aud', true)).toBe('AUD')
    expect(resolvePinnedCurrency('  GBP  ', true)).toBe('GBP')
  })

  it('falls back to the NZD base, never to USD or to unpinned', () => {
    // organisations.preferred_currency defaults to 'USD' in the schema while
    // every other read in the codebase falls back to 'NZD', so an unset column
    // must not flip a NZ client to US$. An unreadable row (null) is the same
    // case: pin the base, do not hand the client a switcher over their own
    // money or leave it on whatever this browser last chose.
    expect(resolvePinnedCurrency(null, true)).toBe('NZD')
    expect(resolvePinnedCurrency(undefined, true)).toBe('NZD')
    expect(resolvePinnedCurrency('', true)).toBe('NZD')
  })

  it('falls back to the base for a code we do not understand', () => {
    expect(resolvePinnedCurrency('XYZ', true)).toBe('NZD')
    expect(asCurrencyCode('XYZ')).toBeNull()
  })
})
