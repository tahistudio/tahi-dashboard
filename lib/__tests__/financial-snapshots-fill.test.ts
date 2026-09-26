/**
 * The single-month fill and the no-overwrite backfill (lib/financial-snapshots.ts).
 *
 * Production has rows for 2026-05 and 2026-06 (backfill), 2026-07 (cron,
 * written once on 10 July) and 2026-09 (cron, daily). 2026-08 is missing.
 * What is pinned here, against a real SQLite database (node:sqlite behind the
 * D1 shape drizzle's d1 driver calls, the table built from migration 0085):
 *
 *   THE FILL writes one month and only one. It refuses a malformed month, the
 *   current month, a future month and a month that already has a row, and on
 *   every refusal the table is byte-for-byte what it was. It inserts once;
 *   a second fill of the same month is refused and the first row stands.
 *
 *   ITS FIELDS are only what the data proves. Cash is the ledger rewind the
 *   backfill uses, burn the trailing P&L (a month synced before it closed is
 *   left out), owed comes from invoice dates and goes null the moment one
 *   invoice with money on it cannot be placed at month end. MRR and active
 *   clients are always null.
 *
 *   THE BACKFILL no longer rewrites settled months. Without refresh an
 *   existing row is never touched, whatever its source; with refresh only
 *   rows it wrote itself are recomputed, and a cron row never is.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { describe, it, expect } from 'vitest'
import {
  backfillCashFromLedger,
  fillMonthSnapshot,
  owedAsOf,
  parseInstant,
  SnapshotFillRefusal,
  type OwedInvoiceRow,
} from '../financial-snapshots'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<unknown[][]>
}

/** `afterRead` runs after every read, so a test can play a concurrent writer. */
function d1Adapter(sqlite: DatabaseSync, afterRead?: (query: string) => void) {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          const results = stmt.all(...(params as never[])) as unknown[]
          afterRead?.(query)
          return { results }
        },
        async run() {
          const info = stmt.run(...(params as never[]))
          return { success: true, meta: { changes: Number(info.changes) } }
        },
        async raw() {
          const rows = stmt.all(...(params as never[])) as Array<Record<string, unknown>>
          afterRead?.(query)
          return rows.map((row) => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

const MIGRATION_0085 = readFileSync(
  join(__dirname, '../../drizzle/migrations/0085_financial_snapshots.sql'),
  'utf8',
)

const TABLES = `
  CREATE TABLE exchange_rates (currency text PRIMARY KEY, rate_to_usd real NOT NULL, updated_at text NOT NULL);
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
  CREATE TABLE xero_pnl_snapshots (
    month_key text PRIMARY KEY, period_start text NOT NULL, period_end text NOT NULL,
    total_revenue real NOT NULL DEFAULT 0, total_cost_of_sales real NOT NULL DEFAULT 0,
    total_expenses real NOT NULL DEFAULT 0, gross_profit real NOT NULL DEFAULT 0,
    net_profit real NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'NZD',
    raw_json text, synced_at text NOT NULL
  );
  CREATE TABLE invoices (
    id text PRIMARY KEY, number text, status text NOT NULL, total_usd real NOT NULL,
    currency text, sent_at text, paid_at text, created_at text NOT NULL, updated_at text NOT NULL
  );
`

// "Today": late September 2026, so August is the last closed month.
const NOW = new Date('2026-09-26T12:00:00.000Z')
const AUG_END = Date.parse('2026-09-01T00:00:00.000Z')

interface InvoiceSeed {
  id: string
  status: string
  total: number
  currency?: string
  sentAt?: string | null
  paidAt?: string | null
  createdAt: string
  updatedAt: string
}

/** Invoices that fully determine August's money owed: NZ$1,850. */
const CLEAN_INVOICES: InvoiceSeed[] = [
  // Sent in August, still unpaid: owed.
  { id: 'inv-a', status: 'sent', total: 1000, currency: 'NZD', sentAt: '2026-08-10T00:00:00.000Z', createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z' },
  // A Xero import (no sent_at, created_at is Xero's zone-less invoice date),
  // paid in September: owed at August's end. USD 500 is NZ$850.
  { id: 'inv-b', status: 'paid', total: 500, currency: 'USD', createdAt: '2026-08-05T00:00:00', paidAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' },
  // Paid in August: not owed.
  { id: 'inv-c', status: 'paid', total: 300, currency: 'NZD', sentAt: '2026-07-01T00:00:00.000Z', paidAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' },
  // A draft is never money.
  { id: 'inv-d', status: 'draft', total: 999, currency: 'NZD', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' },
  // Created in August but first sent in September: not yet issued.
  { id: 'inv-e', status: 'sent', total: 700, currency: 'NZD', sentAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z' },
  // Written off, and the row has not been touched since June: dead by then.
  { id: 'inv-f', status: 'written_off', total: 400, currency: 'NZD', createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
  // Written off and rewritten since, but zero: it cannot move the figure.
  { id: 'inv-g', status: 'written_off', total: 0, currency: 'NZD', createdAt: '2025-12-01T00:00:00', updatedAt: '2026-09-12T10:53:28.100Z' },
]

/** Written off, rewritten on 18 September: may still have been owed on 31 August. */
const AMBIGUOUS_WRITE_OFF: InvoiceSeed = {
  id: 'inv-h', status: 'written_off', total: 600, currency: 'NZD', createdAt: '2025-12-27T00:04:49.000Z', updatedAt: '2026-09-18T20:43:17.994Z',
}

interface SeedOptions {
  invoices?: InvoiceSeed[]
  /** Override the August P&L row's synced_at (default: synced after it closed). */
  augustPnlSyncedAt?: string
  withLedger?: boolean
  withPnl?: boolean
  snapshots?: boolean
  /** When the Airwallex balances were read (default: this morning's sync). */
  balancesAsOf?: string
}

function seed(options: SeedOptions = {}) {
  const {
    invoices = CLEAN_INVOICES,
    augustPnlSyncedAt = '2026-09-25T15:01:19.179Z',
    withLedger = true,
    withPnl = true,
    snapshots = true,
    balancesAsOf = '2026-09-26T06:00:00.000Z',
  } = options
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_0085)
  sqlite.exec(TABLES)

  // 1 USD = 1.7 NZD.
  const rate = sqlite.prepare('INSERT INTO exchange_rates VALUES (?, ?, ?)')
  rate.run('USD', 1, '2026-09-26T00:00:00.000Z')
  rate.run('NZD', 1.7, '2026-09-26T00:00:00.000Z')

  if (withLedger) {
    const bal = sqlite.prepare('INSERT INTO airwallex_balances (account_id, account_name, currency, balance, available_balance, as_of, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    bal.run('acct_1:NZD', 'Main', 'NZD', 50000, 49000, balancesAsOf, balancesAsOf)
    bal.run('acct_1:USD', 'Main', 'USD', 1000, 1000, balancesAsOf, balancesAsOf)
    // Yield is excluded from the anchor; counting it would add NZ$99,999.
    bal.run('yield:NZD', 'Yield', 'NZD', 99999, 99999, balancesAsOf, balancesAsOf)

    const txn = sqlite.prepare('INSERT INTO airwallex_transactions (id, account_id, amount, currency, type, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    // After August closed: rewound out of August's balance.
    txn.run('t1', 'acct_1', 10000, 'NZD', 'deposit', null, '2026-09-10T00:00:00.000Z')
    txn.run('t2', 'acct_1', -2000, 'NZD', 'withdrawal', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')
    txn.run('t3', 'acct_1', 500, 'USD', 'deposit', '2026-09-15T00:00:00.000Z', '2026-09-15T00:00:00.000Z')
    // Inside August: moves July's balance, not August's.
    txn.run('t4', 'acct_1', -3000, 'NZD', 'withdrawal', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
    // The earliest transaction held: the ledger reaches back into May.
    txn.run('t5', 'acct_1', 1000, 'NZD', 'deposit', '2026-05-02T00:00:00.000Z', '2026-05-02T00:00:00.000Z')
  }

  if (withPnl) {
    const pnl = sqlite.prepare('INSERT INTO xero_pnl_snapshots (month_key, period_start, period_end, total_cost_of_sales, total_expenses, currency, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    pnl.run('2026-06', '2026-06-01', '2026-06-30', 0, 15000, 'NZD', '2026-09-25T15:01:19.179Z')
    pnl.run('2026-07', '2026-07-01', '2026-07-31', 0, 16000, 'NZD', '2026-09-25T15:01:19.179Z')
    pnl.run('2026-08', '2026-08-01', '2026-08-31', 2000, 14000, 'NZD', augustPnlSyncedAt)
    pnl.run('2026-09', '2026-09-01', '2026-09-30', 0, 5000, 'NZD', '2026-09-25T15:01:19.179Z')
  }

  const inv = sqlite.prepare('INSERT INTO invoices (id, number, status, total_usd, currency, sent_at, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const row of invoices) {
    inv.run(row.id, row.id.toUpperCase(), row.status, row.total, row.currency ?? 'USD', row.sentAt ?? null, row.paidAt ?? null, row.createdAt, row.updatedAt)
  }

  if (snapshots) {
    // Production's shape: sentinel values, so any rewrite is visible.
    const snap = sqlite.prepare('INSERT INTO financial_snapshots (month_key, cash_nzd, owed_nzd, mrr_nzd, active_clients, burn_nzd, runway_months, source, captured_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    snap.run('2026-05', 11111, null, null, null, 14000, 0.79, 'backfill', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
    snap.run('2026-06', 22222, 777, null, null, 15000, 1.48, 'backfill', '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
    snap.run('2026-07', 33333, 4444, 17000, 9, 15500, 2.15, 'cron', '2026-07-10T18:00:00.000Z', '2026-07-10T18:00:00.000Z')
    snap.run('2026-09', 55555, 6666, 10317, 8, 16000, 3.47, 'cron', '2026-09-25T18:00:00.000Z', '2026-09-01T18:00:00.000Z')
  }

  return { sqlite, database: drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) }
}

type SnapshotRow = Record<string, unknown> & { month_key: string }

function allSnapshots(sqlite: DatabaseSync): SnapshotRow[] {
  return sqlite.prepare('SELECT * FROM financial_snapshots ORDER BY month_key').all() as SnapshotRow[]
}

function withoutMonth(rows: SnapshotRow[], monthKey: string): SnapshotRow[] {
  return rows.filter((row) => row.month_key !== monthKey)
}

async function refusalOf(promise: Promise<unknown>): Promise<SnapshotFillRefusal> {
  try {
    await promise
  } catch (err) {
    if (err instanceof SnapshotFillRefusal) return err
    throw err
  }
  throw new Error('expected a SnapshotFillRefusal, but the fill succeeded')
}

describe('fillMonthSnapshot: what it refuses', () => {
  it('refuses a malformed month and writes nothing', async () => {
    const { sqlite, database } = seed()
    const before = allSnapshots(sqlite)
    for (const month of ['2026-8', '2026-13', '2026-00', 'August', '', '2026-08-01', ' 2026-08']) {
      const refusal = await refusalOf(fillMonthSnapshot(database, month, NOW))
      expect(refusal.code).toBe('invalid_month')
      expect(refusal.status).toBe(400)
    }
    expect(allSnapshots(sqlite)).toEqual(before)
  })

  it('refuses the current month, even when it has no row, because the daily cron owns it', async () => {
    const { sqlite, database } = seed({ snapshots: false })
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-09', NOW))
    expect(refusal.code).toBe('not_past')
    expect(refusal.status).toBe(400)
    expect(refusal.message).toContain('current month')
    expect(allSnapshots(sqlite)).toEqual([])
  })

  it('refuses a future month', async () => {
    const { sqlite, database } = seed({ snapshots: false })
    for (const month of ['2026-10', '2027-01']) {
      const refusal = await refusalOf(fillMonthSnapshot(database, month, NOW))
      expect(refusal.code).toBe('not_past')
      expect(refusal.status).toBe(400)
    }
    expect(allSnapshots(sqlite)).toEqual([])
  })

  it('refuses a month that already has a row, cron or backfill, and leaves every row as it was', async () => {
    const { sqlite, database } = seed()
    const before = allSnapshots(sqlite)

    const cron = await refusalOf(fillMonthSnapshot(database, '2026-07', NOW))
    expect(cron.code).toBe('exists')
    expect(cron.status).toBe(409)
    expect(cron.existing).toEqual({ source: 'cron', capturedAt: '2026-07-10T18:00:00.000Z' })
    expect(cron.message).toContain('never overwrites')

    const backfill = await refusalOf(fillMonthSnapshot(database, '2026-06', NOW))
    expect(backfill.code).toBe('exists')
    expect(backfill.existing?.source).toBe('backfill')

    expect(allSnapshots(sqlite)).toEqual(before)
  })

  it('refuses when nothing can be rebuilt, rather than writing a row of nulls that would block a later fill', async () => {
    const { sqlite, database } = seed({ withLedger: false, withPnl: false, invoices: [AMBIGUOUS_WRITE_OFF], snapshots: false })
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', NOW))
    expect(refusal.code).toBe('nothing_derivable')
    expect(refusal.status).toBe(422)
    expect(allSnapshots(sqlite)).toEqual([])
  })
})

describe('fillMonthSnapshot: the write', () => {
  it('inserts August once, from the ledger, the P&L and the invoices, and touches no other month', async () => {
    const { sqlite, database } = seed()
    const before = allSnapshots(sqlite)

    const result = await fillMonthSnapshot(database, '2026-08', NOW)

    const after = allSnapshots(sqlite)
    expect(after).toHaveLength(before.length + 1)
    // Every other month is byte-for-byte what it was.
    expect(withoutMonth(after, '2026-08')).toEqual(before)

    // NZD 50,000 - 10,000 (t1) + 2,000 (t2) = 42,000; USD 1,000 - 500 (t3)
    // = 500, which is NZ$850. t4 is inside August and t5 long before.
    const august = after.find((row) => row.month_key === '2026-08')
    expect(august).toMatchObject({
      cash_nzd: 42850,
      owed_nzd: 1850,
      mrr_nzd: null,
      active_clients: null,
      // (15,000 + 16,000 + 16,000) / 3, June to August.
      burn_nzd: 15667,
      source: 'backfill',
      captured_at: NOW.toISOString(),
      created_at: NOW.toISOString(),
    })
    expect(august?.runway_months).toBeCloseTo(42850 / 15667, 6)

    expect(result.monthKey).toBe('2026-08')
    expect(result.monthEnd).toBe('2026-09-01T00:00:00.000Z')
    expect(result.filled).toEqual(['cashNzd', 'owedNzd', 'burnNzd', 'runwayMonths'])
    expect(result.leftNull).toEqual(['mrrNzd', 'activeClients'])
    expect(result.fields.cashNzd.basis).toContain('3 ledger transactions')
    expect(result.fields.burnNzd.basis).toContain('2026-06, 2026-07, 2026-08')
    expect(result.fields.mrrNzd.basis).toContain('no history')
    expect(result.fields.activeClients.value).toBeNull()
    expect(result.owed).toMatchObject({ owedNzd: 1850, certainCount: 2, ambiguous: [] })
  })

  it('refuses a second fill of the same month, and the first row stands', async () => {
    const { sqlite, database } = seed()
    await fillMonthSnapshot(database, '2026-08', NOW)
    const afterFirst = allSnapshots(sqlite)

    const later = new Date('2026-09-27T09:00:00.000Z')
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', later))
    expect(refusal.code).toBe('exists')
    expect(refusal.existing).toEqual({ source: 'backfill', capturedAt: NOW.toISOString() })
    expect(allSnapshots(sqlite)).toEqual(afterFirst)
  })

  it('is a plain insert: a row that lands while the fill runs wins, and the fill is refused', async () => {
    const { sqlite } = seed()
    // The daily cron writes August the moment the fill's existence check
    // has read nothing. An upsert would now overwrite it.
    let raced = false
    const database = drizzle(d1Adapter(sqlite, (query) => {
      if (raced || !/from "financial_snapshots" where/i.test(query)) return
      raced = true
      sqlite.prepare("INSERT INTO financial_snapshots (month_key, cash_nzd, source, captured_at, created_at) VALUES ('2026-08', 88888, 'cron', '2026-09-26T12:00:01.000Z', '2026-09-26T12:00:01.000Z')").run()
    }) as unknown as AnyD1Database)

    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', NOW))
    expect(raced).toBe(true)
    expect(refusal.code).toBe('exists')
    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-08')).toMatchObject({ cash_nzd: 88888, source: 'cron' })
  })

  it('leaves owed null when one written-off invoice cannot be placed at month end, and says why', async () => {
    const { sqlite, database } = seed({ invoices: [...CLEAN_INVOICES, AMBIGUOUS_WRITE_OFF] })
    const result = await fillMonthSnapshot(database, '2026-08', NOW)

    const august = allSnapshots(sqlite).find((row) => row.month_key === '2026-08')
    expect(august?.owed_nzd).toBeNull()
    // The rest of the row still lands.
    expect(august?.cash_nzd).toBe(42850)

    expect(result.fields.owedNzd.value).toBeNull()
    expect(result.leftNull).toContain('owedNzd')
    expect(result.owed?.certainNzd).toBe(1850)
    expect(result.owed?.ambiguousNzd).toBe(600)
    expect(result.owed?.ambiguous).toEqual([
      expect.objectContaining({ id: 'inv-h', number: 'INV-H', status: 'written_off', amountNzd: 600 }),
    ])
    expect(result.fields.owedNzd.basis).toContain('NZ$1850')
    expect(result.fields.owedNzd.basis).toContain('NZ$2450')
  })

  it('leaves a P&L month synced before it closed out of the burn', async () => {
    const { database } = seed({ augustPnlSyncedAt: '2026-08-20T00:00:00.000Z' })
    const result = await fillMonthSnapshot(database, '2026-08', NOW)
    // June and July only: (15,000 + 16,000) / 2.
    expect(result.fields.burnNzd.value).toBe(15500)
    expect(result.fields.burnNzd.basis).toContain('2026-06, 2026-07')
    expect(result.fields.burnNzd.basis).not.toContain('2026-08')
  })

  it('fills cash as null, and says so, when the balances were read before the month ended', async () => {
    // A stalled Airwallex sync: the stored balances are from 20 August, and a
    // rewind cannot move forward to 31 August.
    const { sqlite, database } = seed({ balancesAsOf: '2026-08-20T00:00:00.000Z' })
    const result = await fillMonthSnapshot(database, '2026-08', NOW)
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('last synced 2026-08-20T00:00:00.000Z')
    expect(result.fields.runwayMonths.value).toBeNull()
    // What the data does prove still lands.
    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-08')).toMatchObject({
      cash_nzd: null, owed_nzd: 1850, burn_nzd: 15667, runway_months: null,
    })
  })

  it('does not subtract a transaction dated after the balances were read', async () => {
    // Balances read on 12 September: t1 (10 Sep) and t2 (5 Sep) are inside
    // them and rewind out; t3 (15 Sep, USD) is not in them, so it stays.
    const { database } = seed({ balancesAsOf: '2026-09-12T00:00:00.000Z' })
    const result = await fillMonthSnapshot(database, '2026-08', NOW)
    // NZD 50,000 - 10,000 + 2,000 = 42,000, plus USD 1,000 = NZ$1,700.
    expect(result.fields.cashNzd.value).toBe(43700)
    expect(result.fields.cashNzd.basis).toContain('2 ledger transactions')
  })

  it('fills cash as null, and says so, when the ledger does not reach back to the month end', async () => {
    // No invoices, so owed is a provable 0 and the fill still has one field.
    const { database } = seed({ snapshots: false, invoices: [] })
    // April ends on 1 May; the earliest transaction is 2 May.
    const result = await fillMonthSnapshot(database, '2026-04', NOW)
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('does not reach back')
    expect(result.fields.runwayMonths.value).toBeNull()
  })
})

describe('owedAsOf', () => {
  const RATES = { NZD: 1, USD: 1 / 1.7 }
  const base: OwedInvoiceRow = {
    id: 'x', number: null, status: 'sent', totalUsd: 100, currency: 'NZD',
    sentAt: null, paidAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }

  it('counts a paid invoice with no paid date as settled only if the row is untouched since month end', () => {
    const untouched = owedAsOf([{ ...base, status: 'paid', updatedAt: '2026-08-31T23:00:00.000Z' }], AUG_END, RATES)
    expect(untouched).toMatchObject({ owedNzd: 0, ambiguous: [] })

    const rewritten = owedAsOf([{ ...base, status: 'paid', updatedAt: '2026-09-02T00:00:00.000Z' }], AUG_END, RATES)
    expect(rewritten.owedNzd).toBeNull()
    expect(rewritten.ambiguous[0]?.reason).toContain('no paid date')
  })

  it('flags a draft that was sent before month end and rewritten since', () => {
    const result = owedAsOf([{ ...base, status: 'draft', sentAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' }], AUG_END, RATES)
    expect(result.owedNzd).toBeNull()
    expect(result.ambiguous[0]?.reason).toContain('draft')
  })

  it('flags an issued invoice whose dates cannot be read', () => {
    const result = owedAsOf([{ ...base, createdAt: 'not a date', sentAt: null }], AUG_END, RATES)
    expect(result.owedNzd).toBeNull()
    expect(result.ambiguous[0]?.reason).toContain('No issue date')
  })

  it('ignores a status no bucket knows, as the live owed figure does', () => {
    expect(owedAsOf([{ ...base, status: 'mystery' }], AUG_END, RATES)).toMatchObject({ owedNzd: 0, ambiguous: [] })
  })

  it('reads a zone-less date as UTC wherever the code runs', () => {
    // 00:30 on 1 September UTC is after August's end. Read as local time in
    // New Zealand it would be 31 August and wrongly count as owed.
    const result = owedAsOf([{ ...base, createdAt: '2026-09-01T00:30:00' }], AUG_END, RATES)
    expect(result).toMatchObject({ owedNzd: 0, certainCount: 0 })
    expect(parseInstant('2026-09-01T00:30:00')).toBe(Date.parse('2026-09-01T00:30:00.000Z'))
    expect(parseInstant('2026-01-01 09:30:00')).toBe(Date.parse('2026-01-01T09:30:00.000Z'))
    expect(parseInstant('2026-08-01')).toBe(Date.parse('2026-08-01T00:00:00.000Z'))
    expect(parseInstant(null)).toBeNull()
    expect(parseInstant('garbage')).toBeNull()
  })
})

describe('backfillCashFromLedger: never overwrites without refresh', () => {
  it('writes only the month with no row and leaves every existing row, cron or backfill, as it was', async () => {
    const { sqlite, database } = seed()
    const before = allSnapshots(sqlite)

    const result = await backfillCashFromLedger(database, NOW)

    expect(result.refresh).toBe(false)
    expect(result.writtenMonths).toEqual(['2026-08'])
    expect(result.refreshedMonths).toEqual([])
    expect(result.skippedMonths).toEqual(['2026-05', '2026-06', '2026-07'])
    const after = allSnapshots(sqlite)
    expect(withoutMonth(after, '2026-08')).toEqual(before)
    // Cash only: owed stays null on a backfill row.
    expect(after.find((row) => row.month_key === '2026-08')).toMatchObject({
      cash_nzd: 42850, owed_nzd: null, mrr_nzd: null, active_clients: null, source: 'backfill',
    })
  })

  it('skips months that ended after the balances were read, and still rewinds the earlier ones', async () => {
    const { sqlite, database } = seed({ snapshots: false, balancesAsOf: '2026-07-15T00:00:00.000Z' })
    const result = await backfillCashFromLedger(database, NOW)

    expect(result.writtenMonths).toEqual(['2026-05', '2026-06'])
    expect(result.note).toContain('last synced before they ended: 2026-07, 2026-08')
    // Nothing in the ledger falls between 1 and 15 July, so June's end is
    // the balance as read: NZ$50,000 plus USD 1,000 (NZ$1,700).
    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-06')?.cash_nzd).toBe(51700)
    expect(allSnapshots(sqlite).map((row) => row.month_key)).toEqual(['2026-05', '2026-06'])
  })

  it('writes nothing on a re-run', async () => {
    const { sqlite, database } = seed()
    await backfillCashFromLedger(database, NOW)
    const afterFirst = allSnapshots(sqlite)

    const again = await backfillCashFromLedger(database, new Date('2026-09-27T12:00:00.000Z'))
    expect(again.monthsWritten).toBe(0)
    expect(again.monthsRefreshed).toBe(0)
    expect(again.note).toContain('never overwritten')
    expect(allSnapshots(sqlite)).toEqual(afterFirst)
  })

  it('with refresh, recomputes only the rows a backfill wrote, keeps their owed figure, and never touches a cron row', async () => {
    const { sqlite, database } = seed()
    const cronBefore = allSnapshots(sqlite).filter((row) => row.source === 'cron')

    const result = await backfillCashFromLedger(database, NOW, { refresh: true })

    expect(result.refresh).toBe(true)
    expect(result.writtenMonths).toEqual(['2026-08'])
    expect(result.refreshedMonths).toEqual(['2026-05', '2026-06'])
    expect(result.skippedMonths).toEqual(['2026-07'])

    const after = allSnapshots(sqlite)
    expect(after.filter((row) => row.source === 'cron')).toEqual(cronBefore)
    const june = after.find((row) => row.month_key === '2026-06')
    // Recomputed from the ledger: 50,000 - 10,000 + 2,000 + 3,000 (t4) = 45,000
    // NZD plus NZ$850, the same at June's end as at July's (no June txns).
    expect(june?.cash_nzd).toBe(45850)
    expect(june?.cash_nzd).not.toBe(22222)
    expect(june?.owed_nzd).toBe(777)
    expect(june?.captured_at).toBe(NOW.toISOString())
    expect(june?.created_at).toBe('2026-09-02T00:00:00.000Z')
  })
})
