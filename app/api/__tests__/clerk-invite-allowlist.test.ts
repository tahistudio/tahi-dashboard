/**
 * Clerk is a second mail transport, and these three routes are where it fires.
 *
 * `clerk.organizations.createOrganizationInvitation` sends an invitation email
 * FROM CLERK'S OWN SYSTEMS to whatever address it is handed. It never touches
 * lib/email-delivery.ts, so the tahi.studio allowlist could not see it and did
 * not apply. That left three live paths from an authenticated session to a real
 * person's inbox while the studio believed the blackout was total:
 *
 *   - POST /api/admin/team/[id]/invite   any Tahi admin, address off the roster
 *   - POST /api/portal/people            any client admin, address typed in
 *   - POST /api/portal/invites           the same, in bulk
 *
 * Liam's rule, 2026-09-06: no real client and no teammate receives anything
 * from this system until he has verified it, staci@ and nathan@ included. That
 * has to be true of an invitation as much as of an invoice.
 *
 * Pinned here: each route asks the gate BEFORE minting, refuses with 409 rather
 * than a 502 (nothing is broken and retrying changes nothing), writes the
 * suppression row that makes the refusal provable, and lets an allowed address
 * through untouched.
 *
 * lib/__tests__/no-resend-bypass.test.ts holds the structural half: any file
 * that mints an invitation must also call guardOutboundAddress, so a fourth
 * route cannot appear without one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state = {
  selectRows: [] as unknown[][],
  inserts: [] as Row[],
  clerkCalls: [] as Row[],
}

/** The live policy these specs run against: the shipped default. */
const CLOSED_POLICY = {
  mode: 'allowlist' as const,
  allowedDomains: ['tahi.studio'],
  allowedOrgIds: [] as string[],
  allowedAddresses: ['business@tahi.studio'],
  blockedAddresses: ['staci@tahi.studio', 'nathan@tahi.studio'],
}

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    organizations: {
      createOrganizationInvitation: vi.fn().mockImplementation((arg: Row) => {
        state.clerkCalls.push(arg)
        return Promise.resolve(undefined)
      }),
    },
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, asc: stub, inArray: stub, desc: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', portalRole: 'portal_role', clerkUserId: 'clerk_user_id', name: 'name', isPrimary: 'is_primary' },
    teamMembers: { __table: 'team_members', id: 'id', name: 'name', email: 'email', clerkUserId: 'clerk_user_id' },
    settings: { __table: 'settings', key: 'key', value: 'value' },
    emailSuppressions: { __table: 'email_suppressions', createdAt: 'created_at' },
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

// The policy itself is read for real from lib/email-gate.ts against the mocked
// D1 above, which answers no settings rows, so the CLOSED DEFAULT applies. That
// is the point: these specs run against what ships, not against a fixture.
vi.mock('@/lib/require-permission', () => ({
  requireManagePermissions: vi.fn().mockResolvedValue({ denied: null }),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/app-url', () => ({ publicUrl: (p: string) => `https://portal.tahi.studio${p}` }))

import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'
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

const suppressions = () => state.inserts.filter(r => r.__table === 'email_suppressions')
const contactRows = () => state.inserts.filter(r => r.__table === 'contacts')

beforeEach(() => {
  vi.clearAllMocks()
  state.selectRows = []
  state.inserts = []
  state.clerkCalls = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
})

// ---------------------------------------------------------------------------
// POST /api/admin/team/[id]/invite
// ---------------------------------------------------------------------------

describe('POST /api/admin/team/[id]/invite', () => {
  const params = { params: Promise.resolve({ id: 'tm-1' }) }
  const post = () => jsonReq('/api/admin/team/tm-1/invite', {})

  function roster(email: string) {
    state.selectRows = [[{ id: 'tm-1', name: 'Nathan', email, clerkUserId: null }]]
  }

  it('refuses to mint an invitation for an address the gate withholds', async () => {
    roster('nathan@tahi.studio')

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(409)
    expect(state.clerkCalls).toHaveLength(0)
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('Held back by the email allowlist')
    expect(body.message).toContain('Clerk would email')
  })

  it('writes the suppression row that proves the refusal', async () => {
    roster('nathan@tahi.studio')

    await teamInvite(post(), params)

    expect(suppressions()).toHaveLength(1)
    expect(suppressions()[0]).toMatchObject({
      to: 'nathan@tahi.studio',
      template: 'clerk-org-invite',
      reason: 'address_blocked',
    })
  })

  it('refuses a teammate who is merely not on the address list', async () => {
    roster('someone@tahi.studio')

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(409)
    expect(suppressions()[0]).toMatchObject({ reason: 'not_in_allowlist' })
  })

  it('mints the invitation for an allowed address', async () => {
    roster('business@tahi.studio')

    const res = await teamInvite(post(), params)

    expect(res.status).toBe(200)
    expect(state.clerkCalls).toHaveLength(1)
    expect(state.clerkCalls[0]).toMatchObject({ emailAddress: 'business@tahi.studio' })
    expect(suppressions()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/portal/people
// ---------------------------------------------------------------------------

describe('POST /api/portal/people', () => {
  /** The admin-gate probe answers first, then the duplicate-email probe. */
  function primed() {
    state.selectRows = [[{ portalRole: 'admin' }], []]
  }

  it('refuses a colleague at the client own domain, and mints nothing', async () => {
    primed()

    const res = await portalPeople(jsonReq('/api/portal/people', {
      name: 'Sam',
      email: 'sam@acme.com',
    }))

    expect(res.status).toBe(409)
    expect(state.clerkCalls).toHaveLength(0)
    // No roster row either: a "Pending" chip must always map to a real
    // invitation, and there is not one.
    expect(contactRows()).toHaveLength(0)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Held back by the email allowlist')
  })

  it('logs it against the client, so the log answers "what have we withheld from them"', async () => {
    primed()

    await portalPeople(jsonReq('/api/portal/people', { email: 'sam@acme.com' }))

    expect(suppressions()[0]).toMatchObject({
      to: 'sam@acme.com',
      orgId: 'org_acme',
      template: 'clerk-org-invite',
    })
  })

  it('mints and rosters an allowed address', async () => {
    primed()

    const res = await portalPeople(jsonReq('/api/portal/people', {
      name: 'Liam',
      email: 'business@tahi.studio',
    }))

    expect(res.status).toBe(201)
    expect(state.clerkCalls).toHaveLength(1)
    expect(contactRows()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// POST /api/portal/invites
// ---------------------------------------------------------------------------

describe('POST /api/portal/invites', () => {
  /** The admin-gate probe answers first, then the roster read. */
  function primed(roster: Row[] = []) {
    state.selectRows = [[{ portalRole: 'admin' }], roster]
  }

  it('409s when the whole batch is withheld, so an empty result cannot read as success', async () => {
    primed()

    const res = await portalInvites(jsonReq('/api/portal/invites', {
      emails: ['sam@acme.com', 'raj@acme.com'],
    }))

    expect(res.status).toBe(409)
    expect(state.clerkCalls).toHaveLength(0)
    expect(contactRows()).toHaveLength(0)
    const body = await res.json() as { suppressed: string[] }
    expect(body.suppressed).toEqual(['sam@acme.com', 'raj@acme.com'])
    expect(suppressions()).toHaveLength(2)
  })

  it('invites the address that passes and withholds the rest, rather than failing whole', async () => {
    primed()

    const res = await portalInvites(jsonReq('/api/portal/invites', {
      emails: ['business@tahi.studio', 'sam@acme.com'],
    }))

    expect(res.status).toBe(200)
    expect(state.clerkCalls).toHaveLength(1)
    expect(state.clerkCalls[0]).toMatchObject({ emailAddress: 'business@tahi.studio' })

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
  })
})
