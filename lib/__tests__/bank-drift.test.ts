import { describe, it, expect } from 'vitest'
import { computeBankDrift, DRIFT_ABS_FLOOR } from '@/lib/bank-drift'

const awx = (accountId: string, currency: string, balance: number) => ({ accountId, currency, balance })
const xero = (currency: string, balance: number) => ({ currency, balance })

describe('computeBankDrift', () => {
  it('returns nothing when balances agree', () => {
    const findings = computeBankDrift(
      [awx('acct:NZD', 'NZD', 25870.05), awx('acct:USD', 'USD', 7273.09)],
      [xero('NZD', 25870.05), xero('USD', 7273.09)],
    )
    expect(findings).toEqual([])
  })

  it('flags the Aug 2026 real-world drift on USD, GBP, and AUD', () => {
    // Full pre-reconciliation picture. AUD is a true positive too: Xero
    // still carried the unbooked wallet-to-yield transfer (531.51) plus
    // drift, against a 0.25 wallet. Ordered by absolute drift.
    const findings = computeBankDrift(
      [
        awx('acct:USD', 'USD', 7273.09),
        awx('acct:GBP', 'GBP', 5626.57),
        awx('acct:NZD', 'NZD', 25870.05),
        awx('acct:AUD', 'AUD', 0.25),
        awx('yield:USD', 'USD', 20014.13),
        awx('yield:AUD', 'AUD', 531.51),
      ],
      [xero('USD', 46367.82), xero('GBP', 16319.05), xero('NZD', 26189.21), xero('AUD', 637.75)],
    )
    expect(findings.map(f => f.currency)).toEqual(['USD', 'GBP', 'AUD'])
    const usd = findings[0]
    expect(usd.diff).toBeCloseTo(39094.73, 2)
    expect(usd.diff).toBeGreaterThan(0)
    expect(usd.relDiff).toBeGreaterThan(0.05)
  })

  it('stays quiet on the reconciled Aug 2026 picture', () => {
    // After Liam reconciled Xero: ledger matches the wallets, yield rows
    // excluded from the comparison, nothing alerts.
    const findings = computeBankDrift(
      [
        awx('acct:USD', 'USD', 7273.09),
        awx('acct:GBP', 'GBP', 5626.57),
        awx('acct:NZD', 'NZD', 25870.05),
        awx('acct:AUD', 'AUD', 0.25),
        awx('yield:USD', 'USD', 20014.13),
        awx('yield:AUD', 'AUD', 531.51),
      ],
      [xero('USD', 7273.09), xero('GBP', 5626.57), xero('NZD', 25901.4), xero('AUD', 0.25)],
    )
    expect(findings).toEqual([])
  })

  it('does not flag NZD-sized drift under the relative threshold', () => {
    // 319 NZD apart on a 26k balance is 1.2 percent: timing noise, not drift.
    const findings = computeBankDrift(
      [awx('acct:NZD', 'NZD', 25870.05)],
      [xero('NZD', 26189.21)],
    )
    expect(findings).toEqual([])
  })

  it('ignores differences under the absolute floor even when relatively huge', () => {
    // AUD 0.25 vs 90: 99 percent relative but under the floor.
    const findings = computeBankDrift([awx('acct:AUD', 'AUD', 0.25)], [xero('AUD', 90)])
    expect(findings).toEqual([])
    expect(Math.abs(90 - 0.25)).toBeLessThan(DRIFT_ABS_FLOOR)
  })

  it('excludes yield rows from the Airwallex side', () => {
    // Wallet 7273 + yield 20014; Xero books only the wallet. No drift.
    const findings = computeBankDrift(
      [awx('acct:USD', 'USD', 7273.09), awx('yield:USD', 'USD', 20014.13)],
      [xero('USD', 7273.09)],
    )
    expect(findings).toEqual([])
  })

  it('skips currencies present on only one side', () => {
    const findings = computeBankDrift(
      [awx('acct:SGD', 'SGD', 9000)],
      [xero('EUR', 9000)],
    )
    expect(findings).toEqual([])
  })

  it('aggregates multiple rows of the same currency before comparing', () => {
    const findings = computeBankDrift(
      [awx('acct1:USD', 'USD', 4000), awx('acct2:USD', 'USD', 3273.09)],
      [xero('USD', 7273.09)],
    )
    expect(findings).toEqual([])
  })

  it('sorts findings by absolute drift, largest first', () => {
    const findings = computeBankDrift(
      [awx('acct:GBP', 'GBP', 5000), awx('acct:USD', 'USD', 5000)],
      [xero('GBP', 6000), xero('USD', 45000)],
    )
    expect(findings.map(f => f.currency)).toEqual(['USD', 'GBP'])
  })

  it('handles zero-vs-zero without dividing by zero', () => {
    const findings = computeBankDrift([awx('acct:EUR', 'EUR', 0)], [xero('EUR', 0)])
    expect(findings).toEqual([])
  })
})
