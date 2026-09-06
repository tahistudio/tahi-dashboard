/**
 * What Client view shows the studio, and what it still refuses to let them do.
 *
 * A preview swaps the org and keeps the operator's Clerk id, so every portal
 * read that matched a contacts row on that id resolved to nobody. On
 * /api/portal/profile that meant `contact: null, isAdmin: false`, and the
 * settings shell reads exactly those two fields, so People and Organisation
 * vanished from the one screen the preview exists to show. The studio was
 * looking at a portal no client has.
 *
 * The fix is identity on READS. The risk is that it becomes identity on WRITES,
 * so the second half of this file pins the boundary that must not move: a
 * read-only preview is still refused with the same string, an unopened route is
 * still refused in act mode, and an opened one still writes as the STUDIO with
 * its audit row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { op: string; col?: unknown; val?: unknown; parts?: unknown[] }

const TAHI_ORG = 'org_tahi'
const CLIENT_ORG = 'org_acme'

const state: { rows: Row[]; wheres: unknown[]; updates: Row[] } = {
  rows: [],
  wheres: [],
  updates: [],
}

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ op: 'eq', col, val }),
  and: (...parts: unknown[]): Op => ({ op: 'and', parts }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      id: 'contacts.id',
      orgId: 'contacts.orgId',
      clerkUserId: 'contacts.clerkUserId',
      name: 'contacts.name',
      email: 'contacts.email',
      role: 'contacts.role',
      phone: 'contacts.phone',
      isPrimary: 'contacts.isPrimary',
      portalRole: 'contacts.portalRole',
    },
    auditLog: 'auditLog',
  },
}))

vi.mock('@/lib/db', () => ({
  db: () =>
    Promise.resolve({
      select: () => ({
        from: () => ({
          where: (w: unknown) => {
            state.wheres.push(w)
            return { limit: () => Promise.resolve(state.rows) }
          },
        }),
      }),
      update: () => ({
        set: (row: Row) => ({
          where: () => {
            state.updates.push(row)
            return Promise.resolve(undefined)
          },
        }),
      }),
    }),
}))

import { GET as profileGet, PATCH as profilePatch } from '@/app/api/portal/profile/route'
import {
  ACTING_AUDIT_PREFIX,
  READ_ONLY_MESSAGE,
  authorFor,
  recordActingWrite,
  refusePreviewWrite,
} from '@/lib/acting-as'
import { getPortalAuth } from '@/lib/server-auth'
import type { ActingAsIdentity, PortalAuthResult } from '@/lib/server-auth'
import type { DB } from '@/db/d1'
import { NextRequest } from 'next/server'

interface ProfilePayload {
  contact: { id?: string; portalRole?: string | null; isPrimary?: boolean | number | null } | null
  orgId: string
  isAdmin: boolean
  preview: boolean
}

const PRIMARY_OWNER: Row = {
  id: 'contact_primary',
  name: 'Ana Owner',
  email: 'ana@acme.test',
  role: 'Founder',
  // The NOT NULL default, on the person who owns the workspace. The verdict
  // still has to read admin (lib/portal-access.ts primary-contact clause).
  portalRole: 'member',
  isPrimary: true,
  phone: null,
}

const PLAIN_MEMBER: Row = {
  id: 'contact_member',
  name: 'Bo Member',
  email: 'bo@acme.test',
  role: 'Designer',
  portalRole: 'member',
  isPrimary: false,
  phone: null,
}

/** The auth a real client session produces: no seat, no preview flag. */
function clientAuth(): PortalAuthResult {
  return {
    userId: 'user_bob',
    orgId: CLIENT_ORG,
    sessionId: 's',
    clerkOrgId: 'org_clerk_acme',
    impersonating: false,
  }
}

/** Read-only Client view: the org is the client's, the login is the studio's. */
function previewAuth(contactId: string | null = 'contact_primary'): PortalAuthResult {
  return {
    userId: 'user_liam',
    orgId: CLIENT_ORG,
    sessionId: 's',
    clerkOrgId: TAHI_ORG,
    impersonating: true,
    contactId,
    previewContact: true,
  }
}

const ACTING: ActingAsIdentity = {
  adminUserId: 'user_liam',
  adminTeamMemberId: 'tm_liam',
  adminName: 'Liam Miller',
  orgId: CLIENT_ORG,
  contactId: 'contact_primary',
}

/** Act as client: the same seat, plus a proven grant. */
function actAuth(): PortalAuthResult {
  return { ...previewAuth(), canWriteAsClient: true, actingAs: ACTING }
}

function getReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/profile')
}

function patchReq(body: Row): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

/** The predicate the route handed the contacts select. */
function seatFilter(): Op[] {
  return ((state.wheres[0] as Op)?.parts ?? []) as Op[]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.rows = []
  state.wheres = []
  state.updates = []
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
})

describe('GET /api/portal/profile in Client view', () => {
  it('answers as the previewed seat, not as the operator', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    state.rows = [PRIMARY_OWNER]

    const res = await profileGet(getReq())
    expect(res.status).toBe(200)
    const json = (await res.json()) as ProfilePayload

    expect(json.contact?.id).toBe('contact_primary')
    // The whole point: the owner's verdict, so the settings shell paints
    // People and Organisation inside the preview.
    expect(json.isAdmin).toBe(true)
    expect(json.preview).toBe(true)

    // Resolved by seat id within the org, never by the studio login (which no
    // client org holds a row for).
    expect(seatFilter()).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: CLIENT_ORG },
      { op: 'eq', col: 'contacts.id', val: 'contact_primary' },
    ])
  })

  it('reports a member seat as a member, not as an admin', async () => {
    // Fidelity cuts both ways. If the seat being previewed cannot see People,
    // neither may the preview of it.
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth('contact_member'))
    state.rows = [PLAIN_MEMBER]

    const json = (await (await profileGet(getReq())).json()) as ProfilePayload
    expect(json.contact?.id).toBe('contact_member')
    expect(json.isAdmin).toBe(false)
    expect(json.preview).toBe(true)
  })

  it('says preview even when the org has nobody in it', async () => {
    // Previously indistinguishable from the bug: `contact: null` used to mean
    // "the operator's login matched nothing", which was always.
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth(null))
    state.rows = []

    const json = (await (await profileGet(getReq())).json()) as ProfilePayload
    expect(json.contact).toBeNull()
    expect(json.isAdmin).toBe(false)
    expect(json.preview).toBe(true)
    // With no seat it falls back to the login, which is the pre-existing
    // behaviour and still finds nothing.
    expect(seatFilter()).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: CLIENT_ORG },
      { op: 'eq', col: 'contacts.clerkUserId', val: 'user_liam' },
    ])
  })
})

describe('GET /api/portal/profile for a real client', () => {
  it('is unchanged: resolved by login, and not a preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(clientAuth())
    state.rows = [PRIMARY_OWNER]

    const json = (await (await profileGet(getReq())).json()) as ProfilePayload
    expect(json.isAdmin).toBe(true)
    expect(json.preview).toBe(false)
    expect(seatFilter()).toEqual([
      { op: 'eq', col: 'contacts.orgId', val: CLIENT_ORG },
      { op: 'eq', col: 'contacts.clerkUserId', val: 'user_bob' },
    ])
  })

  it('still refuses the Tahi org outright', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue({
      ...clientAuth(),
      orgId: TAHI_ORG,
    })
    expect((await profileGet(getReq())).status).toBe(403)
  })
})

describe('the write boundary, unmoved', () => {
  it('refuses PATCH /api/portal/profile in a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(previewAuth())
    const res = await profilePatch(patchReq({ name: 'Renamed By The Studio' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(state.updates).toEqual([])
  })

  it('refuses PATCH /api/portal/profile in act mode too', async () => {
    // Profile is not an opened route. Act mode opens routes one at a time
    // through lib/acting-as.ts, and editing a named client person's own name,
    // role and phone is not one of them.
    vi.mocked(getPortalAuth).mockResolvedValue(actAuth())
    const res = await profilePatch(patchReq({ name: 'Renamed By The Studio' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: READ_ONLY_MESSAGE })
    expect(state.updates).toEqual([])
  })

  it('still refuses every write in a read-only preview, seat or no seat', async () => {
    // The seat is read identity. It is not a grant, so carrying one must not
    // let an opted-in route through on the read-only side.
    const res = refusePreviewWrite(previewAuth(), { allowActing: true })
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: READ_ONLY_MESSAGE })
  })

  it('still lets a proven acting session through an opened route, as the studio', async () => {
    expect(refusePreviewWrite(actAuth(), { allowActing: true })).toBeNull()
    // And the row is attributed to the roster member, never to the seat the
    // read answered as: a row claiming a named client person said something
    // they did not say is the harm this mode exists to avoid.
    const author = authorFor(ACTING, 'contact_primary')
    expect(author).toEqual({ id: 'tm_liam', type: 'team_member' })
  })

  it('still records one acting audit row naming the same seat', async () => {
    const rows: Row[] = []
    const database = {
      insert: () => ({
        values: (row: Row) => {
          rows.push(row)
          return Promise.resolve(undefined)
        },
      }),
    } as unknown as DB

    await recordActingWrite(database, ACTING, {
      verb: 'request.created',
      entityType: 'request',
      entityId: 'r1',
      route: 'POST /api/portal/requests',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}request.created`)
    expect(rows[0].actorId).toBe('user_liam')
    const meta = JSON.parse(rows[0].metadata as string) as Record<string, unknown>
    // The seat in the trail is the seat the preview was reading as, so "what
    // did the studio do in this workspace" and "whose screen were they on"
    // answer with one person.
    expect(meta.contactId).toBe('contact_primary')
    expect(meta.adminTeamMemberId).toBe('tm_liam')
    expect(meta.mode).toBe('act')
  })
})
