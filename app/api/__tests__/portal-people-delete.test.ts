/**
 * DELETE /api/portal/people - removing a teammate.
 *
 * Liam's bug: org "Blah Blah Inc", he is the Owner row (primary contact,
 * portalRole still the NOT NULL 'member' default), the teammate row "Liam alt"
 * was invited through the seat-invite flow, then signed up in Clerk BY HAND
 * instead of following the invite link. lib/contact-link-server.ts and the
 * Clerk webhook (lib/clerk-webhook-server.ts) both link `contacts.clerkUserId`
 * off a verified-email match alone, with no requirement that the person ever
 * accepted THIS org's invite (only app/api/portal/accept-invite/route.ts calls
 * createOrganizationMembership). So the contact carries a clerkUserId while
 * Clerk's own membership list for the org has one member: the Owner. Clicking
 * the bin called deleteOrganizationMembership for someone Clerk does not count
 * as a member, which threw, and the route turned every Clerk exception into a
 * 502 with no distinction for "already the state we wanted". This spec pins
 * that state, the three others alongside it, the org-scoped gates, and that the
 * invite-token expiry now runs on both branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

interface DbState {
  queues: Record<string, Row[][]>
  updates: Row[]
  deletes: Row[]
}

// ---------------------------------------------------------------------------
// Mocks (vi.mock factories are hoisted and cannot close over outer variables)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))

const deleteOrganizationMembership = vi.fn()
const getOrganizationInvitationList = vi.fn()
const revokeOrganizationInvitation = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    organizations: {
      deleteOrganizationMembership: (...a: unknown[]) => deleteOrganizationMembership(...a),
      getOrganizationInvitationList: (...a: unknown[]) => getOrganizationInvitationList(...a),
      revokeOrganizationInvitation: (...a: unknown[]) => revokeOrganizationInvitation(...a),
    },
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, asc: stub, desc: stub, inArray: stub, isNull: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      _table: 'contacts',
      id: 'id',
      orgId: 'org_id',
      name: 'name',
      email: 'email',
      role: 'role',
      portalRole: 'portal_role',
      isPrimary: 'is_primary',
      clerkUserId: 'clerk_user_id',
      createdAt: 'created_at',
    },
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    onboardingInvites: {
      _table: 'onboarding_invites',
      orgId: 'org_id',
      contactEmail: 'contact_email',
      expiresAt: 'expires_at',
      updatedAt: 'updated_at',
      usedAt: 'used_at',
    },
  },
}))

// Not exercised by DELETE, but the route module imports these at the top
// level (used by POST), so they must resolve.
vi.mock('@/lib/onboarding-invites', () => ({ ensureClientInvite: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))

vi.mock('@/lib/db', () => {
  const state: DbState = { queues: {}, updates: [], deletes: [] }

  type Chain = Promise<Row[]> & { where: () => Chain; limit: () => Chain; orderBy: () => Chain }

  function chainFor(rows: Row[]): Chain {
    const chain = Promise.resolve(rows) as Chain
    chain.where = () => chain
    chain.limit = () => chain
    chain.orderBy = () => chain
    return chain
  }

  const tableName = (t: unknown) => (t as { _table?: string })?._table ?? 'unknown'

  const database = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        const queue = state.queues[tableName(table)] ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((row: Row) => ({
        where: vi.fn(() => {
          state.updates.push({ _table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(() => {
        state.deletes.push({ _table: tableName(table) })
        return Promise.resolve(undefined)
      }),
    })),
  }

  return { db: vi.fn().mockResolvedValue(database), __mock: { state } }
})

// Imported after the mocks are registered.
import { DELETE } from '@/app/api/portal/people/route'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'

const dbMock = (dbModule as unknown as { __mock: { state: DbState } }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_caller',
    orgId: 'org_acme',
    sessionId: 'sess_1',
    clerkOrgId: 'clerk_org_acme',
    impersonating: false,
    ...overrides,
  }
}

function req(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/portal/people?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/** The admin-gate probe (caller's own contact row), then the target row. */
function seed(caller: Row | null, target: Row | null) {
  dbMock.state.queues = {
    contacts: [caller ? [caller] : [], target ? [target] : []],
  }
}

const invitesUpdates = () => dbMock.state.updates.filter((r) => r._table === 'onboarding_invites')

/** The three callers that matter, as the contacts row reads in D1. */
const ADMIN_CALLER: Row = { portalRole: 'admin', isPrimary: false }
const FRESH_OWNER_CALLER: Row = { portalRole: 'member', isPrimary: true }
const MEMBER_CALLER: Row = { portalRole: 'member', isPrimary: false }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  dbMock.state.queues = {}
  dbMock.state.updates = []
  dbMock.state.deletes = []
  getOrganizationInvitationList.mockResolvedValue({ data: [] })
  deleteOrganizationMembership.mockResolvedValue(undefined)
  revokeOrganizationInvitation.mockResolvedValue(undefined)
})

describe('DELETE /api/portal/people - the four Clerk states', () => {
  it('member removed: deleteOrganizationMembership is called and the roster row is deleted', async () => {
    seed(ADMIN_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(200)
    expect(deleteOrganizationMembership).toHaveBeenCalledWith({
      organizationId: 'clerk_org_acme',
      userId: 'user_raj',
    })
    expect(dbMock.state.deletes).toHaveLength(1)
    // Both branches expire any unused invite token for the email.
    expect(invitesUpdates()).toHaveLength(1)
  })

  it("not-a-member 404 continues: Liam's exact bug, a contact linked by verified email who never accepted this org's invite", async () => {
    seed(FRESH_OWNER_CALLER, {
      id: 'c_alt',
      email: 'hello+test@liammiller.dev',
      isPrimary: false,
      clerkUserId: 'user_liam_alt',
    })
    deleteOrganizationMembership.mockRejectedValue({
      status: 404,
      errors: [{ code: 'organization_membership_not_found' }],
    })

    const res = await DELETE(req('c_alt'))

    expect(res.status).toBe(200)
    expect(dbMock.state.deletes).toHaveLength(1)
    expect(invitesUpdates()).toHaveLength(1)
  })

  it('pending invite revoked: no clerkUserId, a matching pending invitation is found and revoked', async () => {
    seed(ADMIN_CALLER, { id: 'c_pending', email: 'sam@acme.test', isPrimary: false, clerkUserId: null })
    getOrganizationInvitationList.mockResolvedValue({
      data: [{ id: 'inv_1', emailAddress: 'sam@acme.test' }],
    })

    const res = await DELETE(req('c_pending'))

    expect(res.status).toBe(200)
    expect(revokeOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'clerk_org_acme',
      invitationId: 'inv_1',
      requestingUserId: 'user_caller',
    })
    expect(dbMock.state.deletes).toHaveLength(1)
    expect(invitesUpdates()).toHaveLength(1)
  })

  it('no invite continues: no clerkUserId and no matching pending invitation, already the case', async () => {
    seed(ADMIN_CALLER, { id: 'c_gone', email: 'nobody@acme.test', isPrimary: false, clerkUserId: null })
    getOrganizationInvitationList.mockResolvedValue({ data: [] })

    const res = await DELETE(req('c_gone'))

    expect(res.status).toBe(200)
    expect(revokeOrganizationInvitation).not.toHaveBeenCalled()
    expect(dbMock.state.deletes).toHaveLength(1)
    expect(invitesUpdates()).toHaveLength(1)
  })
})

describe('DELETE /api/portal/people - only a genuine Clerk failure on a real member keeps the 502', () => {
  it('a 500 from deleteOrganizationMembership 502s and touches neither the roster nor the invite token', async () => {
    seed(ADMIN_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })
    deleteOrganizationMembership.mockRejectedValue({ status: 500, message: 'Clerk is down' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(502)
    expect(dbMock.state.deletes).toHaveLength(0)
    expect(invitesUpdates()).toHaveLength(0)
  })

  it('a 403 (a real member Clerk simply refuses to remove) also 502s rather than guessing it is gone', async () => {
    seed(ADMIN_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })
    deleteOrganizationMembership.mockRejectedValue({ status: 403, errors: [{ code: 'not_authorized' }] })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(502)
    expect(dbMock.state.deletes).toHaveLength(0)
  })
})

describe('DELETE /api/portal/people - the admin gate', () => {
  it('lets the Owner (primary contact, portalRole still the member default) remove a teammate', async () => {
    seed(FRESH_OWNER_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(200)
  })

  it('an explicit admin can also remove a teammate', async () => {
    seed(ADMIN_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(200)
  })

  it('403s a plain member and never reaches Clerk', async () => {
    seed(MEMBER_CALLER, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(403)
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(dbMock.state.deletes).toHaveLength(0)
  })

  it('403s a session with no contact row at all', async () => {
    seed(null, { id: 'c_target', email: 'raj@acme.test', isPrimary: false, clerkUserId: 'user_raj' })

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(403)
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/portal/people - self and primary refusals', () => {
  it('409s a caller trying to remove themselves, before any Clerk call', async () => {
    seed(ADMIN_CALLER, { id: 'c_self', email: 'me@acme.test', isPrimary: false, clerkUserId: 'user_caller' })

    const res = await DELETE(req('c_self'))

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('You cannot remove yourself')
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(dbMock.state.deletes).toHaveLength(0)
  })

  it('409s removing the primary contact, before any Clerk call', async () => {
    seed(ADMIN_CALLER, { id: 'c_primary', email: 'owner@acme.test', isPrimary: true, clerkUserId: 'user_owner' })

    const res = await DELETE(req('c_primary'))

    expect(res.status).toBe(409)
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(dbMock.state.deletes).toHaveLength(0)
  })
})

describe('DELETE /api/portal/people - request-shape guards', () => {
  it('400s an impersonating (Client view) session before any DB or Clerk work', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true }))

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(400)
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
  })

  it('403s the Tahi admin org itself', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi' }))

    const res = await DELETE(req('c_target'))

    expect(res.status).toBe(403)
  })

  it('400s a missing id query param', async () => {
    seed(ADMIN_CALLER, null)

    const res = await DELETE(new NextRequest('http://localhost:3000/api/portal/people', { method: 'DELETE' }))

    expect(res.status).toBe(400)
  })

  it('404s an id that does not resolve to a contact at this org', async () => {
    seed(ADMIN_CALLER, null)

    const res = await DELETE(req('c_missing'))

    expect(res.status).toBe(404)
  })
})
