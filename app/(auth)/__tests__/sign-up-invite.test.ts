/**
 * app/(auth)/sign-up - the invite-aware landing.
 *
 * A seat invite now lands a signed-out visitor here (middleware.ts
 * shouldLandOnSignUp), not on /sign-in, so this page has to do what /sign-in
 * used to leave to Clerk: read the invite token, prefill the bound email, and
 * - since an address that ALREADY has a Clerk account should sign IN, not
 * create a second one - look it up server-side and render SignIn instead.
 *
 * These tests call the async server component directly and inspect the
 * returned React element tree (no DOM, no ClerkProvider needed: the widgets
 * are never actually mounted, only referenced by `.type`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { cookieState, inviteState, userListState, getUserList } = vi.hoisted(() => ({
  cookieState: { token: undefined as string | undefined },
  inviteState: { value: null as Record<string, unknown> | null },
  userListState: { data: [] as unknown[] },
  getUserList: vi.fn(),
}))
getUserList.mockImplementation(() => Promise.resolve({ data: userListState.data }))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => Promise.resolve({
    get: (name: string) => (name === 'tahi-invite-token' && cookieState.token
      ? { value: cookieState.token }
      : undefined),
  })),
}))

vi.mock('@/lib/onboarding-invites', () => ({
  resolveInvite: vi.fn().mockImplementation(() => Promise.resolve(inviteState.value)),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({ users: { getUserList } }),
}))

import SignUpPage from '@/app/(auth)/sign-up/[[...sign-up]]/page'
import { ClerkSignIn, ClerkSignUp } from '@/components/tahi/clerk-mount'

interface RenderedElement {
  type: unknown
  props: { children?: RenderedElement; initialValues?: { emailAddress?: string }; path?: string }
}

function childOf(page: unknown): RenderedElement {
  return (page as RenderedElement).props.children as RenderedElement
}

describe('SignUpPage: invite-aware landing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieState.token = undefined
    inviteState.value = null
    userListState.data = []
  })

  it('renders a plain ClerkSignUp with no prefill when there is no invite token', async () => {
    const page = await SignUpPage({ searchParams: Promise.resolve({}) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignUp)
    expect(child.props.initialValues).toBeUndefined()
  })

  it('renders ClerkSignUp prefilled with the invite email when the address has no Clerk account', async () => {
    inviteState.value = {
      flow: 'client', orgId: 'org_acme', contactEmail: 'jane@acme.com',
      companyName: 'Acme Corp', expired: false,
    }
    userListState.data = []

    const page = await SignUpPage({ searchParams: Promise.resolve({ token: 'tok_1' }) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignUp)
    expect(child.props.initialValues).toEqual({ emailAddress: 'jane@acme.com' })
  })

  it('renders ClerkSignIn instead when the invite email already has a Clerk account', async () => {
    inviteState.value = {
      flow: 'client', orgId: 'org_acme', contactEmail: 'jane@acme.com',
      companyName: 'Acme Corp', expired: false,
    }
    userListState.data = [{ id: 'user_1' }]

    const page = await SignUpPage({ searchParams: Promise.resolve({ token: 'tok_1' }) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignIn)
    expect(child.props.initialValues).toEqual({ emailAddress: 'jane@acme.com' })
    // Mounted on the ACTUAL route (/sign-up), not the component's own default,
    // so Clerk's multi-step navigation builds the right step URL.
    expect(child.props.path).toBe('/sign-up')
    expect(getUserList).toHaveBeenCalledWith({ emailAddress: ['jane@acme.com'] })
  })

  it('falls back to the cookie when the query has no token (the post-redirect case)', async () => {
    cookieState.token = 'tok_cookie'
    inviteState.value = {
      flow: 'client', orgId: 'org_acme', contactEmail: 'jane@acme.com',
      companyName: 'Acme Corp', expired: false,
    }

    const page = await SignUpPage({ searchParams: Promise.resolve({}) })
    const child = childOf(page)
    expect(child.props.initialValues).toEqual({ emailAddress: 'jane@acme.com' })
  })

  it('ignores an expired invite and falls back to a plain sign-up', async () => {
    inviteState.value = {
      flow: 'client', orgId: 'org_acme', contactEmail: 'jane@acme.com', expired: true,
    }

    const page = await SignUpPage({ searchParams: Promise.resolve({ token: 'tok_1' }) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignUp)
    expect(child.props.initialValues).toBeUndefined()
  })

  it('never fails the page when the Clerk account-lookup errors: defaults to sign-up, still prefilled', async () => {
    // The invite itself resolved fine; only the "does this email already have
    // an account" check failed. Degrading to sign-up mode (rather than
    // guessing sign-in) is the safe default, and the invite's own email is
    // still worth prefilling.
    inviteState.value = { flow: 'client', orgId: 'org_acme', contactEmail: 'jane@acme.com', expired: false }
    getUserList.mockRejectedValueOnce(new Error('Clerk unavailable'))

    const page = await SignUpPage({ searchParams: Promise.resolve({ token: 'tok_1' }) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignUp)
    expect(child.props.initialValues).toEqual({ emailAddress: 'jane@acme.com' })
  })

  it('never fails the page when the invite fails to resolve at all', async () => {
    const database = await import('@/lib/db')
    vi.mocked(database.db).mockRejectedValueOnce(new Error('D1 unavailable'))

    const page = await SignUpPage({ searchParams: Promise.resolve({ token: 'tok_1' }) })
    const child = childOf(page)
    expect(child.type).toBe(ClerkSignUp)
    expect(child.props.initialValues).toBeUndefined()
  })
})
