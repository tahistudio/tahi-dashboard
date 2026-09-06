/**
 * POST /api/portal/invites - the contact row a second seat later claims.
 *
 * Inviting a colleague only ever created a Clerk organization invitation, so
 * the person arrived with a login and no `contacts` row to be. Nothing then
 * linked them: no portal role, no notifications, messages stamped with a raw
 * Clerk id. The route now writes the waiting row, deny by default, which is
 * what lib/contact-link-server.ts claims on their first dashboard load.
 *
 * Pinned: a row per newly invited address, no duplicate for someone already on
 * the org, no row for an address Clerk refused, the write scoped to the
 * caller's own org, and a D1 failure never losing an invitation Clerk has
 * already sent.
 *
 * Also pinned, and the reason this route is no longer the soft way in: it is
 * WORKSPACE ADMIN ONLY, the same gate POST /api/portal/people applies. The two
 * routes now do the same thing, so a plain member could otherwise add an
 * outsider to the roster here and get exactly what the sibling route refuses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  inserts: Record<string, unknown>[]
  insertThrows: boolean
} = { selectRows: [], inserts: [], insertThrows: false }

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

const clerkState = { failFor: new Set<string>(), calls: [] as Record<string, unknown>[] }

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    organizations: {
      createOrganizationInvitation: vi.fn().mockImplementation((arg: { emailAddress: string }) => {
        clerkState.calls.push(arg)
        if (clerkState.failFor.has(arg.emailAddress)) return Promise.reject(new Error('already a member'))
        return Promise.resolve(undefined)
      }),
    },
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, inArray: stub, desc: stub }
})

// The delivery allowlist, opened. This spec is about the contact row a second
// seat later claims, not about who Clerk may write to; the gate on this route
// has its own spec in app/api/__tests__/clerk-invite-allowlist.test.ts. Left
// real, every fixture address here is an outside domain and every case would
// answer 409.
vi.mock('@/lib/email-gate', () => ({
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({
    mode: 'all',
    allowedDomains: [],
    allowedOrgIds: [],
    allowedAddresses: [],
    blockedAddresses: [],
  }),
  guardOutboundAddress: vi.fn().mockResolvedValue({ allowed: true, reason: '' }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', portalRole: 'portal_role', clerkUserId: 'clerk_user_id' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  // Terminal at `where` (the roster read) or at `limit` (the admin-gate probe).
  chain.where = vi.fn(() => {
    const promise = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(promise, { limit: vi.fn(() => promise) })
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: Record<string, unknown>) => {
          if (captured.insertThrows) return Promise.reject(new Error('d1 down'))
          captured.inserts.push({ __table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { POST } from '@/app/api/portal/invites/route'
import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_owner',
    orgId: 'org_acme',
    sessionId: 'sess_1',
    clerkOrgId: 'clerk_org_1',
    impersonating: false,
    ...overrides,
  }
}

function makeRequest(emails: string[]): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails }),
  })
}

const contacts = () => captured.inserts.filter(r => r.__table === 'contacts')

/** The admin-gate probe answers first, then the roster read. */
const ADMIN_CALLER = [{ portalRole: 'admin' }]
function queue(roster: Record<string, unknown>[] = [], caller = ADMIN_CALLER) {
  captured.selectRows = [caller, roster]
}

describe('POST /api/portal/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    captured.insertThrows = false
    clerkState.failFor = new Set()
    clerkState.calls = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  it('writes a waiting contact row per invited colleague, deny by default', async () => {
    queue()

    const res = await POST(makeRequest(['Raj@Acme.com', 'sam@acme.com']))
    expect(res.status).toBe(200)

    const rows = contacts()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.email).sort()).toEqual(['raj@acme.com', 'sam@acme.com'])
    for (const row of rows) {
      // A colleague is a member until someone promotes them, and the row is
      // unclaimed until they sign in and the link module claims it.
      expect(row.portalRole).toBe('member')
      expect(row.isPrimary).toBe(false)
      expect(row.orgId).toBe('org_acme')
      expect(row.clerkUserId).toBeUndefined()
    }
  })

  it('does not duplicate someone who is already a contact', async () => {
    queue([{ email: 'RAJ@acme.com', clerkUserId: null }])

    await POST(makeRequest(['raj@acme.com', 'sam@acme.com']))
    const rows = contacts()
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('sam@acme.com')
  })

  it('writes no row for an address Clerk refused', async () => {
    queue()
    clerkState.failFor = new Set(['sam@acme.com'])

    const res = await POST(makeRequest(['raj@acme.com', 'sam@acme.com']))
    const json = await res.json() as { invited: number }
    expect(json.invited).toBe(1)
    expect(contacts().map(r => r.email)).toEqual(['raj@acme.com'])
  })

  it('keeps the invitations Clerk already sent when the contact write fails', async () => {
    queue()
    captured.insertThrows = true

    const res = await POST(makeRequest(['raj@acme.com']))
    expect(res.status).toBe(200)
    const json = await res.json() as { invited: number }
    expect(json.invited).toBe(1)
  })

  it('403s a Tahi session', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi' }))
    const res = await POST(makeRequest(['raj@acme.com']))
    expect(res.status).toBe(403)
    expect(contacts()).toHaveLength(0)
  })

  it('refuses to invite from an impersonated client view', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true }))
    const res = await POST(makeRequest(['raj@acme.com']))
    expect(res.status).toBe(400)
    expect(contacts()).toHaveLength(0)
  })

  it('400s when no address is usable', async () => {
    const res = await POST(makeRequest(['not-an-email']))
    expect(res.status).toBe(400)
    expect(contacts()).toHaveLength(0)
  })

  it('refuses a plain member, the same as POST /api/portal/people would', async () => {
    queue([], [{ portalRole: 'member' }])

    const res = await POST(makeRequest(['outsider@x.com']))
    expect(res.status).toBe(403)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('admin')
    // Neither half of the invitation happened: no Clerk invite, no roster row.
    expect(clerkState.calls).toHaveLength(0)
    expect(contacts()).toHaveLength(0)
  })

  it('refuses a session with no contact row at all', async () => {
    queue([], [])

    const res = await POST(makeRequest(['outsider@x.com']))
    expect(res.status).toBe(403)
    expect(clerkState.calls).toHaveLength(0)
    expect(contacts()).toHaveLength(0)
  })

  it('does not re-invite someone who already has portal access', async () => {
    // On the roster AND linked to a Clerk user: they are already in, so there
    // is nothing to invite them to.
    queue([{ email: 'raj@acme.com', clerkUserId: 'user_raj' }])

    const res = await POST(makeRequest(['Raj@Acme.com', 'sam@acme.com']))
    const json = await res.json() as { invited: number; results: { email: string; invited: boolean }[] }
    expect(json.invited).toBe(1)
    expect(clerkState.calls.map(c => c.emailAddress)).toEqual(['sam@acme.com'])
    expect(contacts().map(r => r.email)).toEqual(['sam@acme.com'])
  })

  it('still invites a roster entry that has never signed in', async () => {
    // A contact the studio added by hand has a row but no login. Sending them
    // the invitation is the whole point of this route.
    queue([{ email: 'raj@acme.com', clerkUserId: null }])

    const res = await POST(makeRequest(['raj@acme.com']))
    const json = await res.json() as { invited: number }
    expect(json.invited).toBe(1)
    expect(clerkState.calls.map(c => c.emailAddress)).toEqual(['raj@acme.com'])
    // No second row: the one already there is what they will claim.
    expect(contacts()).toHaveLength(0)
  })
})
