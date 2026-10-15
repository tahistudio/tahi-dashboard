import { describe, expect, it } from 'vitest'
import { fxFreshness } from '@/lib/fx-freshness'

const now = new Date('2026-10-14T12:00:00.000Z')
const day = 86_400_000
const row = (age: number, currency = 'NZD') => ({ currency, updatedAt: new Date(now.getTime() - age * day).toISOString() })

describe('FX freshness for converted cash', () => {
  it('warns about the August cache without changing cash figures', () => {
    expect(fxFreshness([{ currency: 'NZD', updatedAt: '2026-08-10T12:00:00.000Z' }], now))
      .toMatchObject({ stale: true, ageDays: 65, warning: expect.stringContaining('65 days ago') })
  })

  it('warns only after seven days, including a partial eighth day', () => {
    expect(fxFreshness([row(7)], now)).toMatchObject({ stale: false, ageDays: 7, warning: null })
    expect(fxFreshness([row(7 + 1 / day)], now)).toMatchObject({ stale: true, ageDays: 7 })
    expect(fxFreshness([row(6.5)], now)).toMatchObject({ stale: false, warning: null })
  })

  it('uses the oldest rate so a fresh base cannot hide a stale foreign rate', () => {
    expect(fxFreshness([row(1), row(12, 'USD')], now))
      .toMatchObject({ stale: true, ageDays: 12, updatedAt: row(12).updatedAt })
    expect(fxFreshness([row(12), row(1, 'USD')], now).ageDays).toBe(12)
  })

  it.each([
    [],
    [{ currency: 'NZD' }],
    [{ currency: 'NZD', updatedAt: null }],
    [{ currency: 'NZD', updatedAt: 'invalid' }],
    [row(1, 'USD')],
    [row(-1)],
    [row(1), { currency: 'USD', updatedAt: null }],
  ].map(rates => ({ rates })))('warns when a conversion timestamp cannot be trusted: %j', ({ rates }) => {
    expect(fxFreshness(rates, now)).toMatchObject({
      updatedAt: null, ageDays: null, stale: true, warning: expect.stringContaining('unknown'),
    })
  })
})
