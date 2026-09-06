/**
 * lib/xero-sync.ts: the two Xero readers that decide what the dashboard
 * believes about a bill.
 *
 * Five things are pinned here, from the 2026-09-06 invoice channel assessment
 * and the review of the first cut of this slice:
 *
 *   1. walkXeroPages actually walks. syncXeroPayments used to call /Invoices
 *      with no `page` parameter at all, so every local invoice past Xero's
 *      first 100 reported 'not_found_in_xero' forever, and an incomplete walk
 *      now surfaces as a warning instead of a clean success.
 *   2. Both readers UPDATE a row they have already seen. The importer used to
 *      `continue` on a known xeroInvoiceId, so an invoice imported while it was
 *      a Xero DRAFT stayed local 'draft' for good, and the portal hides drafts
 *      from the client.
 *   3. Neither reader ever moves a row BACKWARDS. The push route holds every
 *      dashboard invoice at Xero DRAFT and push-back on a hand mark-paid is a
 *      later slice, so Xero is knowingly stale: a nightly reader that trusted
 *      it would walk a sent or paid invoice back to 'draft', hide it from the
 *      client portal and null the paid date the revenue reports are keyed on.
 *   4. Neither reader writes when nothing changed, so a quiet night does not
 *      bump 100 updated_at stamps and report 100 updates.
 *   5. Neither reader touches a row billed on the other rail.
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
import {
  ONLINE_INVOICE_FETCH_CAP,
  ONLINE_INVOICE_ROTATION_MS,
  captureOnlineInvoiceUrls,
  needsOnlineInvoiceUrl,
  onlineInvoiceWindow,
  readOnlineInvoiceUrl,
  shouldClearOnlineInvoiceUrl,
} from '@/lib/xero-online-invoice'

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
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'overdue', source: 'xero', sentAt: '2026-08-01T00:00:00.000Z' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0 })
  })

  it('leaves a sent invoice alone while Xero still holds it at DRAFT', async () => {
    // The live workflow: the push route sends every dashboard invoice to Xero
    // as Status DRAFT and nothing in the repo ever approves one, so Xero says
    // DRAFT forever while the send-email route has already moved the local row
    // to 'sent'. Writing that back would hide the invoice from the client
    // portal, which filters status != 'draft'.
    serveInvoicePages([[xeroInvoice({ Status: 'DRAFT' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero', sentAt: '2026-08-01T00:00:00.000Z' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0 })
    expect((outcome.body.results as Array<Record<string, unknown>>)[0]).toMatchObject({ status: 'no_change' })
  })

  it('leaves a hand-marked-paid invoice paid while Xero still holds it at DRAFT', async () => {
    // Same invoice, one step later: paid by bank transfer and hand-marked paid
    // (IC.1 stamps paid_at). Push-back is a later slice, so Xero never hears
    // about it. Demoting to 'draft' here would both hide the invoice and null
    // the paid date /financial-reports keys the revenue on.
    serveInvoicePages([[xeroInvoice({ Status: 'DRAFT' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero', paidAt: '2026-09-02T00:00:00.000Z' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0 })
  })

  it('stamps the first send date when Xero approves a draft', async () => {
    serveInvoicePages([[xeroInvoice({ Status: 'AUTHORISED' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero', sentAt: null }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
    expect(typeof set.sentAt).toBe('string')
  })

  it('reports a lost Xero page as a warning instead of a clean success', async () => {
    vi.mocked(callXeroAPI).mockImplementation(async (_method, endpoint) => {
      const page = Number(/[?&]page=(\d+)/.exec(String(endpoint))?.[1] ?? '1')
      if (page === 2) return null
      return { Invoices: Array.from({ length: XERO_PAGE_SIZE }, (_, i) => xeroInvoice({ InvoiceID: `p1-${i}` })) } as never
    })
    const { handle } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'missing', status: 'sent', source: 'xero' }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(outcome.body).toMatchObject({ partial: true, pagesRead: 1 })
    expect(outcome.warning).toContain('Partial Xero read')
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

  it('does not undo a paid invoice on a Xero AUTHORISED with a balance', async () => {
    // Push-back is unbuilt, so a hand mark-paid never reaches Xero and a Xero
    // AUTHORISED on a locally paid row means Xero is stale, not that the
    // payment was unwound. Demoting here would null the paid date the revenue
    // reports are keyed on.
    serveInvoicePages([[xeroInvoice({ Status: 'AUTHORISED', AmountDue: 1150 })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero', paidAt: '2026-09-02T00:00:00.000Z' }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('writes off a paid invoice Xero voided without erasing the paid date', async () => {
    // A write-off is not an unwind: the money may well have landed, and
    // /financial-reports keys YTD revenue and the tax-year totals off paid_at.
    serveInvoicePages([[xeroInvoice({ Status: 'VOIDED' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero', paidAt: '2026-09-02T00:00:00.000Z' }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('written_off')
    expect(set).not.toHaveProperty('paidAt')
  })

  it('writes off a row Xero has deleted rather than leaving it payable forever', async () => {
    // Nothing else can clear it: the importer never sees a deleted invoice
    // again and this sync would report 'not_found_in_xero' every night.
    serveInvoicePages([[xeroInvoice({ Status: 'DELETED' })]])
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero' }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('written_off')
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

  it('keeps the number Xero already gave a bill it imports', async () => {
    // Xero named this invoice before we ever saw it and the client has already
    // been sent that number, so the studio sequence must not touch it. The
    // studio numbers what it RAISES; it never renumbers an import.
    serveImportPage([xeroInvoice({ InvoiceID: 'xero-new', InvoiceNumber: 'INV-0431' })])
    const { handle, queries } = makeDb([[], ORGS])

    await importXeroInvoices(handle as unknown as Db, 1)

    const values = argOf(byEntry(queries, 'insert')[0], 'values') as Record<string, unknown>
    expect(values.number).toBe('INV-0431')
    expect(values.xeroInvoiceId).toBe('xero-new')
  })

  it('leaves the number NULL rather than empty when Xero sends a blank one', async () => {
    // SQLite treats NULLs as distinct in a unique index but empty strings as
    // equal, so a second blank import would collide with the first.
    serveImportPage([xeroInvoice({ InvoiceID: 'xero-new', InvoiceNumber: '   ' })])
    const { handle, queries } = makeDb([[], ORGS])

    await importXeroInvoices(handle as unknown as Db, 1)

    const values = argOf(byEntry(queries, 'insert')[0], 'values') as Record<string, unknown>
    expect(values.number).toBeNull()
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

  it('writes nothing at all when Xero and the local row already agree', async () => {
    // A nightly run over an unchanged ledger used to rewrite up to 100 rows,
    // bump every updated_at and report 100 updates.
    serveImportPage([xeroInvoice({ Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '2026-09-01' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', paidAt: '2026-09-01T00:00:00.000Z', sentAt: '2026-08-01T00:00:00.000Z',
      }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ imported: 0, updated: 0, unchanged: 1 })
    expect(outcome.count).toBe(0)
  })

  it('does not undo a paid invoice on a Xero AUTHORISED with a balance', async () => {
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED', AmountDue: 1150 })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', paidAt: '2026-09-02T00:00:00.000Z',
      }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('leaves a sent invoice alone while Xero still holds it at DRAFT', async () => {
    // The cron calls this reader with page 1 of DateString DESC, which is
    // exactly where a freshly pushed invoice sits.
    serveImportPage([xeroInvoice({ Status: 'DRAFT' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', sentAt: '2026-08-01T00:00:00.000Z',
      }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(outcome.body).toMatchObject({ updated: 0, unchanged: 1 })
  })

  it('leaves a hand-marked-paid invoice paid while Xero still holds it at DRAFT', async () => {
    serveImportPage([xeroInvoice({ Status: 'DRAFT' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', paidAt: '2026-09-02T00:00:00.000Z',
      }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('keeps the paid date when Xero voids a settled invoice', async () => {
    serveImportPage([xeroInvoice({ Status: 'VOIDED' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'paid', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', paidAt: '2026-09-02T00:00:00.000Z',
      }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('written_off')
    expect(set).not.toHaveProperty('paidAt')
  })

  it('does not null a local due date when the Xero payload has none', async () => {
    // Xero DRAFTs commonly carry no DueDateString, and nothing else re-derives
    // the date the receivables aging reads.
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED', DueDateString: undefined })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD',
        dueDate: '2026-08-15', sentAt: '2026-08-01T00:00:00.000Z',
      }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
    expect(set).not.toHaveProperty('dueDate')
  })

  it('stamps the first send date when Xero approves a draft', async () => {
    serveImportPage([xeroInvoice({ Status: 'AUTHORISED' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD', dueDate: '2026-08-15', sentAt: null,
      }],
      ORGS,
    ])

    await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('sent')
    expect(typeof set.sentAt).toBe('string')
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

  it('writes off a known row Xero has deleted rather than leaving it payable', async () => {
    // Leaving it alone would keep a 'sent' invoice in the client portal as
    // payable forever, with no path able to clear it.
    serveImportPage([xeroInvoice({ Status: 'DELETED' })])
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD', dueDate: '2026-08-15',
      }],
      ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    const set = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(set.status).toBe('written_off')
    expect(outcome.body).toMatchObject({ imported: 0, updated: 1, skipped: 0 })
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

// ---------------------------------------------------------------------------
// The Xero pay link (OnlineInvoiceUrl)
// ---------------------------------------------------------------------------
//
// A Xero-rail client has no Stripe hosted page. What they get is Xero's own
// online invoice, and Xero only issues that URL once the invoice is AUTHORISED
// (approved by hand in Xero, long after our push, which stays DRAFT on
// purpose). So the readers are the only things that can ever watch the link
// appear, and asking for one on a DRAFT is an ERROR at Xero, not an empty
// answer. Four properties are pinned: it is captured when it exists, it is
// never asked for when it cannot, the run is capped, and a failure is silent.
describe('Xero pay link capture', () => {
  /**
   * One mocked Xero for both endpoints the readers now call: the paged ACCREC
   * list, and GET /Invoices/{id}/OnlineInvoice. Returns the endpoints hit, so
   * "never asked" is asserted against the calls rather than against a result.
   */
  function serveXero(opts: {
    pages?: Array<Array<Record<string, unknown>>>
    importPage?: Array<Record<string, unknown>>
    onlineInvoiceUrl?: (xeroInvoiceId: string) => string | null
  }): string[] {
    const endpoints: string[] = []
    vi.mocked(callXeroAPI).mockImplementation(async (_method, endpoint) => {
      const ep = String(endpoint)
      endpoints.push(ep)

      const online = /^\/Invoices\/([^/?]+)\/OnlineInvoice$/.exec(ep)
      if (online) {
        const url = opts.onlineInvoiceUrl?.(online[1]) ?? null
        return url ? ({ OnlineInvoices: [{ OnlineInvoiceUrl: url }] } as never) : null
      }

      if (opts.importPage) return { Invoices: opts.importPage } as never

      const page = Number(/[?&]page=(\d+)/.exec(ep)?.[1] ?? '1')
      return { Invoices: opts.pages?.[page - 1] ?? [] } as never
    })
    return endpoints
  }

  /** Every OnlineInvoice endpoint the run actually asked for. */
  function onlineInvoiceCalls(endpoints: string[]): string[] {
    return endpoints.filter(e => e.endsWith('/OnlineInvoice'))
  }

  /** The `.set({...})` of the update that wrote a pay link, if there was one. */
  function payLinkWrite(queries: QueryRecord[]): Record<string, unknown> | undefined {
    for (const q of byEntry(queries, 'update')) {
      const set = argOf(q, 'set') as Record<string, unknown> | undefined
      if (set && 'xeroOnlineInvoiceUrl' in set) return set
    }
    return undefined
  }

  const IMPORT_ORGS = [{ id: 'org-a', name: 'Kowhai Ltd', xeroContactId: 'contact-1' }]

  it('captures the link for an approved invoice the payment sync already knows', async () => {
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'AUTHORISED' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/abc123',
    })
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: null,
      }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toEqual(['/Invoices/xero-1/OnlineInvoice'])
    expect(payLinkWrite(queries)).toMatchObject({ xeroOnlineInvoiceUrl: 'https://in.xero.com/abc123' })
    expect(outcome.body.payLinks).toMatchObject({ candidates: 1, fetched: 1, captured: 1, failed: 0, deferred: 0 })
    // The status already agreed with Xero, so no status write happened: the
    // capture has to survive the no-change bail-out, which is the whole point.
    expect(outcome.body).toMatchObject({ updated: 0 })
  })

  it('never asks Xero for a link on a DRAFT, which would be an error', async () => {
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'DRAFT' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/never-asked-for',
    })
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero', xeroOnlineInvoiceUrl: null }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toEqual([])
    expect(payLinkWrite(queries)).toBeUndefined()
    expect(outcome.body.payLinks).toMatchObject({ candidates: 0, fetched: 0, captured: 0 })
  })

  it('never asks for a SUBMITTED invoice, which is still awaiting approval', async () => {
    // It maps to 'sent' (the money is owed) but Xero has not issued it, so the
    // OnlineInvoice endpoint errors. Asking buys a failure that requeues on
    // every run and holds a slot in the cap.
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'SUBMITTED' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/never-asked-for',
    })
    const { handle } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: null,
      }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toEqual([])
    expect(outcome.body.payLinks).toMatchObject({ candidates: 0, fetched: 0 })
  })

  it('clears the stored link when Xero voids the invoice', async () => {
    // The column used to be write-once, so a voided bill kept a URL that now
    // shows the client a cancelled invoice or a 404.
    serveXero({ pages: [[xeroInvoice({ Status: 'VOIDED' })]] })
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: 'https://in.xero.com/dead',
      }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    expect(payLinkWrite(queries)).toMatchObject({ status: 'written_off', xeroOnlineInvoiceUrl: null })
  })

  it('clears the link even when nothing else about the row changes', async () => {
    // Our own push route re-sends Status DRAFT on an UPDATE, demoting an
    // invoice Liam had approved and revoking its online invoice. The local
    // status does not move (Xero may only move a row forward), so the clear
    // has to survive the no-change bail-out on its own.
    serveXero({ pages: [[xeroInvoice({ Status: 'DRAFT' })]] })
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'draft', source: 'xero',
        xeroOnlineInvoiceUrl: 'https://in.xero.com/revoked',
      }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(payLinkWrite(queries)).toMatchObject({ xeroOnlineInvoiceUrl: null })
    expect(outcome.body).toMatchObject({ updated: 1 })
  })

  it('never asks twice: a row that already holds a link is left alone', async () => {
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'AUTHORISED' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/second-fetch',
    })
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: 'https://in.xero.com/already-here',
      }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toEqual([])
    expect(payLinkWrite(queries)).toBeUndefined()
  })

  it('never asks for a row billed on the Stripe rail', async () => {
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'AUTHORISED' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/wrong-rail',
    })
    const { handle } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'stripe', xeroOnlineInvoiceUrl: null }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toEqual([])
  })

  it('caps the extra fetches per run and defers the rest', async () => {
    // A first sync over a ledger of approved invoices must not spend hundreds
    // of calls on links. The backlog drains across the following hourly runs.
    const total = ONLINE_INVOICE_FETCH_CAP + 7
    const rows = Array.from({ length: total }, (_, i) => xeroInvoice({ InvoiceID: `xero-${i}`, Status: 'AUTHORISED' }))
    const endpoints = serveXero({
      pages: [rows],
      onlineInvoiceUrl: id => `https://in.xero.com/${id}`,
    })
    const { handle } = makeDb([
      rows.map((_, i) => ({
        id: `inv-${i}`, xeroInvoiceId: `xero-${i}`, status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: null,
      })),
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toHaveLength(ONLINE_INVOICE_FETCH_CAP)
    expect(outcome.body.payLinks).toMatchObject({
      candidates: total,
      fetched: ONLINE_INVOICE_FETCH_CAP,
      captured: ONLINE_INVOICE_FETCH_CAP,
      deferred: 7,
    })
  })

  it('tolerates a failed fetch: no link, no failed run', async () => {
    // Xero rate limits, the org has online invoicing off, the invoice was
    // voided between the list read and this one. All of it leaves the column
    // NULL, which is the state every draft is already in.
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'AUTHORISED' })]],
      onlineInvoiceUrl: () => null,
    })
    const { handle, queries } = makeDb([
      [{
        id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: null,
      }],
    ])

    const outcome = await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toHaveLength(1)
    expect(payLinkWrite(queries)).toBeUndefined()
    expect(outcome.ok).toBe(true)
    expect(outcome.body.payLinks).toMatchObject({ fetched: 1, captured: 0, failed: 1 })
  })

  it('captures the link for a paid invoice too, which is the client receipt', async () => {
    const endpoints = serveXero({
      pages: [[xeroInvoice({ Status: 'PAID', AmountDue: 0, FullyPaidOnDate: '2026-09-01' })]],
      onlineInvoiceUrl: () => 'https://in.xero.com/paid-one',
    })
    const { handle, queries } = makeDb([
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1', status: 'sent', source: 'xero', xeroOnlineInvoiceUrl: null }],
    ])

    await syncXeroPayments(handle as unknown as Db)

    expect(onlineInvoiceCalls(endpoints)).toHaveLength(1)
    expect(payLinkWrite(queries)).toMatchObject({ xeroOnlineInvoiceUrl: 'https://in.xero.com/paid-one' })
  })

  it('captures on the importer too, for a known row and for one it just created', async () => {
    const endpoints = serveXero({
      importPage: [
        xeroInvoice({ InvoiceID: 'xero-known', Status: 'AUTHORISED' }),
        xeroInvoice({ InvoiceID: 'xero-new', InvoiceNumber: 'INV-0002', Status: 'AUTHORISED' }),
        xeroInvoice({ InvoiceID: 'xero-draft', InvoiceNumber: 'INV-0003', Status: 'DRAFT' }),
      ],
      onlineInvoiceUrl: id => `https://in.xero.com/${id}`,
    })
    const { handle } = makeDb([
      [{
        id: 'inv-known', xeroInvoiceId: 'xero-known', status: 'sent', source: 'xero',
        amountUsd: 1000, totalUsd: 1150, currency: 'NZD', dueDate: '2026-08-15',
        sentAt: '2026-08-01T00:00:00.000Z', xeroOnlineInvoiceUrl: null,
      }],
      IMPORT_ORGS,
    ])

    const outcome = await importXeroInvoices(handle as unknown as Db, 1)

    // The known approved row and the freshly imported approved row, never the
    // draft.
    expect(onlineInvoiceCalls(endpoints).sort()).toEqual([
      '/Invoices/xero-known/OnlineInvoice',
      '/Invoices/xero-new/OnlineInvoice',
    ])
    expect(outcome.body.payLinks).toMatchObject({ candidates: 2, fetched: 2, captured: 2, failed: 0 })
  })
})

// ---------------------------------------------------------------------------
// lib/xero-online-invoice.ts, directly
// ---------------------------------------------------------------------------
describe('captureOnlineInvoiceUrls', () => {
  it('reads the URL out of the Xero shape and ignores everything else', () => {
    expect(readOnlineInvoiceUrl({ OnlineInvoices: [{ OnlineInvoiceUrl: ' https://in.xero.com/x ' }] }))
      .toBe('https://in.xero.com/x')
    // An org with online invoicing switched off, a failed call, a shape change.
    expect(readOnlineInvoiceUrl({ OnlineInvoices: [] })).toBeNull()
    expect(readOnlineInvoiceUrl({ OnlineInvoices: [{ OnlineInvoiceUrl: '' }] })).toBeNull()
    expect(readOnlineInvoiceUrl(null)).toBeNull()
    expect(readOnlineInvoiceUrl('nope')).toBeNull()
  })

  it('only queues a row Xero has issued and the dashboard has not stored', () => {
    expect(needsOnlineInvoiceUrl('sent', null)).toBe(true)
    expect(needsOnlineInvoiceUrl('paid', '')).toBe(true)
    expect(needsOnlineInvoiceUrl('sent', 'https://in.xero.com/x')).toBe(false)
    expect(needsOnlineInvoiceUrl('draft', null)).toBe(false)
    expect(needsOnlineInvoiceUrl('written_off', null)).toBe(false)
    expect(needsOnlineInvoiceUrl(null, null)).toBe(false)
  })

  it('never queues a SUBMITTED invoice, which maps to sent but has no link', () => {
    // Awaiting approval in Xero: the OnlineInvoice endpoint errors, and a
    // guaranteed failure requeues on every run and eats the cap forever.
    expect(needsOnlineInvoiceUrl('sent', null, 'SUBMITTED')).toBe(false)
    expect(needsOnlineInvoiceUrl('sent', null, 'AUTHORISED')).toBe(true)
    expect(needsOnlineInvoiceUrl('paid', null, 'PAID')).toBe(true)
  })

  it('clears a stored link only when Xero has stopped serving one', () => {
    const url = 'https://in.xero.com/x'
    // Voided or deleted in Xero, and demoted back to DRAFT by our own push:
    // both revoke the online invoice, and the client must not keep a dead URL.
    expect(shouldClearOnlineInvoiceUrl('written_off', url)).toBe(true)
    expect(shouldClearOnlineInvoiceUrl('draft', url)).toBe(true)
    // Still issued, so the link stands.
    expect(shouldClearOnlineInvoiceUrl('sent', url)).toBe(false)
    expect(shouldClearOnlineInvoiceUrl('paid', url)).toBe(false)
    // Xero had no opinion worth writing: never a reason to bin a good link.
    expect(shouldClearOnlineInvoiceUrl(null, url)).toBe(false)
    // Nothing stored, nothing to clear: no pointless write.
    expect(shouldClearOnlineInvoiceUrl('written_off', null)).toBe(false)
    expect(shouldClearOnlineInvoiceUrl('draft', '  ')).toBe(false)
  })

  it('rotates the window so a poisoned head cannot hold the cap forever', () => {
    // A candidate that can never yield a link writes nothing and requeues on
    // every run. With a stable prefix, 25 of those would starve every newly
    // approved invoice indefinitely.
    const candidates = Array.from({ length: 5 }, (_, i) => `c${i}`)
    const base = Date.parse('2026-09-05T00:00:00.000Z')
    const at = (runs: number) => new Date(base + runs * ONLINE_INVOICE_ROTATION_MS).toISOString()

    expect(onlineInvoiceWindow(candidates, 2, at(0))).toEqual(['c0', 'c1'])
    expect(onlineInvoiceWindow(candidates, 2, at(1))).toEqual(['c2', 'c3'])
    // The last block wraps rather than running short.
    expect(onlineInvoiceWindow(candidates, 2, at(2))).toEqual(['c4', 'c0'])
    expect(onlineInvoiceWindow(candidates, 2, at(3))).toEqual(['c0', 'c1'])

    // Every candidate is reached inside one cycle, which is the property that
    // matters: ceil(5 / 2) = 3 runs.
    const seen = new Set([0, 1, 2].flatMap(r => onlineInvoiceWindow(candidates, 2, at(r))))
    expect(seen).toEqual(new Set(candidates))
  })

  it('leaves a queue that fits under the cap in its found order', () => {
    // No rotation to do, and reordering a short queue for no reason would make
    // the sync summary harder to read.
    const candidates = ['a', 'b', 'c']
    expect(onlineInvoiceWindow(candidates, 25, '2026-09-05T07:00:00.000Z')).toEqual(candidates)
    expect(onlineInvoiceWindow(candidates, 0, '2026-09-05T07:00:00.000Z')).toEqual([])
    // An unparseable stamp is a window, not a crash.
    expect(onlineInvoiceWindow(['a', 'b', 'c', 'd'], 2, 'not-a-date')).toEqual(['a', 'b'])
  })

  it('stops at the cap and counts what it left behind', async () => {
    const asked: string[] = []
    const { handle } = makeDb()
    const candidates = Array.from({ length: 5 }, (_, i) => ({ id: `inv-${i}`, xeroInvoiceId: `xero-${i}` }))

    const capture = await captureOnlineInvoiceUrls(
      handle as unknown as Db,
      candidates,
      '2026-09-05T00:00:00.000Z',
      {
        cap: 2,
        fetchOnlineInvoice: async (id) => {
          asked.push(id)
          return { OnlineInvoices: [{ OnlineInvoiceUrl: `https://in.xero.com/${id}` }] }
        },
      },
    )

    expect(asked).toEqual(['xero-0', 'xero-1'])
    expect(capture).toEqual({ candidates: 5, fetched: 2, captured: 2, failed: 0, deferred: 3 })
  })

  it('swallows a throwing fetch and keeps going', async () => {
    const { handle, queries } = makeDb()

    const capture = await captureOnlineInvoiceUrls(
      handle as unknown as Db,
      [{ id: 'inv-1', xeroInvoiceId: 'xero-1' }, { id: 'inv-2', xeroInvoiceId: 'xero-2' }],
      '2026-09-05T00:00:00.000Z',
      {
        fetchOnlineInvoice: async (id) => {
          if (id === 'xero-1') throw new Error('Xero 429')
          return { OnlineInvoices: [{ OnlineInvoiceUrl: 'https://in.xero.com/two' }] }
        },
      },
    )

    expect(capture).toMatchObject({ fetched: 2, captured: 1, failed: 1 })
    expect(byEntry(queries, 'update')).toHaveLength(1)
  })
})
