/**
 * Currency aggregation invariants.
 *
 * Regression guard for the mixed-currency MRR bug (2026-04-14): financial
 * aggregates were summing native amounts from GBP/USD/NZD invoices as if
 * they were the same unit, silently inflating the displayed MRR. Each
 * amount MUST be passed through toNzd() before summing.
 *
 * rateToUsd semantics: "units of [currency] per 1 USD".
 *   rateToUsd[NZD] = 1.67  means  1 USD = 1.67 NZD
 *   rateToUsd[GBP] = 0.80  means  1 USD = 0.80 GBP  (i.e. 1 GBP = 1.25 USD)
 *
 * Therefore to convert 100 GBP → NZD:
 *   100 GBP × (1 USD / 0.80 GBP) × (1.67 NZD / 1 USD)
 *   = 125 USD × 1.67
 *   = 208.75 NZD
 */

import { describe, it, expect } from 'vitest'
import {
  buildRateMap,
  toNzd,
  sumAsNzd,
  convertToNzd,
  type ExchangeRate,
} from '../currency'

const RATES: ExchangeRate[] = [
  { currency: 'NZD', rateToUsd: 1.67 },
  { currency: 'USD', rateToUsd: 1.0 },
  { currency: 'GBP', rateToUsd: 0.80 },
  { currency: 'EUR', rateToUsd: 0.92 },
  { currency: 'AUD', rateToUsd: 1.52 },
]

describe('buildRateMap', () => {
  it('gives NZD rate of 1', () => {
    const map = buildRateMap(RATES)
    expect(map.NZD).toBe(1)
  })

  it('encodes "units of [C] per 1 NZD" for non-NZD currencies', () => {
    const map = buildRateMap(RATES)
    // 1 NZD = ~0.60 USD (since 1 USD = 1.67 NZD)
    expect(map.USD).toBeCloseTo(1 / 1.67, 5)
    // 1 NZD = ~0.48 GBP
    expect(map.GBP).toBeCloseTo(0.80 / 1.67, 5)
  })

  it('still returns a usable map when NZD is missing (with NZD=1 fallback)', () => {
    const withoutNzd = RATES.filter(r => r.currency !== 'NZD')
    const map = buildRateMap(withoutNzd)
    expect(map.NZD).toBe(1)
    // With the fallback (nzdRateToUsd = 1), USD map value = 1
    expect(map.USD).toBe(1)
  })
})

describe('toNzd', () => {
  const map = buildRateMap(RATES)

  it('returns NZD amounts unchanged', () => {
    expect(toNzd(500, 'NZD', map)).toBe(500)
  })

  it('converts GBP to NZD using realistic rates', () => {
    // 100 GBP -> ~208.75 NZD
    expect(toNzd(100, 'GBP', map)).toBeCloseTo(208.75, 2)
  })

  it('converts USD to NZD using realistic rates', () => {
    // 100 USD -> 167 NZD
    expect(toNzd(100, 'USD', map)).toBeCloseTo(167, 2)
  })

  it('returns unknown currency unconverted rather than NaN', () => {
    expect(toNzd(100, 'XYZ', map)).toBe(100)
  })

  it('treats zero-rate currencies as unknown', () => {
    const badMap = { ...map, ZZZ: 0 }
    expect(toNzd(100, 'ZZZ', badMap)).toBe(100)
  })

  it('returns 0 for non-finite input', () => {
    expect(toNzd(NaN, 'USD', map)).toBe(0)
    expect(toNzd(Infinity, 'USD', map)).toBe(0)
  })
})

describe('sumAsNzd — the bug this suite exists to catch', () => {
  const map = buildRateMap(RATES)

  it('sums mixed-currency rows correctly', () => {
    // Mimics the actual MRR scenario from 2026-04-14
    const rows = [
      { amount: 3125, currency: 'GBP' }, // Physitrack
      { amount: 1250, currency: 'GBP' }, // Glasswall
      { amount: 1075, currency: 'GBP' }, // Elevate
      { amount: 500,  currency: 'GBP' }, // BCS
      { amount: 1200, currency: 'USD' }, // Stride
    ]

    const nzdTotal = sumAsNzd(rows, r => r, map)

    // Hand calculation (using 1.67 NZD/USD, 0.80 GBP/USD):
    //   GBP total = 5950 GBP × (1/0.80) × 1.67 = 5950 × 2.0875 = 12420.625 NZD
    //   USD total = 1200 × 1.67 = 2004 NZD
    //   Total = 14424.625 NZD
    expect(nzdTotal).toBeCloseTo(14424.625, 2)
  })

  it('does NOT equal the raw sum of native amounts', () => {
    const rows = [
      { amount: 1000, currency: 'GBP' },
      { amount: 1000, currency: 'NZD' },
    ]
    const nzdTotal = sumAsNzd(rows, r => r, map)
    const rawSum = 2000
    // If these were equal, the aggregation bug would be back.
    expect(nzdTotal).not.toBe(rawSum)
    // 1000 GBP = ~2087.5 NZD, + 1000 NZD = 3087.5 NZD
    expect(nzdTotal).toBeCloseTo(3087.5, 2)
  })

  it('handles an empty list', () => {
    expect(sumAsNzd([], (r: { amount: number; currency: string }) => r, map)).toBe(0)
  })
})

describe('convertToNzd (legacy wrapper) matches toNzd', () => {
  const map = buildRateMap(RATES)

  it.each([
    { amount: 100, currency: 'GBP' },
    { amount: 1200, currency: 'USD' },
    { amount: 500, currency: 'EUR' },
    { amount: 750, currency: 'AUD' },
    { amount: 2500, currency: 'NZD' },
  ])('agrees on %s conversion', ({ amount, currency }) => {
    const viaMap = toNzd(amount, currency, map)
    const viaLegacy = convertToNzd(amount, currency, RATES)
    expect(viaMap).toBeCloseTo(viaLegacy, 4)
  })
})
