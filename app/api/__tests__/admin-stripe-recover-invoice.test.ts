import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), isAdmin: vi.fn(), permissions: vi.fn(), db: vi.fn(), key: vi.fn(),
  importer: vi.fn(), audit: vi.fn(), fetch: vi.fn(),
}))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: mocks.auth, isTahiAdmin: mocks.isAdmin }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: mocks.permissions }))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: mocks.key }))
vi.mock('@/lib/stripe-import', () => ({ importStripeInvoice: mocks.importer }))
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }))

import { POST } from '@/app/api/admin/integrations/stripe/recover-invoice/route'

const endpoint = 'http://localhost:3000/api/admin/integrations/stripe/recover-invoice'
const requestBody = { orgId: 'org-a', stripeInvoiceId: 'in_QArecovery' }
const imported = { localInvoiceId: 'invoice-local', created: true, orgId: 'org-a' }

function stripeInvoice() {
  return {
    id: requestBody.stripeInvoiceId, number: 'STRIPE-QA-001', customer: 'cus_qa',
    customer_name: 'QA client', customer_email: 'billing@example.test',
    status: 'paid', livemode: true, currency: 'nzd', subtotal: 15000, total: 17250,
    amount_paid: 17250, created: 1_760_000_000,
    status_transitions: { paid_at: 1_760_000_500 },
    hosted_invoice_url: 'https://invoice.stripe.com/i/qa',
    lines: { has_more: false, data: [{ id: 'il_1', description: 'Design', quantity: 1, amount: 15000 }] },
  }
}

type LocalInvoice = {
  id: string; orgId: string; stripeInvoiceId: string | null; totalUsd: number
  currency: string; number: string; status: string
}
type State = {
  org: { id: string; name: string; status: string; stripeCustomerId: string | null } | null
  contacts: { name: string; email: string | null }[]
  linked: { id: string }[]
  invoices: LocalInvoice[]
  mapped: { id: string }[]
}

// Every read resolves from state at the time of the request, letting a test
// change Stripe or the local ledger between preview and apply.
function databaseFixture(state: State) {
  function chain(result: () => unknown, calls: Map<string, unknown[]>): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        if (typeof prop !== 'string') return undefined
        return (...args: unknown[]) => { calls.set(prop, args); return proxy }
      },
    })
    return proxy
  }
  return {
    select: vi.fn((fields?: unknown) => {
      const calls = new Map<string, unknown[]>()
      return chain(() => {
        const table = calls.get('from')?.[0]
        if (table === schema.organisations) return fields ? state.linked : state.org ? [state.org] : []
        if (table === schema.contacts) return state.contacts
        if (table === schema.invoices) return state.invoices
        throw new Error('Unexpected recovery query')
      }, calls)
    }),
    update: vi.fn(() => chain(() => state.mapped, new Map())),
    insert: vi.fn(() => { throw new Error('Recovery route must delegate invoice creation to the importer') }),
    delete: vi.fn(() => { throw new Error('Recovery must not delete existing data') }),
  }
}

function request(body: Record<string, unknown> = requestBody) {
  return new NextRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

let state: State
let database: ReturnType<typeof databaseFixture>
let remote: ReturnType<typeof stripeInvoice>

function expectNoWrites() {
  expect(database.update).not.toHaveBeenCalled()
  expect(database.insert).not.toHaveBeenCalled()
  expect(database.delete).not.toHaveBeenCalled()
  expect(mocks.importer).not.toHaveBeenCalled()
  expect(mocks.audit).not.toHaveBeenCalled()
}

async function previewKey() {
  const response = await POST(request())
  expect(response.status).toBe(200)
  const preview = await response.json() as { previewKey: string }
  expect(preview.previewKey).toMatch(/^[0-9a-f]{64}$/)
  return preview.previewKey
}

async function apply(key: unknown) {
  return POST(request({ ...requestBody, dryRun: false, previewKey: key }))
}

beforeEach(() => {
  vi.resetAllMocks()
  state = {
    org: { id: 'org-a', name: 'QA client', status: 'active', stripeCustomerId: null },
    contacts: [{ name: 'QA billing', email: 'billing@example.test' }],
    linked: [], invoices: [], mapped: [{ id: 'org-a' }],
  }
  remote = stripeInvoice()
  database = databaseFixture(state)
  mocks.auth.mockResolvedValue({ userId: 'user_liam', orgId: 'org_tahi', sessionId: 'sess_qa' })
  mocks.isAdmin.mockImplementation((orgId: string | null) => orgId === 'org_tahi')
  mocks.permissions.mockResolvedValue({ isSuperAdmin: true })
  mocks.db.mockResolvedValue(database)
  mocks.key.mockReturnValue('sk_live_FAKE_QA_ONLY')
  mocks.importer.mockResolvedValue(imported)
  mocks.audit.mockResolvedValue(undefined)
  mocks.fetch.mockImplementation(async () => json(remote))
  vi.stubGlobal('fetch', mocks.fetch)
})
afterEach(() => vi.unstubAllGlobals())

describe('Stripe invoice recovery authorization and input guards', () => {
  it.each([
    { userId: null, orgId: null, sessionId: null },
    { userId: 'client', orgId: 'org_client', sessionId: 'sess_client' },
  ])('rejects callers outside the studio before database or Stripe reads: %j', async auth => {
    mocks.auth.mockResolvedValue(auth)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each([true, false])('requires super-admin permission even for dryRun=%s', async dryRun => {
    mocks.permissions.mockResolvedValue({ isSuperAdmin: false })
    expect((await POST(request({ ...requestBody, dryRun }))).status).toBe(403)
    expect(database.select).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each([
    {}, { orgId: 'org-a' }, { stripeInvoiceId: 'in_QA' },
    { ...requestBody, orgId: 5 }, { ...requestBody, stripeInvoiceId: 5 },
    { ...requestBody, stripeInvoiceId: 'ch_QA' },
    { ...requestBody, stripeInvoiceId: 'in_QA/lines' },
    { ...requestBody, stripeInvoiceId: 'in_QA?expand=customer' },
  ])('rejects missing, mistyped or invalid identifiers: %j', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('rejects malformed JSON', async () => {
    expect((await POST(new NextRequest(endpoint, { method: 'POST', body: '{' }))).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('returns 503 when Stripe is unconfigured', async () => {
    mocks.key.mockReturnValue(null)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each(['missing', 'archived'])('refuses a %s client', async status => {
    if (status === 'missing') state.org = null
    else if (state.org) state.org.status = 'archived'
    expect((await POST(request())).status).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each([
    { id: 'in_wrong' }, { customer: null }, { customer: '' },
    { customer: { id: 'cus_qa' } }, { status: 'open' }, { status: 'draft' },
    { status: 'void' }, { livemode: false }, { livemode: undefined },
  ])('refuses anything other than the requested paid live invoice with a customer id: %j', async patch => {
    mocks.fetch.mockResolvedValue(json({ ...remote, ...patch }))
    expect((await POST(request())).status).toBe(400)
    expectNoWrites()
  })

  it.each(['sk_test_FAKE', 'rk_test_FAKE', 'sk_live_FAKE'])('reports Stripe retrieval failures and mode without exposing the key: %s', async key => {
    mocks.key.mockReturnValue(key)
    mocks.fetch.mockResolvedValue(json({ error: { message: 'not found' } }, 404))
    const response = await POST(request())
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(body).toContain(key.includes('test') ? 'test mode' : 'live mode')
    expect(body).not.toContain(key)
    expectNoWrites()
  })

  it.each([new DOMException('timeout', 'TimeoutError'), new Error('network failure')])('handles failed Stripe reads without writes: %s', async error => {
    mocks.fetch.mockRejectedValue(error)
    expect((await POST(request())).status).toBe(502)
    expectNoWrites()
  })
})

describe('Stripe invoice recovery preview and conflicts', () => {
  it.each([undefined, true, null, 0, 'false'])('keeps dryRun=%j read-only and returns a stable preview fingerprint', async dryRun => {
    const response = await POST(request({ ...requestBody, dryRun }))
    expect(response.status).toBe(200)
    const body = await response.json() as { previewKey: string }
    expect(body).toMatchObject({
      dryRun: true, canApply: true, conflicts: [], existingInvoiceId: null, possibleTwins: [],
      client: { id: 'org-a' }, invoice: { id: remote.id, total: 172.5, currency: 'NZD', status: 'paid' },
    })
    expect(body.previewKey).toBe(await previewKey())
    expectNoWrites()
  })

  it('matches contact email after trimming and case normalization', async () => {
    state.contacts[0].email = '  BILLING@Example.Test '
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ canApply: true, conflicts: [] })
    expectNoWrites()
  })

  const conflicts: Array<{ name: string; change: () => void; message: string }> = [
    { name: 'contact email mismatch', change: () => { state.contacts[0].email = 'other@example.test' }, message: 'does not match an existing client contact' },
    { name: 'no local contacts', change: () => { state.contacts = [] }, message: 'does not match an existing client contact' },
    { name: 'missing Stripe email', change: () => { remote.customer_email = '' }, message: 'does not match an existing client contact' },
    { name: 'a different existing Stripe mapping', change: () => { if (state.org) state.org.stripeCustomerId = 'cus_other' }, message: 'linked to a different Stripe customer' },
    { name: 'a Stripe customer linked to another client', change: () => { state.linked = [{ id: 'org-other' }] }, message: 'linked to another client' },
    { name: 'the same Stripe invoice attached to another client', change: () => { state.invoices = [{ id: 'old', orgId: 'org-other', stripeInvoiceId: remote.id, totalUsd: 172.5, currency: 'NZD', number: 'OLD', status: 'paid' }] }, message: 'already attached to another client' },
    { name: 'a same-amount, same-currency invoice twin', change: () => { state.invoices = [{ id: 'twin', orgId: 'org-a', stripeInvoiceId: 'ch_other', totalUsd: 172.5, currency: 'nzd', number: 'TWIN', status: 'paid' }] }, message: 'duplicate review' },
  ]
  it.each(conflicts)('exposes and blocks $name on apply', async ({ change, message }) => {
    change()
    const response = await POST(request())
    const body = await response.json() as { previewKey: string; conflicts: string[]; canApply: boolean }
    expect(response.status).toBe(200)
    expect(body.canApply).toBe(false)
    expect(body.conflicts.join(' ')).toContain(message)
    expect((await apply(body.previewKey)).status).toBe(409)
    expectNoWrites()
  })

  it('does not treat a different currency or a different amount as a twin', async () => {
    state.invoices = [
      { id: 'usd', orgId: 'org-a', stripeInvoiceId: null, totalUsd: 172.5, currency: 'USD', number: 'USD', status: 'paid' },
      { id: 'amount', orgId: 'org-a', stripeInvoiceId: null, totalUsd: 173, currency: 'NZD', number: 'AMOUNT', status: 'paid' },
    ]
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ canApply: true, possibleTwins: [] })
    expectNoWrites()
  })
})

describe('Stripe invoice recovery apply', () => {
  it.each([undefined, null, '', 'stale', 123])('refuses a missing or mismatched preview key: %j', async key => {
    expect((await apply(key)).status).toBe(409)
    expectNoWrites()
  })

  const changes: Array<{ name: string; change: () => void }> = [
    { name: 'invoice total', change: () => { remote.total++ } },
    { name: 'invoice line description', change: () => { remote.lines.data[0].description = 'Changed after preview' } },
    { name: 'invoice line quantity', change: () => { remote.lines.data[0].quantity = 2 } },
    { name: 'hosted invoice URL', change: () => { remote.hosted_invoice_url = 'https://invoice.stripe.com/i/changed' } },
    { name: 'paid timestamp', change: () => { remote.status_transitions.paid_at++ } },
    { name: 'client name', change: () => { if (state.org) state.org.name = 'Renamed client' } },
    { name: 'contact list', change: () => { state.contacts.push({ name: 'Another contact', email: 'extra@example.test' }) } },
    { name: 'client mapping', change: () => { if (state.org) state.org.stripeCustomerId = 'cus_qa'; state.linked = [{ id: 'org-a' }] } },
    { name: 'existing local invoice', change: () => { state.invoices = [{ id: 'existing', orgId: 'org-a', stripeInvoiceId: remote.id, totalUsd: 172.5, currency: 'NZD', number: 'OLD', status: 'paid' }] } },
  ]
  it.each(changes)('refuses a stale preview after $name changes', async ({ change }) => {
    const key = await previewKey()
    change()
    const response = await apply(key)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Preview') })
    expectNoWrites()
  })

  it('rechecks new identity and twin conflicts between preview and apply', async () => {
    const key = await previewKey()
    state.linked = [{ id: 'org-other' }]
    const response = await apply(key)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ canApply: false, conflicts: [expect.stringContaining('another client')] })
    expectNoWrites()
  })

  it('imports only after a matching preview and writes an audit carrying Liam and all recovery ids', async () => {
    const key = await previewKey()
    expectNoWrites()
    const response = await apply(key)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ dryRun: false, result: imported })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(url).toBe(`https://api.stripe.com/v1/invoices/${remote.id}`)
      expect(options).toMatchObject({ headers: { Authorization: 'Bearer sk_live_FAKE_QA_ONLY' }, signal: expect.any(AbortSignal) })
      expect(options.method ?? 'GET').toBe('GET')
    }
    expect(database.update).toHaveBeenCalledTimes(1)
    expect(mocks.importer).toHaveBeenCalledExactlyOnceWith(database, remote, { autoCreateOrg: false })
    expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(database, {
      action: 'stripe_invoice_recovered', userId: 'user_liam', entityType: 'invoice', entityId: 'invoice-local',
      metadata: { orgId: 'org-a', stripeInvoiceId: remote.id, stripeCustomerId: 'cus_qa', created: true },
    })
    expect(mocks.importer.mock.invocationCallOrder[0]).toBeGreaterThan(database.update.mock.invocationCallOrder[0])
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.importer.mock.invocationCallOrder[0])
    expect(database.insert).not.toHaveBeenCalled()
    expect(database.delete).not.toHaveBeenCalled()
  })

  it('permits retry of an invoice already attached to the chosen client and keeps its id', async () => {
    if (state.org) state.org.stripeCustomerId = 'cus_qa'
    state.linked = [{ id: 'org-a' }]
    state.invoices = [{ id: 'historical-id', orgId: 'org-a', stripeInvoiceId: remote.id, totalUsd: 172.5, currency: 'NZD', number: 'OLD', status: 'paid' }]
    mocks.importer.mockResolvedValue({ ...imported, localInvoiceId: 'historical-id', created: false })
    const key = await previewKey()
    const response = await apply(key)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ existingInvoiceId: 'historical-id', result: { localInvoiceId: 'historical-id', created: false } })
    expect(mocks.audit.mock.calls[0][1].metadata.created).toBe(false)
  })

  it('refuses an intervening mapping change at the conditional update', async () => {
    const key = await previewKey()
    state.mapped = []
    expect((await apply(key)).status).toBe(409)
    expect(database.update).toHaveBeenCalledTimes(1)
    expect(mocks.importer).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('returns a conflict without auditing success if the importer skips recovery', async () => {
    const key = await previewKey()
    mocks.importer.mockResolvedValue({ skipped: true, reason: 'No matching org' })
    const response = await apply(key)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'No matching org' })
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('Stripe recovery full line pagination', () => {
  it('reads every line page on preview and apply under one shared signal for each request', async () => {
    remote.lines.has_more = true
    const first = { id: 'il_first', description: 'First full line', quantity: 2, amount: 10000 }
    const second = { id: 'il_second', description: 'Last full line', quantity: 1, amount: 5000 }
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith(`/invoices/${remote.id}`)) return json(remote)
      if (url.endsWith('/lines?limit=100')) return json({ data: [first], has_more: true })
      if (url.endsWith('/lines?limit=100&starting_after=il_first')) return json({ data: [second], has_more: false })
      throw new Error(`Unexpected Stripe URL: ${url}`)
    })
    const key = await previewKey()
    expectNoWrites()
    expect((await apply(key)).status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledTimes(6)
    const calls = mocks.fetch.mock.calls as Array<[string, RequestInit]>
    expect(calls.slice(0, 3).every(([, options]) => options.signal === calls[0][1].signal)).toBe(true)
    expect(calls.slice(3).every(([, options]) => options.signal === calls[3][1].signal)).toBe(true)
    expect(mocks.importer.mock.calls[0][1].lines).toEqual({ data: [first, second], has_more: false })
  })

  it('invalidates preview when a later page changes even though the embedded first page stays the same', async () => {
    remote.lines.has_more = true
    let laterAmount = 5000
    mocks.fetch.mockImplementation(async (url: string) => url.includes('/lines?')
      ? json({ data: [{ id: 'il_later', description: 'Later line', quantity: 1, amount: laterAmount }], has_more: false })
      : json(remote))
    const key = await previewKey()
    laterAmount++
    expect((await apply(key)).status).toBe(409)
    expectNoWrites()
  })

  it.each([
    { data: [], has_more: true },
    { data: [{ description: 'No cursor id', amount: 100 }], has_more: true },
  ])('refuses incomplete pages with no next cursor: %j', async page => {
    remote.lines.has_more = true
    mocks.fetch.mockResolvedValueOnce(json(remote)).mockResolvedValueOnce(json(page))
    expect((await POST(request())).status).toBe(502)
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expectNoWrites()
  })

  it('fails closed when a line page fails after the initial invoice succeeds', async () => {
    remote.lines.has_more = true
    mocks.fetch.mockResolvedValueOnce(json(remote)).mockResolvedValueOnce(json({}, 500))
    expect((await POST(request())).status).toBe(502)
    expectNoWrites()
  })

  it('limits unending pagination to twenty pages without importing partial lines', async () => {
    remote.lines.has_more = true
    mocks.fetch.mockImplementation(async (url: string) => url.includes('/lines?')
      ? json({ data: [{ id: 'il_repeated', description: 'Repeated', amount: 100 }], has_more: true })
      : json(remote))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('too many line items') })
    expect(mocks.fetch).toHaveBeenCalledTimes(21)
    expectNoWrites()
  })
})
