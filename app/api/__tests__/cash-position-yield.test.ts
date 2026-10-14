import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'admin', orgId: 'tahi', sessionId: null }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn().mockResolvedValue({}), can: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/xero', () => ({ callXeroAPIOrThrow: vi.fn() }))

import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { computeCashPosition } from '@/lib/cash-position'
import { GET } from '@/app/api/admin/reports/bank-balances/route'
import { permissionSqlite } from './helpers/permission-sqlite'

function seed(includeAirwallex = true) {
  const fixture = permissionSqlite([
    schema.airwallexBalances, schema.xeroBankBalances, schema.exchangeRates,
    schema.settings, schema.xeroPnlSnapshots, schema.organisations, schema.invoices,
    schema.expenseCommitments, schema.reserves,
  ])
  const timestamp = new Date(Date.now() - 31 * 86_400_000).toISOString()
  fixture.insert(schema.exchangeRates, { currency: 'NZD', rate_to_usd: 0.6, updated_at: timestamp })
  if (includeAirwallex) {
    fixture.insert(schema.airwallexBalances, {
      account_id: 'wallet:NZD', account_name: 'Airwallex NZD', currency: 'NZD',
      balance: 150, available_balance: 100, as_of: timestamp, updated_at: timestamp,
    })
    fixture.insert(schema.airwallexBalances, {
      account_id: 'yield:NZD', account_name: 'Airwallex NZD Yield', currency: 'NZD',
      balance: 700, available_balance: 700, as_of: timestamp, updated_at: timestamp,
    })
    fixture.insert(schema.settings, { key: 'finance.yieldHoldings', value: '[{"currency":"NZD","amount":700}]', updated_at: timestamp })
  }
  fixture.insert(schema.xeroBankBalances, {
    account_id: 'ledger:NZD', account_name: 'Airwallex NZD ledger', currency: 'NZD',
    balance: 999999, as_of: timestamp, updated_at: timestamp,
  })
  fixture.insert(schema.xeroBankBalances, {
    account_id: 'ledger:EUR', account_name: 'Xero EUR ledger', currency: 'EUR',
    balance: 999999, as_of: timestamp, updated_at: timestamp,
  })
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  return fixture
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'admin', orgId: 'tahi', sessionId: null })
})

describe('cash position and bank balances share yield truth, synthetic SQLite fixtures', () => {
  it('counts cleared Airwallex cash plus yield and never reads wallet cash from Xero', async () => {
    const fixture = seed()
    try {
      const position = await computeCashPosition(fixture.database)
      expect(position.totalCashNzd).toBe(800)
      expect(position.yieldFreshness).toMatchObject({ stale: true, ageDays: 31 })
      const response = await GET(new NextRequest('http://localhost/api/admin/reports/bank-balances'))
      expect(response.status).toBe(200)
      const body = await response.json() as { totalBalanceNzd: number; accounts: Array<{ source: string }>; yieldFreshness: unknown }
      expect(body.totalBalanceNzd).toBe(position.totalCashNzd)
      expect(body.accounts.map(account => account.source).sort()).toEqual(['airwallex', 'airwallex_yield'])
      expect(body.yieldFreshness).toEqual(position.yieldFreshness)
      expect(fixture.queries.some(query => query.includes('from "xero_bank_balances"'))).toBe(false)
    } finally { fixture.close() }
  })

  it('has no Xero ledger fallback when Airwallex has no balance rows', async () => {
    const fixture = seed(false)
    try {
      const position = await computeCashPosition(fixture.database)
      expect(position.totalCashNzd).toBe(0)
      const response = await GET(new NextRequest('http://localhost/api/admin/reports/bank-balances'))
      expect(await response.json()).toMatchObject({ totalBalanceNzd: 0, accounts: [], yieldFreshness: { stale: false, warning: null } })
    } finally { fixture.close() }
  })

  it('warns about yield rows whose source setting cannot be dated', async () => {
    const fixture = seed()
    try {
      fixture.sqlite.prepare("DELETE FROM settings WHERE key = 'finance.yieldHoldings'").run()
      const position = await computeCashPosition(fixture.database)
      expect(position.yieldFreshness).toMatchObject({ stale: true, ageDays: null, updatedAt: null })
    } finally { fixture.close() }
  })

  it('denies the bank balances route to a client before reading money', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client', orgId: 'client-org', sessionId: null })
    const response = await GET(new NextRequest('http://localhost/api/admin/reports/bank-balances'))
    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })
})
