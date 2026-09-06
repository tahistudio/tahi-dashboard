/**
 * The email delivery allowlist, on the invoice send route.
 *
 * The gate itself is pinned in lib/__tests__/email-delivery.test.ts. What is
 * pinned HERE is the second transport, which the gate cannot see: on the Xero
 * rail this route can ask Xero to email the invoice, and Xero holds the
 * contact, so no address ever passes through lib/email-delivery.ts. Left
 * alone, "no client receives mail until Liam says so" would be true of our
 * template and quietly false of Xero's PDF.
 *
 * So the route asks the same pure rule itself and stands Xero down when every
 * billing contact would be withheld, and answers 409 (a decision, retrying
 * changes nothing) rather than 502 (an outage, retry it).
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

// sendEmail is mocked at its own module boundary, so what it reports is under
// this spec's control. The route's OTHER allowlist read (resolveDeliveryPolicy)
// is left real and fed by the policy fixture below.
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))

vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
}))

vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn(() => null) }))

vi.mock('@/lib/xero', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/xero')>()),
  callXeroAPI: vi.fn(),
  callXeroAPIOrThrow: vi.fn(),
}))

const policy = vi.hoisted(() => ({
  value: { mode: 'allowlist', allowedDomains: ['tahi.studio'], allowedOrgIds: [] as string[] },
}))

vi.mock('@/lib/email-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-delivery')>()),
  resolveDeliveryPolicy: vi.fn(async () => policy.value),
}))

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { callXeroAPI, callXeroAPIOrThrow } from '@/lib/xero'
import { NextRequest } from 'next/server'

import { POST as sendInvoiceEmail } from '@/app/api/admin/invoices/[id]/send-email/route'
import { XERO_EMAIL_MODE_SETTING_KEY } from '@/lib/invoice-pay-settings'
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

/** A Xero-rail invoice, approved in Xero, so Xero would happily email it. */
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

/** A real client at their own company: exactly what the gate holds back. */
const OUTSIDE_CONTACTS = [
  { id: 'c-owner', email: 'owner@acme.test', name: 'Ana Owner', portalRole: 'admin', isPrimary: true },
]

function primeDb(contacts: unknown[]) {
  vi.mocked(db).mockResolvedValue(
    makeDb([
      [XERO_INVOICE],
      contacts,
      [
        { key: INVOICE_CHANNEL_SETTING_KEY, value: 'stripe' },
        { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'both' },
      ],
    ]) as never,
  )
}

interface SendBody {
  error?: string
  message?: string
  sentTo?: string[]
  xeroEmail?: string
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  policy.value = { mode: 'allowlist', allowedDomains: ['tahi.studio'], allowedOrgIds: [] }
  vi.mocked(callXeroAPI).mockResolvedValue(
    { Invoices: [{ Status: 'AUTHORISED', SentToContact: false }] } as never,
  )
  vi.mocked(callXeroAPIOrThrow).mockResolvedValue({} as never)
  // What the gate returns for an address it will not deliver to.
  vi.mocked(sendEmail).mockResolvedValue({
    success: false,
    error: 'Held back by the email allowlist (1 recipient).',
    suppressedCount: 1,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a client nobody has allowlisted', () => {
  it('does not let Xero email the invoice either', async () => {
    primeDb(OUTSIDE_CONTACTS)

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    // The whole point: Xero's Email endpoint is never called.
    expect(vi.mocked(callXeroAPIOrThrow)).not.toHaveBeenCalled()
    expect(res.status).toBe(409)
    const body = await res.json() as SendBody
    expect(body.error).toBe('Held back by the email allowlist')
    expect(body.message).toContain('Studio details')
  })

  it('does not mark the invoice sent or notify the client', async () => {
    primeDb(OUTSIDE_CONTACTS)
    const { createNotifications } = await import('@/lib/notifications')

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    expect(res.status).toBe(409)
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })
})

describe('a client whose org has been exempted', () => {
  it('lets both our email and Xero go', async () => {
    policy.value = { mode: 'allowlist', allowedDomains: ['tahi.studio'], allowedOrgIds: ['org-a'] }
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
    primeDb(OUTSIDE_CONTACTS)

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    expect(res.status).toBe(200)
    expect(vi.mocked(callXeroAPIOrThrow)).toHaveBeenCalledTimes(1)
    const body = await res.json() as SendBody
    expect(body.sentTo).toEqual(['owner@acme.test'])
    expect(body.xeroEmail).toBe('sent')
  })
})

describe('a billing contact on tahi.studio', () => {
  it('goes out under the default policy, with no exemption needed', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
    primeDb([
      { id: 'c-liam', email: 'business@tahi.studio', name: 'Liam', portalRole: 'admin', isPrimary: true },
    ])

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    expect(res.status).toBe(200)
    expect(vi.mocked(callXeroAPIOrThrow)).toHaveBeenCalledTimes(1)
  })
})

describe('a genuine send failure, with the allowlist satisfied', () => {
  it('is still a 502, not a 409: retrying is the right advice', async () => {
    policy.value = { mode: 'all', allowedDomains: ['tahi.studio'], allowedOrgIds: [] }
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend down' })
    // 'dashboard' mode so Xero is never asked and the only outcome is ours.
    vi.mocked(db).mockResolvedValue(
      makeDb([
        [XERO_INVOICE],
        OUTSIDE_CONTACTS,
        [
          { key: INVOICE_CHANNEL_SETTING_KEY, value: 'stripe' },
          { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'dashboard' },
        ],
      ]) as never,
    )

    const res = await sendInvoiceEmail(post('inv-1042'), params('inv-1042'))

    expect(res.status).toBe(502)
    const body = await res.json() as SendBody
    expect(body.message).toBe('Resend down')
  })
})
