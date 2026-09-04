/**
 * POST /api/admin/clients/[id]/welcome-email - the welcome email IS the invite.
 *
 * The old route pointed its CTA at the bare portal root with no token, so a
 * migrated client who followed it signed up, joined nothing, and self
 * provisioned an empty workspace while their real data sat in an org they could
 * never reach. It also went to one contact and swallowed every outcome.
 *
 * Pinned here: the PRIMARY contact and only them by default (the payload is a
 * claimable access token now, and a migrated client can carry an AP mailbox and
 * a designer who left, so a fan-out has to be asked for), `all: true` fans out,
 * `contactId` targets one, each link carries a live invite bound to its own
 * recipient with the address and expiry rendered in the email, a live invite is
 * reused rather than re-minted, the caller learns what actually happened, and
 * the org gate, feature gate and access scoping all fail closed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  inserts: Record<string, unknown>[]
} = { selectRows: [], inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, desc: stub, isNull: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: { __table: 'organisations', id: 'id', name: 'name', planType: 'plan_type' },
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', name: 'name', isPrimary: 'is_primary' },
    onboardingInvites: {
      __table: 'onboarding_invites', id: 'id', orgId: 'org_id',
      contactEmail: 'contact_email', usedAt: 'used_at', createdAt: 'created_at',
    },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  // Terminal at `where` (contact list), `limit` (org) or `orderBy` (invites).
  chain.where = vi.fn(() => {
    const p = answer() as Promise<unknown[]> & { limit?: unknown; orderBy?: unknown }
    return Object.assign(p, { limit: vi.fn(() => p), orderBy: vi.fn(() => p) })
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((row: Record<string, unknown>) => {
          captured.inserts.push({ __table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { POST } from '@/app/api/admin/clients/[id]/welcome-email/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { sendEmail } from '@/lib/email'

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/clients/org_acme/welcome-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'org_acme' }) }
const ORG = [{ id: 'org_acme', name: 'Acme Corp', planType: 'scale' }]
const invites = () => captured.inserts.filter(r => r.__table === 'onboarding_invites')

interface WelcomeResponse {
  error?: string
  success?: boolean
  sent?: number
  total?: number
  results?: { contactId: string; email: string; sent: boolean; link: string; error?: string }[]
}

describe('POST /api/admin/clients/[id]/welcome-email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.inserts = []
    process.env.NEXT_PUBLIC_APP_URL = 'https://portal.tahi.studio'
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
    })
    vi.mocked(requireAccessToOrg).mockResolvedValue(null)
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
  })

  it('sends to the primary contact only by default', async () => {
    captured.selectRows = [
      ORG,
      [
        { id: 'c_2', email: 'raj@acme.com', name: 'Raj Patel', isPrimary: false },
        { id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: true },
      ],
      [], // no live invite for jane
    ]

    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(200)
    const json = await res.json() as WelcomeResponse

    // Raj is first in the roster and still gets nothing: a live access token
    // goes to the person the studio nominated, not to everyone on file.
    expect(json.total).toBe(1)
    expect(json.results?.[0].email).toBe('jane@acme.com')
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(invites()).toHaveLength(1)
    expect(invites()[0].contactEmail).toBe('jane@acme.com')
    // A retainer client is already engaged, so no payment step.
    expect(invites()[0].persona).toBe('existing_retainer')
    expect(json.results?.[0].link).toContain('/onboarding?token=')
  })

  it('tells the email which address the link is bound to and when it expires', async () => {
    captured.selectRows = [
      ORG,
      [{ id: 'c_1', email: 'Jane@Acme.com', name: 'Jane Smith', isPrimary: true }],
      [],
    ]

    await POST(makeRequest(), params)
    const element = vi.mocked(sendEmail).mock.calls[0][2] as {
      props: { boundEmail?: string | null; expiresAt?: string | null; dashboardUrl: string }
    }
    // Without these the template cannot explain a 410 or a 403 to the person
    // holding the link, which is the whole point of a self-diagnosing invite.
    expect(element.props.boundEmail).toBe('jane@acme.com')
    expect(Date.parse(element.props.expiresAt ?? '')).toBeGreaterThan(Date.now())
    expect(element.props.dashboardUrl).toContain('/onboarding?token=')
  })

  it('falls back to the first contact when nobody is flagged primary', async () => {
    captured.selectRows = [
      ORG,
      [
        { id: 'c_2', email: 'raj@acme.com', name: 'Raj Patel', isPrimary: false },
        { id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: false },
      ],
      [],
    ]

    const res = await POST(makeRequest(), params)
    const json = await res.json() as WelcomeResponse
    expect(json.total).toBe(1)
    expect(json.results?.[0].email).toBe('raj@acme.com')
  })

  it('fans out to every contact only when all is asked for', async () => {
    captured.selectRows = [
      ORG,
      [
        { id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: true },
        { id: 'c_2', email: 'raj@acme.com', name: 'Raj Patel', isPrimary: false },
      ],
      [], // no live invite for jane
      [], // no live invite for raj
    ]

    const res = await POST(makeRequest({ all: true }), params)
    expect(res.status).toBe(200)
    const json = await res.json() as WelcomeResponse

    expect(json.sent).toBe(2)
    expect(json.total).toBe(2)
    expect(invites()).toHaveLength(2)
    // Each token is bound to its own recipient: a forwarded link is useless.
    expect(invites().map(i => i.contactEmail).sort()).toEqual(['jane@acme.com', 'raj@acme.com'])
    expect(sendEmail).toHaveBeenCalledTimes(2)
    for (const result of json.results ?? []) {
      expect(result.link).toContain('/onboarding?token=')
    }
  })

  it('reuses a live invite instead of invalidating the one already sent', async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString()
    captured.selectRows = [
      ORG,
      [{ id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: true }],
      [{ id: 'inv_1', token: 'live-token', flow: 'client', expiresAt: future, usedAt: null }],
    ]

    const res = await POST(makeRequest(), params)
    const json = await res.json() as WelcomeResponse
    expect(invites()).toHaveLength(0)
    expect(json.results?.[0].link).toContain('token=live-token')
  })

  it('can target a single contact', async () => {
    captured.selectRows = [
      ORG,
      [
        { id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: true },
        { id: 'c_2', email: 'raj@acme.com', name: 'Raj Patel', isPrimary: false },
      ],
      [],
    ]

    const res = await POST(makeRequest({ contactId: 'c_2' }), params)
    const json = await res.json() as WelcomeResponse
    expect(json.total).toBe(1)
    expect(json.results?.[0].email).toBe('raj@acme.com')
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('reports a total delivery failure rather than claiming success', async () => {
    captured.selectRows = [
      ORG,
      [{ id: 'c_1', email: 'jane@acme.com', name: 'Jane Smith', isPrimary: true }],
      [],
    ]
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured' })

    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(502)
    const json = await res.json() as WelcomeResponse
    expect(json.success).toBe(false)
    expect(json.results?.[0].error).toContain('RESEND_API_KEY')
    // The link is still handed back so the operator can send it by hand.
    expect(json.results?.[0].link).toContain('/onboarding?token=')
  })

  it('400s when the client has nobody with an email', async () => {
    captured.selectRows = [ORG, []]
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('404s an unknown client', async () => {
    captured.selectRows = [[]]
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(404)
  })

  it('403s a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client', orgId: 'org_client', sessionId: 'sess_2',
    })
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the org is outside the caller access scope', async () => {
    vi.mocked(requireAccessToOrg).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('fails closed when the caller cannot see the clients feature', async () => {
    vi.mocked(requireFeature).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await POST(makeRequest(), params)
    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
