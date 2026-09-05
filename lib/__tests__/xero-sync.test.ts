/**
 * lib/xero-sync.ts: the two Xero readers that decide what the dashboard
 * believes about a bill.
 *
 * Three things are pinned here, all of them from the 2026-09-06 invoice
 * channel assessment:
 *
 *   1. walkXeroPages actually walks. syncXeroPayments used to call /Invoices
 *      with no `page` parameter at all, so every local invoice past Xero's
 *      first 100 reported 'not_found_in_xero' forever.
 *   2. Both readers UPDATE a row they have already seen. The importer used to
 *      `continue` on a known xeroInvoiceId, so an invoice imported while it was
 *      a Xero DRAFT stayed local 'draft' for good, and the portal hides drafts
 *      from the client.
 *   3. Neither reader touches a row billed on the other rail.
 *
 * The fake D1 is the chainable recorder the route tests use: only the chain is
 * thenable, and every call is recorded so the values actually written can be
 * asserted rather than inferred from a return value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/xero', () => ({
  callXeroAPI: vi.fn(),
  callXeroAPIOrThrow: vi.fn(),
  XeroAPIError: class XeroAPIError extends Error {},
}))

import { callXeroAPI } from '@/lib/xero'
import {
  walkXeroPages,
  syncXeroPayments,
  importXeroInvoices,
  XERO_MAX_PAGES,
  XERO_PAGE_SIZE,
} from '@/lib/xero-sync'

// ---------------------------------------------------------------------------
// Fake D1
// ---------------------------------------------------------------------------
type QueryRecord = { calls: Array<{ method: string; args: unknown[] }> }

function makeChain(result: unknown, record: QueryRecord): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        record.calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)
    return makeChain(queue.length ? queue.shift() : [], record)
  }
  return {
    handle: {
      select: (...args: unknown[]) => entry('select', args),
      insert: (...args: unknown[]) => entry('insert', args),
      update: (...args: unknown[]) => entry('update', args),
      delete: (...args: unknown[]) => entry('delete', args),
    },
    queries,
  }
}

function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

type Db = Parameters<typeof syncXeroPayments>[0]

/** A Xero ACCREC row, only the fields either reader reads. */
function xeroInvoice(over: Record<string, unknown> = {}) {
  return {
    InvoiceID: 'xero-1',
    InvoiceNumber: 'INV-0001',
    Type: 'ACCREC',
    Status: 'AUTHORISED',
    Contact: { ContactID: 'contact-1', Name: 'Kowhai Ltd' },
    DateString: '2026-08-01T00:00:00',
    DueDateString: '2026-08-15T00:00:00',
    SubTotal: 1000,
    Total: 1150,
    CurrencyCode: 'NZD',
    AmountDue: 1150,
    AmountPaid: 0,
    UpdatedDateUTC: '2026-08-02T00:00:00',
    HasAttachments: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// walkXeroPages
// ---------------------------------------------------------------------------
describe('walkXeroPages', () => {
  /** A fake Xero client holding `total` rows, served 100 at a time. */
  function fakeClient(total: number, pageSize = XERO_PAGE_SIZE) {
    const pagesAsked: number[] = []
    const readPage = async (page: number) => {
      pagesAsked.push(page)
      const start = (page - 1) * pageSize
      return Array.from(
        { length: Math.max(0, Math.min(pageSize, total - start)) },
        (_, i) => ({ id: `row-${start + i + 1}` }),
      )
    }
    return { readPage, pagesAsked }
  }

  it('reads all three pages when the client holds three', async () => {
    // 100 + 100 + 7: the third page is short, so the walk stops there.
    const { readPage, pagesAsked } = fakeClient(207)

    const walk = await walkXeroPages(readPage)

    expect(pagesAsked).toEqual([1, 2, 3])
    expect(walk.pagesRead).toBe(3)
    expect(walk.rows).toHaveLength(207)
    expect(walk.rows[206]).toEqual({ id: 'row-207' })
    expect(walk.truncated).toBe(false)
    expect(walk.failed).toBe(false)
  })

  it('stops on the first short page', async () => {
    const { readPage, pagesAsked } = fakeClient(12)

    const walk = await walkXeroPages(readPage)

    expect(pagesAsked).toEqual([1])
    expect(walk.pagesRead).toBe(1)
    expect(walk.rows).toHaveLength(12)
  })

  it('stops at the 50 page ceiling and says so', async () => {
    // A client that never runs out: without the ceiling this is a forever loop.
    const pagesAsked: number[] = []
    const walk = await walkXeroPages(async (page) => {
      pagesAsked.push(page)
      return Array.from({ length: XERO_PAGE_SIZE }, (_, i) => ({ id: `p${page}-${i}` }))
    })

    expect(XERO_MAX_PAGES).toBe(50)
    expect(pagesAsked).toHaveLength(XERO_MAX_PAGES)
    expect(walk.pagesRead).toBe(XERO_MAX_PAGES)
    expect(walk.truncated).toBe(true)
    expect(walk.rows).toHaveLength(XERO_MAX_PAGES * XERO_PAGE_SIZE)
  })

  it('keeps what it read when a later page fails', async () => {
    const walk = await walkXeroPages(async (page) => {
      if (page === 3) return null
      return Array.from({ length: XERO_PAGE_SIZE }, (_, i) => ({ id: `p${page}-${i}` }))
    })

    expect(walk.pagesRead).toBe(2)
    expect(walk.failed).toBe(true)
    expect(walk.rows).toHaveLength(2 * XERO_PAGE_SIZE)
  })

  it('reads nothing when the very first page fails', async () => {
    const walk = await walkXeroPages(async () => null)

    expect(walk.pagesRead).toBe(0)
    expect(walk.failed).toBe(true)
    expect(walk.rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// syncXeroPayments
// ---------------------------------------------------------------------------
describe('syncXeroPayments', () => {
  /** Serve `pages` pages of Xero invoices through the mocked callXeroAPI. */
  function serveInvoicePages(pages: Array<Array<Record<string, unknown>>>) {
    vi.mocked(callXeroAPI).mockImplementation(async (_method, endpoint) => {
      const page = Number(/[?&]page=(\d+)/.exec(String(endpoint))?.[1] ?? '1')
      return { Invoices: pages[page - 1] ?? [] } as never
    })
  }

  it('finds an invoice that only exists on the third Xero page', async () => {
    // The bug this replaces: one unpaged GET, so this row read
    // 'not_found_in_xero' every night no matter how many times it ran.
    const filler = (page: number) => Array.from(
      { length: XERO_PAGE_SIZE },
      (_, i) => xeroInvoice({ InvoiceID: `other-${page}-${i}` }),
    )
    serveInvoicePages([
      filler(1),
      filler(2),
      [xeroInvoice({ InvoiceID: 'xero-far', Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '/Date(1518685950940+0000)/' })],
    ])

    const { handle, queries } = makeDb([
      [{ id: 'inv-far', xeroInvoiceId: 'xero-far', status: 'sent', source: 'xero' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(outcome.ok).toBe(true)
    expect(outcome.body).toMatchObject({ updated: 1, pagesRead: 3, truncated: false, partial: false })

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('paid')
    // Xero's own settlement date, not "now".
    expect(set.paidAt).toBe('2018-02-15T09:12:30.940Z')
  })

  it('reads SUBMITTED as sent, not viewed', async () => {
    serveInvoicePages([[xeroInvoice({ Status: 'SUBMITTED' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero' }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
  })

  it('leaves an overdue row overdue when Xero still says AUTHORISED', async () => {
    serveInvoicePages([[xeroInvoice({ Status: 'AUTHORISED' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'overdue', source: 'xero' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0 })
  })

  it('never touches an invoice billed on the Stripe rail', async () => {
    serveInvoicePages([[xeroInvoice({ Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '2026-09-01' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'stripe' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect((outcome.body.results as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: 'skipped_not_xero_source',
    })
  })

  it('unwinds the paid date when Xero says the invoice is owed again', async () => {
    serveInvoicePages([[xeroInvoice({ Status: 'AUTHORISED', AmountDue: 1150 })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero' }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
    expect(set.paidAt).toBeNull()
  })

  it('fails loudly when Xero cannot be read at all', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue(null)
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(outcome.ok).toBe(false)
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// importXeroInvoices
// ---------------------------------------------------------------------------
describe('importXeroInvoices', () => {
  function serveImportPage(invoices: Array<Record<string, unknown>>) {
    vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: invoices } as never)
  }

  const ORGS = [{ id: 'org-a', name: 'Kowhai Ltd', xeroContactId: 'contact-1' }]

  it('lands a Xero status change on a row it has already seen', async () => {
    // The row was imported while it was a Xero DRAFT, so it is local 'draft'
    // and invisible in the client portal. Xero has since approved it.
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED', Total: 1200, SubTotal: 1050, DueDateString: '2026-09-30T00:00:00' })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero' }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(outcome.ok).toBe(true)
    expect(outcome.body).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
    expect(byEntry(queries, 'insert')).toHaveLength(0)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).toMatchObject({
      status: 'sent',
      amountUsd: 1050,
      totalUsd: 1200,
      currency: 'NZD',
      dueDate: '2026-09-30',
    })
  })

  it('stamps the paid date from FullyPaidOnDate when a known row settles', async () => {
    serveImportPage([xeroInvoice({ Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '2026-09-01' })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero' }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('paid')
    expect(set.paidAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('keeps a settled row settled without restamping the paid date as today', async () => {
    serveImportPage([xeroInvoice({ Status: 'PAID', AmountDue: 0 })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero' }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set).not.toHaveProperty('status')
    expect(set).not.toHaveProperty('paidAt')
  })

  it('unwinds the paid date when Xero puts a settled invoice back on the books', async () => {
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED', AmountDue: 1150 })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero' }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
    expect(set.paidAt).toBeNull()
  })

  it('never touches a known row billed on the Stripe rail', async () => {
    serveImportPage([xeroInvoice({ Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '2026-09-01' })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'stripe' }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0, skipped: 1 })
  })

  it('inserts a row it has never seen, with the mapped status', async () => {
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED' })])
    const { handle, queries } = makeDb([[], ORGS])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(outcome.body).toMatchObject({ imported: 1, updated: 0 })
    const values = argOf(byEntry(queries, 'insert')[0], 'values') as Record<string, unknown>
    expect(values).toMatchObject({
      orgId: 'org-a',
      xeroInvoiceId: 'xero-1',
      source: 'xero',
      status: 'sent',
      dueDate: '2026-08-15',
    })
    expect(values.paidAt).toBeNull()
  })

  it('creates nothing for an invoice deleted in Xero', async () => {
    serveImportPage([xeroInvoice({ Status: 'DELETED' })])
    const { handle, queries } = makeDb([[], ORGS])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ imported: 0, skipped: 1 })
  })

  it('rewrites nothing on a known row Xero has deleted', async () => {
    serveImportPage([xeroInvoice({ Status: 'DELETED' })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero' }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ imported: 0, updated: 0, skipped: 1 })
  })

  it('reads a VOIDED invoice as written off rather than deleting it', async () => {
    serveImportPage([xeroInvoice({ Status: 'VOIDED' })])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero' }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('written_off')
  })
})
