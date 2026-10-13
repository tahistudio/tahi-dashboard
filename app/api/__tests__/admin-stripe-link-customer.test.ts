import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { permissionSqlite } from './helpers/permission-sqlite'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), isAdmin: vi.fn(), permissions: vi.fn(), db: vi.fn(), key: vi.fn(), audit: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: mocks.auth, isTahiAdmin: mocks.isAdmin }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: mocks.permissions }))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/stripe-key', () => ({ stripeSecretKey: mocks.key }))
vi.mock('@/lib/audit', () => ({ logAudit: mocks.audit }))

import { POST } from '@/app/api/admin/integrations/stripe/link-customer/route'

const endpoint = 'http://localhost:3000/api/admin/integrations/stripe/link-customer'
const requestBody = { orgId: 'org-a', stripeCustomerId: 'cus_QA' }
let fixture: ReturnType<typeof permissionSqlite>
let customer: { id: string; name: string; email: string; livemode: boolean; deleted?: boolean }

function request(body: Record<string, unknown> = requestBody) {
  return new NextRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function addClient(id: string, stripeCustomerId: string | null = null, status = 'active') {
  fixture.insert(schema.organisations, { id, name: `QA ${id}`, status, stripe_customer_id: stripeCustomerId, updated_at: '2026-10-13T00:00:00.000Z' })
}

async function previewKey(orgId = 'org-a') {
  const response = await POST(request({ ...requestBody, orgId }))
  expect(response.status).toBe(200)
  const preview = await response.json() as { previewKey: string }
  expect(preview.previewKey).toMatch(/^\d{13}\.[0-9a-f]{64}$/)
  return preview.previewKey
}

function apply(previewKey: unknown, orgId = 'org-a') {
  return POST(request({ ...requestBody, orgId, dryRun: false, previewKey }))
}

function mapping(id = 'org-a') {
  return fixture.rows(schema.organisations).find(row => row.id === id)?.stripe_customer_id
}

beforeEach(() => {
  vi.resetAllMocks()
  fixture = permissionSqlite([schema.organisations, schema.contacts])
  addClient('org-a')
  addClient('org-b')
  fixture.insert(schema.contacts, { id: 'contact-a', org_id: 'org-a', name: 'QA billing', email: 'billing@example.test' })
  customer = { id: 'cus_QA', name: 'QA Stripe customer', email: 'billing@example.test', livemode: true }
  mocks.auth.mockResolvedValue({ userId: 'user_liam', orgId: 'org_tahi', sessionId: 'sess_qa' })
  mocks.isAdmin.mockImplementation((orgId: string | null) => orgId === 'org_tahi')
  mocks.permissions.mockImplementation(async (_database: unknown, auth: { userId: string | null }) => ({ isSuperAdmin: auth.userId === 'user_liam' }))
  mocks.db.mockResolvedValue(fixture.database)
  mocks.key.mockReturnValue('sk_live_QA_ONLY_customer_link_signing_secret')
  mocks.audit.mockResolvedValue(undefined)
  mocks.fetch.mockImplementation(async () => Response.json(customer))
  vi.stubGlobal('fetch', mocks.fetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  fixture.close()
})

describe('Stripe customer link super-admin authorization', () => {
  it.each([
    { userId: null, orgId: 'org_tahi' },
    { userId: 'client', orgId: 'org_client' },
  ])('refuses callers before database or Stripe reads: %j', async auth => {
    mocks.auth.mockResolvedValue(auth)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['user_admin', 'user_scoped', 'api-service'])('refuses %s for both preview and apply', async userId => {
    mocks.auth.mockResolvedValue({ userId, orgId: 'org_tahi' })
    expect((await POST(request())).status).toBe(403)
    expect((await apply('missing')).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mapping()).toBeNull()
  })

  it('never authorizes using the full MCP recorded actor', async () => {
    const auth = { userId: 'api-service', orgId: 'org_tahi', mcpActor: { clerkUserId: 'user_liam', teamMemberId: 'tm_liam', profile: 'full', name: 'Liam' } }
    mocks.auth.mockResolvedValue(auth)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.permissions).toHaveBeenCalledWith(fixture.database, auth)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('Stripe customer link input and provider guards', () => {
  it.each([
    {}, { orgId: 'org-a' }, { ...requestBody, orgId: '../other' },
    { ...requestBody, orgId: 5 }, { ...requestBody, stripeCustomerId: 'in_QA' },
    { ...requestBody, stripeCustomerId: 'cus_QA/charges' }, { ...requestBody, stripeCustomerId: 'cus_QA?expand=source' },
  ])('refuses invalid identifiers: %j', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mapping()).toBeNull()
  })

  it('refuses malformed JSON', async () => {
    expect((await POST(new NextRequest(endpoint, { method: 'POST', body: '{' }))).status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reports missing Stripe configuration', async () => {
    mocks.key.mockReturnValue(null)
    expect((await POST(request())).status).toBe(503)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each(['missing', 'archived'])('refuses a %s client', async status => {
    if (status === 'archived') addClient('org-archived', null, 'archived')
    expect((await POST(request({ ...requestBody, orgId: `org-${status}` }))).status).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([{ id: 'cus_other' }, { deleted: true }, { livemode: false }, { livemode: undefined }])('refuses a deleted, mismatched or test customer: %j', async patch => {
    mocks.fetch.mockResolvedValue(Response.json({ ...customer, ...patch }))
    expect((await POST(request())).status).toBe(400)
    expect(mapping()).toBeNull()
  })

  it('handles provider HTTP and network failures without exposing the key or writing', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'missing' }, { status: 404 }))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain(mocks.key())
    mocks.fetch.mockRejectedValueOnce(new Error('network failure'))
    expect((await POST(request())).status).toBe(502)
    expect(mapping()).toBeNull()
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('Stripe customer link preview and application with real SQLite', () => {
  it.each([undefined, true, null, 0, 'false'])('defaults dryRun=%j to a read-only preview', async dryRun => {
    const response = await POST(request({ ...requestBody, dryRun }))
    expect(await response.json()).toMatchObject({
      dryRun: true, canApply: true, conflicts: [], alreadyLinked: false,
      client: { id: 'org-a', stripeCustomerId: null, contacts: [{ name: 'QA billing', email: 'billing@example.test' }] },
      customer: { id: 'cus_QA', email: 'billing@example.test', livemode: true },
    })
    expect(mapping()).toBeNull()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(fixture.queries.some(query => /^update /i.test(query))).toBe(false)
  })

  it.each([undefined, null, '', '0'.repeat(64)])('rejects apply without an issued signed preview: %j', async token => {
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('links only the chosen existing client and records the human actor', async () => {
    const token = await previewKey()
    const response = await apply(token)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ dryRun: false, applied: true })
    expect(mapping()).toBe('cus_QA')
    expect(mapping('org-b')).toBeNull()
    expect(fixture.rows(schema.organisations)).toHaveLength(2)
    expect(mocks.audit).toHaveBeenCalledWith(fixture.database, expect.objectContaining({
      action: 'stripe_customer_linked', userId: 'user_liam', entityType: 'organisation', entityId: 'org-a',
    }))
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    for (const [url, init] of mocks.fetch.mock.calls) {
      expect(url).toBe('https://api.stripe.com/v1/customers/cus_QA')
      expect(init).not.toHaveProperty('method')
      expect(init).not.toHaveProperty('body')
    }
  })

  it('refuses the same customer linked to another client, including an archived client', async () => {
    addClient('org-linked', 'cus_QA', 'archived')
    const token = await previewKey()
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
    expect(mapping('org-linked')).toBe('cus_QA')
  })

  it('never replaces a different Stripe customer already on the target client', async () => {
    addClient('org-different', 'cus_other')
    const token = await previewKey('org-different')
    expect((await apply(token, 'org-different')).status).toBe(409)
    expect(mapping('org-different')).toBe('cus_other')
  })

  it('refreshes conflicts and customer identity after preview', async () => {
    const token = await previewKey()
    customer.email = 'changed@example.test'
    expect((await apply(token)).status).toBe(409)
    customer.email = 'billing@example.test'
    addClient('org-new-link', 'cus_QA')
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
  })

  it('refuses using a preview for a different client or super admin', async () => {
    const token = await previewKey()
    expect((await apply(token, 'org-b')).status).toBe(409)
    mocks.auth.mockResolvedValue({ userId: 'user_staci', orgId: 'org_tahi' })
    mocks.permissions.mockResolvedValue({ isSuperAdmin: true })
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
  })

  it('expires stale previews', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-13T00:00:00.000Z') })
    const token = await previewKey()
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
  })

  it('checks competing links inside the SQL write instead of trusting earlier reads', async () => {
    const token = await previewKey()
    const originalUpdate = fixture.database.update.bind(fixture.database)
    vi.spyOn(fixture.database, 'update').mockImplementation(table => {
      addClient('org-racing-link', 'cus_QA')
      return originalUpdate(table)
    })
    expect((await apply(token)).status).toBe(409)
    expect(mapping()).toBeNull()
    expect(mapping('org-racing-link')).toBe('cus_QA')
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('returns an idempotent no-op for a customer already linked to the same client', async () => {
    await apply(await previewKey())
    mocks.audit.mockClear()
    const response = await apply(await previewKey())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ dryRun: false, applied: false, alreadyLinked: true })
    expect(mapping()).toBe('cus_QA')
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})
