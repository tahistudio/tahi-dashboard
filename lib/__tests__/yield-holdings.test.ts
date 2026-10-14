import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/xero', () => ({ callXeroAPIOrThrow: vi.fn() }))
import { callXeroAPIOrThrow } from '@/lib/xero'
import { parseXeroYieldHoldings, readXeroYieldHoldings, yieldFreshness } from '@/lib/yield-holdings'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

const accounts = {
  Accounts: [
    { AccountID: 'yield-usd', Name: 'AWX_Yield_USD', Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'USD' },
    { AccountID: 'yield-aud', Name: 'AWX Yield AUD', Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'AUD' },
    { AccountID: 'wallet', Name: 'Airwallex NZD', Type: 'BANK', Status: 'ACTIVE', CurrencyCode: 'NZD' },
  ],
}
const organisation = { Organisations: [{ BaseCurrency: 'NZD' }] }
function row(name: string, balance: string, id?: string) {
  return { RowType: 'Row', Cells: [
    { Value: name, ...(id ? { Attributes: [{ Id: 'account', Value: id }] } : {}) },
    { Value: '0.00' }, { Value: balance }, { Value: '999999.99' },
  ] }
}
function summary(rows = [row('AWX_Yield_USD', '31,234.56', 'yield-usd'), row('AWX Yield AUD', '700.23', 'yield-aud')]) {
  return { Reports: [{ Rows: [
    { RowType: 'Header', Cells: [{ Value: 'Bank Account' }, { Value: 'Opening Balance' }, { Value: 'Closing Balance' }, { Value: 'Other column' }] },
    { RowType: 'Section', Rows: [...rows, row('Airwallex NZD', '999999.99', 'wallet')] },
  ] }] }
}

describe('Xero AWX Yield source, synthetic report fixtures', () => {
  it('keeps exact closing balances in report base currency and excludes wallet accounts', () => {
    expect(parseXeroYieldHoldings(accounts, organisation, summary())).toEqual({
      ok: true, currencyBasis: 'NZD', holdings: [
        { currency: 'NZD', amount: 31234.56, sourceAccountId: 'yield-usd', sourceAccountCurrency: 'USD' },
        { currency: 'NZD', amount: 700.23, sourceAccountId: 'yield-aud', sourceAccountCurrency: 'AUD' },
      ],
    })
  })

  it('admits exact documented names when report account attributes are absent', () => {
    expect(parseXeroYieldHoldings(accounts, organisation, summary([
      row('AWX_Yield_USD', '0.00'), row('AWX Yield AUD', '0.00'),
    ]))).toMatchObject({ ok: true, holdings: [{ amount: 0 }, { amount: 0 }] })
  })

  it('requires both unique active bank accounts with the documented native currencies', () => {
    for (const patch of [{ Status: 'ARCHIVED' }, { CurrencyCode: 'NZD' }, { Type: 'CURRENT' }, { Name: 'AWX_Yield_USD_backup' }]) {
      expect(parseXeroYieldHoldings({ Accounts: [{ ...accounts.Accounts[0], ...patch }, accounts.Accounts[1]] }, organisation, summary()).ok).toBe(false)
    }
    expect(parseXeroYieldHoldings({ Accounts: [...accounts.Accounts, accounts.Accounts[0]] }, organisation, summary()).ok).toBe(false)
    expect(parseXeroYieldHoldings({ Accounts: [accounts.Accounts[0]] }, organisation, summary()).ok).toBe(false)
  })

  it('does not fall back to a yield name when its report identity points at a wallet', () => {
    expect(parseXeroYieldHoldings(accounts, organisation, summary([
      row('AWX_Yield_USD', '100', 'wallet'), row('AWX Yield AUD', '100', 'yield-aud'),
    ])).ok).toBe(false)
  })

  it('refuses missing or duplicated balances and an unknown report base currency', () => {
    expect(parseXeroYieldHoldings(accounts, organisation, summary([])).ok).toBe(false)
    expect(parseXeroYieldHoldings(accounts, organisation, summary([
      row('AWX_Yield_USD', '100', 'yield-usd'), row('AWX_Yield_USD', '100', 'yield-usd'), row('AWX Yield AUD', '100', 'yield-aud'),
    ])).ok).toBe(false)
    expect(parseXeroYieldHoldings(accounts, { Organisations: [] }, summary()).ok).toBe(false)
  })

  it('refuses a partial, blank, negative or non-finite closing balance instead of clearing holdings', () => {
    for (const value of ['', ' ', '-10', '(10)', 'Infinity', '100 dollars', '1,00', '1e5']) {
      expect(parseXeroYieldHoldings(accounts, organisation, summary([
        row('AWX_Yield_USD', value, 'yield-usd'), row('AWX Yield AUD', '100', 'yield-aud'),
      ])).ok).toBe(false)
    }
  })

  it('does not select a native-currency column or guess the last column', () => {
    const report = summary()
    report.Reports[0].Rows[0].Cells![2].Value = 'Closing Balance (USD)'
    expect(parseXeroYieldHoldings(accounts, organisation, report).ok).toBe(false)
    report.Reports[0].Rows[0].Cells![2].Value = 'Closing Balance (NZD)'
    expect(parseXeroYieldHoldings(accounts, organisation, report).ok).toBe(true)
    report.Reports[0].Rows[0].Cells![3].Value = 'Closing Balance'
    expect(parseXeroYieldHoldings(accounts, organisation, report).ok).toBe(false)
  })
})

describe('yield freshness', () => {
  const now = new Date('2026-10-14T18:00:00.000Z')
  it('warns strictly after 30 days, including empty recorded holdings', () => {
    expect(yieldFreshness('2026-09-14T18:00:00.000Z', true, now).stale).toBe(false)
    expect(yieldFreshness('2026-09-14T17:59:59.999Z', true, now).stale).toBe(true)
    expect(yieldFreshness('2026-08-18T18:00:00.000Z', true, now)).toMatchObject({ stale: true, ageDays: 57 })
    expect(yieldFreshness('2026-08-18T18:00:00.000Z', true, now).warning).toContain('Cash may be out of date.')
  })
  it('warns when known holdings have no valid timestamp and ignores fresh wallet syncs', () => {
    for (const timestamp of [null, 'invalid', '2026-10-15T18:00:00.000Z']) {
      expect(yieldFreshness(timestamp, true, now)).toMatchObject({ stale: true, ageDays: null, updatedAt: null })
    }
    expect(yieldFreshness(null, false, now)).toMatchObject({ stale: false, warning: null })
    expect(yieldFreshness(null, true, now).warning).toContain('Cash may be out of date.')
  })
})

describe('bounded Xero yield read', () => {
  const now = '2026-10-14T18:00:00.000Z'

  it('returns a retention warning on a stalled read and stops later requests after a late response', async () => {
    vi.useFakeTimers()
    let finish: ((value: unknown) => void) | undefined
    vi.mocked(callXeroAPIOrThrow).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const read = readXeroYieldHoldings(now)
    const signal = vi.mocked(callXeroAPIOrThrow).mock.calls[0][3]?.signal
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(await read).toEqual({ ok: false, warning: expect.stringContaining('timed out') })
    expect((await read).ok).toBe(false)
    expect(signal?.aborted).toBe(true)
    finish!(accounts)
    await Promise.resolve()
    await Promise.resolve()
    expect(callXeroAPIOrThrow).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds all three calls together, including a stall after a successful account read', async () => {
    vi.useFakeTimers()
    vi.mocked(callXeroAPIOrThrow)
      .mockImplementationOnce(() => new Promise(resolve => { setTimeout(() => resolve(accounts), 9_000) }))
      .mockImplementationOnce(() => new Promise(() => undefined))
    const read = readXeroYieldHoldings(now)

    await vi.advanceTimersByTimeAsync(9_000)
    expect(callXeroAPIOrThrow).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await read).toMatchObject({ ok: false, warning: expect.stringContaining('Saved yield holdings were retained') })
    expect(callXeroAPIOrThrow).toHaveBeenCalledTimes(2)
    expect(vi.mocked(callXeroAPIOrThrow).mock.calls[1][3]?.signal)
      .toBe(vi.mocked(callXeroAPIOrThrow).mock.calls[0][3]?.signal)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the deadline on success and preserves the report currency basis', async () => {
    vi.useFakeTimers()
    vi.mocked(callXeroAPIOrThrow)
      .mockResolvedValueOnce(accounts)
      .mockResolvedValueOnce(organisation)
      .mockResolvedValueOnce(summary())

    expect(await readXeroYieldHoldings(now)).toMatchObject({ ok: true, currencyBasis: 'NZD' })
    expect(callXeroAPIOrThrow).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the deadline and preserves saved holdings on a rejected read', async () => {
    vi.useFakeTimers()
    vi.mocked(callXeroAPIOrThrow).mockRejectedValueOnce(new Error('Xero unavailable'))

    expect(await readXeroYieldHoldings(now)).toEqual({ ok: false, warning: expect.stringContaining('the Xero read failed') })
    expect(callXeroAPIOrThrow).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
