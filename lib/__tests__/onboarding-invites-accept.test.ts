/**
 * lib/onboarding-invites.ts - the seat/first-contact decision, and
 * acceptClientInvite (the accept logic shared by POST
 * /api/portal/accept-invite and the seat branch of
 * app/(onboarding)/onboarding/page.tsx).
 *
 * app/api/__tests__/portal-accept-invite.test.ts already exercises
 * acceptClientInvite end to end through the route (email binding, the
 * single-use claim, the founding/promotion rules); these tests target the
 * lib function directly, plus the seat-vs-first-contact decision that decides
 * which landing an invited person gets (never the token's flow string).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  inserts: Record<string, unknown>[]
  updates: { table: string; set: Record<string, unknown> }[]
  updateReturns: unknown[][]
} = { selectRows: [], inserts: [], updates: [], updateReturns: [] }

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, isNull: stub, desc: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    onboardingInvites: { __table: 'onboarding_invites', id: 'id', usedAt: 'used_at', usedByUserId: 'used_by_user_id' },
    organisations: { __table: 'organisations', id: 'id', name: 'name', clerkOrgId: 'clerk_org_id' },
    contacts: {
      __table: 'contacts',
      id: 'id', orgId: 'org_id', email: 'email',
      portalRole: 'portal_role', isPrimary: 'is_primary', clerkUserId: 'clerk_user_id',
    },
  },
}))

vi.mock('@/lib/app-url', () => ({ publicUrl: (p: string) => `https://portal.tahi.studio${p}` }))

const clerkState = {
  email: 'jane@acme.com',
  verified: true,
  createMembership: vi.fn().mockResolvedValue(undefined),
  createOrganization: vi.fn(),
  updateUser: vi.fn().mockResolvedValue(undefined),
  publicMetadata: {} as Record<string, unknown>,
}

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockImplementation(() => Promise.resolve({
        primaryEmailAddressId: 'eml_1',
        publicMetadata: clerkState.publicMetadata,
        emailAddresses: [{
          id: 'eml_1',
          emailAddress: clerkState.email,
          verification: { status: clerkState.verified ? 'verified' : 'unverified' },
        }],
      })),
      updateUser: (...args: unknown[]) => clerkState.updateUser(...args),
    },
    organizations: {
      createOrganizationMembership: (...args: unknown[]) => clerkState.createMembership(...args),
      createOrganization: (...args: unknown[]) => clerkState.createOrganization(...args),
    },
  }),
}))

function fakeDatabase() {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const selectChain: Record<string, unknown> = {}
  selectChain.from = vi.fn(() => selectChain)
  selectChain.where = vi.fn(() => {
    const p = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(p, { limit: vi.fn(() => p) })
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    select: vi.fn(() => selectChain),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((row: Record<string, unknown>) => {
        captured.inserts.push({ __table: tableName(table), ...row })
        return Promise.resolve(undefined)
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((set: Record<string, unknown>) => ({
        where: vi.fn(() => {
          captured.updates.push({ table: tableName(table), set })
          const rows = captured.updateReturns.length ? captured.updateReturns.shift()! : [{ id: 'x' }]
          const p = Promise.resolve(rows) as Promise<unknown[]> & { returning?: unknown }
          return Object.assign(p, { returning: vi.fn(() => Promise.resolve(rows)) })
        }),
      })),
    })),
  }
}

// Imported after the mocks above so the module under test picks them up.
import {
  acceptClientInvite,
  hasOtherOrgContact,
  isSeatInvite,
  type InviteContext,
} from '@/lib/onboarding-invites'

function invite(overrides: Partial<InviteContext> = {}): InviteContext {
  return {
    id: 'inv_1',
    token: 'tok_1',
    flow: 'client',
    orgId: 'org_acme',
    persona: null,
    contractId: null,
    scheduleId: null,
    proposalId: null,
    contactEmail: 'jane@acme.com',
    contactName: 'Jane Smith',
    companyName: 'Acme Corp',
    expired: false,
    used: false,
    ...overrides,
  }
}

function queue(org: Record<string, unknown>, contacts: Record<string, unknown>[]) {
  captured.selectRows = [[org], contacts]
}

const contactInserts = () => captured.inserts.filter(r => r.__table === 'contacts')

describe('hasOtherOrgContact / isSeatInvite: the seat-vs-first-contact decision', () => {
  it('is first contact for a brand-new org with nobody on it at all', () => {
    expect(hasOtherOrgContact([], 'new@acme.com')).toBe(false)
  })

  it('is still first contact when the only row is the invitee\'s own pending contact', () => {
    expect(hasOtherOrgContact([{ email: 'New@Acme.com' }], 'new@acme.com')).toBe(false)
  })

  it('is a seat once any OTHER contact is on the roster (the admin who sent the invite)', () => {
    expect(hasOtherOrgContact(
      [{ email: 'admin@acme.com' }, { email: 'new@acme.com' }],
      'new@acme.com',
    )).toBe(true)
  })

  it('isSeatInvite reads the org roster via D1 and applies the same rule', async () => {
    const database = fakeDatabase()
    captured.selectRows = [[{ email: 'admin@acme.com' }, { email: 'new@acme.com' }]]
    await expect(isSeatInvite(database as never, 'org_acme', 'new@acme.com')).resolves.toBe(true)
  })

  it('isSeatInvite is false for a genuinely empty roster', async () => {
    const database = fakeDatabase()
    captured.selectRows = [[]]
    await expect(isSeatInvite(database as never, 'org_acme', 'new@acme.com')).resolves.toBe(false)
  })
})

describe('acceptClientInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    captured.updates = []
    captured.updateReturns = []
    clerkState.email = 'jane@acme.com'
    clerkState.verified = true
    clerkState.publicMetadata = {}
    clerkState.createMembership = vi.fn().mockResolvedValue(undefined)
    clerkState.createOrganization = vi.fn().mockResolvedValue({ id: 'clerk_org_new' })
    clerkState.updateUser = vi.fn().mockResolvedValue(undefined)
  })

  it('rejects a null/invalid invite without touching anything', async () => {
    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', null)
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid invite' })
    expect(captured.updates).toHaveLength(0)
  })

  it('rejects a team-flow invite (this function is client-only)', async () => {
    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', invite({ flow: 'team' }))
    expect(result.ok).toBe(false)
  })

  it('rejects an expired invite before touching anything', async () => {
    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', invite({ expired: true }))
    expect(result).toEqual({ ok: false, status: 410, error: 'This invite has expired' })
    expect(captured.updates).toHaveLength(0)
  })

  it('refuses an invite bound to a different address', async () => {
    clerkState.email = 'someone-else@acme.com'
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [])

    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', invite())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
    expect(contactInserts()).toHaveLength(0)
  })

  it('409s when someone else already used the invite', async () => {
    captured.selectRows = [
      [{ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }],
      [{ usedByUserId: 'user_someone_else' }],
    ]
    captured.updateReturns = [[]]

    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', invite())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
    }
    expect(contactInserts()).toHaveLength(0)
  })

  it('on success: creates the Clerk membership, links the contact, and stamps onboardingComplete', async () => {
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'owner@acme.com', portalRole: 'admin', isPrimary: true },
    ])

    const database = fakeDatabase()
    const result = await acceptClientInvite(database as never, 'user_client', invite())

    expect(result).toEqual({ ok: true, orgId: 'org_acme', clerkOrgId: 'clerk_org_1' })
    expect(clerkState.createMembership).toHaveBeenCalledWith({
      organizationId: 'clerk_org_1',
      userId: 'user_client',
      role: 'org:member',
    })

    const inserted = contactInserts()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].email).toBe('jane@acme.com')
    expect(inserted[0].clerkUserId).toBe('user_client')

    expect(clerkState.updateUser).toHaveBeenCalledWith(
      'user_client',
      expect.objectContaining({ publicMetadata: expect.objectContaining({ onboardingComplete: true }) }),
    )
  })

  it('does not re-stamp a user whose onboardingComplete flag is already set', async () => {
    clerkState.publicMetadata = { onboardingComplete: true }
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'owner@acme.com', portalRole: 'admin', isPrimary: true },
    ])

    const database = fakeDatabase()
    await acceptClientInvite(database as never, 'user_client', invite())
    expect(clerkState.updateUser).not.toHaveBeenCalled()
  })
})
