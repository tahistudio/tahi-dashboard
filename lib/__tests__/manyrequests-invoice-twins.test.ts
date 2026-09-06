/**
 * The ManyRequests ledger-twin rules.
 *
 * This morning's import wrote 13 historical rows against clients whose Stripe
 * ledger rows still sat on archived shell organisations. Merging the shells in
 * afterwards carried the same payments across, so several clients hold each
 * payment twice. These tests pin the cleanup: which rows pair, which twin wins
 * when several could, what is carried onto the survivor before the duplicate
 * goes, what is refused outright, and that a second run finds nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Recorded {
  deletes: Array<{ table: string }>
  updates: Array<{ table: string; values: Record<string, unknown> }>
}

const recorded: Recorded = { deletes: [], updates: [] }
let tableRows: Record<string, Array<Record<string, unknown>>> = {}

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, isNotNull: stub, sql: stub }
})

function fakeTable(name: string): { __table: string } {
  return { __table: name }
}

vi.mock('@/db/d1', () => ({
  schema: {
    invoices: fakeTable('invoices'),
    invoiceItems: fakeTable('invoice_items'),
    organisations: fakeTable('organisations'),
    timeEntries: fakeTable('time_entries'),
    aiReplyDrafts: fakeTable('ai_reply_drafts'),
  },
}))

import {
  planManyrequestsTwinDedupe,
  findRailLedgerTwin,
  isManyrequestsRow,
  isRailLedgerRow,
  twinDistanceMs,
  MANYREQUESTS_TWIN_WINDOW_DAYS,
  type LedgerRowLike,
} from '@/lib/manyrequests-dedupe'
import type { DB } from '@/db/d1'

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

function query(rows: Array<Record<string, unknown>>) {
  const thenable = {
    where: () => query(rows),
    limit: () => query(rows),
    then: <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(rows).then(resolve),
  }
  return thenable
}

/**
 * The fake mutates `tableRows` the way D1 would, because idempotence is only a
 * real claim if the second run reads the state the first run left behind.
 */
function fakeDb(): DB {
  return {
    select: () => ({ from: (table: unknown) => query(tableRows[tableName(table)] ?? []) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (clause: unknown) => {
          recorded.updates.push({ table: tableName(table), values })
          applyWrite(tableName(table), clause, values)
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (clause: unknown) => {
        recorded.deletes.push({ table: tableName(table) })
        applyWrite(tableName(table), clause, null)
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as DB
}

/**
 * The drizzle mock turns `eq(column, value)` into `{ args: [column, value] }`,
 * which is enough to replay the write against the in-memory rows: every write
 * this module makes is a single `eq` on invoices.id or on invoice_items.invoice_id.
 */
function clauseValue(clause: unknown): unknown {
  const args = (clause as { args?: unknown[] })?.args
  return args && args.length === 2 ? args[1] : undefined
}

function applyWrite(table: string, clause: unknown, values: Record<string, unknown> | null) {
  const rows = tableRows[table] ?? []
  const value = clauseValue(clause)
  const matches = (row: Record<string, unknown>) =>
    (table === 'invoices' && row.id === value) || (table === 'invoice_items' && row.invoiceId === value)

  if (values === null) {
    tableRows[table] = rows.filter((row) => !matches(row))
    if (table === 'invoices') {
      tableRows.invoice_items = (tableRows.invoice_items ?? []).filter((item) => item.invoiceId !== value)
    }
    return
  }
  for (const row of rows) {
    if (matches(row)) Object.assign(row, values)
  }
}

const ORG = 'org_physitrack'

function mrRow(over: Partial<LedgerRowLike> = {}): Record<string, unknown> {
  return {
    id: 'inv_mr_1',
    orgId: ORG,
    source: 'manyrequests',
    status: 'paid',
    stripeInvoiceId: null,
    xeroInvoiceId: null,
    manyrequestsId: 'INV-2025000008',
    number: 'INV-2025000008',
    totalUsd: 3125,
    currency: 'GBP',
    createdAt: '2026-08-01T10:00:00.000Z',
    paidAt: '2026-08-01T10:00:00.000Z',
    ...over,
  }
}

function xeroRow(over: Partial<LedgerRowLike> = {}): Record<string, unknown> {
  return {
    id: 'inv_xero_1',
    orgId: ORG,
    source: 'xero',
    status: 'paid',
    stripeInvoiceId: null,
    xeroInvoiceId: 'xero_abc',
    manyrequestsId: null,
    number: null,
    totalUsd: 3125,
    currency: 'GBP',
    createdAt: '2026-08-03T10:00:00.000Z',
    paidAt: '2026-08-01T12:00:00.000Z',
    ...over,
  }
}

function stripeInvoice(over: Partial<LedgerRowLike> = {}): Record<string, unknown> {
  return xeroRow({
    id: 'inv_stripe_in',
    source: 'stripe',
    xeroInvoiceId: null,
    stripeInvoiceId: 'in_123',
    ...over,
  })
}

function stripeCharge(over: Partial<LedgerRowLike> = {}): Record<string, unknown> {
  return xeroRow({
    id: 'inv_stripe_ch',
    source: 'stripe',
    xeroInvoiceId: null,
    stripeInvoiceId: 'ch_123',
    ...over,
  })
}

function reset() {
  recorded.deletes = []
  recorded.updates = []
  tableRows = { organisations: [{ id: ORG, name: 'Physitrack' }] }
}

describe('the row classifiers', () => {
  it('counts only a clean ManyRequests import row as a candidate', () => {
    expect(isManyrequestsRow(mrRow() as unknown as LedgerRowLike)).toBe(true)
    expect(isManyrequestsRow(xeroRow() as unknown as LedgerRowLike)).toBe(false)
  })

  it('stops counting a ManyRequests row once it carries a rail id, which is what makes a second run a no-op', () => {
    expect(isManyrequestsRow(mrRow({ stripeInvoiceId: 'in_1' }) as unknown as LedgerRowLike)).toBe(false)
    expect(isManyrequestsRow(mrRow({ xeroInvoiceId: 'xero_1' }) as unknown as LedgerRowLike)).toBe(false)
  })

  it('counts Stripe and Xero rows as ledger rows, and never one already carrying a ManyRequests key', () => {
    expect(isRailLedgerRow(xeroRow() as unknown as LedgerRowLike)).toBe(true)
    expect(isRailLedgerRow(stripeCharge() as unknown as LedgerRowLike)).toBe(true)
    expect(isRailLedgerRow(xeroRow({ manyrequestsId: 'INV-1' }) as unknown as LedgerRowLike)).toBe(false)
    expect(isRailLedgerRow(mrRow() as unknown as LedgerRowLike)).toBe(false)
  })
})

describe('the pairing rules', () => {
  const rows = (list: Array<Record<string, unknown>>) => list as unknown as LedgerRowLike[]

  it('measures the gap across BOTH dates, so an import-stamped created_at cannot hide a settled pair', () => {
    const distance = twinDistanceMs(
      mrRow({ createdAt: '2026-08-01T00:00:00.000Z', paidAt: '2026-08-01T00:00:00.000Z' }) as unknown as LedgerRowLike,
      xeroRow({ createdAt: '2026-09-06T00:00:00.000Z', paidAt: '2026-08-02T00:00:00.000Z' }) as unknown as LedgerRowLike,
    )
    expect(distance).toBe(24 * 60 * 60 * 1000)
  })

  it('leaves a dateless pair alone rather than deleting on a guess', () => {
    expect(
      twinDistanceMs(
        mrRow({ createdAt: null, paidAt: null }) as unknown as LedgerRowLike,
        xeroRow() as unknown as LedgerRowLike,
      ),
    ).toBeNull()
  })

  it(`pairs inside the ${MANYREQUESTS_TWIN_WINDOW_DAYS} day window and not outside it`, () => {
    const near = findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow()]))
    expect(near?.twin.id).toBe('inv_xero_1')

    const far = findRailLedgerTwin(
      mrRow() as unknown as LedgerRowLike,
      rows([xeroRow({ createdAt: '2026-09-01T10:00:00.000Z', paidAt: '2026-09-01T10:00:00.000Z' })]),
    )
    expect(far).toBeNull()
  })

  it('prefers the Stripe invoice row over the charge row even when the charge is closer in time', () => {
    const match = findRailLedgerTwin(
      mrRow() as unknown as LedgerRowLike,
      rows([
        stripeCharge({ createdAt: '2026-08-01T10:00:01.000Z', paidAt: '2026-08-01T10:00:01.000Z' }),
        stripeInvoice({ createdAt: '2026-08-04T10:00:00.000Z', paidAt: '2026-08-04T10:00:00.000Z' }),
      ]),
    )
    expect(match?.twin.stripeInvoiceId).toBe('in_123')
  })

  it('prefers a paid twin over an unpaid one', () => {
    const match = findRailLedgerTwin(
      mrRow() as unknown as LedgerRowLike,
      rows([
        xeroRow({ id: 'inv_unpaid', status: 'sent', paidAt: null, createdAt: '2026-08-01T10:00:01.000Z' }),
        xeroRow({ id: 'inv_paid', status: 'paid', paidAt: '2026-08-04T10:00:00.000Z', createdAt: '2026-08-04T10:00:00.000Z' }),
      ]),
    )
    expect(match?.twin.id).toBe('inv_paid')
  })

  it('breaks a tie on the closest date', () => {
    const match = findRailLedgerTwin(
      mrRow() as unknown as LedgerRowLike,
      rows([
        xeroRow({ id: 'inv_far', createdAt: '2026-08-05T10:00:00.000Z', paidAt: '2026-08-05T10:00:00.000Z' }),
        xeroRow({ id: 'inv_near', createdAt: '2026-08-02T10:00:00.000Z', paidAt: '2026-08-02T10:00:00.000Z' }),
      ]),
    )
    expect(match?.twin.id).toBe('inv_near')
  })

  it('ignores a different amount, a different currency and a different client', () => {
    expect(findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow({ totalUsd: 500 })]))).toBeNull()
    expect(findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow({ currency: 'EUR' })]))).toBeNull()
    expect(findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow({ orgId: 'org_other' })]))).toBeNull()
  })

  it('matches within half a cent, and not beyond it', () => {
    expect(findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow({ totalUsd: 3125.004 })]))).not.toBeNull()
    expect(findRailLedgerTwin(mrRow() as unknown as LedgerRowLike, rows([xeroRow({ totalUsd: 3125.02 })]))).toBeNull()
  })
})

describe('the dry run', () => {
  beforeEach(reset)

  it('pairs the ManyRequests row with its ledger row and reports what it would carry', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.invoice_items = [
      { id: 'item_1', invoiceId: 'inv_mr_1' },
      { id: 'item_2', invoiceId: 'inv_mr_1' },
    ]

    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(1)
    const pair = plan.pairs[0]
    expect(pair.orgName).toBe('Physitrack')
    expect(pair.manyrequests.invoiceId).toBe('inv_mr_1')
    expect(pair.ledger.invoiceId).toBe('inv_xero_1')
    expect(pair.carry).toEqual({
      manyrequestsId: 'INV-2025000008',
      number: 'INV-2025000008',
      itemsMoved: 2,
      itemsDeleted: 0,
    })
    expect(plan.applied).toEqual({
      invoicesDeleted: 0, itemsMoved: 0, itemsDeleted: 0, numbersCarried: 0, keysCarried: 0,
    })
    expect(recorded.deletes).toEqual([])
    expect(recorded.updates).toEqual([])
  })

  it('does not carry the number when the ledger row already has one of its own', async () => {
    tableRows.invoices = [mrRow(), xeroRow({ number: 'INV-2026-0004' })]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs[0].carry.number).toBeNull()
  })

  it('drops the line items instead of moving them when the ledger row has its own', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.invoice_items = [
      { id: 'item_1', invoiceId: 'inv_mr_1' },
      { id: 'item_2', invoiceId: 'inv_xero_1' },
    ]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs[0].carry).toMatchObject({ itemsMoved: 0, itemsDeleted: 1 })
  })

  it('pairs one to one, so Physitrack four fixed retainer months give four pairs, not sixteen', async () => {
    tableRows.invoices = [
      mrRow({ id: 'mr_1', manyrequestsId: 'INV-1', number: 'INV-1', createdAt: '2026-05-01T00:00:00.000Z', paidAt: '2026-05-01T00:00:00.000Z' }),
      mrRow({ id: 'mr_2', manyrequestsId: 'INV-2', number: 'INV-2', createdAt: '2026-06-01T00:00:00.000Z', paidAt: '2026-06-01T00:00:00.000Z' }),
      xeroRow({ id: 'xr_1', xeroInvoiceId: 'xero_1', createdAt: '2026-05-02T00:00:00.000Z', paidAt: '2026-05-02T00:00:00.000Z' }),
      xeroRow({ id: 'xr_2', xeroInvoiceId: 'xero_2', createdAt: '2026-06-02T00:00:00.000Z', paidAt: '2026-06-02T00:00:00.000Z' }),
      xeroRow({ id: 'xr_3', xeroInvoiceId: 'xero_3', createdAt: '2026-07-02T00:00:00.000Z', paidAt: '2026-07-02T00:00:00.000Z' }),
    ]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(2)
    expect(plan.pairs.map((p) => p.ledger.invoiceId).sort()).toEqual(['xr_1', 'xr_2'])
  })

  it('leaves a ManyRequests row with no ledger twin alone', async () => {
    tableRows.invoices = [mrRow(), xeroRow({ totalUsd: 999 })]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toEqual([])
  })

  it('refuses a ManyRequests row a billed time entry points at', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_mr_1' }]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
    expect(plan.refused[0]).toMatchObject({ invoiceId: 'inv_mr_1', manyrequestsId: 'INV-2025000008' })
    expect(plan.refused[0].reason).toContain('time_entries.invoice_id')
  })

  it('refuses a ManyRequests row an AI reply draft points at', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.ai_reply_drafts = [{ id: 'd_1', invoiceId: 'inv_mr_1' }]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
    expect(plan.refused[0].reason).toContain('ai_reply_drafts.invoice_id')
  })

  it('does not care that the LEDGER row is referenced: it is the survivor', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_xero_1' }]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(1)
    expect(plan.refused).toHaveLength(0)
  })
})

describe('the apply', () => {
  beforeEach(reset)

  it('moves the items, deletes the ManyRequests row, then stamps the key and number onto the survivor', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.invoice_items = [{ id: 'item_1', invoiceId: 'inv_mr_1' }]

    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.removedInvoiceIds).toEqual(['inv_mr_1'])
    expect(plan.applied).toEqual({
      invoicesDeleted: 1, itemsMoved: 1, itemsDeleted: 0, numbersCarried: 1, keysCarried: 1,
    })

    // The order is the point: the items leave the doomed row, the row goes, and
    // only then can the unique manyrequests_id and number land on the survivor.
    expect(recorded.updates.map((u) => u.table)).toEqual(['invoice_items', 'invoices'])
    expect(recorded.deletes.map((d) => d.table)).toEqual(['invoices'])

    const survivor = tableRows.invoices.find((row) => row.id === 'inv_xero_1')
    expect(survivor).toMatchObject({
      manyrequestsId: 'INV-2025000008',
      number: 'INV-2025000008',
      xeroInvoiceId: 'xero_abc',
      source: 'xero',
    })
    expect(survivor?.updatedAt).toBeTruthy()
    expect(tableRows.invoices.some((row) => row.id === 'inv_mr_1')).toBe(false)
    expect(tableRows.invoice_items[0].invoiceId).toBe('inv_xero_1')
  })

  it('leaves the survivor own number alone and still carries the key', async () => {
    tableRows.invoices = [mrRow(), xeroRow({ number: 'INV-2026-0004' })]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.applied.numbersCarried).toBe(0)
    expect(plan.applied.keysCarried).toBe(1)
    const survivor = tableRows.invoices.find((row) => row.id === 'inv_xero_1')
    expect(survivor?.number).toBe('INV-2026-0004')
    expect(survivor?.manyrequestsId).toBe('INV-2025000008')
  })

  it('deletes the duplicate line items with the row when the survivor has its own', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.invoice_items = [
      { id: 'item_1', invoiceId: 'inv_mr_1' },
      { id: 'item_2', invoiceId: 'inv_xero_1' },
    ]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.applied).toMatchObject({ itemsMoved: 0, itemsDeleted: 1 })
    expect(tableRows.invoice_items.map((i) => i.id)).toEqual(['item_2'])
  })

  it('writes nothing when every candidate was refused', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_mr_1' }]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.removedInvoiceIds).toEqual([])
    expect(recorded.deletes).toEqual([])
    expect(recorded.updates).toEqual([])
  })

  it('writes nothing when there is no ManyRequests row at all', async () => {
    tableRows.invoices = [xeroRow()]
    const plan = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.pairs).toEqual([])
    expect(recorded.deletes).toEqual([])
  })

  it('is idempotent: the second run over the state the first one left finds nothing', async () => {
    tableRows.invoices = [mrRow(), xeroRow()]
    tableRows.invoice_items = [{ id: 'item_1', invoiceId: 'inv_mr_1' }]

    const first = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(first.pairs).toHaveLength(1)

    recorded.deletes = []
    recorded.updates = []
    const second = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(second.pairs).toEqual([])
    expect(second.removedInvoiceIds).toEqual([])
    expect(recorded.deletes).toEqual([])
    expect(recorded.updates).toEqual([])
  })

  it('cannot eat a second ledger row: the survivor is no longer a candidate even with a spare twin sitting there', async () => {
    tableRows.invoices = [mrRow(), xeroRow(), xeroRow({ id: 'inv_xero_2', xeroInvoiceId: 'xero_def' })]
    await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    const second = await planManyrequestsTwinDedupe(fakeDb(), { dryRun: false })
    expect(second.pairs).toEqual([])
    expect(tableRows.invoices.map((row) => row.id).sort()).toEqual(['inv_xero_1', 'inv_xero_2'])
  })
})
