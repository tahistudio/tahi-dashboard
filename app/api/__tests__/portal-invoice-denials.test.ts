/**
 * The 403 bodies of GET /api/portal/invoices and /api/portal/invoices/[id].
 *
 * Both routes turn a client away from four different gates, and three of them
 * used to send the same bare `{ error: 'Forbidden' }`. The client page reads
 * that body to choose its sentence (lib/portal-admin-label.ts), so an org
 * admin whose workspace had invoices switched off was told to "ask your
 * organisation admin" for one, which is themselves. Each denial now names
 * itself, and lib/portal-admin-label maps the code to the copy.
 *
 * These are body-shape tests: the gates themselves are exercised in
 * lib/__tests__/portal-access.test.ts and require-feature-guards.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { isOrgAdmin } from '@/lib/portal-access'

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requirePortalFeature: vi.fn() }))
vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn() }))
vi.mock('@/db/d1', () => ({ schema: { invoices: {}, invoiceItems: {}, organisations: {} } }))
vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}), ne: () => ({}), desc: () => ({}) }))
// Enough drizzle to let an allowed read run to completion (it returns no rows);
// the denial paths never reach it.
vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'offset']) {
    chain[key] = () => chain
  }
  chain.then = (resolve: (rows: unknown[]) => void) => resolve([])
  // The handle itself must NOT be thenable, or `await db()` would unwrap it.
  return { db: async () => ({ select: () => chain }) }
})

const { GET: listInvoices } = await import('../portal/invoices/route')
const { GET: getInvoice } = await import('../portal/invoices/[id]/route')

const listReq = () => new Request('http://localhost/api/portal/invoices?status=all')
const detailReq = () => new Request('http://localhost/api/portal/invoices/inv1')
const detailParams = { params: Promise.resolve({ id: 'inv1' }) }

async function bodies(): Promise<Array<Record<string, unknown>>> {
  const list = await listInvoices(listReq() as never)
  const detail = await getInvoice(detailReq() as never, detailParams)
  expect(list.status).toBe(403)
  expect(detail.status).toBe(403)
  return [
    await list.json() as Record<string, unknown>,
    await detail.json() as Record<string, unknown>,
  ]
}

describe('portal invoice denials name themselves', () => {
  beforeEach(() => {
    vi.mocked(requirePortalFeature).mockResolvedValue(null)
    vi.mocked(isOrgAdmin).mockResolvedValue(true)
    vi.mocked(getPortalAuth).mockResolvedValue({
      userId: 'user_client', orgId: 'org-client', clerkOrgId: 'clerk-client', impersonating: false,
    } as never)
  })

  it('says not_org_admin when a member seat asks for their org money', async () => {
    vi.mocked(isOrgAdmin).mockResolvedValue(false)
    for (const body of await bodies()) {
      expect(body).toEqual({ error: 'Forbidden', code: 'not_org_admin' })
    }
  })

  it('says no_org when the login is not linked to a workspace', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue({
      userId: 'user_client', orgId: null, clerkOrgId: 'clerk-client', impersonating: false,
    } as never)
    for (const body of await bodies()) {
      expect(body.code).toBe('no_org')
      expect(body.error).toBe('No organisation found for this user')
    }
  })

  it('lets an admin previewing the portal through the seat gate', async () => {
    vi.mocked(isOrgAdmin).mockResolvedValue(false)
    vi.mocked(getPortalAuth).mockResolvedValue({
      userId: 'user_owner', orgId: 'org-client', clerkOrgId: 'clerk-tahi', impersonating: true,
    } as never)
    const res = await listInvoices(listReq() as never)
    expect(res.status).not.toBe(403)
  })
})
