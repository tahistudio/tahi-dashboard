import { describe, expect, it } from 'vitest'
import { computeWalletForex } from '@/lib/wallet-forex'

const nzd = (amount: number, currency: string) => currency === 'USD' ? amount * 2 : amount
describe('wallet forex basis', () => {
  it('weights shares in one converted currency instead of summing unlike native units', () => {
    const result = computeWalletForex([
      { accountId: 'wallet:NZD', currency: 'NZD', availableBalance: 1000 },
      { accountId: 'wallet:USD', currency: 'USD', availableBalance: 500 },
    ], nzd)
    expect(result.nzdShare).toBe(0.5)
    expect(result.items[1]).toEqual({ currency: 'USD', available: 500, share: 0.5 })
  })
  it('does not label a base-valued foreign yield holding as operating-currency exposure', () => {
    const result = computeWalletForex([
      { accountId: 'wallet:USD', currency: 'USD', availableBalance: 500 },
      { accountId: 'yield:NZD', currency: 'NZD', availableBalance: 99999 },
    ], nzd)
    expect(result.nzdShare).toBe(0)
    expect(result.items).toEqual([{ currency: 'USD', available: 500, share: 1 }])
  })
  it('combines wallet accounts without changing the reported native amount', () => {
    expect(computeWalletForex([
      { accountId: 'a:USD', currency: 'USD', availableBalance: 100 },
      { accountId: 'b:USD', currency: 'USD', availableBalance: 400 },
    ], nzd).items).toEqual([{ currency: 'USD', available: 500, share: 1 }])
  })
  it('has no fabricated percentage when there is no funded wallet', () => {
    expect(computeWalletForex([], nzd)).toEqual({ items: [], nzdShare: 0 })
    expect(computeWalletForex([{ accountId: 'wallet:NZD', currency: 'NZD', availableBalance: 0 }], nzd)).toEqual({ items: [], nzdShare: 0 })
  })
})
