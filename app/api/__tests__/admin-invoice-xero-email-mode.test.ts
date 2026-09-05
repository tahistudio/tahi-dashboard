/**
 * app/api/__tests__/admin-invoice-xero-email-mode.test.ts
 *
 * WHO sends a Xero-rail invoice, and what the client is handed.
 *
 * Liam, 2026-09-06: "Xero-rail email: both, behind a studio toggle (send our
 * template with the portal link, let Xero send its PDF, or both)." The toggle
 * is the settings key invoicing.xeroEmailMode:
 *
 *   dashboard  our template only. The default.
 *   xero       Xero's own PDF, and we stand down.
 *   both       both copies.
 *
 * The fallback is the part worth testing hardest. Xero REFUSES to email an
 * invoice that is not AUTHORISED, and the push route holds every
 * dashboard-raised invoice at DRAFT on purpose, so "Xero will not send it" is
 * the ORDINARY state of a freshly pushed bill. In 'xero' mode a refusal has to
 * fall back to our own template, or the client receives nothing at all while
 * the route reports a clean send.
 *
 * Also pinned here: what the email carries. A pay page when either rail has
 * issued one, and otherwise the How to pay block with the studio's bank
 * details and the invoice reference, so a Xero client is never emailed a bill
 * with nothing to act on.
 *
 * The Xero client is mocked at lib/xero, so the three modes and the draft
 * fallback are exercised without a Xero tenant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }))

vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
}))

vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn(() => null) }))

// The Xero client itself. XeroAPIError stays real: lib/xero-invoice-email
// tells a refusal from an empty 204 body with an `instanceof` check.
vi.mock('@/lib/xero', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/xero')>()),
  callXeroAPI: vi.fn(),
  callXeroAPIOrThrow: vi.fn(),
}))

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { callXeroAPI, callXeroAPIOrThrow, XeroAPIError } from '@/lib/xero'
import { NextRequest } from 'next/server'

import { POST as sendInvoiceEmail } from '@/app/api/admin/invoices/[id]/send-email/route'
import {
  BANK_DETAILS_SETTING_KEY,
  XERO_EMAIL_MODE_SETTING_KEY,
  type XeroEmailMode,
} from '@/lib/invoice-pay-settings'
import { INVOICE_CHANNEL_SETTING_KEY } from '@/lib/invoice-channel'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable.
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
  const queue = [...results]
  const entry = () => makeChain(queue.length ? queue.shift() : [])
  return { select: entry, insert: entry, update: entry, delete: entry }
}

function post(id: string) {
  return new NextRequest(`http://localhost:3000/api/admin/invoices/${id}/send-email`, {
    method: 'POST',
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

const BANK = {
  bankName: 'ANZ',
  accountName: 'Tahi Studio Ltd',
  accountNumber: '01-0242-0198765-00',
  referenceHint: 'Quote the reference on your transfer.',
}

/** A Xero-rail invoice with no pay page: where every pushed bill starts. */
const XERO_INVOICE = {
  id: 'inv-1042-9c31-4b77-8e05-6f1d2a94c7b3',
  orgId: 'org-a',
  status: 'draft',
  totalUsd: 4312.5,
  currency: 'NZD',
  notes: null,
  dueDate: '2026-09-30',
  sentAt: null,
  stripeInvoiceId: null,
  stripeHostedInvoiceUrl: null,
  xeroInvoiceId: 'xero-inv-1',
  xeroOnlineInvoiceUrl: null,
  orgInvoiceChannel: 'xero',
}

const CONTACTS = [
  { id: 'c-owner', email: 'owner@acme.test', name: 'Ana Owner', portalRole: 'admin', isPrimary: true },
]

function settingsRows(mode: XeroEmailMode) {
  return [
    { key: INVOICE_CHANNEL_SETTING_KEY, value: 'stripe' },
    { key: BANK_DETAILS_SETTING_KEY, value: JSON.stringify(BANK) },
    { key: XERO_EMAIL_MODE_SETTING_KEY, value: mode },
  ]
}

/**
 * The reads this route makes, in order: the invoice (joined to the org), the
 * contacts, the settings. Everything after that is a write.
 */
function primeDb(mode: XeroEmailMode, invoice: Record<string, unknown> = XERO_INVOICE) {
  vi.mocked(db).mockResolvedValue(
    makeDb([[invoice], CONTACTS, settingsRows(mode)]) as never,
  )
}

/** Xero answers the status read with this, and takes the Email call. */
function xeroAt(status: string) {
  vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: [{ Status: status }] } as never)
  vi.mocked(callXeroAPIOrThrow).mockResolvedValue({} as never)
}

interface SendBody {
  sentTo?: string[]
  payLink?: boolean
  bankDetails?: boolean
  xeroEmail?: string
  reason?: string
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(sendEmail).mockResolvedValue({ success: true })
  xeroAt('AUTHORISED')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST send-email: invoicing.xeroEmailMode', () => {
  it("mode 'dashboard' sends ours and never touches Xero", async () => {
    primeDb('dashboard')

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))
    expect(res.status).toBe(200)
    const body = await res.json() as SendBody

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callXeroAPIOrThrow)).not.toHaveBeenCalled()
    // No Xero send was attempted, so there is nothing to report about one.
    expect(body.xeroEmail).toBeUndefined()
    expect(body.sentTo).toEqual(['owner@acme.test'])
  })

  it("mode 'xero' hands the send to Xero and stands our template down", async () => {
    primeDb('xero')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(vi.mocked(callXeroAPIOrThrow)).toHaveBeenCalledWith(
      'POST', '/Invoices/xero-inv-1/Email', {},
    )
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
    expect(body.xeroEmail).toBe('sent')
    // Nobody was mailed BY US, and that is a success rather than a 502.
    expect(body.sentTo).toEqual([])
  })

  it("mode 'both' sends ours and Xero's", async () => {
    primeDb('both')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callXeroAPIOrThrow)).toHaveBeenCalledTimes(1)
    expect(body.xeroEmail).toBe('sent')
    expect(body.sentTo).toEqual(['owner@acme.test'])
  })

  it("falls back to our template when the Xero invoice is still a draft, and says so", async () => {
    // The ordinary state of a freshly pushed bill: the push route holds it at
    // DRAFT until Liam approves it, and Xero will not email a draft.
    xeroAt('DRAFT')
    primeDb('xero')

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))
    expect(res.status).toBe(200)
    const body = await res.json() as SendBody

    expect(vi.mocked(callXeroAPIOrThrow)).not.toHaveBeenCalled()
    // The client still gets the bill.
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
    expect(body.xeroEmail).toBe('skipped')
    expect(body.reason).toBe('Xero invoice is still a draft')
    expect(body.sentTo).toEqual(['owner@acme.test'])
  })

  it('falls back when Xero refuses the Email call outright', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue({ Invoices: [{ Status: 'AUTHORISED' }] } as never)
    vi.mocked(callXeroAPIOrThrow).mockRejectedValue(
      new XeroAPIError('Xero API POST failed: 400', 400, '/Invoices/xero-inv-1/Email', 'POST'),
    )
    primeDb('xero')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(body.xeroEmail).toBe('failed')
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
    expect(body.sentTo).toEqual(['owner@acme.test'])
  })

  it('falls back when the Email call never reached Xero, rather than claiming a send', async () => {
    // A network error or an unobtainable token arrives as a plain Error, not a
    // XeroAPIError. Treating it as the empty-204 body would report a send that
    // did not happen, and in 'xero' mode our own template is stood down on the
    // strength of that report, so the client would receive nothing at all.
    vi.mocked(callXeroAPIOrThrow).mockRejectedValue(new Error('fetch failed'))
    primeDb('xero')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(body.xeroEmail).toBe('failed')
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
  })

  it('counts an empty 204 body as the send it is', async () => {
    // POST /Invoices/{id}/Email answers 204 NO CONTENT, and callXeroAPIOrThrow
    // ends in res.json(), which throws a SyntaxError on an empty body. That
    // throw is a successful send.
    vi.mocked(callXeroAPIOrThrow).mockRejectedValue(new SyntaxError('Unexpected end of JSON input'))
    primeDb('xero')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(body.xeroEmail).toBe('sent')
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
  })

  it('leaves the Stripe rail alone whatever the mode says', async () => {
    // The mode only ever applies to a Xero-rail client. A Stripe client's
    // invoice does not exist in Xero to email.
    primeDb('both', { ...XERO_INVOICE, orgInvoiceChannel: 'stripe' })

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    expect(vi.mocked(callXeroAPI)).not.toHaveBeenCalled()
    expect(body.xeroEmail).toBeUndefined()
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1)
  })
})

describe('POST send-email: what the client is handed', () => {
  it('passes the How to pay block when a Xero-rail invoice has no pay page', async () => {
    primeDb('dashboard')

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    const el = vi.mocked(sendEmail).mock.calls[0][2] as unknown as {
      props: { paymentUrl?: string; howToPay?: Record<string, unknown> }
    }
    expect(el.props.paymentUrl).toBeUndefined()
    expect(el.props.howToPay).toMatchObject({
      bankName: 'ANZ',
      accountName: 'Tahi Studio Ltd',
      accountNumber: '01-0242-0198765-00',
      reference: 'INV-1042',
      amount: 4312.5,
      currency: 'NZD',
      dueDate: '2026-09-30',
    })
    expect(body.bankDetails).toBe(true)
    expect(body.payLink).toBe(false)
  })

  it("passes Xero's online invoice as the pay link once it exists, and drops the block", async () => {
    primeDb('dashboard', { ...XERO_INVOICE, xeroOnlineInvoiceUrl: 'https://in.xero.com/abc' })

    const body = await (await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))).json() as SendBody

    const el = vi.mocked(sendEmail).mock.calls[0][2] as unknown as {
      props: { paymentUrl?: string; howToPay?: unknown }
    }
    expect(el.props.paymentUrl).toBe('https://in.xero.com/abc')
    expect(el.props.howToPay).toBeUndefined()
    expect(body.payLink).toBe(true)
    expect(body.bankDetails).toBe(false)
  })

  it('prefers the Stripe hosted page over the Xero one when both exist', async () => {
    primeDb('dashboard', {
      ...XERO_INVOICE,
      stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_1',
      xeroOnlineInvoiceUrl: 'https://in.xero.com/abc',
    })

    await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    const el = vi.mocked(sendEmail).mock.calls[0][2] as unknown as { props: { paymentUrl?: string } }
    expect(el.props.paymentUrl).toBe('https://invoice.stripe.com/i/acct_1/test_1')
  })
})
