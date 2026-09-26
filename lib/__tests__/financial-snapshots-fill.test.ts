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
 *   backfill uses, and null for any month that ended after Airwallex yield
 *   was first held (the Cash card counts yield, and what sat in yield at a
 *   past month end is not stored), whether or not any yield is left today:
 *   finance.yieldFirstHeldAt, not today's yield rows, says which months.
 *   Burn is the trailing P&L (a month synced before it closed is left out).
 *   Owed comes from invoice dates and goes null the moment one invoice with
 *   money on it cannot be placed at month end, or when the invoice ledger
 *   does not reach back to the month end: never a made-up 0. MRR and active
 *   clients are always null. A month from before all the data, a month whose
 *   balances were read before it ended, and a month where neither cash nor
 *   owed can be rebuilt are refused with nothing written.
 *
 *   THE MONTH END is half-open: anything stamped exactly at it (a Xero
 *   invoice dated the 1st, a payment on the 1st, a transaction at midnight)
 *   belongs to the next month.
 *
 *   THE BACKFILL no longer rewrites settled months. Without refresh an
 *   existing row is never touched, whatever its source; with refresh only
 *   rows it wrote itself are recomputed, and a cron row never is. It writes
 *   no month that ended after yield was first held, and nothing at all while
 *   that date is unknown.
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
  readYieldHeldSince,
  SnapshotFillRefusal,
  type OwedInvoiceRow,
} from '../financial-snapshots'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<unknown[][]>
}

/**
 * `afterRead` runs after every read, so a test can play a concurrent writer;
 * `beforeRun` runs before every write, so a test can make one fail.
 */
function d1Adapter(sqlite: DatabaseSync, afterRead?: (query: string) => void, beforeRun?: (query: string) => void) {
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
          beforeRun?.(query)
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
    currency text, source text, sent_at text, paid_at text, created_at text NOT NULL, updated_at text NOT NULL
  );
  CREATE TABLE settings (key text PRIMARY KEY, value text, updated_at text NOT NULL);
`

// "Today": late September 2026, so August is the last closed month.
const NOW = new Date('2026-09-26T12:00:00.000Z')
const AUG_END = Date.parse('2026-09-01T00:00:00.000Z')

interface InvoiceSeed {
  id: string
  status: string
  total: number
  currency?: string
  source?: string
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
  /** Airwallex yield rows, [currency, amount] (default: none held). */
  yieldHoldings?: Array<[string, number]>
  /** The finance.yieldFirstHeldAt value (default: no row). */
  yieldMarker?: string | null
  /** The finance.yieldHoldings value (default: no row). */
  yieldHoldingsSetting?: string | null
}

function seed(options: SeedOptions = {}) {
  const {
    invoices = CLEAN_INVOICES,
    augustPnlSyncedAt = '2026-09-25T15:01:19.179Z',
    withLedger = true,
    withPnl = true,
    snapshots = true,
    balancesAsOf = '2026-09-26T06:00:00.000Z',
    yieldHoldings = [],
  } = options
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_0085)
  sqlite.exec(TABLES)

  const setting = sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  if (options.yieldMarker !== undefined) setting.run('finance.yieldFirstHeldAt', options.yieldMarker, '2026-09-20T18:00:00.000Z')
  if (options.yieldHoldingsSetting !== undefined) setting.run('finance.yieldHoldings', options.yieldHoldingsSetting, '2026-09-20T18:00:00.000Z')

  // 1 USD = 1.7 NZD.
  const rate = sqlite.prepare('INSERT INTO exchange_rates VALUES (?, ?, ?)')
  rate.run('USD', 1, '2026-09-26T00:00:00.000Z')
  rate.run('NZD', 1.7, '2026-09-26T00:00:00.000Z')

  if (withLedger) {
    const bal = sqlite.prepare('INSERT INTO airwallex_balances (account_id, account_name, currency, balance, available_balance, as_of, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    bal.run('acct_1:NZD', 'Main', 'NZD', 50000, 49000, balancesAsOf, balancesAsOf)
    bal.run('acct_1:USD', 'Main', 'USD', 1000, 1000, balancesAsOf, balancesAsOf)
    for (const [currency, amount] of yieldHoldings) {
      bal.run(`yield:${currency}`, `Airwallex ${currency} Yield`, currency, amount, amount, balancesAsOf, balancesAsOf)
    }

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

  const inv = sqlite.prepare('INSERT INTO invoices (id, number, status, total_usd, currency, source, sent_at, paid_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const row of invoices) {
    inv.run(row.id, row.id.toUpperCase(), row.status, row.total, row.currency ?? 'USD', row.source ?? 'xero', row.sentAt ?? null, row.paidAt ?? null, row.createdAt, row.updatedAt)
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
    // 0050-01 is well formed, but Date.UTC would read it as 1950.
    for (const month of ['2026-8', '2026-13', '2026-00', 'August', '', '2026-08-01', ' 2026-08', '0050-01', '1999-12']) {
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

  it('refuses a month that ended before any data we hold, where it used to write a made-up owed of 0', async () => {
    // The earliest data here is the zero write-off issued on 1 December 2025.
    // November 2025 ends at exactly that instant, so it holds nothing either.
    const { sqlite, database } = seed({ snapshots: false })
    for (const month of ['2023-01', '2025-11']) {
      const refusal = await refusalOf(fillMonthSnapshot(database, month, NOW))
      expect(refusal.code).toBe('before_data')
      expect(refusal.status).toBe(400)
      expect(refusal.message).toContain('2025-12-01T00:00:00.000Z')
    }
    // No invoices at all: the ledger (2 May) is the earliest data, and April
    // ended on 1 May.
    const bare = seed({ snapshots: false, invoices: [] })
    const april = await refusalOf(fillMonthSnapshot(bare.database, '2026-04', NOW))
    expect(april.code).toBe('before_data')
    expect(allSnapshots(sqlite)).toEqual([])
    expect(allSnapshots(bare.sqlite)).toEqual([])
  })

  it('refuses, rather than writing a row without cash, when the balances were read before the month ended', async () => {
    // A stalled Airwallex sync: the stored balances are from 20 August, and a
    // rewind cannot move forward to 31 August. Owed and burn could be
    // rebuilt, but a row written now could never gain its cash: a second
    // fill is refused once the month has a row.
    const { sqlite, database } = seed({ snapshots: false, balancesAsOf: '2026-08-20T00:00:00.000Z' })
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', NOW))
    expect(refusal.code).toBe('balances_stale')
    expect(refusal.status).toBe(422)
    expect(refusal.message).toContain('last synced 2026-08-20T00:00:00.000Z')
    expect(refusal.message).toContain('Run the Airwallex sync')
    expect(allSnapshots(sqlite)).toEqual([])
  })

  it('names the wallet row holding the balances back, since the sync never deletes one it stopped refreshing', async () => {
    // This morning's sync refreshed NZD and USD, but an old 'default:GBP'
    // row from June is still there, and the anchor is only as fresh as its
    // stalest row.
    const { sqlite, database } = seed({ snapshots: false })
    sqlite.prepare('INSERT INTO airwallex_balances (account_id, account_name, currency, balance, available_balance, as_of, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('default:GBP', 'Airwallex GBP', 'GBP', 0, 0, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', NOW))
    expect(refusal.code).toBe('balances_stale')
    expect(refusal.message).toContain('default:GBP (as_of 2026-06-01T00:00:00.000Z)')

    const backfill = await backfillCashFromLedger(database, NOW)
    expect(backfill.note).toContain('default:GBP')
    expect(allSnapshots(sqlite).map((row) => row.month_key)).toEqual(['2026-05'])
  })
})

describe('fillMonthSnapshot: while Airwallex yield is held', () => {
  // Production's shape on 26 September 2026: wallet balances plus a USD and
  // an AUD yield holding. The wallet ledger moved USD 20,000 into yield on
  // 5 August, so August's month end falls after the transfer and the money
  // sat in yield, not in the wallet, on 31 August.
  function seedWithYield(invoices: InvoiceSeed[]) {
    const seeded = seed({ invoices, snapshots: false, yieldHoldings: [['USD', 25100], ['AUD', 534]] })
    seeded.sqlite.prepare('INSERT INTO airwallex_transactions (id, account_id, amount, currency, type, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('t-yield', 'acct_1', -20000, 'USD', 'unknown', null, '2026-08-05T00:00:00.000Z')
    return seeded
  }

  it('leaves cash and runway null for a month after the move into yield, and says why, rather than writing wallet cash alone', async () => {
    const { sqlite, database } = seedWithYield(CLEAN_INVOICES)
    const result = await fillMonthSnapshot(database, '2026-08', NOW)

    // A wallet-only rewind would give NZ$42,850 here, low by the whole
    // USD 20,000+ that sat in yield on 31 August. Nothing is guessed instead.
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('yield')
    expect(result.fields.cashNzd.basis).toContain('USD 25100, AUD 534')
    expect(result.fields.cashNzd.basis).toContain('not stored')
    expect(result.fields.runwayMonths.value).toBeNull()
    expect(result.filled).toEqual(['owedNzd', 'burnNzd'])

    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-08')).toMatchObject({
      cash_nzd: null, owed_nzd: 1850, burn_nzd: 15667, runway_months: null, source: 'backfill',
    })
  })

  it('refuses August outright when owed cannot be placed either, which is production today', async () => {
    // Production's August: yield held, and written-off invoices rewritten
    // after month end. Only burn is left, and burn alone is not written.
    const { sqlite, database } = seedWithYield([...CLEAN_INVOICES, AMBIGUOUS_WRITE_OFF])
    const refusal = await refusalOf(fillMonthSnapshot(database, '2026-08', NOW))
    expect(refusal.code).toBe('nothing_derivable')
    expect(refusal.status).toBe(422)
    expect(refusal.message).toContain('Neither month-end cash nor money owed')
    expect(refusal.message).toContain('yield')
    expect(allSnapshots(sqlite)).toEqual([])
  })
})

describe('fillMonthSnapshot and the backfill: after the yield has been withdrawn', () => {
  // USD 20,000 moved into yield on 5 August and came back on 15 September.
  // Liam then emptied finance.yieldHoldings, so the sync deleted the yield
  // rows: nothing held today. What is left is the marker the sync wrote the
  // first time it saw the holding.
  function seedWithdrawn(yieldMarker?: string | null, yieldHoldingsSetting?: string | null) {
    const seeded = seed({
      snapshots: false,
      ...(yieldMarker !== undefined ? { yieldMarker } : {}),
      ...(yieldHoldingsSetting !== undefined ? { yieldHoldingsSetting } : {}),
    })
    const txn = seeded.sqlite.prepare('INSERT INTO airwallex_transactions (id, account_id, amount, currency, type, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    txn.run('t-into-yield', 'acct_1', -20000, 'USD', 'unknown', null, '2026-08-05T00:00:00.000Z')
    txn.run('t-out-of-yield', 'acct_1', 20000, 'USD', 'unknown', null, '2026-09-15T00:00:00.000Z')
    return seeded
  }

  it('leaves August cash null on a fill, and writes nothing on a backfill, with no yield rows left', async () => {
    const fill = seedWithdrawn('unknown')
    const result = await fillMonthSnapshot(fill.database, '2026-08', NOW)
    // The wallet-only figure would be NZ$8,850 (the control below), low by
    // the USD 20,000 (NZ$34,000) that sat in yield on 31 August.
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('finance.yieldFirstHeldAt is "unknown"')
    expect(result.fields.cashNzd.basis).toContain('None is held today')
    expect(result.fields.cashNzd.basis).toContain('date of the first transfer into yield')
    expect(result.fields.runwayMonths.value).toBeNull()
    expect(allSnapshots(fill.sqlite)).toEqual([
      expect.objectContaining({ month_key: '2026-08', cash_nzd: null, owed_nzd: 1850, runway_months: null }),
    ])

    for (const refresh of [false, true]) {
      const backfill = seedWithdrawn('unknown')
      const done = await backfillCashFromLedger(backfill.database, NOW, { refresh })
      expect(done.monthsWritten).toBe(0)
      expect(done.monthsRefreshed).toBe(0)
      expect(done.note).toMatch(/^Nothing written\./)
      expect(done.note).toContain('finance.yieldFirstHeldAt')
      expect(allSnapshots(backfill.sqlite)).toEqual([])
    }
  })

  it('treats an emptied finance.yieldHoldings row as evidence when the yield went before any sync wrote the marker', async () => {
    const fill = seedWithdrawn(undefined, '[]')
    const result = await fillMonthSnapshot(fill.database, '2026-08', NOW)
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('finance.yieldHoldings setting was recorded')

    const backfill = seedWithdrawn(undefined, '[]')
    const done = await backfillCashFromLedger(backfill.database, NOW)
    expect(done.monthsWritten).toBe(0)
    expect(allSnapshots(backfill.sqlite)).toEqual([])
  })

  it('with no record of yield anywhere, rebuilds wallet cash alone, which is what the records exist to stop', async () => {
    const { database } = seedWithdrawn()
    const result = await fillMonthSnapshot(database, '2026-08', NOW)
    // NZD 42,000 as before; USD 1,000 - 500 (t3) - 20,000 (back from yield
    // in September) = -19,500, which is NZ$-33,150. The move into yield on
    // 5 August is inside August and stays, so the wallet reads the whole
    // USD 20,000 short: that money sat in yield on 31 August.
    expect(result.fields.cashNzd.value).toBe(8850)
    expect(result.fields.cashNzd.basis).toContain('No Airwallex yield holding has been recorded')
  })

  it('with the date of the first transfer into yield, rebuilds the months that ended by then and only those', async () => {
    const july = seedWithdrawn('2026-08-05')
    const julyResult = await fillMonthSnapshot(july.database, '2026-07', NOW)
    // July ended on 1 August, before the move into yield, so the wallet held
    // everything: NZD 45,000, and USD 1,000 - 500 - 20,000 + 20,000 = 500
    // (NZ$850), since both yield transfers came after July's end.
    expect(julyResult.fields.cashNzd.value).toBe(45850)
    expect(julyResult.fields.cashNzd.basis).toContain('first held on or after 2026-08-05T00:00:00.000Z')

    const august = seedWithdrawn('2026-08-05')
    const augustResult = await fillMonthSnapshot(august.database, '2026-08', NOW)
    expect(augustResult.fields.cashNzd.value).toBeNull()
    expect(augustResult.fields.cashNzd.basis).toContain('held since 2026-08-05T00:00:00.000Z')

    const backfill = seedWithdrawn('2026-08-05')
    const done = await backfillCashFromLedger(backfill.database, NOW)
    expect(done.writtenMonths).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(done.note).toContain('ended after Airwallex yield was first held: 2026-08')
    expect(allSnapshots(backfill.sqlite).find((row) => row.month_key === '2026-07')?.cash_nzd).toBe(45850)
  })

  it('with a dated marker and yield still held, rebuilds an earlier month from the wallet, transfer into yield rewound', async () => {
    const { database, sqlite } = seed({ snapshots: false, yieldHoldings: [['USD', 20000]], yieldMarker: '2026-08-05' })
    sqlite.prepare('INSERT INTO airwallex_transactions (id, account_id, amount, currency, type, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('t-into-yield', 'acct_1', -20000, 'USD', 'unknown', null, '2026-08-05T00:00:00.000Z')
    const result = await fillMonthSnapshot(database, '2026-07', NOW)
    // NZD 45,000; USD 1,000 - 500 + 20,000 = 20,500 in the wallet on 31 July
    // (NZ$34,850), none of it in yield yet.
    expect(result.fields.cashNzd.value).toBe(79850)
  })
})

describe('readYieldHeldSince', () => {
  it('reads a date from the marker, and anything else as held since a date not recorded', () => {
    expect(readYieldHeldSince(null, false)).toBeNull()
    expect(readYieldHeldSince(null, true)).toBe(-Infinity)
    expect(readYieldHeldSince({ value: 'unknown' }, false)).toBe(-Infinity)
    expect(readYieldHeldSince({ value: null }, false)).toBe(-Infinity)
    expect(readYieldHeldSince({ value: '5 Aug 2026' }, false)).toBe(-Infinity)
    // A dated marker wins over the rows and the setting: they only say that
    // yield was held, the marker says since when.
    expect(readYieldHeldSince({ value: '2026-08-05' }, true)).toBe(Date.parse('2026-08-05T00:00:00.000Z'))
    expect(readYieldHeldSince({ value: ' 2026-08-05T09:30:00Z ' }, false)).toBe(Date.parse('2026-08-05T09:30:00.000Z'))
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

  it('throws a write that failed for any other reason, rather than calling it a race', async () => {
    const { sqlite } = seed()
    const database = drizzle(d1Adapter(sqlite, undefined, (query) => {
      if (/insert into "financial_snapshots"/i.test(query)) throw new Error('NOT NULL constraint failed: financial_snapshots.captured_at')
    }) as unknown as AnyD1Database)

    let thrown: unknown = null
    try {
      await fillMonthSnapshot(database, '2026-08', NOW)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(SnapshotFillRefusal)
    const cause = (thrown as Error).cause instanceof Error ? ((thrown as Error).cause as Error).message : ''
    expect(`${(thrown as Error).message} ${cause}`).toContain('NOT NULL constraint failed')
    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-08')).toBeUndefined()
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

  it('rewinds a transaction stamped exactly at month end out of the month, since it belongs to the next one', async () => {
    const { sqlite, database } = seed({ snapshots: false })
    sqlite.prepare('INSERT INTO airwallex_transactions (id, account_id, amount, currency, type, settled_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('t-midnight', 'acct_1', 4000, 'NZD', 'deposit', null, '2026-09-01T00:00:00.000Z')
    const result = await fillMonthSnapshot(database, '2026-08', NOW)
    // 42,850 as before, less the NZ$4,000 that landed on 1 September.
    expect(result.fields.cashNzd.value).toBe(38850)
    expect(result.fields.cashNzd.basis).toContain('4 ledger transactions')
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

  it('fills cash as null, and says so, when the Airwallex ledger does not reach back to the month end', async () => {
    // The invoice ledger reaches back to December 2025 (the zero write-off),
    // and one April invoice was paid in May, so owed at April's end is proven.
    const aprilInvoice: InvoiceSeed = {
      id: 'inv-apr', status: 'paid', total: 800, currency: 'NZD', sentAt: '2026-04-10T00:00:00.000Z',
      paidAt: '2026-05-20T00:00:00.000Z', createdAt: '2026-04-09T00:00:00.000Z', updatedAt: '2026-05-20T00:00:00.000Z',
    }
    const zeroWriteOff = CLEAN_INVOICES.find((row) => row.id === 'inv-g') as InvoiceSeed
    const { sqlite, database } = seed({ snapshots: false, invoices: [zeroWriteOff, aprilInvoice] })
    // April ends on 1 May; the earliest transaction is 2 May.
    const result = await fillMonthSnapshot(database, '2026-04', NOW)
    expect(result.fields.cashNzd.value).toBeNull()
    expect(result.fields.cashNzd.basis).toContain('does not reach back')
    expect(result.fields.runwayMonths.value).toBeNull()
    expect(allSnapshots(sqlite)).toEqual([
      expect.objectContaining({ month_key: '2026-04', cash_nzd: null, owed_nzd: 800, burn_nzd: null, source: 'backfill' }),
    ])
  })

  it('leaves owed null, not 0, for a month the invoice ledger does not reach', async () => {
    // The only invoice was sent on 10 August. June is inside the Airwallex
    // ledger, so its cash rebuilds, but no invoice shows the invoice ledger
    // goes back to June, and 0 owed would be a guess.
    const onlyAugust = CLEAN_INVOICES.filter((row) => row.id === 'inv-a')
    const { sqlite, database } = seed({ snapshots: false, invoices: onlyAugust })
    const result = await fillMonthSnapshot(database, '2026-06', NOW)

    expect(result.fields.owedNzd.value).toBeNull()
    expect(result.fields.owedNzd.basis).toContain('earliest issue date held is 2026-08-10T00:00:00.000Z')
    expect(result.owed).toMatchObject({ owedNzd: null, beforeLedger: true, ledgerFrom: '2026-08-10T00:00:00.000Z', certainCount: 0 })
    // 50,000 - 10,000 + 2,000 + 3,000 NZD, plus USD 500 (NZ$850).
    expect(allSnapshots(sqlite)).toEqual([
      expect.objectContaining({ month_key: '2026-06', cash_nzd: 45850, owed_nzd: null }),
    ])
  })
})

describe('owedAsOf', () => {
  const RATES = { NZD: 1, USD: 1 / 1.7 }
  const base: OwedInvoiceRow = {
    id: 'x', number: null, status: 'sent', totalUsd: 100, currency: 'NZD', source: 'xero',
    sentAt: null, paidAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }
  // Paid in July and untouched since: shows the ledger reaches back past
  // August's end without moving the figure.
  const cover: OwedInvoiceRow = {
    ...base, id: 'cover', status: 'paid', createdAt: '2026-07-01T00:00:00.000Z', paidAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
  }

  it('is null, never 0, when no invoice in the ledger was issued by the instant', () => {
    const empty = owedAsOf([], AUG_END, RATES)
    expect(empty).toMatchObject({ owedNzd: null, beforeLedger: true, ledgerFrom: null, certainCount: 0 })

    // Only a September invoice and a draft: nothing issued by 31 August.
    const later = owedAsOf([
      { ...base, id: 'sep', sentAt: '2026-09-05T00:00:00.000Z', createdAt: '2026-09-04T00:00:00.000Z' },
      { ...base, id: 'draft', status: 'draft', createdAt: '2026-07-01T00:00:00.000Z' },
    ], AUG_END, RATES)
    expect(later).toMatchObject({ owedNzd: null, beforeLedger: true, ledgerFrom: '2026-09-05T00:00:00.000Z' })

    // One July invoice paid in July is enough to show the ledger reaches back.
    expect(owedAsOf([cover], AUG_END, RATES)).toMatchObject({ owedNzd: 0, beforeLedger: false, ledgerFrom: '2026-07-01T00:00:00.000Z' })
  })

  it('treats a ManyRequests paid date copied from the invoice date as no paid date, but trusts a Stripe charge', () => {
    // The ManyRequests importer copies created_at into paid_at when no
    // payment date came across. Read at face value, a July invoice paid in
    // September would look paid on the day it was raised.
    const copied: OwedInvoiceRow = { ...base, status: 'paid', source: 'manyrequests', createdAt: '2026-07-01T00:00:00.000Z', paidAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }
    const rewritten = owedAsOf([cover, copied], AUG_END, RATES)
    expect(rewritten.owedNzd).toBeNull()
    expect(rewritten.ambiguous[0]?.reason).toContain('copy of its invoice date')

    // Untouched since before month end: it already said paid then.
    expect(owedAsOf([cover, { ...copied, updatedAt: '2026-08-20T00:00:00.000Z' }], AUG_END, RATES)).toMatchObject({ owedNzd: 0, ambiguous: [] })

    // A Stripe charge is paid the moment it exists, so equal dates are real.
    expect(owedAsOf([cover, { ...copied, source: 'stripe' }], AUG_END, RATES)).toMatchObject({ owedNzd: 0, ambiguous: [] })
  })

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
    expect(owedAsOf([cover, { ...base, status: 'mystery' }], AUG_END, RATES)).toMatchObject({ owedNzd: 0, ambiguous: [] })
  })

  it('puts a Xero date-only stamp on the 1st in the next month, for the issue date and the paid date alike', () => {
    // Xero rows carry created_at = the invoice's DateString (midnight, no
    // zone) and paid_at = normaliseXeroDate(FullyPaidOnDate) (midnight UTC),
    // so both land exactly on August's end.
    const datedFirst: OwedInvoiceRow = { ...base, id: 'sep-1', status: 'sent', totalUsd: 5000, createdAt: '2026-09-01T00:00:00', updatedAt: '2026-09-01T00:00:00' }
    expect(owedAsOf([cover, datedFirst], AUG_END, RATES)).toMatchObject({ owedNzd: 0, certainCount: 0 })
    // With nothing issued in August, nothing shows the ledger reaches it.
    expect(owedAsOf([datedFirst], AUG_END, RATES)).toMatchObject({ owedNzd: null, beforeLedger: true, certainCount: 0 })

    const paidFirst: OwedInvoiceRow = {
      ...base, id: 'aug-20', status: 'paid', totalUsd: 3000, createdAt: '2026-08-20T00:00:00', paidAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }
    expect(owedAsOf([paidFirst], AUG_END, RATES)).toMatchObject({ owedNzd: 3000, certainCount: 1 })
  })

  it('treats a row rewritten, or a draft sent, exactly at month end as after it', () => {
    // A paid invoice with no paid date, last written at the stroke of
    // midnight: that write happened in September, so August's state is open.
    const touched = owedAsOf([{ ...base, status: 'paid', updatedAt: '2026-09-01T00:00:00.000Z' }], AUG_END, RATES)
    expect(touched.owedNzd).toBeNull()
    expect(touched.ambiguous[0]?.reason).toContain('no paid date')

    // A draft first sent at that same instant was never out in August.
    const draft = owedAsOf([cover, { ...base, status: 'draft', sentAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' }], AUG_END, RATES)
    expect(draft).toMatchObject({ owedNzd: 0, ambiguous: [] })
  })

  it('reads a zone-less date as UTC wherever the code runs', () => {
    // 00:30 on 1 September UTC is after August's end. Read as local time in
    // New Zealand it would be 31 August and wrongly count as owed.
    const result = owedAsOf([cover, { ...base, createdAt: '2026-09-01T00:30:00' }], AUG_END, RATES)
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

  it('says so, rather than blaming the ledger, when every month ended after the balances were read', async () => {
    const { sqlite, database } = seed({ snapshots: false, balancesAsOf: '2026-04-15T00:00:00.000Z' })
    const result = await backfillCashFromLedger(database, NOW)

    expect(result.monthsWritten).toBe(0)
    expect(result.note).toMatch(/^Nothing written\./)
    expect(result.note).toContain('last synced before they ended: 2026-05, 2026-06, 2026-07, 2026-08')
    expect(result.note).not.toContain('ledger')
    expect(allSnapshots(sqlite)).toEqual([])
  })

  it('reports a month whose row appeared mid-run as left untouched, not as written', async () => {
    const { sqlite } = seed({ snapshots: false })
    // The daily cron writes August right after the backfill has read which
    // months already have a row, so the insert changes nothing.
    let raced = false
    const database = drizzle(d1Adapter(sqlite, (query) => {
      if (raced || !/from "financial_snapshots"/i.test(query)) return
      raced = true
      sqlite.prepare("INSERT INTO financial_snapshots (month_key, cash_nzd, source, captured_at, created_at) VALUES ('2026-08', 88888, 'cron', '2026-09-26T12:00:01.000Z', '2026-09-26T12:00:01.000Z')").run()
    }) as unknown as AnyD1Database)

    const result = await backfillCashFromLedger(database, NOW)
    expect(raced).toBe(true)
    expect(result.writtenMonths).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(result.skippedMonths).toEqual(['2026-08'])
    expect(allSnapshots(sqlite).find((row) => row.month_key === '2026-08')).toMatchObject({ cash_nzd: 88888, source: 'cron' })
  })

  it('writes nothing while yield is held, refresh or not, and says why', async () => {
    for (const refresh of [false, true]) {
      const { sqlite, database } = seed({ yieldHoldings: [['USD', 25100]] })
      const before = allSnapshots(sqlite)
      const result = await backfillCashFromLedger(database, NOW, { refresh })
      expect(result.monthsWritten).toBe(0)
      expect(result.monthsRefreshed).toBe(0)
      expect(result.note).toContain('Nothing written')
      expect(result.note).toContain('USD 25100')
      expect(allSnapshots(sqlite)).toEqual(before)
    }
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
