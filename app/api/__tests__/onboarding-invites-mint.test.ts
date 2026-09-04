/**
 * POST /api/admin/onboarding-invites - minting and delivering a client invite.
 *
 * The bug this covers: the mint route was correct and had zero product callers,
 * so onboarding a client meant hand-crafting a POST and the link was never
 * delivered. The route now has a send step, and these tests pin the contract
 * the client detail button and the MCP tool depend on:
 *   - the link carries the token and is absolute,
 *   - `send` is opt-in and its outcome is reported rather than swallowed,
 *   - a failed send still returns the minted link so the operator can copy it,
 *   - `reuse` hands back the live invite instead of invalidating the one
 *     already sitting in the contact's inbox,
 *   - the org gate, the feature gate and access scoping all fail closed.
 *
 * Fake D1: a chainable select whose terminal answers from `captured`, and an
 * insert that records the row. Same shape as the other route tests here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  inserts: Record<string, unknown>[]
  selectRows: unknown[][]
} = { inserts: [], selectRows: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
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

// The fake D1 hands string column names around, so the real operator builders
// would be comparing the wrong shapes. Stub them: this suite asserts on the
// rows written and the response, not on generated SQL.
vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, desc: stub, isNull: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    onboardingInvites: {
      id: 'id', token: 'token', flow: 'flow', orgId: 'org_id',
      contactEmail: 'contact_email', usedAt: 'used_at', createdAt: 'created_at',
    },
    organisations: { id: 'id', name: 'name' },
  },
}))

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  for (const method of ['from', 'leftJoin']) chain[method] = vi.fn(() => chain)
  // `where` is terminal for the invite lookup (no limit), and chains for the
  // org lookup, so it has to be thenable AND chainable.
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => answer())
  chain.limit = vi.fn(() => answer())
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => {
          captured.inserts.push(row)
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

import { POST } from '@/app/api/admin/onboarding-invites/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { sendEmail } from '@/lib/email'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/onboarding-invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ORG_ROW = [{ id: 'org_acme', name: 'Acme Corp' }]

function clientBody(extra: Record<string, unknown> = {}) {
  return {
    flow: 'client',
    orgId: 'org_acme',
    persona: 'existing_retainer',
    contactEmail: 'Jane@Acme.com',
    contactName: 'Jane Smith',
    ...extra,
  }
}

describe('POST /api/admin/onboarding-invites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.inserts = []
    captured.selectRows = []
    process.env.NEXT_PUBLIC_APP_URL = 'https://portal.tahi.studio'
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1',
    })
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(requireAccessToOrg).mockResolvedValue(null)
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
  })

  it('mints a token and returns an absolute link carrying it', async () => {
    captured.selectRows = [ORG_ROW]
    const res = await POST(makeRequest(clientBody()))
    expect(res.status).toBe(200)
    const json = await res.json() as { token: string; link: string; path: string; emailed: boolean }

    expect(json.token).toBeTruthy()
    expect(json.path).toBe(`/onboarding?token=${json.token}`)
    expect(json.link).toBe(`https://portal.tahi.studio/onboarding?token=${json.token}`)
    expect(captured.inserts).toHaveLength(1)
    // Bound to the invitee, lowercased, so accept-invite can compare it to the
    // Clerk-verified primary email.
    expect(captured.inserts[0].contactEmail).toBe('jane@acme.com')
    expect(captured.inserts[0].orgId).toBe('org_acme')
  })

  it('does not email unless send is asked for', async () => {
    captured.selectRows = [ORG_ROW]
    const res = await POST(makeRequest(clientBody()))
    const json = await res.json() as { emailed: boolean }
    expect(sendEmail).not.toHaveBeenCalled()
    expect(json.emailed).toBe(false)
  })

  it('emails the tokened link when send is true', async () => {
    captured.selectRows = [ORG_ROW]
    const res = await POST(makeRequest(clientBody({ send: true })))
    const json = await res.json() as { emailed: boolean; link: string }

    expect(json.emailed).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [to, subject] = vi.mocked(sendEmail).mock.calls[0]
    expect(to).toBe('Jane@Acme.com')
    expect(subject).toContain('Acme Corp')
  })

  it('reports a failed send and still hands back the link to copy', async () => {
    captured.selectRows = [ORG_ROW]
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured' })

    const res = await POST(makeRequest(clientBody({ send: true })))
    expect(res.status).toBe(200)
    const json = await res.json() as { emailed: boolean; emailError: string; link: string }
    expect(json.emailed).toBe(false)
    expect(json.emailError).toContain('RESEND_API_KEY')
    expect(json.link).toContain('/onboarding?token=')
  })

  it('reuse hands back the live invite instead of minting another', async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString()
    captured.selectRows = [
      ORG_ROW,
      [{ id: 'inv_1', token: 'live-token', flow: 'client', expiresAt: future, usedAt: null }],
    ]

    const res = await POST(makeRequest(clientBody({ reuse: true })))
    const json = await res.json() as { token: string; reused: boolean }
    expect(json.token).toBe('live-token')
    expect(json.reused).toBe(true)
    // Nothing new written: the link already in the inbox stays valid.
    expect(captured.inserts).toHaveLength(0)
  })

  it('reuse mints a fresh token when the only invite has expired', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    captured.selectRows = [
      ORG_ROW,
      [{ id: 'inv_1', token: 'stale-token', flow: 'client', expiresAt: past, usedAt: null }],
    ]

    const res = await POST(makeRequest(clientBody({ reuse: true })))
    const json = await res.json() as { token: string; reused: boolean }
    expect(json.token).not.toBe('stale-token')
    expect(json.reused).toBe(false)
    expect(captured.inserts).toHaveLength(1)
  })

  it('requires a contactEmail so the link can be bound to someone', async () => {
    const res = await POST(makeRequest({ flow: 'client', orgId: 'org_acme', persona: 'existing_project' }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('contactEmail')
    expect(captured.inserts).toHaveLength(0)
  })

  it('rejects an unknown persona', async () => {
    const res = await POST(makeRequest(clientBody({ persona: 'freeloader' })))
    expect(res.status).toBe(400)
    expect(captured.inserts).toHaveLength(0)
  })

  it('403s a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client', orgId: 'org_client', sessionId: 'sess_2',
    })
    const res = await POST(makeRequest(clientBody()))
    expect(res.status).toBe(403)
    expect(captured.inserts).toHaveLength(0)
  })

  it('fails closed when the caller cannot see the clients feature', async () => {
    vi.mocked(requireFeature).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await POST(makeRequest(clientBody()))
    expect(res.status).toBe(403)
    expect(captured.inserts).toHaveLength(0)
  })

  it('fails closed when the org is outside the caller access scope', async () => {
    captured.selectRows = [ORG_ROW]
    vi.mocked(requireAccessToOrg).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await POST(makeRequest(clientBody({ send: true })))
    expect(res.status).toBe(403)
    expect(captured.inserts).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('404s when the org does not exist', async () => {
    captured.selectRows = [[]]
    const res = await POST(makeRequest(clientBody()))
    expect(res.status).toBe(404)
    expect(captured.inserts).toHaveLength(0)
  })
})
