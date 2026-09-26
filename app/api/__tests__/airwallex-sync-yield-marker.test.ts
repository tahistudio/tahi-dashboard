/**
 * POST /api/admin/integrations/airwallex/sync, and the one record of yield
 * that outlives the yield rows (lib/yield-history.ts).
 *
 * The sync materialises finance.yieldHoldings as 'yield:CUR' balance rows and
 * deletes them again once the setting is emptied, so after a withdrawal the
 * rows say nothing about months that ended while the yield was held. The
 * month-end cash rebuild (lib/financial-snapshots.ts) reads
 * finance.yieldFirstHeldAt instead. What is pinned here, against a real
 * SQLite database (node:sqlite behind the D1 shape drizzle's d1 driver calls):
 *
 *   The sync writes the marker ('unknown') the first time it sees a holding
 *   with money in it: one it is about to write, or one already in the rows,
 *   including one it is about to delete, and one it leaves alone because the
 *   setting cannot be read.
 *   It never overwrites a marker that exists, and never clears one.
 *   With no yield anywhere it writes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/cron-runs', () => ({ logCronRun: vi.fn() }))
vi.mock('@/lib/airwallex', () => ({
  AirwallexNotConfiguredError: class extends Error {},
  getAirwallexToken: vi.fn().mockResolvedValue('token'),
  listBalances: vi.fn().mockResolvedValue([
    { currency: 'NZD', total_amount: 50000, available_amount: 49000 },
    { currency: 'USD', total_amount: 1000, available_amount: 1000 },
  ]),
  listTransactions: vi.fn().mockResolvedValue([]),
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as syncAirwallex } from '@/app/api/admin/integrations/airwallex/sync/route'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<unknown[][]>
}

function d1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          return { results: stmt.all(...(params as never[])) as unknown[] }
        },
        async run() {
          const info = stmt.run(...(params as never[]))
          return { success: true, meta: { changes: Number(info.changes) } }
        },
        async raw() {
          const rows = stmt.all(...(params as never[])) as Array<Record<string, unknown>>
          return rows.map((row) => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

const TABLES = `
  CREATE TABLE airwallex_balances (
    account_id text PRIMARY KEY, account_name text NOT NULL, currency text NOT NULL,
    balance real NOT NULL DEFAULT 0, available_balance real NOT NULL DEFAULT 0,
    as_of text NOT NULL, updated_at text NOT NULL
  );
  CREATE TABLE airwallex_transactions (
    id text PRIMARY KEY, account_id text NOT NULL, amount real NOT NULL, currency text NOT NULL,
    type text NOT NULL, description text, counterparty text, settled_at text,
    linked_xero_id text, linked_stripe_id text, reconciled_at text,
    reconciliation_status text DEFAULT 'orphan', created_at text NOT NULL
  );
  CREATE TABLE settings (key text PRIMARY KEY, value text, updated_at text NOT NULL);
  CREATE TABLE integrations (id text PRIMARY KEY, service text NOT NULL UNIQUE, last_synced_at text, updated_at text);
`

interface SeedOptions {
  /** The finance.yieldHoldings value (default: no row). */
  holdings?: string
  /** Yield rows already materialised by an earlier sync, [currency, amount]. */
  yieldRows?: Array<[string, number]>
  /** The finance.yieldFirstHeldAt value (default: no row). */
  marker?: string
}

function seed(options: SeedOptions = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(TABLES)
  const setting = sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  if (options.holdings !== undefined) setting.run('finance.yieldHoldings', options.holdings, '2026-08-18T00:00:00.000Z')
  if (options.marker !== undefined) setting.run('finance.yieldFirstHeldAt', options.marker, '2026-09-01T00:00:00.000Z')
  for (const [currency, amount] of options.yieldRows ?? []) {
    sqlite.prepare('INSERT INTO airwallex_balances (account_id, account_name, currency, balance, available_balance, as_of, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`yield:${currency}`, `Airwallex ${currency} Yield`, currency, amount, amount, '2026-09-25T18:00:00.000Z', '2026-09-25T18:00:00.000Z')
  }
  vi.mocked(db).mockResolvedValue(drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) as never)
  return sqlite
}

function marker(sqlite: DatabaseSync): { value: string | null } | undefined {
  return sqlite.prepare("SELECT value FROM settings WHERE key = 'finance.yieldFirstHeldAt'").get() as { value: string | null } | undefined
}

function yieldAccounts(sqlite: DatabaseSync): string[] {
  const rows = sqlite.prepare("SELECT account_id FROM airwallex_balances WHERE account_id LIKE 'yield:%' ORDER BY account_id").all() as Array<{ account_id: string }>
  return rows.map((row) => row.account_id)
}

async function sync() {
  const res = await syncAirwallex(new NextRequest('http://localhost:3000/api/admin/integrations/airwallex/sync', { method: 'POST' }))
  expect(res.status).toBe(200)
  return await res.json() as { yieldRows: number; yieldMalformed: boolean; yieldMarked: boolean }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('the Airwallex sync records that yield has been held', () => {
  it('writes the marker, as unknown, the first time a holding is materialised', async () => {
    const sqlite = seed({ holdings: '[{"currency":"USD","amount":20014.13}]' })
    const body = await sync()
    expect(body).toMatchObject({ yieldRows: 1, yieldMarked: true })
    expect(yieldAccounts(sqlite)).toEqual(['yield:USD'])
    expect(marker(sqlite)).toEqual({ value: 'unknown' })
  })

  it('writes it when the setting is emptied and the sync deletes the last yield rows', async () => {
    // Today's production shape, one step later: Liam withdrew the yield and
    // cleared the setting before any sync had written the marker.
    const sqlite = seed({ holdings: '[]', yieldRows: [['USD', 25100], ['AUD', 534]] })
    const body = await sync()
    expect(body).toMatchObject({ yieldRows: 0, yieldMarked: true })
    expect(yieldAccounts(sqlite)).toEqual([])
    expect(marker(sqlite)).toEqual({ value: 'unknown' })
  })

  it('writes it when the setting cannot be read and the old rows stay', async () => {
    const sqlite = seed({ holdings: 'not json', yieldRows: [['USD', 25100]] })
    const body = await sync()
    expect(body).toMatchObject({ yieldMalformed: true, yieldMarked: true })
    expect(yieldAccounts(sqlite)).toEqual(['yield:USD'])
    expect(marker(sqlite)).toEqual({ value: 'unknown' })
  })

  it('never overwrites or clears a marker that exists', async () => {
    const dated = seed({ holdings: '[{"currency":"USD","amount":20014.13}]', marker: '2026-08-05' })
    expect(await sync()).toMatchObject({ yieldMarked: false })
    expect(marker(dated)).toEqual({ value: '2026-08-05' })

    const cleared = seed({ holdings: '[]', marker: 'unknown' })
    expect(await sync()).toMatchObject({ yieldMarked: false })
    expect(marker(cleared)).toEqual({ value: 'unknown' })
  })

  it('writes nothing when no yield is held anywhere', async () => {
    for (const holdings of [undefined, '[]', '[{"currency":"USD","amount":0}]']) {
      const sqlite = seed(holdings === undefined ? {} : { holdings })
      expect(await sync()).toMatchObject({ yieldMarked: false })
      expect(marker(sqlite)).toBeUndefined()
    }
  })
})
