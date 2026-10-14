import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org-tahi',
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/cash-position', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/cash-position')>(),
  computeCashPosition: vi.fn().mockResolvedValue({ projectRunRateNzd: 700 }),
}))

let sqlite: DatabaseSync
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'))
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'owner', orgId: 'org-tahi', sessionId: null })
  vi.mocked(requireFeature).mockResolvedValue(null)
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE exchange_rates (currency TEXT, rate_to_usd REAL, updated_at TEXT);
    INSERT INTO exchange_rates VALUES ('NZD', 2, 'now'), ('USD', 1, 'now');
    CREATE TABLE organisations (custom_mrr REAL, custom_mrr_currency TEXT, preferred_currency TEXT, status TEXT, retainer_start_date TEXT, retainer_end_date TEXT);
    INSERT INTO organisations VALUES
      (1000, 'NZD', 'USD', 'active', NULL, '2026-11-30'),
      (100, 'USD', 'NZD', 'active', '2026-11-01', NULL),
      (9999, 'NZD', 'NZD', 'inactive', NULL, NULL);
    CREATE TABLE pipeline_stages (id TEXT, probability REAL, is_closed_won INTEGER, is_closed_lost INTEGER);
    INSERT INTO pipeline_stages VALUES ('open', 50, 0, 0), ('won', 100, 1, 0), ('lost', 0, 0, 1);
    CREATE TABLE deals (id TEXT, stage_id TEXT, value_nzd REAL, value REAL, upfront_value REAL, upfront_value_nzd REAL, monthly_value REAL, monthly_value_nzd REAL, currency TEXT, expected_close_date TEXT, recurring_start_date TEXT, engagement_end_date TEXT, closed_at TEXT, close_reason TEXT);
    INSERT INTO deals VALUES
      ('split', 'open', 2200, 2200, 1000, 1000, 100, 100, 'NZD', '2026-11-15', NULL, NULL, NULL, NULL),
      ('native', 'open', 3400, 1700, 500, NULL, 100, NULL, 'USD', '2026-10-15', '2026-12-01', NULL, NULL, NULL),
      ('archived', 'open', 99999, 99999, 99999, 99999, 999, 999, 'NZD', '2026-10-15', NULL, NULL, NULL, 'archived'),
      ('won', 'won', 99999, 99999, 99999, 99999, 999, 999, 'NZD', '2026-10-15', NULL, NULL, NULL, NULL),
      ('lost', 'lost', 99999, 99999, 99999, 99999, 999, 999, 'NZD', '2026-10-15', NULL, NULL, NULL, NULL);
  `)
  const database = drizzle(async (query: string, params: unknown[]) => {
    const statement = sqlite.prepare(query)
    statement.setReturnArrays(true)
    return { rows: statement.all(...params as SQLInputValue[]) }
  })
  const dialect = new SQLiteSyncDialect()
  const handle = Object.assign(database, {
    all: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query)
      return sqlite.prepare(rendered.sql).all(...rendered.params as SQLInputValue[])
    },
  })
  vi.mocked(db).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof db>>)
})
afterEach(() => { sqlite.close(); vi.useRealTimers() })

describe('GET cash-flow forecast with real SQLite', () => {
  const request = () => new NextRequest('https://portal.tahi.studio/api/admin/reports/cash-flow-forecast?months=3')

  it('uses split pipeline receipts, excludes archived/closed deals, and matches established MRR currency resolution and dates', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      months: [
        { month: '2026-10', revenueRetainer: 2000, revenueProject: 700, revenuePipeline: 500, revenue: 3200 },
        { month: '2026-11', revenueRetainer: 2200, revenueProject: 700, revenuePipeline: 550, revenue: 3450 },
        { month: '2026-12', revenueRetainer: 200, revenueProject: 700, revenuePipeline: 150, revenue: 1050 },
      ],
      summary: {
        totalRevenue: 7700, totalCost: 0, totalNet: 7700, recurringMrrNzd: 2000,
        projectRunRateNzd: 700,
        pipelineBasis: expect.stringContaining('Undated closes spread evenly'),
      },
    })
  })

  it('refuses callers without financial reports permission before reading money', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(request())).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })

  it('refuses clients before reading money', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client', orgId: 'org-client', sessionId: null })
    expect((await GET(request())).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(requireFeature).not.toHaveBeenCalled()
  })
})
