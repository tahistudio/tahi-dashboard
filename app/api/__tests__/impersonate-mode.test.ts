/**
 * /api/admin/impersonate/mode : the server's answer to "may I act as this
 * client", and the cookie it sets when the answer is yes.
 *
 * The cookie itself is forgeable from any console, so this route is not a lock.
 * It is the place the DECISION is made and explained, using the same rule
 * getPortalAuth applies to every write, so the UI and the write path can never
 * disagree about who may act. What the route must never do is say yes to
 * someone the write path would say no to.
 *
 * Disarming is deliberately ungated: whoever holds the cookie may always put it
 * down, exactly like the exit hatches next door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TAHI_ORG = 'org_tahi'
const CLIENT_ORG = '4f0d2c1a-8e77-4b31-9d2a-7c5b1e6a0f33'

const getRequestAuth = vi.fn()
const resolvePermissions = vi.fn()
const resolveTeamMember = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: (...a: unknown[]) => getRequestAuth(...a),
  isTahiAdmin: (orgId: string | null) => orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID,
}))
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: (...a: unknown[]) => resolvePermissions(...a),
}))
vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: (...a: unknown[]) => resolveTeamMember(...a),
}))
vi.mock('@/lib/db', () => ({ db: () => Promise.resolve({}) }))

import { GET, POST } from '@/app/api/admin/impersonate/mode/route'
import { NextRequest } from 'next/server'
import { IMPERSONATE_MODE_COOKIE, IMPERSONATE_ORG_COOKIE } from '@/lib/preview-cookie'

function req(method: string, body?: unknown, cookies: Record<string, string> = {}): NextRequest {
  const jar = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('http://localhost:3000/api/admin/impersonate/mode', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jar ? { cookie: jar } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

/** What the response tells the browser to store under the mode cookie. */
function modeCookie(res: Response): { value: string; maxAge?: number } | null {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  const match = raw.split(/,(?=[^;]+=)/).find(c => c.trim().startsWith(IMPERSONATE_MODE_COOKIE))
  if (!match) return null
  const value = match.trim().slice(IMPERSONATE_MODE_COOKIE.length + 1).split(';')[0]
  const age = /Max-Age=(-?\d+)/i.exec(match)
  return { value, ...(age ? { maxAge: Number(age[1]) } : {}) }
}

const previewing = { [IMPERSONATE_ORG_COOKIE]: CLIENT_ORG }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
  getRequestAuth.mockResolvedValue({ userId: 'user_liam', orgId: TAHI_ORG, sessionId: 's' })
  resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
  resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin' })
})

describe('POST /api/admin/impersonate/mode', () => {
  it('arms act mode for a super admin who is already previewing a client', async () => {
    const res = await POST(req('POST', { mode: 'act' }, previewing))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, mode: 'act', previewOrgId: CLIENT_ORG })
    expect(modeCookie(res)?.value).toBe('act')
  })

  it('refuses a Tahi admin who is not a super admin', async () => {
    resolvePermissions.mockResolvedValue({ isSuperAdmin: false })
    const res = await POST(req('POST', { mode: 'act' }, previewing))
    expect(res.status).toBe(403)
    expect(modeCookie(res)).toBeNull()
  })

  it('refuses a super admin with no team member row to attribute writes to', async () => {
    resolveTeamMember.mockResolvedValue(null)
    const res = await POST(req('POST', { mode: 'act' }, previewing))
    expect(res.status).toBe(403)
    expect(modeCookie(res)).toBeNull()
  })

  it('refuses a client session outright', async () => {
    getRequestAuth.mockResolvedValue({ userId: 'user_bob', orgId: 'org_client', sessionId: 's' })
    const res = await POST(req('POST', { mode: 'act' }, previewing))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(resolvePermissions).not.toHaveBeenCalled()
  })

  it('refuses to arm a mode with no client to aim it at', async () => {
    const res = await POST(req('POST', { mode: 'act' }))
    expect(res.status).toBe(400)
    expect(modeCookie(res)).toBeNull()
  })

  it('treats a junk preview cookie as no preview at all', async () => {
    const res = await POST(req('POST', { mode: 'act' }, { [IMPERSONATE_ORG_COOKIE]: 'short' }))
    expect(res.status).toBe(400)
  })

  it('rejects any mode other than the two it knows', async () => {
    for (const mode of ['ACT', 'acting', '', 1, true, null]) {
      const res = await POST(req('POST', { mode }, previewing))
      expect(res.status).toBe(400)
    }
  })

  it('disarms without asking anyone', async () => {
    // Putting the mode down must work even for a session that could never have
    // armed it, and even when the permission resolver is unavailable.
    resolvePermissions.mockRejectedValue(new Error('D1 unavailable'))
    const res = await POST(req('POST', { mode: 'view' }, previewing))
    expect(res.status).toBe(200)
    expect(modeCookie(res)?.maxAge).toBe(0)
  })

  it('fails closed when the permission resolver throws while arming', async () => {
    resolvePermissions.mockRejectedValue(new Error('D1 unavailable'))
    const res = await POST(req('POST', { mode: 'act' }, previewing))
    expect(res.status).toBe(500)
    expect(modeCookie(res)).toBeNull()
  })
})

describe('GET /api/admin/impersonate/mode', () => {
  it('reports the armed mode and the right to arm it', async () => {
    const res = await GET(req('GET', undefined, { ...previewing, [IMPERSONATE_MODE_COOKIE]: 'act' }))
    expect(await res.json()).toEqual({
      mode: 'act',
      previewOrgId: CLIENT_ORG,
      canAct: true,
      reason: null,
    })
  })

  it('reports view with a reason for an admin who may not act', async () => {
    resolvePermissions.mockResolvedValue({ isSuperAdmin: false })
    const res = await GET(req('GET', undefined, previewing))
    const body = await res.json() as { canAct: boolean; reason: string | null }
    expect(body.canAct).toBe(false)
    expect(body.reason).toContain('super admin')
  })

  it('reports view when the mode cookie is armed but no preview is open', async () => {
    // A mode with nothing to aim at is not a mode. The middleware sweeps it;
    // this route must not report it as live in the meantime.
    const res = await GET(req('GET', undefined, { [IMPERSONATE_MODE_COOKIE]: 'act' }))
    const body = await res.json() as { mode: string; previewOrgId: string | null }
    expect(body.mode).toBe('view')
    expect(body.previewOrgId).toBeNull()
  })

  it('is closed to a client session', async () => {
    getRequestAuth.mockResolvedValue({ userId: 'user_bob', orgId: 'org_client', sessionId: 's' })
    const res = await GET(req('GET', undefined, previewing))
    expect(res.status).toBe(403)
  })
})
