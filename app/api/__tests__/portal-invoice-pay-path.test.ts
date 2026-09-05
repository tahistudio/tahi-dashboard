/**
 * app/api/__tests__/portal-invoice-pay-path.test.ts
 *
 * What the CLIENT is handed for an invoice, on both portal reads.
 *
 * Two shapes, and a client only ever gets one of them:
 *
 *   payUrl    a pay page. Stripe's hosted invoice, or Xero's own online
 *             invoice once the bill has been approved in Xero. Folded into one
 *             field on purpose: the client does not care which rail issued the
 *             link, and gating the Xero page on the org's nominal channel would
 *             leave a payable bill unpayable.
 *   howToPay  bank details, the reference, the amount and the due date, for a
 *             Xero-rail invoice with no link yet. That is where EVERY pushed
 *             Xero invoice starts (it sits at DRAFT until Liam approves it), so
 *             without this the client holds a real bill with nothing to act on.
 *
 * And one rule over both: nothing studio-side rides along. No rail label, no
 * Stripe or Xero id, no reconciliation state. Liam, 2026-09-06: "the client
 * sees only what they need to act". The no-leak assertions below are written
 * against the WHOLE key set rather than a blocklist, so a column added to the
 * projection later fails this test instead of shipping to a client.
 *
 * The fake D1 is the recorder from admin-scoping-routes.test.ts: only the
 * chain is thenable, and results are served positionally, so the ORDER of the
 * reads each route makes is part of what is pinned here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: 'org-a', clerkOrgId: 'clerk_org_a', impersonating: false,
  }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

import { db } from '@/lib/db'
import { NextRequest } from 'next/server'

import { GET as portalInvoiceList } from '@/app/api/portal/invoices/route'
import { GET as portalInvoiceDetail } from '@/app/api/portal/invoices/[id]/route'
import {
  BANK_DETAILS_SETTING_KEY,
  XERO_EMAIL_MODE_SETTING_KEY,
} from '@/lib/invoice-pay-settings'
import { INVOICE_CHANNEL_SETTING_KEY } from '@/lib/invoice-channel'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself (awaiting `db()` must not resolve the query).
// ---------------------------------------------------------------------------
function makeChain(result: unknown): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return () => proxy
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const entries: string[] = []
  const queue = [...results]
  const entry = (method: string) => {
    entries.push(method)
    return makeChain(queue.length ? queue.shift() : [])
  }
  const handle = {
    select: () => entry('select'),
    insert: () => entry('insert'),
    update: () => entry('update'),
    delete: () => entry('delete'),
  }
  return { handle, entries }
}

function req(url: string) {
  return new NextRequest(`http://localhost:3000${url}`)
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const BANK = {
  bankName: 'ANZ',
  accountName: 'Tahi Studio Ltd',
  accountNumber: '01-0242-0198765-00',
  referenceHint: 'Quote the reference on your transfer.',
}

/** The studio settings rows both routes read whole. */
const SETTINGS_ROWS = [
  { key: INVOICE_CHANNEL_SETTING_KEY, value: 'stripe' },
  { key: BANK_DETAILS_SETTING_KEY, value: JSON.stringify(BANK) },
  { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'dashboard' },
]

/** One row as the LIST route selects it. */
const LIST_ROW = {
  id: 'inv-1042-9c31-4b77-8e05-6f1d2a94c7b3',
  orgId: 'org-a',
  status: 'sent',
  totalAmount: 4312.5,
  currency: 'NZD',
  dueDate: '2026-09-30',
  sentAt: '2026-09-01T00:00:00.000Z',
  paidAt: null,
  payUrl: null,
  xeroPayUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

/** One row as the DETAIL route selects it (it also reads the org's rail). */
const DETAIL_ROW = {
  id: 'inv-1042-9c31-4b77-8e05-6f1d2a94c7b3',
  orgId: 'org-a',
  orgName: 'Mahana Orchards',
  projectId: null,
  subscriptionId: null,
  source: 'xero',
  status: 'sent',
  amountUsd: 4312.5,
  taxAmountUsd: 0,
  discountAmountUsd: 0,
  totalUsd: 4312.5,
  currency: 'NZD',
  notes: null,
  dueDate: '2026-09-30',
  sentAt: '2026-09-01T00:00:00.000Z',
  viewedAt: '2026-09-02T00:00:00.000Z',
  paidAt: null,
  payUrl: null,
  xeroPayUrl: null,
  orgInvoiceChannel: 'xero',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
}

interface HowToPay {
  bankName?: string
  accountName?: string
  accountNumber?: string
  reference: string
  amount: number
  currency: string
  dueDate: string | null
  hint: string
}

type Projected = Record<string, unknown> & { payUrl: string | null; howToPay?: HowToPay }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// GET /api/portal/invoices
// ---------------------------------------------------------------------------
describe('GET /api/portal/invoices pay path', () => {
  it('hands a Xero-rail invoice with no link the How to pay block', async () => {
    const { handle } = makeDb([[LIST_ROW], [{ invoiceChannel: 'xero' }], SETTINGS_ROWS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceList(req('/api/portal/invoices'))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: Projected[] }
    const row = body.items[0]

    expect(row.payUrl).toBeNull()
    expect(row.howToPay).toEqual({
      bankName: 'ANZ',
      accountName: 'Tahi Studio Ltd',
      accountNumber: '01-0242-0198765-00',
      // The invoice number, which is what the client quotes on the transfer.
      reference: 'INV-1042',
      amount: 4312.5,
      currency: 'NZD',
      dueDate: '2026-09-30',
      hint: BANK.referenceHint,
    })
  })

  it('hands a Stripe hosted page straight through as payUrl, with no block', async () => {
    const withLink = { ...LIST_ROW, payUrl: 'https://invoice.stripe.com/i/acct_1/test_1' }
    const { handle, entries } = makeDb([[withLink]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalInvoiceList(req('/api/portal/invoices'))).json() as {
      items: Projected[]
    }

    expect(body.items[0].payUrl).toBe('https://invoice.stripe.com/i/acct_1/test_1')
    expect(body.items[0].howToPay).toBeUndefined()
    // A client whose bills all carry a hosted page pays no extra D1 round
    // trips for a block they will never see.
    expect(entries).toEqual(['select'])
  })

  it('folds the Xero online invoice into payUrl rather than returning it by name', async () => {
    const withXero = { ...LIST_ROW, xeroPayUrl: 'https://in.xero.com/abc' }
    const { handle } = makeDb([[withXero]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalInvoiceList(req('/api/portal/invoices'))).json() as {
      items: Projected[]
    }

    expect(body.items[0].payUrl).toBe('https://in.xero.com/abc')
    expect(body.items[0]).not.toHaveProperty('xeroPayUrl')
    expect(body.items[0].howToPay).toBeUndefined()
  })

  it('builds no block for a Stripe-rail client waiting on a hosted page', async () => {
    // A bank transfer against a Stripe invoice reconciles against nothing, so
    // "no link yet" on the Stripe rail is a wait, not a transfer.
    const { handle } = makeDb([[LIST_ROW], [{ invoiceChannel: 'stripe' }], SETTINGS_ROWS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalInvoiceList(req('/api/portal/invoices'))).json() as {
      items: Projected[]
    }
    expect(body.items[0].howToPay).toBeUndefined()
  })

  it('leaks nothing studio-side: the row is exactly the client-facing fields', async () => {
    const { handle } = makeDb([[LIST_ROW], [{ invoiceChannel: 'xero' }], SETTINGS_ROWS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await portalInvoiceList(req('/api/portal/invoices'))).json() as {
      items: Projected[]
    }

    expect(Object.keys(body.items[0]).sort()).toEqual([
      'createdAt',
      'currency',
      'dueDate',
      'howToPay',
      'id',
      'orgId',
      'paidAt',
      'payUrl',
      'sentAt',
      'status',
      'totalAmount',
      'updatedAt',
    ])
  })
})

// ---------------------------------------------------------------------------
// GET /api/portal/invoices/[id]
// ---------------------------------------------------------------------------
describe('GET /api/portal/invoices/[id] pay path', () => {
  it('hands a Xero-rail invoice with no link the same block as the list', async () => {
    const { handle } = makeDb([[DETAIL_ROW], SETTINGS_ROWS, []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceDetail(req('/api/portal/invoices/inv-1042'), params('inv-1042'))
    const body = await res.json() as { invoice: Projected }

    expect(body.invoice.payUrl).toBeNull()
    // Word for word the list's block: a client reading two different account
    // numbers for the same bill is the failure this module exists to prevent.
    expect(body.invoice.howToPay).toEqual({
      bankName: 'ANZ',
      accountName: 'Tahi Studio Ltd',
      accountNumber: '01-0242-0198765-00',
      reference: 'INV-1042',
      amount: 4312.5,
      currency: 'NZD',
      dueDate: '2026-09-30',
      hint: BANK.referenceHint,
    })
  })

  it('prefers a pay page and reads no settings when one exists', async () => {
    const withLink = { ...DETAIL_ROW, xeroPayUrl: 'https://in.xero.com/abc' }
    const { handle, entries } = makeDb([[withLink], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (
      await portalInvoiceDetail(req('/api/portal/invoices/inv-1042'), params('inv-1042'))
    ).json() as { invoice: Projected }

    expect(body.invoice.payUrl).toBe('https://in.xero.com/abc')
    expect(body.invoice.howToPay).toBeUndefined()
    // The invoice read and the items read, and no settings round trip between.
    expect(entries).toEqual(['select', 'select'])
  })

  it('never returns the Xero pay column or the org rail under their own names', async () => {
    const { handle } = makeDb([[DETAIL_ROW], SETTINGS_ROWS, []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (
      await portalInvoiceDetail(req('/api/portal/invoices/inv-1042'), params('inv-1042'))
    ).json() as { invoice: Projected }

    expect(body.invoice).not.toHaveProperty('xeroPayUrl')
    expect(body.invoice).not.toHaveProperty('orgInvoiceChannel')
    expect(body.invoice).not.toHaveProperty('xeroInvoiceId')
    expect(body.invoice).not.toHaveProperty('stripeInvoiceId')
    expect(JSON.stringify(body.invoice)).not.toContain('xero-')
  })
})
