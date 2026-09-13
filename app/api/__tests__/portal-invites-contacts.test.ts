/**
 * POST /api/portal/invites - the contact row a second seat later claims.
 *
 * Inviting a colleague used to only ever create a Clerk organization
 * invitation, so the person arrived with a login and no `contacts` row to be.
 * Nothing then linked them: no portal role, no notifications, messages
 * stamped with a raw Clerk id. The route now mints its own app invite token
 * (lib/onboarding-invites.ts, mocked here) and sends it through sendEmail
 * (lib/email.ts), and writes the waiting row, deny by default, which is what
 * lib/contact-link-server.ts claims on their first dashboard load.
 *
 * Pinned: a row per newly invited address, no duplicate for someone already on
 * the org, no row for an address the send failed for, the write scoped to the
 * caller's own org, and a D1 failure never losing an invite the email has
 * already carried.
 *
 * Also pinned, and the reason this route is no longer the soft way in: it is
 * WORKSPACE ADMIN ONLY, the same gate POST /api/portal/people applies. The two
 * routes now do the same thing, so a plain member could otherwise add an
 * outsider to the roster here and get exactly what the sibling route refuses.
 *
 * The allowlist edge (a withheld address gets no row, and the batch reports it
 * as such) has its own spec in app/api/__tests__/clerk-invite-allowlist.test.ts,
 * alongside the two sibling routes that dropped the same Clerk call.
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

vi.mock('@/lib/onboarding-invites', () => ({
  ensureClientInvite: vi.fn().mockResolvedValue({
    id: 'inv_1',
    token: 'tok_1',
    path: '/onboarding?token=tok_1',
    link: 'https://portal.tahi.studio/onboarding?token=tok_1',
    expiresAt: '2026-10-01T00:00:00.000Z',
    reused: false,
  }),
}))

const sendState = { failFor: new Set<string>(), calls: [] as Record<string, unknown>[] }

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockImplementation((to: string, subject: string, react: unknown, text: unknown, context: Record<string, unknown>) => {
    sendState.calls.push({ to, subject, context })
    if (sendState.failFor.has(to)) {
      return Promise.resolve({ success: false, error: 'Failed to send' })
    }
    return Promise.resolve({ success: true })
  }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, inArray: stub, desc: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', name: 'name', portalRole: 'portal_role', clerkUserId: 'clerk_user_id' },
    organisations: { __table: 'organisations', id: 'id', name: 'name' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  // Terminal at `where` (the roster read) or at `limit` (the admin-gate probe,
  // the org-name read, the caller-name read).
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

/**
 * The admin-gate probe answers first, then the roster read, then the org-name
 * and caller-name reads the email needs for its subject and "invited by" line.
 */
const ADMIN_CALLER = [{ portalRole: 'admin' }]
const ORG_ROW = [{ name: 'Acme Co' }]
const CALLER_NAME = [{ name: 'Ana Owner' }]
function queue(roster: Record<string, unknown>[] = [], caller = ADMIN_CALLER) {
  captured.selectRows = [caller, roster, ORG_ROW, CALLER_NAME]
}

describe('POST /api/portal/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    captured.insertThrows = false
    sendState.failFor = new Set()
    sendState.calls = []
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

  it('writes no row for an address the send failed for', async () => {
    queue()
    sendState.failFor = new Set(['sam@acme.com'])

    const res = await POST(makeRequest(['raj@acme.com', 'sam@acme.com']))
    const json = await res.json() as { invited: number }
    expect(json.invited).toBe(1)
    expect(contacts().map(r => r.email)).toEqual(['raj@acme.com'])
  })

  it('keeps the invite the email has already carried when the contact write fails', async () => {
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
    // Neither half of the invitation happened: no email sent, no roster row.
    expect(sendState.calls).toHaveLength(0)
    expect(contacts()).toHaveLength(0)
  })

  it('refuses a session with no contact row at all', async () => {
    queue([], [])

    const res = await POST(makeRequest(['outsider@x.com']))
    expect(res.status).toBe(403)
    expect(sendState.calls).toHaveLength(0)
    expect(contacts()).toHaveLength(0)
  })

  it('does not re-invite someone who already has portal access', async () => {
    // On the roster AND linked to a Clerk user: they are already in, so there
    // is nothing to invite them to.
    queue([{ email: 'raj@acme.com', clerkUserId: 'user_raj' }])

    const res = await POST(makeRequest(['Raj@Acme.com', 'sam@acme.com']))
    const json = await res.json() as { invited: number; results: { email: string; invited: boolean }[] }
    expect(json.invited).toBe(1)
    expect(sendState.calls.map(c => c.to)).toEqual(['sam@acme.com'])
    expect(contacts().map(r => r.email)).toEqual(['sam@acme.com'])
  })

  it('still invites a roster entry that has never signed in', async () => {
    // A contact the studio added by hand has a row but no login. Sending them
    // the invite is the whole point of this route.
    queue([{ email: 'raj@acme.com', clerkUserId: null }])

    const res = await POST(makeRequest(['raj@acme.com']))
    const json = await res.json() as { invited: number }
    expect(json.invited).toBe(1)
    expect(sendState.calls.map(c => c.to)).toEqual(['raj@acme.com'])
    // No second row: the one already there is what they will claim.
    expect(contacts()).toHaveLength(0)
  })

  it('sends with the seat-invite template and this org, whatever the address', async () => {
    queue()

    await POST(makeRequest(['raj@acme.com']))
    expect(sendState.calls[0].context).toMatchObject({ template: 'seat-invite', orgId: 'org_acme' })
  })
})
