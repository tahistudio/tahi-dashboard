/**
 * POST /api/portal/accept-invite - the contact row and the portal role.
 *
 * Two entry bugs live here. An invite sent to someone with no `contacts` row
 * linked nothing at all, so the person got a login and no identity in the
 * product. And `portalRole` was never set, so even the founding member of a
 * workspace landed on the 'member' default and was refused by their own
 * organisation, brands and people routes.
 *
 * These tests pin the resulting rules:
 *   - a missing contact is created and linked to the Clerk user,
 *   - an empty org's first acceptor owns the workspace,
 *   - so does the org's PRIMARY contact when nobody administers it yet,
 *   - a non-primary acceptor is a plain member even when they are the one who
 *     creates the Clerk org, and even when the org has no admin at all,
 *   - a later joiner at an org that already has an admin is a plain member,
 *   - an existing admin is never demoted,
 *   - the email binding and single-use claim still fail closed.
 *
 * Fake D1: chainable select answering from `captured.selectRows`, plus insert
 * and update recorders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  inserts: Record<string, unknown>[]
  updates: { table: string; set: Record<string, unknown> }[]
  updateReturns: unknown[][]
} = { selectRows: [], inserts: [], updates: [], updateReturns: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_client', orgId: null, sessionId: 'sess_1',
  }),
}))

const clerkState = {
  email: 'jane@acme.com',
  verified: true,
  createdOrgId: 'clerk_org_new',
  createMembership: vi.fn().mockResolvedValue(undefined),
  createOrganization: vi.fn(),
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
      createOrganization: (...args: unknown[]) => clerkState.createOrganization(...args),
    },
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, isNull: stub }
})

// `__table` lets the fake D1 below report which table a write hit, which is the
// whole point of these assertions (contact row vs invite claim vs org link).
vi.mock('@/db/d1', () => ({
  schema: {
    onboardingInvites: { __table: 'onboarding_invites', id: 'id', usedAt: 'used_at', usedByUserId: 'used_by_user_id' },
    organisations: { __table: 'organisations', id: 'id', name: 'name', clerkOrgId: 'clerk_org_id' },
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', portalRole: 'portal_role', isPrimary: 'is_primary', clerkUserId: 'clerk_user_id' },
  },
}))

const inviteState: { value: Record<string, unknown> | null } = { value: null }

vi.mock('@/lib/onboarding-invites', () => ({
  resolveInvite: vi.fn().mockImplementation(() => Promise.resolve(inviteState.value)),
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const selectChain: Record<string, unknown> = {}
  selectChain.from = vi.fn(() => selectChain)
  // Terminal either at `where` (read every contact at the org) or at `limit`
  // (single-row lookups), so both have to resolve.
  selectChain.where = vi.fn(() => {
    const p = answer() as Promise<unknown[]> & { limit?: unknown }
    const withLimit = Object.assign(p, { limit: vi.fn(() => p) })
    return withLimit
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
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
    }),
  }
})

import { POST } from '@/app/api/portal/accept-invite/route'
import { NextRequest } from 'next/server'

function makeRequest(body: Record<string, unknown> = { token: 'tok_1' }): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv_1',
    token: 'tok_1',
    flow: 'client',
    orgId: 'org_acme',
    persona: 'existing_retainer',
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

/** Rows the handler reads, in order: org, then contacts at that org. */
function queue(org: Record<string, unknown>, contacts: Record<string, unknown>[]) {
  captured.selectRows = [[org], contacts]
}

const contactInserts = () => captured.inserts.filter(r => r.__table === 'contacts')
const contactUpdates = () => captured.updates.filter(u => u.table === 'contacts')

describe('POST /api/portal/accept-invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    captured.updates = []
    captured.updateReturns = []
    inviteState.value = invite()
    clerkState.email = 'jane@acme.com'
    clerkState.verified = true
    clerkState.createMembership = vi.fn().mockResolvedValue(undefined)
    clerkState.createOrganization = vi.fn().mockResolvedValue({ id: 'clerk_org_new' })
  })

  it('creates and links the contact row when the invite has no matching contact', async () => {
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [])

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    const inserted = contactInserts()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].email).toBe('jane@acme.com')
    expect(inserted[0].clerkUserId).toBe('user_client')
    expect(inserted[0].name).toBe('Jane Smith')
    // First person at the org: primary, and the workspace admin.
    expect(inserted[0].isPrimary).toBe(true)
    expect(inserted[0].portalRole).toBe('admin')
  })

  it('makes the primary contact an admin when they found the workspace', async () => {
    // No Clerk org yet, so this acceptance is what creates the workspace, and
    // jane is the org's primary contact.
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: null }, [
      { id: 'c_1', email: 'jane@acme.com', portalRole: 'member', isPrimary: true },
    ])

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(clerkState.createOrganization).toHaveBeenCalled()

    const updated = contactUpdates()
    expect(updated.length).toBeGreaterThan(0)
    const contactSet = updated[updated.length - 1].set
    expect(contactSet.clerkUserId).toBe('user_client')
    expect(contactSet.portalRole).toBe('admin')
  })

  it('promotes the primary contact at an org that has no admin yet', async () => {
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'jane@acme.com', portalRole: 'member', isPrimary: true },
      { id: 'c_2', email: 'someone@acme.com', portalRole: 'member' },
    ])

    await POST(makeRequest())
    const contactSet = contactUpdates()[contactUpdates().length - 1].set
    expect(contactSet.portalRole).toBe('admin')
  })

  it('leaves a non-primary acceptor a member even when they create the Clerk org', async () => {
    // The escalation this guards: the studio stamps the primary contact admin
    // at creation, an intern is added as a member, an invite reaches both, and
    // the intern clicks first. Founding the Clerk org must not hand them the
    // workspace.
    clerkState.email = 'intern@acme.com'
    inviteState.value = invite({ contactEmail: 'intern@acme.com', contactName: 'Sam Intern' })
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: null }, [
      { id: 'c_1', email: 'owner@acme.com', portalRole: 'admin', isPrimary: true },
      { id: 'c_2', email: 'intern@acme.com', portalRole: 'member' },
    ])

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(clerkState.createOrganization).toHaveBeenCalled()
    const contactSet = contactUpdates()[contactUpdates().length - 1].set
    expect(contactSet.clerkUserId).toBe('user_client')
    expect(contactSet.portalRole).toBe('member')
  })

  it('leaves a non-primary acceptor a member at a migrated org with no admin', async () => {
    // Every row on a migrated client can still read portal_role 'member'. The
    // AP mailbox clicking first must not take the workspace off the owner.
    clerkState.email = 'accounts@acme.com'
    inviteState.value = invite({ contactEmail: 'accounts@acme.com', contactName: 'Acme Accounts' })
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'owner@acme.com', portalRole: 'member', isPrimary: true },
      { id: 'c_2', email: 'accounts@acme.com', portalRole: 'member' },
    ])

    await POST(makeRequest())
    const contactSet = contactUpdates()[contactUpdates().length - 1].set
    expect(contactSet.portalRole).toBe('member')
  })

  it('leaves a later joiner as a member when the org already has an admin', async () => {
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'owner@acme.com', portalRole: 'admin', isPrimary: true },
      { id: 'c_2', email: 'jane@acme.com', portalRole: 'member' },
    ])

    await POST(makeRequest())
    const contactSet = contactUpdates()[contactUpdates().length - 1].set
    expect(contactSet.clerkUserId).toBe('user_client')
    expect(contactSet.portalRole).toBe('member')
  })

  it('never demotes an existing admin', async () => {
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [
      { id: 'c_1', email: 'jane@acme.com', portalRole: 'admin', isPrimary: true },
      { id: 'c_2', email: 'other@acme.com', portalRole: 'admin' },
    ])

    await POST(makeRequest())
    const contactSet = contactUpdates()[contactUpdates().length - 1].set
    expect(contactSet.clerkUserId).toBe('user_client')
    expect(contactSet).not.toHaveProperty('portalRole')
  })

  it('refuses an invite bound to a different address', async () => {
    clerkState.email = 'someone-else@acme.com'
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [])

    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(contactInserts()).toHaveLength(0)
  })

  it('refuses an unverified email', async () => {
    clerkState.verified = false
    queue({ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }, [])

    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(contactInserts()).toHaveLength(0)
  })

  it('rejects an expired invite before touching anything', async () => {
    inviteState.value = invite({ expired: true })
    const res = await POST(makeRequest())
    expect(res.status).toBe(410)
    expect(captured.updates).toHaveLength(0)
  })

  it('409s when someone else already used the invite', async () => {
    captured.selectRows = [
      [{ id: 'org_acme', name: 'Acme Corp', clerkOrgId: 'clerk_org_1' }],
      // The re-read after a lost single-use claim.
      [{ usedByUserId: 'user_someone_else' }],
    ]
    captured.updateReturns = [[]]

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    expect(contactInserts()).toHaveLength(0)
  })
})
