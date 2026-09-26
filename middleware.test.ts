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
 *
 * WHY THE MODULE IS IMPORTED STATICALLY (LW.34). Loading middleware.ts pulls in
 * the real Clerk server package through importOriginal, which takes about
 * 250ms alone and 2.5s under a full parallel run. Every test used to do that
 * load itself with `await import('@/middleware')`, so the first test paid for
 * it inside its own 5 second budget, and while that import was still in
 * flight every later test awaited the SAME pending import and burned its own 5
 * seconds too: one slow load times out test after test (reproduced with a
 * deliberately slow module), which fits all eight going red at once on
 * 2026-09-14 while passing alone. A static import loads the module while the
 * file is collected, where no per-test timeout applies.
 *
 * The mocks are built in vi.hoisted so the factories below can hold them
 * directly, and every test starts from vi.resetAllMocks(): unlike
 * clearAllMocks, a reset also drops a queued `mockRejectedValueOnce` that a
 * failed or timed-out test never consumed, and puts each mock back on the
 * implementation it was created with, so no test inherits another's script.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import middlewareModule from '@/middleware'
import { targetToPath } from './workers/cron-trigger/src/schedule'

const { inviteState, seatState, resolveInvite, isSeatInvite, db } = vi.hoisted(() => {
  const inviteState: { value: Record<string, unknown> | null } = { value: null }
  const seatState: { value: boolean } = { value: false }
  return {
    inviteState,
    seatState,
    resolveInvite: vi.fn(() => Promise.resolve(inviteState.value)),
    isSeatInvite: vi.fn(() => Promise.resolve(seatState.value)),
    db: vi.fn(() => Promise.resolve({})),
  }
})

vi.mock('@clerk/nextjs/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clerk/nextjs/server')>()
  return {
    ...actual,
    // Identity: the handler middleware.ts builds becomes the module's own
    // default export, callable directly as `middleware(auth, req)` in tests.
    clerkMiddleware: (handler: unknown) => handler,
  }
})

vi.mock('@/lib/db', () => ({ db }))

vi.mock('@/lib/onboarding-invites', () => ({ resolveInvite, isSeatInvite }))

type FakeAuth = () => Promise<{ userId: string | null; orgId?: string | null }>
type MiddlewareHandler = (auth: FakeAuth, req: NextRequest) => Promise<NextResponse>

const middleware = middlewareModule as unknown as MiddlewareHandler

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
    vi.resetAllMocks()
    inviteState.value = null
    seatState.value = false
  })

  it('sends a signed-out visitor with no token to /sign-in, carrying redirect_url', async () => {
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

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('redirect_url')).toBe('/onboarding?token=tok_1')
  })

  it('sends a signed-out visitor with a SEAT token to /sign-up, carrying redirect_url', async () => {
    inviteState.value = invite()
    seatState.value = true // the org already has someone else on it

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-up')
    expect(location.searchParams.get('redirect_url')).toBe('/onboarding?token=tok_1')
  })

  it('sets the tahi-invite-token cookie on the redirect regardless of destination', async () => {
    inviteState.value = invite()
    seatState.value = true

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedOut(), req)

    expect(res.cookies.get('tahi-invite-token')?.value).toBe('tok_1')
  })

  it('falls back to /sign-in when the invite fails to resolve (fail-safe, never a hard failure)', async () => {
    resolveInvite.mockRejectedValueOnce(new Error('D1 unavailable'))

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_broken')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
  })

  it('falls back to /sign-in for a team invite (welcome flow untouched)', async () => {
    inviteState.value = invite({ flow: 'team', orgId: null })
    seatState.value = true

    const req = new NextRequest('https://portal.tahi.studio/welcome?token=tok_team')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(isSeatInvite).not.toHaveBeenCalled()
  })

  it('falls back to /sign-in for an expired invite', async () => {
    inviteState.value = invite({ expired: true })
    seatState.value = true

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_expired')
    const res = await middleware(signedOut(), req)

    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/sign-in')
    expect(isSeatInvite).not.toHaveBeenCalled()
  })

  it('passes a signed-in visitor straight through, still setting the cookie', async () => {
    inviteState.value = invite()
    seatState.value = true

    const req = new NextRequest('https://portal.tahi.studio/onboarding?token=tok_1')
    const res = await middleware(signedIn(), req)

    expect(res.headers.get('location')).toBeNull()
    expect(res.cookies.get('tahi-invite-token')?.value).toBe('tok_1')
  })
})

/**
 * Every scheduled target reaches its route handler.
 *
 * workers/cron-trigger POSTs each target with x-cron-secret and no Bearer, so
 * the Bearer bypass never applies: a target path that is missing from
 * isPublicRoute falls through to auth.protect(), which Clerk answers with a
 * 404 before the handler can check the secret. That is how the call-notes
 * suggester (/api/admin/crons/, plural) silently stopped running for four days
 * after the schedule moved off GitHub. Walking targetToPath here means a new
 * schedule entry cannot ship without its middleware line.
 */
describe('middleware: cron-trigger targets are public', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each(Object.entries(targetToPath))('lets the %s target through without a session', async (_target, path) => {
    const protect = vi.fn(() => Promise.reject(new Error('Clerk would 404 here')))
    const auth = Object.assign(signedOut(), { protect }) as FakeAuth
    const req = new NextRequest(`https://portal.tahi.studio/api/admin/${path}`, {
      method: 'POST',
      headers: { 'x-cron-secret': 'secret' },
    })

    const res = await middleware(auth, req)

    expect(protect).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })
})
