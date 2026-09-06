/**
 * The Stripe charge-twin rules, both halves.
 *
 * A subscription payment exists twice in the Stripe API (the invoice and the
 * charge that settled it) and both doors used to write an invoices row, which
 * doubled eight clients' billed totals on production. These tests pin the two
 * guards: the IMPORT must skip an invoice-backed charge and still import a
 * genuine one-off, and the CLEANUP must pair only true twins and refuse to
 * delete anything another table points at.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Recorded {
  deletes: string[]
  inserts: Array<{ table: string; values: Record<string, unknown> }>
}

const recorded: Recorded = { deletes: [], inserts: [] }
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
  planStripeChargeTwinDedupe,
  findInvoiceTwin,
  isChargeRow,
  isInvoiceRow,
  type InvoiceRowLike,
} from '@/lib/stripe-dedupe'
import { chargeInvoiceLink, paymentIntentId, importStripePayments } from '@/lib/stripe-sync'
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

function fakeDb(): DB {
  return {
    select: () => ({ from: (table: unknown) => query(tableRows[tableName(table)] ?? []) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        recorded.inserts.push({ table: tableName(table), values })
        return Promise.resolve(undefined)
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        recorded.deletes.push(tableName(table))
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as DB
}

const ORG = 'org_physitrack'

function invoiceRow(over: Partial<InvoiceRowLike> = {}): Record<string, unknown> {
  return {
    id: 'inv_local_1',
    orgId: ORG,
    stripeInvoiceId: 'in_123',
    source: 'stripe',
    totalUsd: 2500,
    currency: 'USD',
    createdAt: '2026-08-01T10:00:00.000Z',
    paidAt: '2026-08-01T10:00:00.000Z',
    notes: 'Imported from Stripe: A1B2-0001',
    manyrequestsId: null,
    xeroInvoiceId: null,
    ...over,
  }
}

function chargeRow(over: Partial<InvoiceRowLike> = {}): Record<string, unknown> {
  return invoiceRow({
    id: 'inv_local_2',
    stripeInvoiceId: 'ch_123',
    notes: 'Stripe payment: Subscription creation',
    createdAt: '2026-08-01T10:00:04.000Z',
    ...over,
  })
}

describe('the import guard', () => {
  it('sees the invoice link on the charge itself', () => {
    expect(chargeInvoiceLink({ invoice: 'in_1', payment_intent: null })).toBe('in_1')
  })

  it('sees the invoice link on the EXPANDED payment intent, which is where a subscription charge carries it', () => {
    expect(chargeInvoiceLink({ invoice: null, payment_intent: { id: 'pi_1', invoice: 'in_9' } })).toBe('in_9')
  })

  it('calls a genuine one-off payment invoice-less, so it still imports', () => {
    expect(chargeInvoiceLink({ invoice: null, payment_intent: { id: 'pi_2', invoice: null } })).toBeNull()
    expect(chargeInvoiceLink({ invoice: null, payment_intent: 'pi_3' })).toBeNull()
    expect(chargeInvoiceLink({ invoice: null, payment_intent: null })).toBeNull()
  })

  it('reads the payment intent id whether Stripe sent the id or the object', () => {
    expect(paymentIntentId({ payment_intent: 'pi_1' })).toBe('pi_1')
    expect(paymentIntentId({ payment_intent: { id: 'pi_1', invoice: null } })).toBe('pi_1')
    expect(paymentIntentId({ payment_intent: null })).toBeNull()
  })

  it('refuses to import a charge whose money already sits on a Stripe invoice row', () => {
    const rows = [invoiceRow()] as unknown as InvoiceRowLike[]
    const twin = findInvoiceTwin(
      { orgId: ORG, totalUsd: 2500, currency: 'USD', createdAt: '2026-08-01T10:00:04.000Z' },
      rows.filter(isInvoiceRow),
    )
    expect(twin?.id).toBe('inv_local_1')
  })

  it('lets an invoice-less one-off through: nothing local matches it', () => {
    const rows = [invoiceRow()] as unknown as InvoiceRowLike[]
    const twin = findInvoiceTwin(
      { orgId: ORG, totalUsd: 900, currency: 'USD', createdAt: '2026-08-01T10:00:04.000Z' },
      rows.filter(isInvoiceRow),
    )
    expect(twin).toBeNull()
  })
})

describe('the row classifiers', () => {
  it('treats ch_ and py_ as charge rows and in_ as the invoice row', () => {
    expect(isChargeRow(chargeRow() as unknown as InvoiceRowLike)).toBe(true)
    expect(isChargeRow(chargeRow({ stripeInvoiceId: 'py_9' }) as unknown as InvoiceRowLike)).toBe(true)
    expect(isChargeRow(invoiceRow() as unknown as InvoiceRowLike)).toBe(false)
    expect(isInvoiceRow(invoiceRow() as unknown as InvoiceRowLike)).toBe(true)
  })

  it('never counts a ManyRequests or Xero ledger row as a charge twin', () => {
    expect(isChargeRow(chargeRow({ manyrequestsId: 'INV-2025000024' }) as unknown as InvoiceRowLike)).toBe(false)
    expect(isChargeRow(chargeRow({ xeroInvoiceId: 'xero_1' }) as unknown as InvoiceRowLike)).toBe(false)
  })
})

describe('POST dedupe: the dry run', () => {
  beforeEach(() => {
    recorded.deletes = []
    recorded.inserts = []
    tableRows = { organisations: [{ id: ORG, name: 'Physitrack' }] }
  })

  it('pairs the charge with its invoice and reports both sides', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(1)
    expect(plan.pairs[0].charge.stripeId).toBe('ch_123')
    expect(plan.pairs[0].charge.notes).toBe('Stripe payment: Subscription creation')
    expect(plan.pairs[0].invoice.stripeId).toBe('in_123')
    expect(plan.pairs[0].orgName).toBe('Physitrack')
    expect(plan.applied).toEqual({ invoicesDeleted: 0, itemsDeleted: 0 })
    expect(recorded.deletes).toEqual([])
  })

  it('ignores a different amount', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow({ totalUsd: 1250 })]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
  })

  it('ignores a different currency', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow({ currency: 'NZD' })]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
  })

  it('ignores a charge created outside the three-day window', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow({ createdAt: '2026-08-05T10:00:00.000Z' })]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
  })

  it('ignores another client entirely', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow({ orgId: 'org_other' })]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
  })

  it('pairs one to one, so two invoices and two charges give two pairs, not four', async () => {
    tableRows.invoices = [
      invoiceRow(),
      invoiceRow({ id: 'inv_local_3', stripeInvoiceId: 'in_456', createdAt: '2026-08-02T10:00:00.000Z' }),
      chargeRow(),
      chargeRow({ id: 'inv_local_4', stripeInvoiceId: 'ch_456', createdAt: '2026-08-02T10:00:03.000Z' }),
    ]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(2)
    expect(plan.pairs.map((p) => p.invoice.stripeId).sort()).toEqual(['in_123', 'in_456'])
  })

  it('refuses a charge row a billed time entry points at', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_local_2' }]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
    expect(plan.refused[0].invoiceId).toBe('inv_local_2')
    expect(plan.refused[0].reason).toContain('time_entries.invoice_id')
  })

  it('refuses a charge row an AI reply draft points at', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    tableRows.ai_reply_drafts = [{ id: 'd_1', invoiceId: 'inv_local_2' }]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(0)
    expect(plan.refused[0].reason).toContain('ai_reply_drafts.invoice_id')
  })

  it('does not care that the INVOICE side is referenced: it is the survivor', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_local_1' }]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: true })
    expect(plan.pairs).toHaveLength(1)
    expect(plan.refused).toHaveLength(0)
  })
})

describe('POST dedupe: the apply', () => {
  beforeEach(() => {
    recorded.deletes = []
    recorded.inserts = []
    tableRows = { organisations: [{ id: ORG, name: 'Physitrack' }] }
  })

  it('deletes the charge twin and its line items, and reports every id removed', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    tableRows.invoice_items = [{ id: 'item_1' }]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.removedInvoiceIds).toEqual(['inv_local_2'])
    expect(plan.applied).toEqual({ invoicesDeleted: 1, itemsDeleted: 1 })
    expect(recorded.deletes).toEqual(['invoice_items', 'invoices'])
  })

  it('deletes nothing when every candidate was refused', async () => {
    tableRows.invoices = [invoiceRow(), chargeRow()]
    tableRows.time_entries = [{ id: 'te_1', invoiceId: 'inv_local_2' }]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.removedInvoiceIds).toEqual([])
    expect(recorded.deletes).toEqual([])
  })

  it('deletes nothing when there is no charge row at all', async () => {
    tableRows.invoices = [invoiceRow()]
    const plan = await planStripeChargeTwinDedupe(fakeDb(), { dryRun: false })
    expect(plan.pairs).toEqual([])
    expect(recorded.deletes).toEqual([])
  })
})

describe('importStripePayments end to end', () => {
  type SyncDb = Parameters<typeof importStripePayments>[0]

  const oneOff = {
    id: 'ch_oneoff',
    amount: 90000,
    currency: 'usd',
    status: 'succeeded',
    description: 'Logo sprint',
    invoice: null,
    payment_intent: { id: 'pi_oneoff', invoice: null },
    customer: 'cus_1',
    receipt_email: null,
    billing_details: { email: null, name: 'Physitrack' },
    created: Math.floor(Date.parse('2026-08-10T10:00:00.000Z') / 1000),
    paid: true,
    refunded: false,
    statement_descriptor: null,
    metadata: {},
  }

  const subscriptionCharge = {
    ...oneOff,
    id: 'ch_sub',
    amount: 250000,
    description: 'Subscription creation',
    payment_intent: { id: 'pi_sub', invoice: 'in_123' },
    created: Math.floor(Date.parse('2026-08-01T10:00:04.000Z') / 1000),
  }

  function stubCharges(data: unknown[]) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data, has_more: false }),
    })))
  }

  beforeEach(() => {
    recorded.deletes = []
    recorded.inserts = []
    tableRows = {
      organisations: [{ id: ORG, name: 'Physitrack', stripeCustomerId: 'cus_1' }],
      invoices: [invoiceRow()],
    }
  })

  it('skips the invoice-backed subscription charge and imports the invoice-less one-off', async () => {
    stubCharges([subscriptionCharge, oneOff])
    const outcome = await importStripePayments(fakeDb() as unknown as SyncDb, 'sk_test')
    const body = outcome.body as { imported: number; results: Array<{ chargeId: string; status: string }> }

    expect(body.imported).toBe(1)
    expect(body.results.find((r) => r.chargeId === 'ch_sub')?.status).toBe('invoice_backed')
    const inserted = recorded.inserts.filter((i) => i.table === 'invoices')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].values.stripeInvoiceId).toBe('ch_oneoff')
  })

  it('asks Stripe to expand the payment intent, or the link is invisible', async () => {
    stubCharges([oneOff])
    await importStripePayments(fakeDb() as unknown as SyncDb, 'sk_test')
    const calledWith = vi.mocked(globalThis.fetch).mock.calls[0][0] as string
    expect(calledWith).toContain('expand[]=data.payment_intent')
  })

  it('skips a link-less charge whose money already sits on a local Stripe invoice row', async () => {
    stubCharges([{ ...subscriptionCharge, invoice: null, payment_intent: { id: 'pi_sub', invoice: null } }])
    const outcome = await importStripePayments(fakeDb() as unknown as SyncDb, 'sk_test')
    const body = outcome.body as { imported: number; results: Array<{ chargeId: string; status: string }> }

    expect(body.imported).toBe(0)
    expect(body.results[0].status).toBe('invoice_twin_exists')
    expect(recorded.inserts.filter((i) => i.table === 'invoices')).toHaveLength(0)
  })
})
