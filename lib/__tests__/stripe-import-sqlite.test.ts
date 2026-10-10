import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from '@/db/d1'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'

type Row = Record<string, SQLInputValue>
type Result = { results: Row[]; success: boolean; meta: { changes: number } }
interface Statement {
  parameters: SQLInputValue[]
  bind(...params: SQLInputValue[]): Statement
  all(): Promise<Result>
  raw(): Promise<SQLInputValue[][]>
  run(): Promise<Result>
  execute(): Result
}

const databases: DatabaseSync[] = []
afterEach(() => {
  databases.splice(0).forEach(database => database.close())
})

// Use the real schema's columns, nullability, defaults, indexes and foreign
// keys, so a mock cannot accidentally supply uniqueness production lacks.
function createTable(sqlite: DatabaseSync, table: SQLiteTable) {
  const config = getTableConfig(table)
  const columns = config.columns.map(column => {
    const defaultValue = typeof column.default === 'string'
      ? `'${column.default.replaceAll("'", "''")}'`
      : typeof column.default === 'number' ? column.default : undefined
    return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${defaultValue === undefined ? '' : ` DEFAULT ${defaultValue}`}`
  })
  const foreignKeys = config.foreignKeys.map(key => {
    const reference = key.reference()
    const target = getTableConfig(reference.foreignTable)
    return `FOREIGN KEY (${reference.columns.map(column => `"${column.name}"`).join(', ')}) REFERENCES "${target.name}" (${reference.foreignColumns.map(column => `"${column.name}"`).join(', ')})`
  })
  sqlite.exec(`CREATE TABLE "${config.name}" (${[...columns, ...foreignKeys].join(', ')})`)
  for (const { config: index } of config.indexes) {
    const names = index.columns.map(column => {
      if (!('name' in column)) throw new Error('Test harness requires ordinary indexed columns')
      return `"${column.name}"`
    })
    sqlite.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX "${index.name}" ON "${config.name}" (${names.join(', ')})`)
  }
}

function setup() {
  const sqlite = new DatabaseSync(':memory:')
  databases.push(sqlite)
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const table of [schema.organisations, schema.invoices, schema.invoiceItems]) createTable(sqlite, table)
  sqlite.prepare('INSERT INTO organisations (id, name, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('org-a', 'QA client', 'cus_qa', '2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z')

  const racedReads: SQLInputValue[][][] = []
  let releaseReads: (() => void) | undefined
  let readsReady: Promise<void> | undefined
  const write = vi.fn(async (_query: string, _params: SQLInputValue[], execute: () => Result) => execute())
  const prepare = (query: string): Statement => {
    const statement = sqlite.prepare(query)
    const bind = (...params: SQLInputValue[]): Statement => {
      const execute = (): Result => {
        if (/^\s*(select|.*\breturning\b)/i.test(query)) {
          const results = statement.all(...params) as Row[]
          return { results, success: true, meta: { changes: /^\s*select/i.test(query) ? 0 : results.length } }
        }
        const info = statement.run(...params)
        return { results: [], success: true, meta: { changes: Number(info.changes) } }
      }
      return {
        parameters: params,
        bind,
        execute,
        async all() { return execute() },
        async run() { return write(query, params, execute) },
        async raw() {
          const rows = execute().results.map(row => Object.values(row))
          if (readsReady && racedReads.length < 2 && /^select .* from "invoices"/i.test(query)) {
            racedReads.push(rows)
            if (racedReads.length === 2) releaseReads?.()
            await readsReady
          }
          return rows
        },
      }
    }
    return bind()
  }
  // D1 promises transactionality for batch. This adapter delegates statements
  // to SQLite and commits or rolls back the whole batch with real constraints.
  const batch = vi.fn(async (statements: Statement[]) => {
    sqlite.exec('BEGIN')
    try {
      const results = statements.map(statement => statement.execute())
      sqlite.exec('COMMIT')
      return results
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  })
  const database = drizzle({ prepare, batch } as unknown as AnyD1Database)
  return {
    sqlite, database, batch, write,
    raceFirstReads() { readsReady = new Promise(resolve => { releaseReads = resolve }) },
    racedReads: () => racedReads,
    invoices: () => sqlite.prepare('SELECT * FROM invoices ORDER BY id').all(),
    items: () => sqlite.prepare('SELECT * FROM invoice_items ORDER BY id').all(),
  }
}

function invoice(overrides: Partial<StripeInvoiceLike> = {}): StripeInvoiceLike {
  return {
    id: 'in_QArecovery', customer: 'cus_qa', number: 'STRIPE-QA-001', status: 'paid',
    currency: 'nzd', subtotal: 15000, total: 17250, amount_paid: 17250,
    created: 1_760_000_000, status_transitions: { paid_at: 1_760_000_500 },
    hosted_invoice_url: 'https://invoice.stripe.com/i/qa',
    lines: { data: [
      { id: 'il_1', description: 'Design', quantity: 2, amount: 10000 },
      { id: 'il_2', description: 'Development', quantity: 1, amount: 5000 },
    ] },
    ...overrides,
  }
}

describe('importStripeInvoice with real SQLite behind the D1 driver', () => {
  it('stores the paid invoice and every item together with currency, source and payment metadata', async () => {
    const db = setup()
    const result = await importStripeInvoice(db.database, invoice(), { autoCreateOrg: false })
    expect(result).toMatchObject({ created: true, orgId: 'org-a' })
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.batch.mock.calls[0][0]).toHaveLength(3)
    expect(db.invoices()).toEqual([expect.objectContaining({
      stripe_invoice_id: 'in_QArecovery', org_id: 'org-a', number: 'STRIPE-QA-001',
      status: 'paid', source: 'stripe', currency: 'NZD', amount_usd: 150, total_usd: 172.5,
      stripe_hosted_invoice_url: 'https://invoice.stripe.com/i/qa',
      paid_at: new Date(1_760_000_500 * 1000).toISOString(),
    })])
    expect(db.items()).toEqual([
      expect.objectContaining({ description: 'Design', quantity: 2, unit_price_usd: 50, total_usd: 100 }),
      expect.objectContaining({ description: 'Development', quantity: 1, unit_price_usd: 50, total_usd: 50 }),
    ])
  })

  it('derives one stable UUID per Stripe invoice across independent imports', async () => {
    const first = await importStripeInvoice(setup().database, invoice())
    const second = await importStripeInvoice(setup().database, invoice())
    const different = await importStripeInvoice(setup().database, invoice({ id: 'in_other', number: 'OTHER' }))
    if ('skipped' in first || 'skipped' in second || 'skipped' in different) throw new Error('Expected successful imports')
    expect(first.localInvoiceId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    expect(second.localInvoiceId).toBe(first.localInvoiceId)
    expect(different.localInvoiceId).not.toBe(first.localInvoiceId)
  })

  it('converges when two retries both read no invoice before either inserts', async () => {
    const db = setup()
    db.raceFirstReads()
    const results = await Promise.all([
      importStripeInvoice(db.database, invoice(), { autoCreateOrg: false }),
      importStripeInvoice(db.database, invoice(), { autoCreateOrg: false }),
    ])
    expect(db.racedReads()).toEqual([[], []])
    expect(db.batch).toHaveBeenCalledTimes(2)
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ created: true, orgId: 'org-a' }),
      expect.objectContaining({ created: false, orgId: 'org-a' }),
    ]))
    expect(new Set(results.map(result => 'skipped' in result ? null : result.localInvoiceId)).size).toBe(1)
    expect(db.invoices()).toHaveLength(1)
    expect(db.items()).toHaveLength(2)
    await importStripeInvoice(db.database, invoice())
    expect(db.invoices()).toHaveLength(1)
    expect(db.items()).toHaveLength(2)
  })

  it('rolls back the invoice and earlier lines if a later line violates a real constraint, then permits retry', async () => {
    const db = setup()
    db.sqlite.exec(`CREATE TRIGGER reject_bad_line BEFORE INSERT ON invoice_items
      WHEN NEW.description = 'Development' BEGIN SELECT RAISE(ABORT, 'bad line insertion'); END`)
    await expect(importStripeInvoice(db.database, invoice())).rejects.toThrow('bad line insertion')
    expect(db.invoices()).toEqual([])
    expect(db.items()).toEqual([])
    db.sqlite.exec('DROP TRIGGER reject_bad_line')
    expect(await importStripeInvoice(db.database, invoice())).toMatchObject({ created: true })
    expect(db.invoices()).toHaveLength(1)
    expect(db.items()).toHaveLength(2)
  })

  it.each([
    { first: 'open', paidFirst: false },
    { first: 'paid', paidFirst: true },
  ])('keeps the paid result when $first wins the concurrent first insert', async ({ paidFirst }) => {
    const db = setup()
    db.raceFirstReads()
    const executeBatch = db.batch.getMockImplementation()
    if (!executeBatch) throw new Error('Expected the real SQLite batch adapter')
    let releaseFirst: (() => void) | undefined
    const firstCommitted = new Promise<void>(resolve => { releaseFirst = resolve })
    db.batch.mockImplementation(async statements => {
      const first = statements[0].parameters.includes('paid') === paidFirst
      if (!first) await firstCommitted
      const result = await executeBatch(statements)
      if (first) releaseFirst?.()
      return result
    })
    const results = await Promise.all([
      importStripeInvoice(db.database, invoice({ status: 'open', status_transitions: null })),
      importStripeInvoice(db.database, invoice()),
    ])
    expect(db.racedReads()).toEqual([[], []])
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ created: true }), expect.objectContaining({ created: false }),
    ]))
    expect(db.invoices()).toHaveLength(1)
    expect(db.invoices()[0]).toMatchObject({ status: 'paid', paid_at: new Date(1_760_000_500 * 1000).toISOString() })
    expect(db.items()).toHaveLength(2)
  })

  const existingRaces = ['draft', 'sent'].flatMap(initialStatus =>
    ['draft', 'open', 'void', 'uncollectible'].flatMap(staleStatus =>
      [true, false].map(paidFirst => ({
        initialStatus, staleStatus, paidFirst, first: paidFirst ? 'paid' : staleStatus,
      })),
    ),
  )
  it.each(existingRaces)('preserves paid on an existing $initialStatus row when $first writes first against stale $staleStatus', async ({ initialStatus, staleStatus, paidFirst }) => {
    const db = setup()
    const original = await importStripeInvoice(db.database, invoice({ status: initialStatus === 'sent' ? 'open' : initialStatus, status_transitions: null }))
    if ('skipped' in original) throw new Error('Expected the seed invoice to be created')
    const originalItems = db.items()
    db.raceFirstReads()
    let releaseFirst: (() => void) | undefined
    const firstCommitted = new Promise<void>(resolve => { releaseFirst = resolve })
    db.write.mockImplementation(async (_query, params, execute) => {
      const first = params.includes('paid') === paidFirst
      if (!first) await firstCommitted
      const result = execute()
      if (first) releaseFirst?.()
      return result
    })
    const results = await Promise.all([
      importStripeInvoice(db.database, invoice()),
      importStripeInvoice(db.database, invoice({ status: staleStatus, status_transitions: null, hosted_invoice_url: null })),
    ])
    // Both calls must have observed the old row before either writes. Any
    // extra reconciliation reads are free to happen after this first pair.
    expect(db.racedReads()).toHaveLength(2)
    for (const rows of db.racedReads()) expect(rows[0]).toContain(initialStatus)
    expect(results).toEqual([
      { localInvoiceId: original.localInvoiceId, created: false, orgId: 'org-a' },
      { localInvoiceId: original.localInvoiceId, created: false, orgId: 'org-a' },
    ])
    expect(db.invoices()).toHaveLength(1)
    expect(db.invoices()[0]).toMatchObject({
      status: 'paid', paid_at: new Date(1_760_000_500 * 1000).toISOString(),
      stripe_hosted_invoice_url: 'https://invoice.stripe.com/i/qa',
    })
    expect(db.items()).toEqual(originalItems)
  })

  it('does not swallow a non-primary-key invoice conflict or write orphan items', async () => {
    const db = setup()
    await importStripeInvoice(db.database, invoice())
    const before = { invoices: db.invoices(), items: db.items() }
    await expect(importStripeInvoice(db.database, invoice({ id: 'in_distinct' }))).rejects.toThrow(/UNIQUE constraint failed/)
    expect({ invoices: db.invoices(), items: db.items() }).toEqual(before)
  })

  it('preserves a historical UUID and line items when refreshing an existing Stripe invoice', async () => {
    const db = setup()
    await importStripeInvoice(db.database, invoice({ status: 'open', status_transitions: null }))
    // A historical row need not have the new deterministic primary key.
    db.sqlite.exec('PRAGMA foreign_keys = OFF')
    db.sqlite.prepare('UPDATE invoices SET id = ?').run('historical-uuid')
    db.sqlite.prepare('UPDATE invoice_items SET invoice_id = ?').run('historical-uuid')
    db.sqlite.exec('PRAGMA foreign_keys = ON')
    const beforeItems = db.items()
    expect(await importStripeInvoice(db.database, invoice())).toEqual({ localInvoiceId: 'historical-uuid', created: false, orgId: 'org-a' })
    expect(db.invoices()).toHaveLength(1)
    expect(db.invoices()[0]).toMatchObject({ id: 'historical-uuid', status: 'paid' })
    expect(db.items()).toEqual(beforeItems)
  })

  it('skips unknown customers and absent invoice ids without creating organisations or invoices', async () => {
    const db = setup()
    expect(await importStripeInvoice(db.database, invoice({ customer: 'cus_unknown', customer_name: 'Unknown' }), { autoCreateOrg: false })).toMatchObject({ skipped: true })
    expect(await importStripeInvoice(db.database, invoice({ id: '' }))).toEqual({ skipped: true, reason: 'No Stripe invoice id' })
    expect(db.invoices()).toEqual([])
    expect(db.items()).toEqual([])
    expect(db.sqlite.prepare('SELECT id FROM organisations').all()).toEqual([{ id: 'org-a' }])
    expect(db.batch).not.toHaveBeenCalled()
  })
})
