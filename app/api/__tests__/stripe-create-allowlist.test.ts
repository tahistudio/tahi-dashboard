/**
 * Stripe is a second mail transport, and POST /api/admin/invoices/stripe-create
 * is where it is armed.
 *
 * The route creates the invoice with collection_method 'send_invoice' and then
 * finalises it. A finalised send_invoice invoice IS EMAILED TO THE CUSTOMER BY
 * STRIPE whenever the account has "email finalised invoices" on, from Stripe's
 * systems, to the address on the Stripe customer. No code here is involved and
 * lib/email-delivery.ts never sees it, so it could not be filtered. The
 * identical Xero hole was recognised and closed; this one was left open and is
 * reachable from the invoice detail page, the invoice list's bulk action and
 * the create_stripe_invoice MCP tool.
 *
 * Pinned: nothing is created in Stripe unless every billing contact is allowed,
 * the refusal is a 409 with the allowlist reason (not a 502: nothing is broken
 * and retrying changes nothing), and it leaves the suppression row that proves
 * the hold.
 *
 * ALL OR NOTHING, unlike our own template, because Stripe mails ONE address we
 * do not choose per send. "Some contacts passed" is not a state it can honour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Row = Record<string, unknown>

const state = {
  selectRows: [] as unknown[][],
  inserts: [] as Row[],
  policy: {
    mode: 'allowlist' as 'allowlist' | 'all',
    allowedDomains: ['tahi.studio'],
    allowedOrgIds: [] as string[],
    allowedAddresses: [] as string[],
    blockedAddresses: [] as string[],
  },
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrg: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn(() => 'sk_test_1') }))
vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, inArray: stub, desc: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    invoices: { __table: 'invoices', id: 'id', orgId: 'org_id' },
    invoiceItems: { __table: 'invoice_items', invoiceId: 'invoice_id' },
    organisations: { __table: 'organisations', id: 'id' },
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', name: 'name', portalRole: 'portal_role', isPrimary: 'is_primary' },
    emailSuppressions: { __table: 'email_suppressions', createdAt: 'created_at' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(state.selectRows.length ? state.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)
  chain.where = vi.fn(() => {
    const promise = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(promise, { limit: vi.fn(() => promise) })
  })
  chain.limit = vi.fn(() => answer())
  chain.then = undefined
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((rows: Row | Row[]) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            state.inserts.push({ __table: tableName(table), ...row })
          }
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

// The policy is the fixture; the RULE is real, so what these specs pin is the
// route's decision rather than a re-implementation of the rule.
vi.mock('@/lib/email-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-delivery')>()),
  resolveDeliveryPolicy: vi.fn(async () => state.policy),
  resolveOrgRecipientScope: vi.fn(async (orgId: string | null) => ({ orgId })),
}))

import { NextRequest } from 'next/server'
import { POST as stripeCreate } from '@/app/api/admin/invoices/stripe-create/route'

const INVOICE = {
  id: 'inv-1',
  orgId: 'org-a',
  currency: 'NZD',
  dueDate: '2026-09-30',
  sentAt: null,
  stripeInvoiceId: null,
}
const ORG = [{ id: 'org-a', name: 'Acme Orchard', stripeCustomerId: 'cus_1' }]
const ITEMS = [{ id: 'li-1', description: 'Retainer', quantity: 1, unitPriceUsd: 1500 }]

const OUTSIDE_CONTACTS = [
  { id: 'c-owner', email: 'owner@acme.test', name: 'Ana Owner', portalRole: 'admin', isPrimary: true },
]

function prime(contacts: unknown[]) {
  state.selectRows = [[INVOICE], ORG, contacts, ITEMS, []]
}

function post() {
  return new NextRequest('http://localhost:3000/api/admin/invoices/stripe-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: 'inv-1' }),
  })
}

const suppressions = () => state.inserts.filter(r => r.__table === 'email_suppressions')

beforeEach(() => {
  vi.clearAllMocks()
  state.selectRows = []
  state.inserts = []
  state.policy = {
    mode: 'allowlist',
    allowedDomains: ['tahi.studio'],
    allowedOrgIds: [],
    allowedAddresses: [],
    blockedAddresses: [],
  }
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'in_new', hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/new' }),
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a client nobody has allowlisted', () => {
  it('creates nothing in Stripe at all', async () => {
    prime(OUTSIDE_CONTACTS)

    const res = await stripeCreate(post())

    expect(res.status).toBe(409)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('says the allowlist is why, and where to change it', async () => {
    prime(OUTSIDE_CONTACTS)

    const body = await (await stripeCreate(post())).json() as { error: string; message: string }

    expect(body.error).toBe('Held back by the email allowlist')
    expect(body.message).toContain('Stripe emails a finalised invoice itself')
    expect(body.message).toContain('Email delivery')
  })

  it('leaves the suppression row that proves the hold', async () => {
    prime(OUTSIDE_CONTACTS)

    await stripeCreate(post())

    expect(suppressions()).toHaveLength(1)
    expect(suppressions()[0]).toMatchObject({
      to: 'owner@acme.test',
      orgId: 'org-a',
      template: 'stripe-invoice',
    })
  })

  it('refuses on a MIXED list, because Stripe mails one address we do not choose', async () => {
    prime([
      { id: 'c-liam', email: 'business@tahi.studio', name: 'Liam', portalRole: 'admin', isPrimary: true },
      ...OUTSIDE_CONTACTS,
    ])

    const res = await stripeCreate(post())

    expect(res.status).toBe(409)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('refuses a client with no billing contact, because there is no address to check', async () => {
    prime([])

    const res = await stripeCreate(post())

    expect(res.status).toBe(409)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('no billing contact')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

describe('a client the policy authorises', () => {
  it('creates and finalises when every billing contact is allowed', async () => {
    prime([
      { id: 'c-liam', email: 'business@tahi.studio', name: 'Liam', portalRole: 'admin', isPrimary: true },
    ])

    const res = await stripeCreate(post())

    expect(res.status).toBe(200)
    expect(suppressions()).toHaveLength(0)
    const calls = vi.mocked(fetch).mock.calls.map(c => String(c[0]))
    expect(calls.some(u => u.endsWith('/v1/invoices'))).toBe(true)
    expect(calls.some(u => u.includes('/finalize'))).toBe(true)
  })

  it('creates and finalises for an outside client once the gate is open', async () => {
    state.policy = { ...state.policy, mode: 'all' }
    prime(OUTSIDE_CONTACTS)

    const res = await stripeCreate(post())

    expect(res.status).toBe(200)
    expect(suppressions()).toHaveLength(0)
  })
})
