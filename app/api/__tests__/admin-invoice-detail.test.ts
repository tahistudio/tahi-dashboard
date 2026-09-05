/**
 * Route-level tests for the admin invoice detail, the two money-path bugs it
 * carried, and the guards that must survive the fix:
 *
 *   - GET   /api/admin/invoices/[id]   the projection has to carry `source`
 *                                     and the Stripe hosted pay page. Without
 *                                     them the detail page read "Manual" for
 *                                     every invoice (while the LIST badged the
 *                                     real channel) and the studio could not
 *                                     see the link it had already stored.
 *
 *   - PATCH /api/admin/invoices/[id]   a hand mark-paid has to keep its date.
 *                                     /financial-reports computes YTD revenue
 *                                     and 90-day collected from paid_at, not
 *                                     from status, so an invoice flipped to
 *                                     paid with a NULL paid_at (bank transfer,
 *                                     the exact case this button exists for)
 *                                     silently left the revenue figure.
 *
 * Same fake D1 as admin-scoping-routes / billing-invoice-flow: only the chain
 * is thenable and every call is recorded, so a claim is checked against the
 * SQL that was actually built rather than against the response body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'

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

vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/xero', () => ({ callXeroAPI: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: vi.fn(() => undefined) }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { callXeroAPI } from '@/lib/xero'
import { stripeSecretKey } from '@/lib/stripe-key'
import { XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY } from '@/lib/invoice-pay-settings'
import { NextRequest, NextResponse } from 'next/server'

import { GET as getInvoice, PATCH as patchInvoice } from '@/app/api/admin/invoices/[id]/route'

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

/** First argument handed to a chain method, e.g. `.set({...})` / `.select({...})`. */
function argOf(record: QueryRecord | undefined, method: string): unknown {
  return record?.calls.find(c => c.method === method)?.args[0]
}

/** The column each key of a `.select({...})` projection actually reads. */
function projectionOf(record: QueryRecord | undefined): Record<string, string> {
  const raw = argOf(record, 'select') as Record<string, unknown> | undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (value instanceof Column) out[key] = value.name
  }
  return out
}

/** Queries whose entry method matches (e.g. every update in the request). */
function byEntry(queries: QueryRecord[], method: string): QueryRecord[] {
  return queries.filter(q => q.calls[0]?.method === method)
}

/** The one `.set({...})` payload the request wrote. */
function patchOf(queries: QueryRecord[]): Record<string, unknown> {
  return (argOf(byEntry(queries, 'update')[0], 'set') ?? {}) as Record<string, unknown>
}

type RequestOptions = ConstructorParameters<typeof NextRequest>[1]
function req(url: string, init?: RequestOptions) {
  return new NextRequest(`http://localhost:3000${url}`, init)
}
function patchReq(id: string, body: unknown) {
  return req(`/api/admin/invoices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

/**
 * The invoice as the PATCH pre-read sees it: owner, the dates it may move, and
 * the rail it belongs to (which push-back needs). Defaults to a manual invoice
 * on no rail, so a test has to opt in to push-back.
 */
function existing(over: Partial<{
  orgId: string
  status: string
  paidAt: string | null
  sentAt: string | null
  source: string | null
  xeroInvoiceId: string | null
  stripeInvoiceId: string | null
  totalUsd: number | null
}> = {}) {
  return [{
    orgId: 'org-a',
    status: 'sent',
    paidAt: null,
    sentAt: '2026-09-01T00:00:00.000Z',
    source: 'manual',
    xeroInvoiceId: null,
    stripeInvoiceId: null,
    totalUsd: 1150,
    ...over,
  }]
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// GET /api/admin/invoices/[id]
// ---------------------------------------------------------------------------
const INVOICE_ROW = {
  id: 'inv-1',
  orgId: 'org-a',
  orgName: 'Acme',
  source: 'stripe',
  stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_1',
  status: 'sent',
  totalUsd: 1500,
}

describe('GET /api/admin/invoices/[id]', () => {
  it('projects the invoice source, so the detail page stops reading Manual for everything', async () => {
    const { handle, queries } = makeDb([[{ orgId: 'org-a' }], [INVOICE_ROW], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await getInvoice(req('/api/admin/invoices/inv-1'), params('inv-1'))
    expect(res.status).toBe(200)

    // queries[0] is the access-scoping owner lookup; queries[1] is the detail.
    const projection = projectionOf(queries[1])
    expect(projection.source).toBe('source')

    const body = await res.json() as { invoice: { source: string } }
    expect(body.invoice.source).toBe('stripe')
  })

  it('projects the Stripe hosted pay page, so the studio can open what the client sees', async () => {
    const { handle, queries } = makeDb([[{ orgId: 'org-a' }], [INVOICE_ROW], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await getInvoice(req('/api/admin/invoices/inv-1'), params('inv-1'))
    expect(res.status).toBe(200)

    expect(projectionOf(queries[1]).stripeHostedInvoiceUrl).toBe('stripe_hosted_invoice_url')

    const body = await res.json() as { invoice: { stripeHostedInvoiceUrl: string } }
    expect(body.invoice.stripeHostedInvoiceUrl).toBe(INVOICE_ROW.stripeHostedInvoiceUrl)
  })

  it('still carries the dates and integration ids the page renders', async () => {
    const { handle, queries } = makeDb([[{ orgId: 'org-a' }], [INVOICE_ROW], []])
    vi.mocked(db).mockResolvedValue(handle as never)
    await getInvoice(req('/api/admin/invoices/inv-1'), params('inv-1'))

    const projection = projectionOf(queries[1])
    expect(projection.paidAt).toBe('paid_at')
    expect(projection.sentAt).toBe('sent_at')
    expect(projection.xeroInvoiceId).toBe('xero_invoice_id')
    expect(projection.stripeInvoiceId).toBe('stripe_invoice_id')
  })

  it('403s a non-Tahi caller before touching the database', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org-a' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await getInvoice(req('/api/admin/invoices/inv-1'), params('inv-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/invoices/[id]
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/invoices/[id] paid date', () => {
  it('stamps paidAt when the studio flips an invoice to paid without one', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(200)

    const patch = patchOf(queries)
    expect(patch.status).toBe('paid')
    expect(patch.paidAt).toMatch(ISO)
  })

  it('keeps an explicit paidAt, so a backdated bank transfer lands in the right month', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const paidAt = '2026-07-15T09:30:00.000Z'
    const res = await patchInvoice(patchReq('inv-1', { status: 'paid', paidAt }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(patchOf(queries).paidAt).toBe(paidAt)
  })

  it('leaves an already-paid invoice its original date on a repeat patch', async () => {
    const { handle, queries } = makeDb([existing({ status: 'paid', paidAt: '2026-06-01T00:00:00.000Z' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(patchOf(queries).paidAt).toBeUndefined()
  })

  it('nulls paidAt when the invoice moves back off paid', async () => {
    const { handle, queries } = makeDb([existing({ status: 'paid', paidAt: '2026-06-01T00:00:00.000Z' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'sent' }), params('inv-1'))
    expect(res.status).toBe(200)

    const patch = patchOf(queries)
    expect(patch.status).toBe('sent')
    expect(patch.paidAt).toBeNull()
  })

  it('keeps the paid date on a write-off, because the money really did land', async () => {
    const { handle, queries } = makeDb([existing({ status: 'paid', paidAt: '2026-06-01T00:00:00.000Z' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'written_off' }), params('inv-1'))
    expect(res.status).toBe(200)

    const patch = patchOf(queries)
    expect(patch.status).toBe('written_off')
    // Nulling it here would drop real collected money out of YTD revenue,
    // 90-day collected and the tax-year totals.
    expect(patch).not.toHaveProperty('paidAt')
  })

  it('does not touch paidAt on a status change that never involved paid', async () => {
    const { handle, queries } = makeDb([existing({ status: 'draft' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    await patchInvoice(patchReq('inv-1', { status: 'overdue' }), params('inv-1'))
    expect(patchOf(queries)).not.toHaveProperty('paidAt')
  })

  it('stamps sentAt on a first flip to sent and leaves an existing one alone', async () => {
    const first = makeDb([existing({ status: 'draft', sentAt: null })])
    vi.mocked(db).mockResolvedValue(first.handle as never)
    await patchInvoice(patchReq('inv-1', { status: 'sent' }), params('inv-1'))
    expect(patchOf(first.queries).sentAt).toMatch(ISO)

    const second = makeDb([existing({ status: 'overdue', sentAt: '2026-08-01T00:00:00.000Z' })])
    vi.mocked(db).mockResolvedValue(second.handle as never)
    await patchInvoice(patchReq('inv-1', { status: 'sent' }), params('inv-1'))
    expect(patchOf(second.queries)).not.toHaveProperty('sentAt')
  })

  it('accepts an explicit null to clear a date', async () => {
    const { handle, queries } = makeDb([existing({ status: 'paid', paidAt: '2026-06-01T00:00:00.000Z' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { paidAt: null }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(patchOf(queries).paidAt).toBeNull()
  })

  it('refuses paid with an explicit null date, the state the whole route exists to prevent', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid', paidAt: null }), params('inv-1'))
    expect(res.status).toBe(400)
    // Refused before anything was written: no paid row with a NULL paid_at.
    expect(queries).toHaveLength(0)
  })

  it('normalises a date-only stamp to full ISO, so it stays inside its own year', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid', paidAt: '2026-01-01' }), params('inv-1'))
    expect(res.status).toBe(200)

    const written = patchOf(queries).paidAt as string
    expect(written).toBe('2026-01-01T00:00:00.000Z')
    // On the Workers runtime (UTC) the reports build their year boundary as
    // new Date(y, 0, 1).toISOString(), which is this string, and they compare
    // paid_at against it as a raw string. The bare "2026-01-01" the caller
    // sent sorts BELOW it and would leave YTD revenue; the stamp we write
    // does not. Spelled out rather than computed so the assertion does not
    // depend on the test machine's timezone.
    const yearStartUtc = '2026-01-01T00:00:00.000Z'
    expect('2026-01-01' >= yearStartUtc).toBe(false)
    expect(written >= yearStartUtc).toBe(true)
  })

  it('normalises a space-separated stamp too', async () => {
    const { handle, queries } = makeDb([existing({ status: 'draft', sentAt: null })])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { sentAt: '2026-01-01 09:30:00' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(patchOf(queries).sentAt).toMatch(ISO)
  })

  it('accepts paidAt on its own, with no status alongside it', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { paidAt: '2026-07-15T09:30:00.000Z' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(patchOf(queries).paidAt).toBe('2026-07-15T09:30:00.000Z')
  })

  it('400s a malformed date instead of writing a stamp the reports cannot read', async () => {
    const bodies = [
      { paidAt: 'yesterday' },
      { sentAt: 'not-a-date' },
      { status: 'paid', paidAt: 42 },
      // Date.parse alone would read this as the year 2042.
      { paidAt: '42' },
      { paidAt: '15/07/2026' },
    ]
    for (const body of bodies) {
      const { handle, queries } = makeDb([existing()])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await patchInvoice(patchReq('inv-1', body), params('inv-1'))
      expect(res.status).toBe(400)
      // Refused before anything was written.
      expect(queries).toHaveLength(0)
    }
  })

  it('still refuses an empty body and a non-Tahi caller', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await patchInvoice(patchReq('inv-1', {}), params('inv-1'))).status).toBe(400)
    expect(queries).toHaveLength(0)

    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org-a' } as never)
    expect((await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))).status).toBe(403)
  })

  it('still enforces the invoices feature gate and org scoping', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const gated = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(gated.handle as never)
    expect((await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))).status).toBe(403)
    expect(gated.queries).toHaveLength(0)

    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-b'])
    const scoped = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(scoped.handle as never)
    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(403)
    // The owner lookup ran; the write did not.
    expect(byEntry(scoped.queries, 'update')).toHaveLength(0)
    expect(whereOf(scoped.queries[0]).params).toContain('inv-1')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/invoices/[id] push-back to the rail
// ---------------------------------------------------------------------------
//
// A hand mark-paid is usually a bank transfer that landed, and the rail has no
// way of knowing. Without push-back a Xero invoice stays open in Xero forever
// and a Stripe invoice keeps chasing a client who has already paid.
//
// The invariants, in order of how much they would cost to get wrong:
//   - the local write happens first and stands whatever the rail does;
//   - only a real transition INTO paid pushes, so a repeat PATCH cannot post a
//     second Xero payment against the same invoice;
//   - no account code means SKIP, never a guess, because a payment posted to
//     the wrong Xero account has to be found and reversed by hand;
//   - `{ pushback: false }` is the door for a caller reconciling money the
//     rail already knows about.
describe('PATCH /api/admin/invoices/[id] push-back', () => {
  /** The settings row holding the Xero bank account code. */
  const ACCOUNT_CODE_ROW = [{ value: '090' }]

  /**
   * The fake D1 hands its queued results out in call order, and the UPDATE
   * takes one as well as each SELECT, so the settings read is the THIRD
   * result: pre-read, write, account code.
   */
  const AFTER_THE_WRITE: unknown[] = []

  beforeEach(() => {
    // clearAllMocks does not reset implementations, so a test that made Xero
    // or Stripe fail would otherwise leak into the next one.
    vi.mocked(callXeroAPI).mockResolvedValue({} as never)
    vi.mocked(stripeSecretKey).mockReturnValue(undefined)
  })

  function stripeFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 402),
      json: async () => response.body ?? {},
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function bodyOf(res: Response) {
    return await res.json() as { success?: boolean; pushback?: { rail: string; status: string; reason?: string } }
  }

  it('records the payment in Xero when the studio marks a Xero invoice paid', async () => {
    const { handle, queries } = makeDb([
      existing({ source: 'xero', xeroInvoiceId: 'xero-1', totalUsd: 1150 }),
      AFTER_THE_WRITE,
      ACCOUNT_CODE_ROW,
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(
      patchReq('inv-1', { status: 'paid', paidAt: '2026-09-04T09:30:00.000Z' }),
      params('inv-1'),
    )
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ pushback: { rail: 'xero', status: 'done' } })

    expect(callXeroAPI).toHaveBeenCalledWith('PUT', '/Payments', {
      Invoice: { InvoiceID: 'xero-1' },
      Account: { Code: '090' },
      // Xero wants a plain date, taken from the paid date the studio gave us
      // rather than from "now", so a backdated transfer books on its own day.
      Date: '2026-09-04',
      Amount: 1150,
    })
    // The local write still happened, and happened first.
    expect(patchOf(queries).status).toBe('paid')
  })

  it('skips the Xero push with a reason when no account code is set', async () => {
    // Guessing an account is worse than not posting: it lands in the ledger,
    // reconciles against nothing, and has to be unpicked by hand.
    const { handle, queries } = makeDb([
      existing({ source: 'xero', xeroInvoiceId: 'xero-1' }),
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({
      pushback: { rail: 'xero', status: 'skipped', reason: 'No Xero payment account code in settings' },
    })

    expect(callXeroAPI).not.toHaveBeenCalled()
    // The invoice is still paid locally. The skip costs the rail, not Liam's
    // revenue figure.
    expect(patchOf(queries).status).toBe('paid')
    expect(patchOf(queries).paidAt).toMatch(ISO)
  })

  it('looks the account code up under its own settings key', async () => {
    const { handle, queries } = makeDb([
      existing({ source: 'xero', xeroInvoiceId: 'xero-1' }),
      AFTER_THE_WRITE,
      ACCOUNT_CODE_ROW,
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))

    const settingsRead = byEntry(queries, 'select').at(-1)
    expect(whereOf(settingsRead).params).toContain(XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY)
  })

  it('marks the Stripe invoice paid out of band, without charging anyone', async () => {
    vi.mocked(stripeSecretKey).mockReturnValue('sk_test_123')
    const fetchMock = stripeFetch({ ok: true })
    const { handle, queries } = makeDb([
      existing({ source: 'stripe', stripeInvoiceId: 'in_123' }),
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ pushback: { rail: 'stripe', status: 'done' } })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.stripe.com/v1/invoices/in_123/pay')
    expect(init.method).toBe('POST')
    // Out of band, not a charge: the money already arrived somewhere else.
    // Voiding instead would lose the revenue from Stripe's own reporting.
    expect(String(init.body)).toContain('paid_out_of_band=true')
    expect(patchOf(queries).status).toBe('paid')
  })

  it('reports a rail failure as failed and still keeps the local payment', async () => {
    vi.mocked(callXeroAPI).mockResolvedValue(null as never)
    const { handle, queries } = makeDb([
      existing({ source: 'xero', xeroInvoiceId: 'xero-1' }),
      AFTER_THE_WRITE,
      ACCOUNT_CODE_ROW,
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))

    // 200, not 500: the dashboard is the source of truth for the paid date and
    // a Xero outage must not stop Liam recording revenue.
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ success: true, pushback: { rail: 'xero', status: 'failed' } })
    expect(patchOf(queries).status).toBe('paid')
  })

  it('surfaces the Stripe error message rather than a bare status', async () => {
    vi.mocked(stripeSecretKey).mockReturnValue('sk_test_123')
    stripeFetch({ ok: false, status: 400, body: { error: { message: 'Invoice is already paid' } } })
    const { handle } = makeDb([existing({ source: 'stripe', stripeInvoiceId: 'in_123' })])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({
      pushback: { rail: 'stripe', status: 'failed', reason: 'Invoice is already paid' },
    })
  })

  it('pushes nothing on any status other than paid', async () => {
    for (const status of ['sent', 'overdue', 'draft', 'written_off', 'viewed']) {
      vi.clearAllMocks()
      vi.mocked(callXeroAPI).mockResolvedValue({} as never)
      const fetchMock = stripeFetch({ ok: true })
      vi.mocked(stripeSecretKey).mockReturnValue('sk_test_123')

      const { handle } = makeDb([
        existing({ status: 'sent', source: 'xero', xeroInvoiceId: 'xero-1', stripeInvoiceId: 'in_123' }),
        ACCOUNT_CODE_ROW,
      ])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await patchInvoice(patchReq('inv-1', { status }), params('inv-1'))
      expect(res.status).toBe(200)
      expect(await bodyOf(res)).not.toHaveProperty('pushback')

      // written_off does call Xero, to void. It must not call /Payments.
      for (const call of vi.mocked(callXeroAPI).mock.calls) {
        expect(call[1]).not.toBe('/Payments')
      }
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('pushes nothing when the invoice was already paid, so it cannot double-post', async () => {
    const { handle } = makeDb([
      existing({ status: 'paid', paidAt: '2026-08-01T00:00:00.000Z', source: 'xero', xeroInvoiceId: 'xero-1' }),
      ACCOUNT_CODE_ROW,
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).not.toHaveProperty('pushback')
    expect(callXeroAPI).not.toHaveBeenCalled()
  })

  it('pushes nothing when the caller says pushback false', async () => {
    vi.mocked(stripeSecretKey).mockReturnValue('sk_test_123')
    const fetchMock = stripeFetch({ ok: true })
    const { handle, queries } = makeDb([
      existing({ source: 'stripe', stripeInvoiceId: 'in_123' }),
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(
      patchReq('inv-1', { status: 'paid', pushback: false }),
      params('inv-1'),
    )
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).not.toHaveProperty('pushback')
    expect(fetchMock).not.toHaveBeenCalled()
    // The local write is unaffected: this flag only silences the rail.
    expect(patchOf(queries).status).toBe('paid')
  })

  it('pushes nothing for an invoice on no rail at all', async () => {
    vi.mocked(stripeSecretKey).mockReturnValue('sk_test_123')
    const fetchMock = stripeFetch({ ok: true })
    // Source says xero but the id was never captured, and a manual invoice.
    for (const over of [{ source: 'xero', xeroInvoiceId: null }, { source: 'manual' }]) {
      const { handle } = makeDb([existing(over)])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await patchInvoice(patchReq('inv-1', { status: 'paid' }), params('inv-1'))
      expect(await bodyOf(res)).not.toHaveProperty('pushback')
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(callXeroAPI).not.toHaveBeenCalled()
  })

  it('does not treat `pushback` as an editable field on its own', async () => {
    const { handle, queries } = makeDb([existing()])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await patchInvoice(patchReq('inv-1', { pushback: false }), params('inv-1'))
    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })
})
