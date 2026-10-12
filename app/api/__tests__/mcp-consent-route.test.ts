/**
 * POST /api/mcp/consent. The browser form on /mcp/authorize posts here; the
 * route turns an Approve into a signed assertion for the worker callback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  nowSeconds,
  signIdentityEnvelope,
  verifyIdentityEnvelope,
} from '@/lib/mcp-identity'

const SECRET = 'test-secret-that-is-at-least-32-characters-long'
const CB = 'https://mcp.tahi.studio/authorize/callback'

const authState: { userId: string | null; orgId: string | null } = { userId: 'user_liam', orgId: 'org_tahi' }
const eligibilityState: { value: unknown } = { value: null }
const audit = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => ({ ...authState, sessionId: 'sess' })),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/audit', () => ({ logAudit: (...args: unknown[]) => audit(...args) }))
vi.mock('@/lib/mcp-profile-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mcp-profile-server')>('@/lib/mcp-profile-server')
  return { ...actual, resolveMcpConsentEligibility: vi.fn(async () => eligibilityState.value) }
})

import { POST } from '../mcp/consent/route'

async function consentRequest(cb = CB) {
  const now = nowSeconds()
  return signIdentityEnvelope(
    {
      typ: 'mcp_consent_request',
      cid: 'client_1',
      ruri: 'https://claude.ai/api/mcp/auth_callback',
      st: 'state1',
      cc: 'challenge',
      cb,
      nonce: 'nonce-123',
      iat: now,
      exp: now + 600,
    },
    SECRET,
  )
}

function post(fields: Record<string, string>, origin: string | null = 'https://portal.tahi.studio') {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (origin) headers.origin = origin
  return new NextRequest('https://portal.tahi.studio/api/mcp/consent', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields).toString(),
  })
}

const LIAM = {
  ok: true,
  member: { teamMemberId: 'tm_1', name: 'Liam', email: 'business@tahi.studio', clerkUserId: 'user_liam', profile: 'full' },
  profile: 'full',
}

beforeEach(() => {
  process.env.MCP_IDENTITY_SECRET = SECRET
  authState.userId = 'user_liam'
  authState.orgId = 'org_tahi'
  eligibilityState.value = LIAM
  audit.mockClear()
})

describe('POST /api/mcp/consent', () => {
  it('rejects a foreign origin', async () => {
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }, 'https://evil.example'))
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects a missing origin', async () => {
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }, null))
    expect(res.status).toBe(403)
  })

  it('rejects a service bearer', async () => {
    authState.userId = 'api-service'
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }))
    expect(res.status).toBe(403)
  })

  it('returns 401 with no session', async () => {
    authState.userId = null
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a bad req', async () => {
    const res = await POST(post({ req: 'not.valid', decision: 'approve' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a non-https callback', async () => {
    const res = await POST(post({ req: await consentRequest('http://mcp.tahi.studio/cb'), decision: 'approve' }))
    expect(res.status).toBe(400)
  })

  it('sends a deny back to the callback with access_denied', async () => {
    const req = await consentRequest()
    const res = await POST(post({ req, decision: 'deny' }))
    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(CB)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('req')).toBe(req)
    expect(location.searchParams.get('assertion')).toBeNull()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(['no_profile', 'not_studio'])('refuses an ineligible approver (%s)', async reason => {
    eligibilityState.value = { ok: false, reason }
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }))
    expect(res.status).toBe(403)
    expect(await res.text()).toContain(reason)
  })

  it('mints a verifiable assertion on approve and audits it', async () => {
    const req = await consentRequest()
    const res = await POST(post({ req, decision: 'approve' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.origin + location.pathname).toBe(CB)
    expect(location.searchParams.get('req')).toBe(req)
    const claims = await verifyIdentityEnvelope(location.searchParams.get('assertion'), SECRET, 'mcp_consent')
    expect(claims).toMatchObject({ tm: 'tm_1', cu: 'user_liam', p: 'full', nonce: 'nonce-123', name: 'Liam' })
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit.mock.calls[0][1]).toMatchObject({
      action: 'mcp.connector_approved',
      userId: 'user_liam',
      metadata: { teamMemberId: 'tm_1', profile: 'full', redirectHost: 'claude.ai' },
    })
  })

  it('still redirects when the audit write throws', async () => {
    audit.mockRejectedValueOnce(new Error('d1 down'))
    const res = await POST(post({ req: await consentRequest(), decision: 'approve' }))
    expect(res.status).toBe(303)
  })

  it('refuses everything when the secret is unusable', async () => {
    const req = await consentRequest()
    process.env.MCP_IDENTITY_SECRET = 'short'
    const res = await POST(post({ req, decision: 'approve' }))
    expect(res.status).toBe(400)
  })
})
