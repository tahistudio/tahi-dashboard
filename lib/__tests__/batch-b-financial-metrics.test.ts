import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { computeCurrentMetrics } from '@/lib/financial-metrics'
import { readMrrDelta } from '@/lib/mrr-delta'

const databases: DatabaseSync[] = []
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  sqlite.exec(`
    CREATE TABLE exchange_rates (currency TEXT PRIMARY KEY, rate_to_usd REAL, updated_at TEXT);
    INSERT INTO exchange_rates VALUES ('NZD', 2, ''), ('USD', 1, ''), ('AUD', 1.6, '');
    CREATE TABLE airwallex_balances (account_id TEXT PRIMARY KEY, account_name TEXT, currency TEXT, balance REAL, available_balance REAL, as_of TEXT, updated_at TEXT);
    CREATE TABLE xero_bank_balances (account_id TEXT PRIMARY KEY, account_name TEXT, currency TEXT, balance REAL, as_of TEXT, updated_at TEXT);
    INSERT INTO xero_bank_balances VALUES ('wrong', 'Wallet ledger', 'AUD', 57000, '', '');
    CREATE TABLE organisations (id TEXT PRIMARY KEY, status TEXT, custom_mrr REAL, preferred_currency TEXT, custom_mrr_currency TEXT);
    INSERT INTO organisations VALUES ('client', 'active', 1000, 'AUD', 'USD');
    CREATE TABLE financial_snapshots (month_key TEXT PRIMARY KEY, mrr_nzd REAL);
  `)
  const adapter = {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]) => ({
        async all() { return { results: stmt.all(...params as never[]) } },
        async run() { return { success: true, meta: { changes: Number(stmt.run(...params as never[]).changes) } } },
        async raw() { return (stmt.all(...params as never[]) as Record<string, unknown>[]).map(Object.values) },
      })
      return { bind, ...bind() }
    },
  }
  return { sqlite, database: drizzle(adapter as unknown as AnyD1Database) }
}
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('batch B financial sources', () => {
  it('counts wallet and yield exactly once without filling missing currencies from Xero', async () => {
    const { sqlite, database } = setup()
    sqlite.exec(`INSERT INTO airwallex_balances VALUES ('wallet:NZD', 'Wallet', 'NZD', 1200, 1000, '', ''), ('yield:USD', 'Yield', 'USD', 500, 500, '', '');`)
    const metrics = await computeCurrentMetrics(database)
    expect(metrics.cashNzd).toBe(2000)
    expect(metrics.mrrNzd).toBe(2000)
  })
  it('leaves cash unknown when only Xero ledger rows exist', async () => {
    const { database } = setup()
    expect((await computeCurrentMetrics(database)).cashNzd).toBeNull()
  })
  it('keeps cash unknown when Airwallex cannot be read', async () => {
    const { sqlite, database } = setup()
    sqlite.exec('DROP TABLE airwallex_balances')
    expect((await computeCurrentMetrics(database)).cashNzd).toBeNull()
  })
  it('selects September rather than July or the unfinished current month', async () => {
    const { sqlite, database } = setup()
    sqlite.exec(`INSERT INTO financial_snapshots VALUES ('2026-07', 2000), ('2026-08', NULL), ('2026-09', 1000), ('2026-10', 2000);`)
    expect(await readMrrDelta(database, 1200, new Date('2026-10-14T00:00:00.000Z'))).toEqual({ mrrDeltaPct: 20, mrrDeltaBasisMonth: '2026-09' })
  })
  it('retains an honest older basis when last month has no recorded MRR', async () => {
    const { sqlite, database } = setup()
    sqlite.exec(`INSERT INTO financial_snapshots VALUES ('2026-07', 2000), ('2026-08', NULL);`)
    expect(await readMrrDelta(database, 1000, new Date('2026-09-14T00:00:00.000Z'))).toEqual({ mrrDeltaPct: -50, mrrDeltaBasisMonth: '2026-07' })
  })
  it('does not invent a percentage from a zero or missing prior MRR', async () => {
    const { sqlite, database } = setup()
    expect(await readMrrDelta(database, 1000)).toEqual({ mrrDeltaPct: null, mrrDeltaBasisMonth: null })
    sqlite.exec(`INSERT INTO financial_snapshots VALUES ('2026-09', 0);`)
    expect(await readMrrDelta(database, 1000, new Date('2026-10-14T00:00:00.000Z'))).toEqual({ mrrDeltaPct: null, mrrDeltaBasisMonth: null })
  })
})
