import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/cron-runs', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cron-runs')>()), logCronRun: vi.fn(),
}))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { logCronRun } from '@/lib/cron-runs'
import { GET, POST } from '@/app/api/admin/exchange-rates/route'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<unknown[][]>
}

const PREVIOUS_TIMESTAMP = '2026-08-10T00:00:00.000Z'
const SOURCE_TIMESTAMP = '2026-10-13T18:00:00.000Z'
const RATES = { NZD: 1.7, USD: 1, AUD: 1.5, GBP: 0.75, EUR: 0.88, CAD: 1.4, SGD: 1.3, HKD: 7.8, JPY: 150, CHF: 0.8 }

let sqlite: DatabaseSync
let batch: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

function request(headers?: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/admin/exchange-rates', { method: 'POST', headers })
}

function provider(overrides: Record<string, unknown> = {}) {
  return { base: 'USD', timestamp: Date.parse(SOURCE_TIMESTAMP) / 1000, rates: { ...RATES }, ...overrides }
}

function cachedRates() {
  return sqlite.prepare('SELECT currency, rate_to_usd, updated_at FROM exchange_rates ORDER BY currency').all()
}

function seed() {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE exchange_rates (currency text PRIMARY KEY, rate_to_usd real NOT NULL, updated_at text NOT NULL)')
  const insert = sqlite.prepare('INSERT INTO exchange_rates VALUES (?, ?, ?)')
  for (const currency of Object.keys(RATES)) insert.run(currency, currency === 'USD' ? 1 : 2, PREVIOUS_TIMESTAMP)

  batch = vi.fn(async (statements: BoundStatement[]) => {
    sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.all())
      sqlite.exec('COMMIT')
      return results
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  })
  const adapter = {
    batch,
    prepare(query: string) {
      const statement = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          return { results: statement.all(...(params as never[])) as unknown[] }
        },
        async run() {
          const result = statement.run(...(params as never[]))
          return { success: true, meta: { changes: Number(result.changes) } }
        },
        async raw() {
          const rows = statement.all(...(params as never[])) as Array<Record<string, unknown>>
          return rows.map(row => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
  vi.mocked(db).mockResolvedValue(drizzle(adapter as unknown as AnyD1Database) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'))
  vi.stubEnv('OPEN_EXCHANGE_RATES_APP_ID', 'fixture-provider-id')
  vi.stubEnv('TAHI_CRON_SECRET', 'fixture-cron-secret')
  vi.stubEnv('CRON_SECRET', '')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(provider()))
  vi.stubGlobal('fetch', fetchMock)
  seed()
})

afterEach(() => {
  sqlite.close()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('exchange rate refresh authorization and scheduling', () => {
  it('keeps manual refresh available to an admin and writes one complete batch', async () => {
    const response = await POST(request())
    const body = await response.json() as {
      updatedAt: string
      rates: Array<{ currency: string; updatedAt: string }>
      fxFreshness: { updatedAt: string; stale: boolean }
    }

    expect(response.status).toBe(200)
    expect(getRequestAuth).toHaveBeenCalledTimes(1)
    expect(requireFeature).toHaveBeenCalledWith({ userId: 'user_admin', orgId: 'org_tahi' }, 'financial_reports')
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(10)
    expect(cachedRates()).toEqual(Object.entries(RATES).sort(([a], [b]) => a.localeCompare(b)).map(([currency, rate]) => ({
      currency, rate_to_usd: rate, updated_at: SOURCE_TIMESTAMP,
    })))
    expect(body.updatedAt).toBe(SOURCE_TIMESTAMP)
    expect(body.rates.every(rate => rate.updatedAt === SOURCE_TIMESTAMP)).toBe(true)
    expect(body.fxFreshness).toMatchObject({ updatedAt: SOURCE_TIMESTAMP, stale: false })
    expect(logCronRun).toHaveBeenCalledWith(expect.anything(), 'refresh-exchange-rates', 'success', 0,
      { count: 10, updatedAt: SOURCE_TIMESTAMP }, null)
  })

  it.each<Record<string, string>>([
    { 'x-cron-secret': 'fixture-cron-secret' },
    { authorization: 'Bearer fixture-cron-secret' },
  ])('accepts the shared cron secret without a user session: %j', async headers => {
    vi.mocked(getRequestAuth).mockRejectedValue(new Error('No browser session'))
    expect((await POST(request(headers))).status).toBe(200)
    expect(getRequestAuth).not.toHaveBeenCalled()
    expect(requireFeature).not.toHaveBeenCalled()
  })

  it.each([GET, POST])('propagates financial-report denial before reading or refreshing rates', async handler => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    vi.mocked(requireFeature).mockResolvedValue(denied)

    expect(await handler(request())).toBe(denied)
    expect(requireFeature).toHaveBeenCalledWith({ userId: 'user_admin', orgId: 'org_tahi' }, 'financial_reports')
    expect(db).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
    expect(logCronRun).not.toHaveBeenCalled()
  })

  it('rejects a client with an incorrect cron secret before fetching or writing', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client', orgId: 'org_client' } as never)
    expect((await POST(request({ 'x-cron-secret': 'incorrect' }))).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
    expect(logCronRun).not.toHaveBeenCalled()
  })

  it('does not grant cron access to the read endpoint', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null } as never)
    const response = await GET(request({ 'x-cron-secret': 'fixture-cron-secret' }))
    expect(response.status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })

  it('returns the actual cache timestamp and warning on an authenticated read', async () => {
    const response = await GET(request())
    const body = await response.json() as { fxFreshness: { updatedAt: string; stale: boolean; warning: string } }
    expect(response.status).toBe(200)
    expect(body.fxFreshness).toMatchObject({ updatedAt: PREVIOUS_TIMESTAMP, stale: true })
    expect(body.fxFreshness.warning).toContain('Converted cash figures may be out of date')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
  })
})

describe('exchange rate refresh preserves a complete cache on failure', () => {
  it('reports a missing provider secret and preserves cached figures and timestamps', async () => {
    vi.stubEnv('OPEN_EXCHANGE_RATES_APP_ID', '')
    const previous = cachedRates()
    expect((await POST(request())).status).toBe(500)
    expect(cachedRates()).toEqual(previous)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
    expect(logCronRun).toHaveBeenCalledWith(expect.anything(), 'refresh-exchange-rates', 'error', 0, null,
      'OPEN_EXCHANGE_RATES_APP_ID not configured')
  })

  it.each(['http', 'network', 'json'])('preserves the cache after a provider %s failure', async failure => {
    const previous = cachedRates()
    if (failure === 'http') fetchMock.mockResolvedValue(new Response('', { status: 503 }))
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('Network failed with a private URL'))
    if (failure === 'json') fetchMock.mockResolvedValue(new Response('invalid JSON'))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(cachedRates()).toEqual(previous)
    expect(batch).not.toHaveBeenCalled()
    expect(logCronRun).toHaveBeenCalledWith(expect.anything(), 'refresh-exchange-rates', 'error', 0, null, expect.any(String))
    expect(await response.text()).not.toContain('private URL')
  })

  it.each([
    ['base', { base: 'NZD' }],
    ['missing currency', { rates: { NZD: 1.7 } }],
    ['zero rate', { rates: { ...RATES, AUD: 0 } }],
    ['negative rate', { rates: { ...RATES, AUD: -1 } }],
    ['string rate', { rates: { ...RATES, AUD: '1.5' } }],
    ['null rate', { rates: { ...RATES, AUD: null } }],
    ['USD parity', { rates: { ...RATES, USD: 2 } }],
    ['missing timestamp', { timestamp: undefined }],
    ['zero timestamp', { timestamp: 0 }],
    ['fractional timestamp', { timestamp: Date.parse(SOURCE_TIMESTAMP) / 1000 + 0.5 }],
    ['future timestamp', { timestamp: Date.parse('2026-10-14T01:00:00.000Z') / 1000 }],
    ['stale timestamp', { timestamp: Date.parse(PREVIOUS_TIMESTAMP) / 1000 }],
  ])('rejects invalid provider %s before writing', async (_, overrides) => {
    const previous = cachedRates()
    fetchMock.mockResolvedValue(Response.json(provider(overrides)))
    expect((await POST(request())).status).toBe(502)
    expect(cachedRates()).toEqual(previous)
    expect(batch).not.toHaveBeenCalled()
  })

  it('accepts an omitted USD quote as parity and an omitted base as the documented default', async () => {
    const { USD: omitted, ...nonUsdRates } = RATES
    expect(omitted).toBe(1)
    fetchMock.mockResolvedValue(Response.json(provider({ base: undefined, rates: nonUsdRates })))
    expect((await POST(request())).status).toBe(200)
    expect(sqlite.prepare("SELECT rate_to_usd FROM exchange_rates WHERE currency = 'USD'").get()).toEqual({ rate_to_usd: 1 })
  })

  it('rolls back every quote and source timestamp if one currency write fails', async () => {
    const previous = cachedRates()
    sqlite.exec("CREATE TRIGGER reject_chf BEFORE UPDATE ON exchange_rates WHEN NEW.currency = 'CHF' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END")
    expect((await POST(request())).status).toBe(500)
    expect(batch).toHaveBeenCalledTimes(1)
    expect(cachedRates()).toEqual(previous)
    expect(logCronRun).toHaveBeenCalledWith(expect.anything(), 'refresh-exchange-rates', 'error', 0, null,
      'Failed to save exchange rates')
  })

  it('bounds the response-body wait and aborts without updating the cache', async () => {
    const previous = cachedRates()
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise<unknown>(() => {}) } as Response)
    const refresh = POST(request())
    await vi.advanceTimersByTimeAsync(15_001)
    const response = await refresh
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Exchange rate refresh timed out' })
    const signal = fetchMock.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(true)
    expect(cachedRates()).toEqual(previous)
    expect(batch).not.toHaveBeenCalled()
  })
})
