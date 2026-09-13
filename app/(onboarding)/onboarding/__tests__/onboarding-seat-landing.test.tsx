/**
 * app/(onboarding)/onboarding/page.tsx - the seat branch.
 *
 * THE BUG THIS EXISTS FOR: Liam invited hello+test@liammiller.dev from the
 * portal People section. After signing up, the onboarding page asked which
 * plan he wanted (the new-client chooser) instead of putting him inside the
 * invited org - POST /api/portal/accept-invite never ran, because the page's
 * old invite-consuming branch only fired for an invite carrying a `persona`,
 * which a seat invite never has.
 *
 * These tests call the async page function directly and assert on what it
 * does for a seat invite: accept immediately and redirect to /continue (never
 * render the wizard), or - on a mismatch/expired/used invite - render the
 * plain problem screen instead of the wizard. redirect() is mocked to THROW,
 * mirroring Next's real control-flow redirect: if the seat branch's redirect
 * were still (bug-prone) nested inside a catch-all try block, this throw
 * would be silently swallowed and the test would see the wizard render
 * instead - which is exactly the regression this guards against.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`REDIRECT:${url}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectSignal(url)
  }),
}))

const { authState, inviteState, seatState, acceptState } = vi.hoisted(() => ({
  authState: { userId: 'user_new', orgId: null as string | null, isPreviewingClient: false },
  inviteState: { value: null as Record<string, unknown> | null },
  seatState: { value: false },
  acceptState: { value: { ok: true, orgId: 'org_acme', clerkOrgId: 'clerk_org_1' } as Record<string, unknown> },
}))

vi.mock('@/lib/view-audience', () => ({
  getViewAudience: vi.fn().mockImplementation(() => Promise.resolve(authState)),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    users: {
      getUser: vi.fn().mockResolvedValue({
        publicMetadata: {},
        emailAddresses: [],
        primaryEmailAddressId: null,
        firstName: '', lastName: '',
      }),
    },
  }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/onboarding-invites', () => ({
  resolveInvite: vi.fn().mockImplementation(() => Promise.resolve(inviteState.value)),
  isSeatInvite: vi.fn().mockImplementation(() => Promise.resolve(seatState.value)),
  acceptClientInvite: vi.fn().mockImplementation(() => Promise.resolve(acceptState.value)),
}))

vi.mock('@/lib/org-onboarding-server', () => ({
  resolveAndStampOrgOnboarding: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/onboarding-lead-server', () => ({
  loadStudioLead: vi.fn().mockResolvedValue({ first: 'Liam', img: null, initials: 'LM' }),
}))

import OnboardingPage from '@/app/(onboarding)/onboarding/page'

interface RenderedElement {
  type: unknown
  props: Record<string, unknown>
}

function invite(overrides: Record<string, unknown> = {}) {
  return {
    flow: 'client',
    orgId: 'org_acme',
    persona: null,
    contactEmail: 'hello+test@liammiller.dev',
    companyName: 'Blah Blah Inc',
    expired: false,
    used: false,
    ...overrides,
  }
}

describe('OnboardingPage: seat branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.userId = 'user_new'
    authState.orgId = null
    inviteState.value = null
    seatState.value = false
    acceptState.value = { ok: true, orgId: 'org_acme', clerkOrgId: 'clerk_org_1' }
  })

  it('accepts a seat invite and redirects to /continue - never the wizard', async () => {
    inviteState.value = invite()
    seatState.value = true

    await expect(
      OnboardingPage({ searchParams: Promise.resolve({ token: 'tok_1' }) }),
    ).rejects.toThrow('REDIRECT:/continue')
  })

  it('shows the wrong-account screen, not the wizard, on an email mismatch', async () => {
    inviteState.value = invite()
    seatState.value = true
    acceptState.value = { ok: false, status: 403, error: 'This invite was sent to a different email address.' }

    const page = (await OnboardingPage({
      searchParams: Promise.resolve({ token: 'tok_1' }),
    })) as unknown as RenderedElement

    expect(page.props.headline).toBe('This invite needs a different account.')
    expect(page.props.message).toContain('hello+test@liammiller.dev')
  })

  it('shows the expired/used screen, not the wizard, when the accept lib refuses', async () => {
    inviteState.value = invite()
    seatState.value = true
    acceptState.value = { ok: false, status: 410, error: 'This invite has expired' }

    const page = (await OnboardingPage({
      searchParams: Promise.resolve({ token: 'tok_1' }),
    })) as unknown as RenderedElement

    expect(page.props.headline).toBe('This invite is no longer valid.')
  })

  it('falls through to the existing wizard for a first-contact invite (not a seat)', async () => {
    inviteState.value = invite({ persona: 'existing_retainer' })
    seatState.value = false

    const page = (await OnboardingPage({
      searchParams: Promise.resolve({ token: 'tok_1' }),
    })) as unknown as RenderedElement

    // The fragment's first child is <OnboardingContent>, never <InviteProblem>.
    const children = page.props.children as RenderedElement[]
    const first = Array.isArray(children) ? children[0] : children
    expect((first as RenderedElement).props).toHaveProperty('entry')
    expect((first as RenderedElement).props).toHaveProperty('inviteToken', 'tok_1')
  })
})
