/**
 * View audience (client walk, BLOCKER 1: Client view rendered the studio's
 * /billing, /settings, /calls and /tasks inside the client shell, naming every
 * other client's plan and money).
 *
 * Claims under test: a Tahi session carrying the tahi-impersonate-org cookie
 * resolves to the CLIENT audience while keeping its real admin identity; the
 * cookie is inert on any other session, so nothing here can be used to reach a
 * surface a client could not already reach; and a plain studio session is
 * untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TAHI = 'org_tahi'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({ getServerAuth: vi.fn() }))

import { cookies } from 'next/headers'
import { getServerAuth } from '@/lib/server-auth'
import {
  IMPERSONATE_ORG_COOKIE,
  getViewAudience,
  resolveViewAudience,
} from '@/lib/view-audience'

describe('resolveViewAudience', () => {
  it('leaves a plain studio session on the studio audience', () => {
    const a = resolveViewAudience({
      userId: 'user_1', orgId: TAHI, tahiOrgId: TAHI, impersonateOrgId: null,
    })
    expect(a).toMatchObject({
      isAdmin: true,
      isPreviewingClient: false,
      previewOrgId: null,
      isClientAudience: false,
    })
  })

  it('flips a studio session carrying the Client view cookie to the client audience', () => {
    const a = resolveViewAudience({
      userId: 'user_1', orgId: TAHI, tahiOrgId: TAHI, impersonateOrgId: 'org_acme',
    })
    // Still the admin identity (permissions and admin APIs are unchanged);
    // only what the page should RENDER moves.
    expect(a.isAdmin).toBe(true)
    expect(a.isPreviewingClient).toBe(true)
    expect(a.previewOrgId).toBe('org_acme')
    expect(a.isClientAudience).toBe(true)
  })

  it('treats a real client as the client audience with no preview', () => {
    const a = resolveViewAudience({
      userId: 'user_2', orgId: 'org_acme_clerk', tahiOrgId: TAHI, impersonateOrgId: null,
    })
    expect(a).toMatchObject({
      isAdmin: false,
      isPreviewingClient: false,
      previewOrgId: null,
      isClientAudience: true,
    })
  })

  it('ignores the cookie on a non-Tahi session', () => {
    const a = resolveViewAudience({
      userId: 'user_2', orgId: 'org_acme_clerk', tahiOrgId: TAHI, impersonateOrgId: 'org_stride',
    })
    expect(a.isPreviewingClient).toBe(false)
    expect(a.previewOrgId).toBeNull()
    // A client forging the cookie gains nothing: they were already the client
    // audience, and no branch keys off previewOrgId to widen access.
    expect(a.isClientAudience).toBe(true)
  })

  it('ignores an empty or whitespace cookie value', () => {
    for (const raw of ['', '   ', undefined]) {
      const a = resolveViewAudience({
        userId: 'user_1', orgId: TAHI, tahiOrgId: TAHI, impersonateOrgId: raw,
      })
      expect(a.isPreviewingClient).toBe(false)
      expect(a.isClientAudience).toBe(false)
    }
  })

  it('is never the studio audience when the Tahi org id is unset', () => {
    const a = resolveViewAudience({
      userId: 'user_1', orgId: TAHI, tahiOrgId: undefined, impersonateOrgId: null,
    })
    expect(a.isAdmin).toBe(false)
    expect(a.isClientAudience).toBe(true)
  })

  it('reports no user for a signed-out caller', () => {
    const a = resolveViewAudience({
      userId: null, orgId: null, tahiOrgId: TAHI, impersonateOrgId: null,
    })
    expect(a.userId).toBeNull()
  })
})

describe('getViewAudience', () => {
  const previousOrg = process.env.NEXT_PUBLIC_TAHI_ORG_ID

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI
    vi.mocked(getServerAuth).mockResolvedValue({
      userId: 'user_1', orgId: TAHI, sessionId: 'sess_1',
    })
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = previousOrg
    vi.clearAllMocks()
  })

  function withCookie(value: string | undefined) {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (name === IMPERSONATE_ORG_COOKIE && value !== undefined
        ? { name, value }
        : undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>)
  }

  it('reads the Client view cookie and URL-decodes the org id', async () => {
    withCookie(encodeURIComponent('org acme/1'))
    const a = await getViewAudience()
    expect(a.isPreviewingClient).toBe(true)
    expect(a.previewOrgId).toBe('org acme/1')
    expect(a.isClientAudience).toBe(true)
  })

  it('is the studio audience with no cookie', async () => {
    withCookie(undefined)
    const a = await getViewAudience()
    expect(a.isPreviewingClient).toBe(false)
    expect(a.isClientAudience).toBe(false)
  })

  it('treats an unreadable cookie store as no preview', async () => {
    vi.mocked(cookies).mockRejectedValue(new Error('no request scope'))
    const a = await getViewAudience()
    expect(a.isPreviewingClient).toBe(false)
    expect(a.isAdmin).toBe(true)
  })
})
