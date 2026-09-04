/**
 * Route-level tests for the client billing loop:
 *
 *   - GET  /api/portal/invoices/[id]        org-scoped detail (the route that
 *                                           did not exist, so every client row
 *                                           click 403d on the admin API)
 *   - POST /api/admin/invoices/[id]/send-email
 *                                           all billing contacts, real
 *                                           template, pay link, status flip,
 *                                           client notification on SEND (to
 *                                           the billing audience only, once,
 *                                           and never for a settled invoice)
 *   - POST /api/admin/invoices/stripe-create
 *                                           the other send door: persists the
 *                                           pay link and bells the same
 *                                           billing audience
 *   - POST /api/admin/invoices              draft creation notifies NOBODY
 *   - POST /api/onboarding/complete         "invoice me" records the terms,
 *                                           raises a draft, tells the studio
 *                                           and completes instead of 402ing,
 *                                           but only from inside onboarding
 *                                           and only for an org with nothing
 *                                           else paying for it
 *
 * The fake D1 is the recorder from admin-scoping-routes.test.ts: only the
 * chain is thenable, and every call is recorded so a tenancy claim can be
 * checked against the SQL that was actually built rather than the response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  getPortalAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: 'org-a', clerkOrgId: 'clerk_org_a', impersonating: false,
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn().mockResolvedValue(true) }))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null), requirePortalFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }))

vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
  notifyOrgContacts: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn(() => null) }))

vi.mock('@/lib/stripe-plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe-plans')>()),
  getStripe: vi.fn(() => null),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({ publicMetadata: {} }),
      updateUser: vi.fn().mockResolvedValue({}),
    },
  }),
}))

import { clerkClient } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { stripeSecretKey } from '@/lib/stripe-key'
import { getPortalAuth } from '@/lib/server-auth'
import { isOrgAdmin } from '@/lib/portal-access'
import { sendEmail } from '@/lib/email'
import { createNotifications, notifyOrgContacts, notifyAllAdmins } from '@/lib/notifications'
import { NextRequest } from 'next/server'

import { GET as portalInvoiceDetail } from '@/app/api/portal/invoices/[id]/route'
import { POST as sendInvoiceEmail } from '@/app/api/admin/invoices/[id]/send-email/route'
import { POST as stripeCreate } from '@/app/api/admin/invoices/stripe-create/route'
import { POST as createInvoice } from '@/app/api/admin/invoices/route'
import { POST as completeOnboarding } from '@/app/api/onboarding/complete/route'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself (awaiting `db()` must not resolve the query).
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
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

type Collected = { cols: string[]; params: unknown[]; text: string }

function walk(node: unknown, out: Collected): void {
  if (node instanceof SQL) {
    for (const chunk of node.queryChunks) walk(chunk, out)
    return
  }
  if (node instanceof Column) { out.cols.push(node.name); return }
  if (node instanceof Param) { out.params.push(node.value); return }
  if (Array.isArray(node)) { for (const item of node) walk(item, out); return }
  if (node && typeof node === 'object' && 'value' in node) {
    const value = (node as { value: unknown }).value
    if (Array.isArray(value)) out.text += value.join('')
  }
}

function whereOf(record: QueryRecord | undefined): Collected {
  const out: Collected = { cols: [], params: [], text: '' }
  for (const call of record?.calls ?? []) {
    if (call.method === 'where') walk(call.args, out)
  }
  return out
}

/** First argument handed to a chain method, e.g. `.set({...})` / `.values([...])`. */
function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

/** Queries whose entry method matches (e.g. every insert in the request). */
function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

type RequestOptions = ConstructorParameters<typeof NextRequest>[1]
function req(url: string, init?: RequestOptions) {
  return new NextRequest(`http://localhost:3000${url}`, init)
}
function jsonReq(url: string, body: unknown) {
  return req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function clientAuth(over: Record<string, unknown> = {}) {
  vi.mocked(getPortalAuth).mockResolvedValue({
    userId: 'user_client', orgId: 'org-a', clerkOrgId: 'clerk_org_a', impersonating: false,
    ...over,
  } as never)
}

/** The Clerk user behind the caller. publicMetadata.onboardingComplete is the
 *  "already through onboarding" signal the invoice-me guard reads. */
function clerkUser(publicMetadata: Record<string, unknown> = {}) {
  vi.mocked(clerkClient).mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({ publicMetadata }),
      updateUser: vi.fn().mockResolvedValue({}),
    },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(isOrgAdmin).mockResolvedValue(true)
  vi.mocked(sendEmail).mockResolvedValue({ success: true })
  vi.mocked(stripeSecretKey).mockReturnValue(undefined)
  clerkUser()
  clientAuth()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// GET /api/portal/invoices/[id]
// ---------------------------------------------------------------------------
const PORTAL_INVOICE = {
  id: 'inv-1',
  orgId: 'org-a',
  orgName: 'Acme',
  status: 'sent',
  totalUsd: 1500,
  currency: 'NZD',
  dueDate: '2026-09-30',
  viewedAt: null,
  payUrl: 'https://invoice.stripe.com/i/acct_1/test_1',
}

describe('GET /api/portal/invoices/[id]', () => {
  it('scopes the lookup to the caller org and excludes drafts', async () => {
    const { handle, queries } = makeDb([[PORTAL_INVOICE], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))
    expect(res.status).toBe(200)

    const where = whereOf(queries[0])
    // Tenancy is in the WHERE clause, not a post-check.
    expect(where.cols).toContain('org_id')
    expect(where.params).toContain('org-a')
    expect(where.params).toContain('inv-1')
    // A draft is the studio's working copy, never a bill the client owes.
    expect(where.cols).toContain('status')
    expect(where.params).toContain('draft')
    expect(where.text).toContain('<>')
  })

  it('returns the invoice, its items and the pay link', async () => {
    const items = [{ id: 'li-1', invoiceId: 'inv-1', description: 'Retainer', quantity: 1, unitPriceUsd: 1500, totalUsd: 1500 }]
    const { handle } = makeDb([[PORTAL_INVOICE], items])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))
    const body = await res.json() as { invoice: { payUrl: string }; items: unknown[] }
    expect(body.invoice.payUrl).toBe(PORTAL_INVOICE.payUrl)
    expect(body.items).toHaveLength(1)
  })

  it('404s an invoice belonging to another org (indistinguishable from missing)', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceDetail(req('/api/portal/invoices/inv-other'), params('inv-other'))
    expect(res.status).toBe(404)
  })

  it('403s a member seat that is not a workspace admin', async () => {
    vi.mocked(isOrgAdmin).mockResolvedValue(false)
    const { handle, queries } = makeDb([[PORTAL_INVOICE]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('401s an unauthenticated caller and 403s the Tahi org', async () => {
    clientAuth({ userId: null })
    expect((await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))).status).toBe(401)

    clientAuth({ orgId: 'org_tahi' })
    expect((await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))).status).toBe(403)
  })

  it('stamps viewedAt on a real client open but not on an admin preview', async () => {
    const first = makeDb([[PORTAL_INVOICE], []])
    vi.mocked(db).mockResolvedValue(first.handle as never)
    await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))
    expect(byEntry(first.queries, 'update')).toHaveLength(1)

    clientAuth({ impersonating: true })
    const second = makeDb([[PORTAL_INVOICE], []])
    vi.mocked(db).mockResolvedValue(second.handle as never)
    await portalInvoiceDetail(req('/api/portal/invoices/inv-1'), params('inv-1'))
    expect(byEntry(second.queries, 'update')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/invoices/[id]/send-email
// ---------------------------------------------------------------------------
const SEND_INVOICE = {
  id: 'inv-1',
  orgId: 'org-a',
  status: 'draft',
  totalUsd: 1500,
  currency: 'NZD',
  notes: null,
  dueDate: '2026-09-30',
  sentAt: null,
  stripeInvoiceId: 'in_test',
  stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_1',
}

const CONTACTS = [
  { id: 'c-owner', email: 'owner@acme.test', name: 'Ana Owner', portalRole: 'admin', isPrimary: true },
  { id: 'c-finance', email: 'finance@acme.test', name: 'Fin Ance', portalRole: 'admin', isPrimary: false },
  { id: 'c-designer', email: 'designer@acme.test', name: 'Dee Signer', portalRole: 'member', isPrimary: false },
]

describe('POST /api/admin/invoices/[id]/send-email', () => {
  it('emails every billing contact, not just the primary', async () => {
    const { handle } = makeDb([[SEND_INVOICE], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
    expect(res.status).toBe(200)
    const body = await res.json() as { sentTo: string[]; payLink: boolean }

    expect(body.sentTo).toEqual(['owner@acme.test', 'finance@acme.test'])
    // A plain member seat cannot open the invoice in the portal, so it is not
    // sent one.
    expect(body.sentTo).not.toContain('designer@acme.test')
    expect(body.payLink).toBe(true)
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2)
  })

  it('passes the stored pay link and a client-openable portal deep link', async () => {
    const { handle } = makeDb([[SEND_INVOICE], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))

    const el = vi.mocked(sendEmail).mock.calls[0][2] as unknown as {
      props: { invoiceUrl: string; paymentUrl?: string }
    }
    expect(el.props.paymentUrl).toBe(SEND_INVOICE.stripeHostedInvoiceUrl)
    // /invoices/<id> renders from the portal API for a client audience, so this
    // is not the admin page that used to 403 them.
    expect(el.props.invoiceUrl).toMatch(/\/invoices\/inv-1$/)
    expect(el.props.invoiceUrl).not.toContain('/api/')
  })

  it('marks the invoice sent and notifies the client on SEND', async () => {
    const { handle, queries } = makeDb([[SEND_INVOICE], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))

    const patch = argOf(byEntry(queries, 'update')[0], 'set') as { status: string; sentAt: string }
    expect(patch.status).toBe('sent')
    expect(patch.sentAt).toBeTruthy()
    expect(vi.mocked(createNotifications)).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(createNotifications).mock.calls[0][2]
    expect(payload.entityType).toBe('invoice')
    expect(payload.entityId).toBe('inv-1')
  })

  it('bells the billing contacts only, never the whole org', async () => {
    const { handle } = makeDb([[SEND_INVOICE], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))

    // A member seat is 403d by both portal invoice routes, so a bell row
    // carrying the amount would disclose the bill and then dead-end on click.
    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
    expect(vi.mocked(createNotifications).mock.calls[0][1]).toEqual([
      { contactId: 'c-owner' },
      { contactId: 'c-finance' },
    ])
  })

  it('does not re-stamp sentAt, demote the status or re-bell on a resend', async () => {
    const chased = { ...SEND_INVOICE, status: 'overdue', sentAt: '2026-09-01T00:00:00.000Z' }
    const { handle, queries } = makeDb([[chased], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ notified: false })

    // sentAt means FIRST send (receivables aging reads it) and 'overdue' is a
    // state this invoice already earned.
    const patch = argOf(byEntry(queries, 'update')[0], 'set') as Record<string, unknown>
    expect(patch).not.toHaveProperty('sentAt')
    expect(patch).not.toHaveProperty('status')
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })

  it('409s a settled invoice instead of re-billing it', async () => {
    for (const status of ['paid', 'written_off']) {
      vi.clearAllMocks()
      const { handle, queries } = makeDb([[{ ...SEND_INVOICE, status, sentAt: '2026-09-01T00:00:00.000Z' }]])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
      expect(res.status).toBe(409)
      expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
      expect(byEntry(queries, 'update')).toHaveLength(0)
      expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
    }
  })

  it('400s when nobody is designated to receive bills, rather than mailing everyone', async () => {
    // A ManyRequests import has no primary and no portalRole 'admin'.
    const undesignated = CONTACTS.map(c => ({ ...c, portalRole: 'member', isPrimary: false }))
    const { handle, queries } = makeDb([[SEND_INVOICE], undesignated])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(/billing contact/i)
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled()
    expect(byEntry(queries, 'update')).toHaveLength(0)
  })

  it('400s when no contact has an email, and never marks it sent', async () => {
    const { handle, queries } = makeDb([[SEND_INVOICE], [{ id: 'c-1', email: '', name: 'Nobody', portalRole: 'admin', isPrimary: true }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
    expect(res.status).toBe(400)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })

  it('502s without marking sent when every send fails', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Resend down' })
    const { handle, queries } = makeDb([[SEND_INVOICE], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/inv-1/send-email', { method: 'POST' }), params('inv-1'))
    expect(res.status).toBe(502)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })

  it('404s an unknown invoice', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await sendInvoiceEmail(req('/api/admin/invoices/nope/send-email', { method: 'POST' }), params('nope'))
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/invoices/stripe-create  (finalising is the other send door)
// ---------------------------------------------------------------------------
describe('POST /api/admin/invoices/stripe-create', () => {
  it('bells the billing contacts only when it finalises', async () => {
    vi.mocked(stripeSecretKey).mockReturnValue('sk_test_1')
    // Every Stripe POST in this route wants an { id }; only finalize reads the
    // hosted url, and an extra field on the others is harmless.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'in_new', hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/new' }),
    }))

    const invoice = { id: 'inv-1', orgId: 'org-a', currency: 'NZD', dueDate: '2026-09-30', sentAt: null, stripeInvoiceId: null }
    const org = [{ id: 'org-a', name: 'Acme', stripeCustomerId: 'cus_1' }]
    const items = [{ id: 'li-1', description: 'Retainer', quantity: 1, unitPriceUsd: 1500 }]
    // invoice, org, line items, the update itself, then the contacts.
    const { handle, queries } = makeDb([[invoice], org, items, [], CONTACTS])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stripeCreate(jsonReq('/api/admin/invoices/stripe-create', { invoiceId: 'inv-1' }))
    expect(res.status).toBe(200)

    // The pay link is persisted, not just returned to the operator.
    const patch = argOf(byEntry(queries, 'update')[0], 'set') as { stripeHostedInvoiceUrl: string; sentAt: string }
    expect(patch.stripeHostedInvoiceUrl).toBe('https://invoice.stripe.com/i/acct_1/new')
    expect(patch.sentAt).toBeTruthy()

    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
    expect(vi.mocked(createNotifications).mock.calls[0][1]).toEqual([
      { contactId: 'c-owner' },
      { contactId: 'c-finance' },
    ])
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/invoices  (draft creation must be silent)
// ---------------------------------------------------------------------------
describe('POST /api/admin/invoices', () => {
  it('creates a draft without notifying the client', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createInvoice(jsonReq('/api/admin/invoices', {
      orgId: 'org-a',
      lineItems: [{ description: 'Retainer', quantity: 1, unitAmount: 1500 }],
    }))
    expect(res.status).toBe(200)

    const inserted = argOf(byEntry(queries, 'insert')[0], 'values') as { status: string }
    expect(inserted.status).toBe('draft')
    // The portal filters drafts out of both the list and the detail route, so
    // a bell row here pointed at something the client could not open.
    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
    expect(vi.mocked(createNotifications)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /api/onboarding/complete  ("invoice me")
// ---------------------------------------------------------------------------
describe('POST /api/onboarding/complete with billingMode invoice', () => {
  const org = [{ id: 'org-a', name: 'Acme', paymentTerms: null }]

  it('records net terms, raises a draft, tells the studio and completes', async () => {
    const { handle, queries } = makeDb([org])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain', addon: true, currency: 'nzd',
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const terms = argOf(byEntry(queries, 'update')[0], 'set') as { paymentTerms: string }
    expect(terms.paymentTerms).toBe('net_14')

    const inserts = byEntry(queries, 'insert')
    const invoice = argOf(inserts[0], 'values') as {
      status: string; orgId: string; currency: string; totalUsd: number; dueDate: string
    }
    expect(invoice.status).toBe('draft')
    expect(invoice.orgId).toBe('org-a')
    expect(invoice.currency).toBe('NZD')
    // Priced server-side from STRIPE_PLANS (maintain base + track), never from
    // the request body.
    expect(invoice.totalUsd).toBeGreaterThan(0)
    expect(invoice.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const lines = argOf(inserts[1], 'values') as Array<{ description: string }>
    expect(lines).toHaveLength(2)

    expect(vi.mocked(notifyAllAdmins)).toHaveBeenCalledTimes(1)
  })

  it('does not raise a second draft when net terms are already on record', async () => {
    const { handle, queries } = makeDb([[{ id: 'org-a', name: 'Acme', paymentTerms: 'net_14' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain',
    }))
    expect(res.status).toBe(200)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(vi.mocked(notifyAllAdmins)).not.toHaveBeenCalled()
  })

  it('refuses a member seat and leaves them unentitled', async () => {
    vi.mocked(isOrgAdmin).mockResolvedValue(false)
    // invite lookup, payment-terms lookup, subscription lookup: all empty.
    const { handle, queries } = makeDb([[], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain',
    }))
    expect(res.status).toBe(402)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
  })

  it('refuses to record terms for an org that already pays by card', async () => {
    // Terms plus a live subscription is a double-billing trap: the client is
    // charged monthly AND a draft for the same plan waits to be sent.
    const activeSub = [{ status: 'active', stripeSubscriptionId: 'sub_1' }]
    // org lookup, subscription guard, then the ordinary entitlement checks.
    const { handle, queries } = makeDb([org, activeSub, [], [], activeSub])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain',
    }))
    // Still entitled, by the subscription they are actually paying on.
    expect(res.status).toBe(200)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(vi.mocked(notifyAllAdmins)).not.toHaveBeenCalled()
  })

  it('refuses a caller who has already finished onboarding', async () => {
    // Otherwise any client workspace admin could POST this from the browser
    // later and grant their org a standing portal entitlement plus a draft.
    clerkUser({ onboardingComplete: true })
    const { handle, queries } = makeDb([org, [], [], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain',
    }))
    expect(res.status).toBe(402)
    expect(byEntry(queries, 'update')).toHaveLength(0)
    expect(byEntry(queries, 'insert')).toHaveLength(0)
    expect(vi.mocked(notifyAllAdmins)).not.toHaveBeenCalled()
  })

  it('records the quoted currency in the draft when an invoice cannot carry it', async () => {
    // CAD is offered by the onboarding picker but no invoice row carries it,
    // so the draft is priced in the fallback and says so.
    const { handle, queries } = makeDb([org])
    vi.mocked(db).mockResolvedValue(handle as never)

    await completeOnboarding(jsonReq('/api/onboarding/complete', {
      billingMode: 'invoice', plan: 'maintain', currency: 'cad',
    }))

    const invoice = argOf(byEntry(queries, 'insert')[0], 'values') as { currency: string; notes: string }
    expect(invoice.currency).toBe('USD')
    expect(invoice.notes).toContain('CAD')
    expect(invoice.notes).toMatch(/re-quote/i)
  })

  it('entitles a client already on net terms with no body at all', async () => {
    // invite lookup empty, then the org carries net terms.
    const { handle } = makeDb([[], [{ paymentTerms: 'net_30' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await completeOnboarding(req('/api/onboarding/complete', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
