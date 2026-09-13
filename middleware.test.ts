/**
 * middleware.ts - the invite-token entry redirect.
 *
 * THE BUG THIS EXISTS FOR: Liam invited hello+test@liammiller.dev from the
 * portal People section. The email's Accept invitation button lands a
 * signed-out visitor on /onboarding?token=..., and the middleware
 * unconditionally sent them to /sign-in, where Clerk answered "Couldn't find
 * your account" for an address with no Clerk user yet - there was nowhere to
 * create one from that screen.
 *
 * A seat invite (the invited org already has someone else on it - the admin
 * who sent the invite, an earlier teammate) must land on /sign-up instead,
 * decided from the org's OWN roster (lib/onboarding-invites.ts isSeatInvite),
 * never the token's flow string. A first-contact invite (a brand-new org,
 * nobody on it yet) keeps the existing /sign-in landing.
 *
 * `clerkMiddleware` is mocked to identity so the handler passed to it can be
 * called directly with a fake `auth()`; `createRouteMatcher` is left real
 * (via importOriginal) since it is pure path matching and middleware.ts relies
 * on it to decide /sign-in, /sign-up etc. are public routes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const inviteState: { value: Record<string, unknown> | null } = { value: null }
const seatState: { value: boolean } = { value: false }
const resolveInvite = vi.fn().mockImplementation(() => Promise.resolve(inviteState.value))
const isSeatInvite = vi.fn().mockImplementation(() => Promise.resolve(seatState.value))

vi.mock('@clerk/nextjs/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clerk/nextjs/server')>()
  return {
    ...actual,
    // Identity: the handler middleware.ts builds becomes the module's own
    // default export, callable directly as `middleware(auth, req)` in tests.
    clerkMiddleware: (handler: unknown) => handler,
  }
})

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/onboarding-invites', () => ({
  resolveInvite: (...args: unknown[]) => resolveInvite(...args),
  isSeatInvite: (...args: unknown[]) => isSeatInvite(...args),
}))

type FakeAuth = () => Promise<{ userId: string | null; orgId?: string | null }>
type MiddlewareHandler = (auth: FakeAuth, req: NextRequest) => Promise<NextResponse>

async function loadMiddleware(): Promise<MiddlewareHandler> {
  const mod = await import('@/middleware')
  return mod.default as unknown as MiddlewareHandler
}

function signedOut(): FakeAuth {
  return async () => ({ userId: null, orgId: null })
}

function signedIn(userId = 'user_1', orgId: string | null = 'org_client_1'): FakeAuth {
  return async () => ({ userId, orgId })
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    flow: 'client',
    orgId: 'org_acme',
    contactEmail: 'jane@acme.com',
    expired: false,
    used: false,
    ...overrides,
  }
}

describe('middleware: invite-token entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inviteState.value = null
    seatState.value = false
  })

  it('sends a signed-out visitor with no token to /sign-in, carrying redirect_url', async () => {
    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('redirect_url')).toBe('/onboarding')
    expect(resolveInvite).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor with a FIRST-CONTACT token to /sign-in (unchanged)', async () => {
    inviteState.value = invite()
    seatState.value = false // the org has nobody else on it yet

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('redirect_url')).toBe('/onboarding?token=tok_1')
  })

  it('sends a signed-out visitor with a SEAT token to /sign-up, carrying redirect_url', async () => {
    inviteState.value = invite()
    seatState.value = true // the org already has someone else on it

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-up')
    expect(location.searchParams.get('redirect_url')).toBe('/onboarding?token=tok_1')
  })

  it('sets the tahi-invite-token cookie on the redirect regardless of destination', async () => {
    inviteState.value = invite()
    seatState.value = true

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    expect(res.cookies.get('tahi-invite-token')?.value).toBe('tok_1')
  })

  it('falls back to /sign-in when the invite fails to resolve (fail-safe, never a hard failure)', async () => {
    resolveInvite.mockRejectedValueOnce(new Error('D1 unavailable'))

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_broken')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
  })

  it('falls back to /sign-in for a team invite (welcome flow untouched)', async () => {
    inviteState.value = invite({ flow: 'team', orgId: null })
    seatState.value = true

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/welcome?token=tok_team')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(isSeatInvite).not.toHaveBeenCalled()
  })

  it('falls back to /sign-in for an expired invite', async () => {
    inviteState.value = invite({ expired: true })
    seatState.value = true

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_expired')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(isSeatInvite).not.toHaveBeenCalled()
  })

  it('passes a signed-in visitor straight through, still setting the cookie', async () => {
    inviteState.value = invite()
    seatState.value = true

    const middleware = await loadMiddleware()
    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedIn(), req)

    expect(res.headers.get('location')).toBeNull()
    expect(res.cookies.get('tahi-invite-token')?.value).toBe('tok_1')
  })
})
