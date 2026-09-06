/**
 * getPortalAuth and the Act as client cookie.
 *
 * The cookie is written by JavaScript in the operator's browser, so it is a
 * REQUEST, never a permission. Everything below is about what happens between
 * that request arriving and a write being allowed:
 *
 *   - a client who forges both cookies gains nothing (the org cookie already
 *     required a Tahi session; the mode inherits that);
 *   - a Tahi admin who is not a super admin is ignored;
 *   - a super admin with no team_members row is ignored, because an acting
 *     write has to be attributable to somebody on the roster;
 *   - and in every refusal the session stays a read-only preview rather than
 *     falling back to something more permissive.
 *
 * The property that matters most is the last assertion in the happy path:
 * `impersonating` stays TRUE in act mode. Roughly twenty-one portal writes
 * hand-roll `if (impersonating) 403`, and they must all go on refusing until a
 * route is deliberately opened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TAHI_ORG = 'org_tahi'
const CLIENT_D1_ORG = '4f0d2c1a-8e77-4b31-9d2a-7c5b1e6a0f33'

const clerkAuth = vi.fn()
const resolvePermissions = vi.fn()
const resolveTeamMember = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({ auth: () => clerkAuth() }))
vi.mock('@clerk/backend', () => ({ createClerkClient: () => ({}) }))
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve({ get: () => null }),
}))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: (...a: unknown[]) => resolvePermissions(...a) }))
vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: (...a: unknown[]) => resolveTeamMember(...a),
  SERVICE_USER_ID: 'api-service',
}))
vi.mock('@/db/d1', () => ({
  schema: {
    teamMembers: { id: 'teamMembers.id', name: 'teamMembers.name', clerkUserId: 'teamMembers.clerkUserId' },
    contacts: { id: 'contacts.id', orgId: 'contacts.orgId', isPrimary: 'contacts.isPrimary' },
    organisations: { id: 'organisations.id', clerkOrgId: 'organisations.clerkOrgId' },
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  desc: (col: unknown) => ({ __op: 'desc', col }),
}))

const selectQueue: Record<string, unknown>[][] = []
vi.mock('@/lib/db', () => ({
  db: () =>
    Promise.resolve({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectQueue.shift() ?? []),
            orderBy: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
          }),
        }),
      }),
    }),
}))

import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest } from 'next/server'
import { IMPERSONATE_MODE_COOKIE, IMPERSONATE_ORG_COOKIE } from '@/lib/preview-cookie'

/**
 * A request carrying whichever preview cookies the case is about.
 *
 * POST by default, because that is the only shape act mode is resolved for:
 * nothing reads `actingAs` on a GET, so getPortalAuth does not pay for one.
 */
function req(cookies: Record<string, string>, method = 'POST'): NextRequest {
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return new NextRequest('http://localhost:3000/api/portal/requests', {
    method,
    headers: jar ? { cookie: jar } : {},
  })
}

const actingCookies = {
  [IMPERSONATE_ORG_COOKIE]: CLIENT_D1_ORG,
  [IMPERSONATE_MODE_COOKIE]: 'act',
}

/**
 * The one read resolveActingIdentity still makes for itself: the org's primary
 * seat, for the audit metadata. The acting person's NAME rides on the roster
 * row `resolveTeamMember` already returned, rather than a second select
 * against the id that lookup just resolved.
 */
function queueIdentityReads(name = 'Liam Miller', contactId: string | null = 'contact_1') {
  resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name })
  selectQueue.push(contactId ? [{ id: contactId }] : [])
}

describe('getPortalAuth: Act as client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
    clerkAuth.mockResolvedValue({ userId: 'user_liam', orgId: TAHI_ORG, sessionId: 'sess_1' })
    resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
    resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name: 'Liam Miller' })
  })

  it('grants a super admin with a roster row, and keeps impersonating true', async () => {
    queueIdentityReads()
    const auth = await getPortalAuth(req(actingCookies))

    expect(auth.orgId).toBe(CLIENT_D1_ORG)
    expect(auth.clerkOrgId).toBe(TAHI_ORG)
    expect(auth.canWriteAsClient).toBe(true)
    expect(auth.actingAs).toEqual({
      adminUserId: 'user_liam',
      adminTeamMemberId: 'tm_liam',
      adminName: 'Liam Miller',
      orgId: CLIENT_D1_ORG,
      contactId: 'contact_1',
    })
    // The load-bearing one. Act mode does not stop being a preview, so every
    // unopened portal write keeps its 403.
    expect(auth.impersonating).toBe(true)
    // The Clerk user id is unchanged: only the org is swapped.
    expect(auth.userId).toBe('user_liam')
  })

  it('refuses a Tahi admin who is not a super admin', async () => {
    resolvePermissions.mockResolvedValue({ isSuperAdmin: false })
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.actingAs).toBeUndefined()
    // Still previewing, so they keep the read-only lens they had.
    expect(auth.impersonating).toBe(true)
    expect(auth.orgId).toBe(CLIENT_D1_ORG)
    expect(resolveTeamMember).not.toHaveBeenCalled()
  })

  it('refuses a super admin with no team_members row', async () => {
    // The MCP service token is the usual traveller here: verified by
    // TAHI_API_TOKEN, no roster row by design, so nobody to attribute to.
    resolveTeamMember.mockResolvedValue(null)
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.impersonating).toBe(true)
  })

  it('ignores the mode cookie for a client session, cookies and all', async () => {
    clerkAuth.mockResolvedValue({ userId: 'user_bob', orgId: 'org_client', sessionId: 's' })
    selectQueue.push([{ id: CLIENT_D1_ORG }]) // their own org resolution
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.impersonating).toBe(false)
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.actingAs).toBeUndefined()
    // Their own org, not the one the forged cookie named.
    expect(auth.orgId).toBe(CLIENT_D1_ORG)
    expect(resolvePermissions).not.toHaveBeenCalled()
  })

  it('does not even look for an identity in read-only preview', async () => {
    // The extra reads are paid only when the browser asks to act, so an
    // ordinary preview costs exactly what it did before this feature.
    const auth = await getPortalAuth(req({ [IMPERSONATE_ORG_COOKIE]: CLIENT_D1_ORG }))
    expect(auth.impersonating).toBe(true)
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(resolveTeamMember).not.toHaveBeenCalled()
  })

  it('does not resolve an identity for a READ, armed or not', async () => {
    // Nothing consumes `actingAs` on a GET: refusePreviewWrite and
    // actingIdentity are only ever called from POST / PATCH / PUT handlers.
    // Resolving anyway cost resolvePermissions (a roster read, a roles join
    // and two feature_visibility reads) plus the seat select on EVERY portal
    // read, and the client overview fires about ten of them in parallel, so
    // merely looking at a client while armed ran roughly seventy queries that
    // no reader consumed. HEAD rides with GET because Next serves it from the
    // GET handler.
    for (const method of ['GET', 'HEAD']) {
      vi.clearAllMocks()
      selectQueue.length = 0
      resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
      resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name: 'Liam Miller' })

      const auth = await getPortalAuth(req(actingCookies, method))

      // Still a preview, still scoped to the client, still read-only.
      expect(auth.impersonating).toBe(true)
      expect(auth.orgId).toBe(CLIENT_D1_ORG)
      expect(auth.canWriteAsClient).toBeUndefined()
      expect(auth.actingAs).toBeUndefined()
      expect(resolvePermissions).not.toHaveBeenCalled()
      expect(resolveTeamMember).not.toHaveBeenCalled()
    }
  })

  it('reads the acting name off the roster row rather than selecting it again', async () => {
    // resolveTeamMember already returns the row; asking `team_members` for the
    // name of the id it just resolved was a second round trip on every acting
    // write. The only select left is the org's primary seat.
    queueIdentityReads('Staci Bonnie')
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.actingAs?.adminName).toBe('Staci Bonnie')
    expect(selectQueue).toHaveLength(0)
  })

  it('ignores a mode cookie with no preview to aim at', async () => {
    const auth = await getPortalAuth(req({ [IMPERSONATE_MODE_COOKIE]: 'act' }))
    expect(auth.impersonating).toBe(false)
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.orgId).toBe(TAHI_ORG)
  })

  it('reads any non-literal mode value as read-only', async () => {
    for (const junk of ['ACT', 'true', '1', 'acting', '']) {
      vi.clearAllMocks()
      resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
      resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name: 'Liam Miller' })
      const auth = await getPortalAuth(
        req({ [IMPERSONATE_ORG_COOKIE]: CLIENT_D1_ORG, [IMPERSONATE_MODE_COOKIE]: junk }),
      )
      expect(auth.canWriteAsClient).toBeUndefined()
      expect(auth.impersonating).toBe(true)
    }
  })

  it('fails closed when the permission resolver throws', async () => {
    resolvePermissions.mockRejectedValue(new Error('D1 unavailable'))
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.impersonating).toBe(true)
  })

  it('still acts when the org has no contact row to name', async () => {
    // contactId is audit context, not an author. Its absence records "no named
    // seat" and must never block the write or substitute an author.
    queueIdentityReads('Staci Bonnie', null)
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.canWriteAsClient).toBe(true)
    expect(auth.actingAs?.contactId).toBeNull()
    expect(auth.actingAs?.adminName).toBe('Staci Bonnie')
  })

  it('falls back to a studio name rather than an empty byline', async () => {
    queueIdentityReads('   ', 'contact_1')
    const auth = await getPortalAuth(req(actingCookies))
    expect(auth.actingAs?.adminName).toBe('Tahi Studio')
  })
})
