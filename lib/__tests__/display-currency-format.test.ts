/**
 * What a pinned client actually reads on a money figure.
 *
 * One currency per figure, always. The two shapes this rules out are the two
 * that were on the table: a bare converted figure (`US$882`, a price nobody
 * charges printed as though it were the price) and a two-currency string
 * (`NZ$1,500 ≈ US$882`, which roughly doubles the width of every KPI tile and
 * table cell on a surface that has to work at 375px).
 */
import { describe, it, expect } from 'vitest'
import {
  APPROX_MARKER,
  formatPinnedBaseAmount,
  type ExchangeRate,
} from '@/lib/currency'

// rateToUsd = units of the currency per 1 USD. NZD 1.70, so NZ$1,500 is
// USD 1500 / 1.70 = ~882.
const RATES: ExchangeRate[] = [
  { currency: 'NZD', rateToUsd: 1.7 },
  { currency: 'USD', rateToUsd: 1 },
  { currency: 'AUD', rateToUsd: 1.55 },
]

describe('formatPinnedBaseAmount', () => {
  it('converts into the client currency and marks it approximate', () => {
    expect(formatPinnedBaseAmount(1500, 'USD', RATES, true)).toBe(`${APPROX_MARKER}US$882`)
  })

  it('never prints two currencies in one figure', () => {
    const out = formatPinnedBaseAmount(1500, 'USD', RATES, true)
    expect(out).not.toContain('NZ$')
    expect(out.match(/\$/g)).toHaveLength(1)
  })

  it('never prints a converted figure without the marker', () => {
    const out = formatPinnedBaseAmount(1500, 'AUD', RATES, true)
    expect(out.startsWith(APPROX_MARKER)).toBe(true)
  })

  it('keeps the marker glued to its figure', () => {
    // U+00A0, so a narrow column cannot wrap the approximation away from the
    // number and leave a bare price behind.
    expect(APPROX_MARKER).toBe('≈ ')
    expect(formatPinnedBaseAmount(1500, 'USD', RATES, true)).not.toContain('≈ ')
  })

  it('leaves an NZD-pinned client on the exact base figure, unmarked', () => {
    // Their money IS the base currency. Nothing is approximate about it.
    expect(formatPinnedBaseAmount(1500, 'NZD', RATES, true)).toBe('NZ$1,500')
  })

  it('prints the exact base figure while rates are still loading', () => {
    // The conversion would be the identity, and 1500 wearing a US$ symbol is a
    // lie rather than an approximation.
    expect(formatPinnedBaseAmount(1500, 'USD', RATES, false)).toBe('NZ$1,500')
  })

  it('prints the exact base figure when the pair has no rate', () => {
    expect(formatPinnedBaseAmount(1500, 'USD', [], true)).toBe('NZ$1,500')
    expect(formatPinnedBaseAmount(1500, 'GBP', RATES, true)).toBe('NZ$1,500')
  })

  it('passes decimals through for line-item precision', () => {
    expect(formatPinnedBaseAmount(1500, 'USD', RATES, true, { decimals: 2 }))
      .toBe(`${APPROX_MARKER}US$882.35`)
  })
})
