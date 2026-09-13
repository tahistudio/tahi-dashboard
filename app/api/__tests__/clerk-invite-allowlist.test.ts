/**
 * Every seat invite now goes through the ONE email door, not Clerk.
 *
 *   - POST /api/admin/team/[id]/invite   any Tahi admin, address off the roster
 *   - POST /api/portal/people            any client admin, address typed in
 *   - POST /api/portal/invites           the same, in bulk
 *
 * These three routes used to call `clerk.organizations.createOrganizationInvitation`,
 * which sends an email FROM CLERK'S OWN SYSTEMS the moment it is called, with
 * no way to suppress it (the Backend API's org-invitation params carry no
 * `notify` flag, unlike the plain Invitation API). That made them a live path
 * from an authenticated session to a real person's inbox while Liam's rule,
 * 2026-09-06, said no real client and no teammate receives anything from this
 * system until he has verified it.
 *
 * The fix was not a gate in front of that call: it was removing the call.
 * Every one of these routes now mints its own app invite token
 * (lib/onboarding-invites.ts, mocked here) and sends the Studio Ledger
 * seat-invite email through sendEmail (lib/email.ts -> the one door,
 * lib/email-delivery.ts). Pinned here: each route
 *
 *   1. never calls a Clerk invitation endpoint at all,
 *   2. sends through sendEmail with template 'seat-invite' and the right
 *      orgId (the client's org for the two portal routes, null for the
 *      studio's own workspace),
 *   3. reports the allowlist holding an address back as the same 409 shape
 *      the rest of the product uses, and writes no roster/roster-adjacent row
 *      when that happens.
 *
 * lib/__tests__/no-resend-bypass.test.ts holds the structural half: nothing in
 * product code may call createOrganizationInvitation again, full stop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state = {
  selectRows: [] as unknown[][],
  inserts: [] as Row[],
  clerkOrgCalls: [] as Row[],
}

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

// No organizations.createOrganizationInvitation mock at all: if any of the
// three routes under test still called it, this suite would throw
// "clerk.organizations.createOrganizationInvitation is not a function" rather
// than silently pass.
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({ firstName: 'Liam', lastName: 'Miller' }),
    },
    organizations: {},
  }),
}))

vi.mock('@/lib/onboarding-invites', () => ({
  createInvite: vi.fn().mockResolvedValue({
    id: 'inv_1',
    token: 'tok_1',
    path: '/onboarding?token=tok_1',
    link: 'https://portal.tahi.studio/onboarding?token=tok_1',
    expiresAt: '2026-10-01T00:00:00.000Z',
    reused: false,
  }),
  ensureClientInvite: vi.fn().mockResolvedValue({
    id: 'inv_1',
    token: 'tok_1',
    path: '/onboarding?token=tok_1',
    link: 'https://portal.tahi.studio/onboarding?token=tok_1',
    expiresAt: '2026-10-01T00:00:00.000Z',
    reused: false,
  }),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/require-permission', () => ({
  requireManagePermissions: vi.fn().mockResolvedValue({ denied: null }),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, asc: stub, desc: stub, inArray: stub, isNull: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', name: 'name',
      portalRole: 'portal_role', isPrimary: 'is_primary', clerkUserId: 'clerk_user_id',
    },
    organisations: { __table: 'organisations', id: 'id', name: 'name' },
    teamMembers: { __table: 'team_members', id: 'id', name: 'name', email: 'email', clerkUserId: 'clerk_user_id' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(state.selectRows.length ? state.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => {
    const promise = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(promise, { limit: vi.fn(() => promise) })
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((rows: Row | Row[]) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            state.inserts.push({ __table: tableName(table), ...row })
          }
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'
import { sendEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'
import { POST as teamInvite } from '@/app/api/admin/team/[id]/invite/route'
import { POST as portalPeople } from '@/app/api/portal/people/route'
import { POST as portalInvites } from '@/app/api/portal/invites/route'

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

function jsonReq(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function sendEmailCalls() {
  return vi.mocked(sendEmail).mock.calls
}

const contactRows = () => state.inserts.filter(r => r.__table === 'contacts')

beforeEach(() => {
  vi.clearAllMocks()
  state.selectRows = []
  state.inserts = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  vi.mocked(sendEmail).mockResolvedValue({ success: true })
})

// ---------------------------------------------------------------------------
// POST /api/admin/team/[id]/invite
// ---------------------------------------------------------------------------

describe('POST /api/admin/team/[id]/invite', () => {
  const params = { params: Promise.resolve({ id: 'tm-1' }) }
  const post = () => jsonReq('/api/admin/team/tm-1/invite', {})

  function roster(email: string, clerkUserId: string | null = null) {
    state.selectRows = [[{ id: 'tm-1', name: 'Nathan', email, clerkUserId }]]
  }

  it('sends the Studio Ledger email instead of minting a Clerk invitation', async () => {
    roster('nathan@tahi.studio')

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; status: string }
    expect(body).toMatchObject({ success: true, status: 'invited' })

    expect(sendEmailCalls()).toHaveLength(1)
    const [to, subject, , , context] = sendEmailCalls()[0]
    expect(to).toBe('nathan@tahi.studio')
    expect(subject).toContain('invited you to Tahi Studio on Tahi')
    // The studio's own workspace, not a client: no orgId on this send.
    expect(context).toMatchObject({ template: 'seat-invite', orgId: null })

    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'team_member.invited' }),
    )
  })

  it('reports the allowlist holding the address back, the same 409 shape as any other send', async () => {
    roster('nathan@tahi.studio')
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Held back by the email allowlist (1 recipient).', suppressedCount: 1 })

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Held back by the email allowlist')
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('does not send for a hire already linked to a login', async () => {
    roster('nathan@tahi.studio', 'user_existing')

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('already_linked')
    expect(sendEmailCalls()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/portal/people
// ---------------------------------------------------------------------------

describe('POST /api/portal/people', () => {
  /** admin-gate probe, dedupe probe, org name, caller name, in that order. */
  function primed() {
    state.selectRows = [
      [{ portalRole: 'admin' }],
      [],
      [{ name: 'Acme Co' }],
      [{ name: 'Ana Owner' }],
    ]
  }

  it('sends the Studio Ledger email and rosters the invite, with no Clerk call anywhere', async () => {
    primed()

    const res = await portalPeople(jsonReq('/api/portal/people', {
      name: 'Sam',
      email: 'sam@acme.com',
    }))

    expect(res.status).toBe(201)
    expect(sendEmailCalls()).toHaveLength(1)
    const [to, subject, , , context] = sendEmailCalls()[0]
    expect(to).toBe('sam@acme.com')
    expect(subject).toBe('Ana Owner invited you to Acme Co on Tahi')
    expect(context).toMatchObject({ template: 'seat-invite', orgId: 'org_acme' })
    expect(contactRows()).toHaveLength(1)
  })

  it('409s and rosters nothing when the allowlist holds the address back', async () => {
    primed()
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Held back by the email allowlist (1 recipient).', suppressedCount: 1 })

    const res = await portalPeople(jsonReq('/api/portal/people', { email: 'sam@acme.com' }))

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Held back by the email allowlist')
    expect(contactRows()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/portal/invites
// ---------------------------------------------------------------------------

describe('POST /api/portal/invites', () => {
  /** admin-gate probe, roster, org name, caller name, in that order. */
  function primed(roster: Row[] = []) {
    state.selectRows = [[{ portalRole: 'admin' }], roster, [{ name: 'Acme Co' }], [{ name: 'Ana Owner' }]]
  }

  it('409s when the whole batch is withheld, so an empty result cannot read as success', async () => {
    primed()
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Held back by the email allowlist (2 recipients).', suppressedCount: 2 })

    const res = await portalInvites(jsonReq('/api/portal/invites', {
      emails: ['sam@acme.com', 'raj@acme.com'],
    }))

    expect(res.status).toBe(409)
    expect(contactRows()).toHaveLength(0)
    const body = await res.json() as { suppressed: string[] }
    expect(body.suppressed).toEqual(['sam@acme.com', 'raj@acme.com'])
  })

  it('invites the address that sends and withholds the rest, rather than failing whole', async () => {
    primed()
    vi.mocked(sendEmail).mockImplementation(async (to) => {
      const address = Array.isArray(to) ? to[0] : to
      if (address === 'sam@acme.com') {
        return { success: false, error: 'Held back by the email allowlist (1 recipient).', suppressedCount: 1 }
      }
      return { success: true }
    })

    const res = await portalInvites(jsonReq('/api/portal/invites', {
      emails: ['business@tahi.studio', 'sam@acme.com'],
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      invited: number
      suppressed: string[]
      results: Array<{ email: string; invited: boolean; withheld?: boolean }>
    }
    expect(body.invited).toBe(1)
    expect(body.suppressed).toEqual(['sam@acme.com'])
    expect(body.results.find(r => r.email === 'sam@acme.com')?.withheld).toBe(true)

    // Only the invited colleague gets a waiting contact row.
    expect(contactRows()).toHaveLength(1)
    expect(contactRows()[0]).toMatchObject({ email: 'business@tahi.studio' })

    // Every send named the org and the seat-invite template, whether it was
    // withheld or not: the allowlist decides delivery, not what we tried to send.
    for (const [, , , , context] of sendEmailCalls()) {
      expect(context).toMatchObject({ template: 'seat-invite', orgId: 'org_acme' })
    }
  })
})
