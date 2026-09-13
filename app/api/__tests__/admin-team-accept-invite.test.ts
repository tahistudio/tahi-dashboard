/**
 * POST /api/admin/team/accept-invite - the Tahi org membership a team invite
 * token grants.
 *
 * The client-side mirror of app/api/portal/accept-invite, for the flow 'team'
 * half of lib/onboarding-invites.ts (see app/api/__tests__/portal-accept-invite.test.ts
 * for the client-flow twin). app/api/admin/team/[id]/invite mints the token and
 * emails it (rather than a Clerk organization invitation, which Clerk itself
 * would have emailed with no way to suppress it); this route is where the
 * signed-in hire redeems it.
 *
 * Pinned:
 *   - the email binding and single-use claim fail closed, same as the client
 *     flow,
 *   - a flow 'client' token is refused here (wrong door),
 *   - createOrganizationMembership is called with the Tahi org id and role
 *     org:member,
 *   - "already a member" from Clerk is swallowed as success (a retry after a
 *     partial failure must still succeed),
 *   - any other Clerk failure is a 502, not a silent success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  updates: { table: string; set: Record<string, unknown> }[]
  updateReturns: unknown[][]
} = { selectRows: [], updates: [], updateReturns: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_hire', orgId: null, sessionId: 'sess_1',
  }),
}))

const clerkState = {
  email: 'nathan@tahi.studio',
  verified: true,
  createMembership: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockImplementation(() => Promise.resolve({
        primaryEmailAddressId: 'eml_1',
        emailAddresses: [{
          id: 'eml_1',
          emailAddress: clerkState.email,
          verification: { status: clerkState.verified ? 'verified' : 'unverified' },
        }],
      })),
    },
    organizations: {
      createOrganizationMembership: (...args: unknown[]) => clerkState.createMembership(...args),
    },
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, isNull: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    onboardingInvites: { __table: 'onboarding_invites', id: 'id', usedAt: 'used_at', usedByUserId: 'used_by_user_id' },
  },
}))

const inviteState: { value: Record<string, unknown> | null } = { value: null }

vi.mock('@/lib/onboarding-invites', () => ({
  resolveInvite: vi.fn().mockImplementation(() => Promise.resolve(inviteState.value)),
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            const p = answer() as Promise<unknown[]> & { limit?: unknown }
            return Object.assign(p, { limit: vi.fn(() => p) })
          }),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((set: Record<string, unknown>) => ({
          where: vi.fn(() => {
            captured.updates.push({ table: (table as { __table?: string })?.__table ?? 'unknown', set })
            const rows = captured.updateReturns.length ? captured.updateReturns.shift()! : [{ id: 'inv_1' }]
            const p = Promise.resolve(rows) as Promise<unknown[]> & { returning?: unknown }
            return Object.assign(p, { returning: vi.fn(() => Promise.resolve(rows)) })
          }),
        })),
      })),
    }),
  }
})

import { POST } from '@/app/api/admin/team/accept-invite/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown> = { token: 'tok_1' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/team/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    token: 'tok_1',
    flow: 'team',
    orgId: null,
    persona: null,
    contractId: null,
    scheduleId: null,
    proposalId: null,
    contactEmail: 'nathan@tahi.studio',
    contactName: 'Nathan Hire',
    companyName: null,
    expired: false,
    used: false,
    ...overrides,
  }
}

describe('POST /api/admin/team/accept-invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.updates = []
    captured.updateReturns = []
    inviteState.value = invite()
    clerkState.email = 'nathan@tahi.studio'
    clerkState.verified = true
    clerkState.createMembership = vi.fn().mockResolvedValue(undefined)
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  it('grants Tahi org membership and returns the org id for setActive', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; clerkOrgId: string }
    expect(json).toMatchObject({ ok: true, clerkOrgId: 'org_tahi' })

    expect(clerkState.createMembership).toHaveBeenCalledWith({
      organizationId: 'org_tahi',
      userId: 'user_hire',
      role: 'org:member',
    })

    const claim = captured.updates.find(u => u.table === 'onboarding_invites')
    expect(claim?.set.usedByUserId).toBe('user_hire')
  })

  it('refuses a client-flow token: wrong door', async () => {
    inviteState.value = invite({ flow: 'client', orgId: 'org_acme' })
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
    expect(clerkState.createMembership).not.toHaveBeenCalled()
  })

  it('refuses an invite bound to a different address', async () => {
    clerkState.email = 'someone-else@tahi.studio'
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(clerkState.createMembership).not.toHaveBeenCalled()
  })

  it('refuses an unverified email', async () => {
    clerkState.verified = false
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(clerkState.createMembership).not.toHaveBeenCalled()
  })

  it('rejects an expired invite before touching anything', async () => {
    inviteState.value = invite({ expired: true })
    const res = await POST(makeRequest())
    expect(res.status).toBe(410)
    expect(captured.updates).toHaveLength(0)
  })

  it('409s when someone else already used the invite', async () => {
    captured.selectRows = [[{ usedByUserId: 'user_someone_else' }]]
    captured.updateReturns = [[]]

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    expect(clerkState.createMembership).not.toHaveBeenCalled()
  })

  it('treats "already a member" from Clerk as success, not a failure', async () => {
    clerkState.createMembership = vi.fn().mockRejectedValue(new Error('already a member'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean }
    expect(json.ok).toBe(true)
  })

  it('502s a genuine Clerk failure', async () => {
    clerkState.createMembership = vi.fn().mockRejectedValue(new Error('internal server error'))
    const res = await POST(makeRequest())
    expect(res.status).toBe(502)
  })
})
