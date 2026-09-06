/**
 * getPortalAuth and the seat a preview reads as.
 *
 * A preview swaps the ORG and nothing else: `userId` stays the operator's Clerk
 * id, and no client org has a contacts row for a Tahi login. Every portal read
 * that matched a contact on that id therefore resolved to nobody, which is why
 * /api/portal/profile answered `contact: null, isAdmin: false` and the portal
 * hid People and Organisation from the person previewing it.
 *
 * So `contactId` is now resolved for READS as well as for acting writes, and
 * from the same chooser, so the row the operator sees and the row an acting
 * write is recorded against are one seat. What must NOT move:
 *   - a real client session is untouched (no seat, no flag);
 *   - a non-previewing admin is untouched;
 *   - `impersonating` still stays true, so every unopened portal write keeps
 *     its 403;
 *   - a read still costs no acting resolution (resolvePermissions and the
 *     roster read are for writes only).
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
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: (...a: unknown[]) => resolvePermissions(...a),
}))
vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: (...a: unknown[]) => resolveTeamMember(...a),
  SERVICE_USER_ID: 'api-service',
}))
vi.mock('@/db/d1', () => ({
  schema: {
    teamMembers: { id: 'teamMembers.id', name: 'teamMembers.name', clerkUserId: 'teamMembers.clerkUserId' },
    contacts: {
      id: 'contacts.id',
      orgId: 'contacts.orgId',
      clerkUserId: 'contacts.clerkUserId',
      isPrimary: 'contacts.isPrimary',
    },
    organisations: { id: 'organisations.id', clerkOrgId: 'organisations.clerkOrgId' },
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  desc: (col: unknown) => ({ __op: 'desc', col }),
  and: (...parts: unknown[]) => ({ __op: 'and', parts }),
}))

/** Rows handed to the next select, in call order. */
const selectQueue: Record<string, unknown>[][] = []
let selectCount = 0
vi.mock('@/lib/db', () => ({
  db: () =>
    Promise.resolve({
      select: () => {
        selectCount += 1
        return {
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve(selectQueue.shift() ?? []),
              orderBy: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
            }),
          }),
        }
      },
    }),
}))

import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest } from 'next/server'
import { IMPERSONATE_MODE_COOKIE, IMPERSONATE_ORG_COOKIE } from '@/lib/preview-cookie'

function req(cookies: Record<string, string>, method = 'GET'): NextRequest {
  const jar = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return new NextRequest('http://localhost:3000/api/portal/profile', {
    method,
    headers: jar ? { cookie: jar } : {},
  })
}

const viewCookies = { [IMPERSONATE_ORG_COOKIE]: CLIENT_D1_ORG }
const actCookies = { ...viewCookies, [IMPERSONATE_MODE_COOKIE]: 'act' }

describe('getPortalAuth: preview identity on reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectQueue.length = 0
    selectCount = 0
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
    clerkAuth.mockResolvedValue({ userId: 'user_liam', orgId: TAHI_ORG, sessionId: 'sess_1' })
    resolvePermissions.mockResolvedValue({ isSuperAdmin: true })
    resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name: 'Liam Miller' })
  })

  it('names the previewed seat on a read-only Client view GET', async () => {
    selectQueue.push([{ id: 'contact_primary' }])
    const auth = await getPortalAuth(req(viewCookies))

    expect(auth.orgId).toBe(CLIENT_D1_ORG)
    expect(auth.contactId).toBe('contact_primary')
    expect(auth.previewContact).toBe(true)
    // A read is still a read. Nothing here arms a write.
    expect(auth.impersonating).toBe(true)
    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.actingAs).toBeUndefined()
    // And it still costs no acting resolution.
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(resolveTeamMember).not.toHaveBeenCalled()
  })

  it('costs exactly one select for the seat', async () => {
    // The reason act-mode identity is not resolved on reads is that it cost a
    // roster read, a roles join and two feature_visibility reads on every one
    // of the ~10 portal GETs a client overview fans out. The seat is a single
    // indexed lookup, which is the price of the preview being truthful.
    selectQueue.push([{ id: 'contact_primary' }])
    await getPortalAuth(req(viewCookies))
    expect(selectCount).toBe(1)
  })

  it('previews an org with nobody in it as a preview with no seat', async () => {
    // Distinguishable from a real client with no linked row: the flag is true
    // and the id is null, rather than both absent.
    const auth = await getPortalAuth(req(viewCookies))
    expect(auth.previewContact).toBe(true)
    expect(auth.contactId).toBeNull()
    expect(auth.impersonating).toBe(true)
  })

  it('leaves a real client session exactly as it was', async () => {
    clerkAuth.mockResolvedValue({ userId: 'user_bob', orgId: 'org_client', sessionId: 's' })
    selectQueue.push([{ id: CLIENT_D1_ORG }]) // their own org resolution
    const auth = await getPortalAuth(req(actCookies))

    expect(auth.impersonating).toBe(false)
    expect(auth.orgId).toBe(CLIENT_D1_ORG)
    // No seat and no flag: their routes go on resolving their own row by login.
    expect(auth.contactId).toBeUndefined()
    expect(auth.previewContact).toBeUndefined()
    expect(selectCount).toBe(1) // the org resolution, and nothing added
  })

  it('leaves a non-previewing admin exactly as it was', async () => {
    const auth = await getPortalAuth(req({}))
    expect(auth.orgId).toBe(TAHI_ORG)
    expect(auth.impersonating).toBe(false)
    expect(auth.contactId).toBeUndefined()
    expect(auth.previewContact).toBeUndefined()
    expect(selectCount).toBe(0)
  })

  it('gives an acting write the same seat the read answered as', async () => {
    // One chooser, one seat. If these could differ, an operator would work on
    // the screen of one person and leave an audit trail naming another.
    selectQueue.push([{ id: 'contact_primary' }])
    const auth = await getPortalAuth(req(actCookies, 'POST'))

    expect(auth.canWriteAsClient).toBe(true)
    expect(auth.contactId).toBe('contact_primary')
    expect(auth.previewContact).toBe(true)
    expect(auth.actingAs?.contactId).toBe('contact_primary')
    // Resolved once, not once per consumer.
    expect(selectCount).toBe(1)
    // The load-bearing property of act mode is untouched.
    expect(auth.impersonating).toBe(true)
    // And the author is still the studio member, never the seat.
    expect(auth.actingAs?.adminTeamMemberId).toBe('tm_liam')
  })

  it('still carries the seat when the act grant is refused', async () => {
    // A Tahi admin who is not a super admin keeps the read-only lens they had,
    // and the lens must still be pointed at somebody.
    resolvePermissions.mockResolvedValue({ isSuperAdmin: false })
    selectQueue.push([{ id: 'contact_primary' }])
    const auth = await getPortalAuth(req(actCookies, 'POST'))

    expect(auth.canWriteAsClient).toBeUndefined()
    expect(auth.impersonating).toBe(true)
    expect(auth.contactId).toBe('contact_primary')
    expect(auth.previewContact).toBe(true)
  })
})
