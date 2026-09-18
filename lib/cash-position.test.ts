import { describe, it, expect } from 'vitest'
import {
  derivePosition,
  cadenceToMonthlyNzd,
  formatCompactNzd,
  cashFlowBasisLine,
  type CashPositionInput,
} from '@/lib/cash-position'

/**
 * The live production figures traced on 2026-09-19. Every expectation in the
 * first block is the number Liam should see on the studio home after this
 * slice lands, so a regression here is a regression on the real screen.
 */
const LIVE: CashPositionInput = {
  totalCashNzd: 76123,
  taxOwedNzd: 24242.68,
  taxPotNzd: 15000,
  otherReservesNzd: 0,
  recurringBurnNzd: 14258,
  projectRunRateNzd: 17093,
  retainerMrrNzd: 10317,
}

describe('derivePosition, live production figures', () => {
  it('never deducts the tax pot on top of the tax bill it is saving toward', () => {
    const p = derivePosition(LIVE)
    // 76,123 - 24,242.68 (the bill, which the 15k pot is part of) - 0
    expect(p.disposableNzd).toBeCloseTo(51880.32, 2)
    expect(p.ringFencedTaxNzd).toBeCloseTo(24242.68, 2)
    expect(p.unreservedTaxNzd).toBeCloseTo(9242.68, 2)
  })

  it('reports gross runway as "if revenue stopped" on tax-adjusted cash', () => {
    const p = derivePosition(LIVE)
    expect(p.taxAdjustedCashNzd).toBeCloseTo(51880.32, 2)
    expect(p.grossRunwayMonths).toBeCloseTo(3.64, 2)
  })

  it('adds the trailing project run-rate to retainer MRR for effective revenue', () => {
    const p = derivePosition(LIVE)
    expect(p.effectiveMonthlyRevenueNzd).toBeCloseTo(27410, 2)
    expect(p.monthlySurplusNzd).toBeCloseTo(13152, 2)
  })

  it('returns a null net runway while the studio is in surplus', () => {
    const p = derivePosition(LIVE)
    expect(p.netMonthlyBurnNzd).toBe(0)
    expect(p.netRunwayMonths).toBeNull()
  })
})

describe('derivePosition, edges', () => {
  it('ring-fences the pot when it already exceeds the assessed bill', () => {
    const p = derivePosition({ ...LIVE, taxOwedNzd: 0, taxPotNzd: 15000 })
    expect(p.ringFencedTaxNzd).toBe(15000)
    expect(p.unreservedTaxNzd).toBe(0)
    expect(p.disposableNzd).toBeCloseTo(61123, 2)
  })

  it('deducts non-tax reserve pots on top of the tax ring-fence', () => {
    const p = derivePosition({ ...LIVE, otherReservesNzd: 5000 })
    expect(p.disposableNzd).toBeCloseTo(46880.32, 2)
    // The buffer pot is spent cash for disposable purposes but still counts
    // as runway, so gross runway does not move.
    expect(p.grossRunwayMonths).toBeCloseTo(3.64, 2)
  })

  it('floors disposable at zero rather than going negative', () => {
    const p = derivePosition({ ...LIVE, totalCashNzd: 5000 })
    expect(p.disposableNzd).toBe(0)
    expect(p.taxAdjustedCashNzd).toBe(0)
  })

  it('returns a null gross runway when no burn is configured', () => {
    const p = derivePosition({ ...LIVE, recurringBurnNzd: 0 })
    expect(p.grossRunwayMonths).toBeNull()
    expect(p.netRunwayMonths).toBeNull()
  })

  it('computes a net runway once burn outruns revenue', () => {
    const p = derivePosition({ ...LIVE, projectRunRateNzd: 0, retainerMrrNzd: 4258 })
    expect(p.monthlySurplusNzd).toBeCloseTo(-10000, 2)
    expect(p.netMonthlyBurnNzd).toBeCloseTo(10000, 2)
    expect(p.netRunwayMonths).toBeCloseTo(5.188032, 4)
  })
})

describe('cadenceToMonthlyNzd', () => {
  it('normalises each recurring cadence to a month', () => {
    expect(cadenceToMonthlyNzd('monthly', 1200)).toBe(1200)
    expect(cadenceToMonthlyNzd('quarterly', 1200)).toBe(400)
    expect(cadenceToMonthlyNzd('annual', 1200)).toBe(100)
  })

  it('excludes one-off commitments from recurring burn', () => {
    expect(cadenceToMonthlyNzd('one_off', 1200)).toBe(0)
    expect(cadenceToMonthlyNzd('whatever', 1200)).toBe(0)
  })
})

describe('formatCompactNzd', () => {
  it('compacts thousands to one decimal place', () => {
    expect(formatCompactNzd(10317)).toBe('NZ$10.3k')
    expect(formatCompactNzd(17093)).toBe('NZ$17.1k')
    expect(formatCompactNzd(76123)).toBe('NZ$76.1k')
  })

  it('drops the decimal above a hundred thousand and below a thousand', () => {
    expect(formatCompactNzd(250000)).toBe('NZ$250k')
    expect(formatCompactNzd(420)).toBe('NZ$420')
    expect(formatCompactNzd(-2600)).toBe('-NZ$2.6k')
  })
})

describe('cashFlowBasisLine', () => {
  it('states the full picture behind the ribbon', () => {
    expect(cashFlowBasisLine({ retainerNzd: 10317, projectRunRateNzd: 17093 })).toBe(
      'Retainers NZ$10.3k + project run-rate NZ$17.1k + weighted pipeline, minus commitments',
    )
  })

  it('accepts a display-currency formatter so the card can follow the currency switcher', () => {
    expect(
      cashFlowBasisLine({ retainerNzd: 10317, projectRunRateNzd: 17093 }, v => `£${Math.round(v)}`),
    ).toBe('Retainers £10317 + project run-rate £17093 + weighted pipeline, minus commitments')
  })
})
