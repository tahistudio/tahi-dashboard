/**
 * The workspace-admin gate on every portal WRITE path, asked of one helper.
 *
 * `contacts.portal_role` is NOT NULL DEFAULT 'member', and the flows that
 * create a workspace owner did not always name a role, so the owner of a
 * freshly provisioned client reads 'member' with is_primary = 1. Five write
 * routes tested that column directly, which meant a fresh owner could not
 * invite a teammate, edit their own organisation, manage brands, or ask to
 * change their retainer, in their own workspace.
 *
 * All five now gate on lib/portal-access.ts (isOrgAdmin / isPortalAdminContact):
 * portalRole 'admin', OR the org's primary contact. This spec pins both edges
 * per route, allowed and denied, plus the profile payload the settings sub-nav
 * reads so the browser never has to re-derive the verdict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlanCatalogEntry } from '@/lib/plan-catalog'

type Row = Record<string, unknown>

interface DbState {
  queues: Record<string, Row[][]>
  inserts: Row[]
  updates: Row[]
}

// ---------------------------------------------------------------------------
// Mocks (vi.mock factories are hoisted and cannot close over outer variables)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, asc: stub, desc: stub, inArray: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      _table: 'contacts',
      id: 'id',
      orgId: 'org_id',
      name: 'name',
      email: 'email',
      role: 'role',
      phone: 'phone',
      clerkUserId: 'clerk_user_id',
      isPrimary: 'is_primary',
      portalRole: 'portal_role',
      createdAt: 'created_at',
    },
    brands: {
      _table: 'brands',
      id: 'id',
      orgId: 'org_id',
      name: 'name',
      logoUrl: 'logo_url',
      website: 'website',
      primaryColour: 'primary_colour',
      notes: 'notes',
      createdAt: 'created_at',
    },
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    subscriptions: {
      _table: 'subscriptions',
      orgId: 'org_id',
      status: 'status',
      planType: 'plan_type',
      createdAt: 'created_at',
    },
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockResolvedValue({
    organizations: {
      createOrganizationInvitation: vi.fn().mockResolvedValue(undefined),
    },
  }),
}))

vi.mock('@/lib/email-gate', () => ({
  guardOutboundAddress: vi.fn().mockResolvedValue({ allowed: true, reason: '' }),
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({
    mode: 'all',
    allowedDomains: [],
    allowedOrgIds: [],
    allowedAddresses: [],
    blockedAddresses: [],
  }),
}))

vi.mock('@/lib/notifications', () => ({ notifyAllAdmins: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/plan-catalog', () => ({ loadPlanCatalog: vi.fn() }))

vi.mock('@/lib/db', () => {
  const state: DbState = { queues: {}, inserts: [], updates: [] }

  type Chain = Promise<Row[]> & {
    where: () => Chain
    limit: () => Chain
    orderBy: () => Chain
    innerJoin: () => Chain
  }

  function chainFor(rows: Row[]): Chain {
    const chain = Promise.resolve(rows) as Chain
    chain.where = () => chain
    chain.limit = () => chain
    chain.orderBy = () => chain
    chain.innerJoin = () => chain
    return chain
  }

  const tableName = (t: unknown) => (t as { _table?: string })?._table ?? 'unknown'

  const database = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        const queue = state.queues[tableName(table)] ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((row: Row) => {
        state.inserts.push({ _table: tableName(table), ...row })
        return Promise.resolve(undefined)
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((row: Row) => ({
        where: vi.fn(() => {
          state.updates.push({ _table: tableName(table), ...row })
          return Promise.resolve(undefined)
        }),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
  }

  return { db: vi.fn().mockResolvedValue(database), __mock: { state } }
})

// Imported after the mocks are registered.
import { POST as brandsPost } from '@/app/api/portal/brands/route'
import { PATCH as organisationPatch } from '@/app/api/portal/organisation/route'
import { POST as peoplePost, PATCH as peoplePatch } from '@/app/api/portal/people/route'
import { POST as invitesPost } from '@/app/api/portal/invites/route'
import { POST as changeRequestPost } from '@/app/api/portal/subscription/change-request/route'
import { GET as profileGet } from '@/app/api/portal/profile/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'
import { loadPlanCatalog } from '@/lib/plan-catalog'

const dbMock = (dbModule as unknown as { __mock: { state: DbState } }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_caller',
    orgId: 'org_acme',
    sessionId: 'sess_1',
    clerkOrgId: 'clerk_org_acme',
    impersonating: false,
    ...overrides,
  }
}

/** The three seats that matter, as the contacts row reads in D1. */
const EXPLICIT_ADMIN: Row = { portalRole: 'admin', isPrimary: false, name: 'Alex Admin' }
const FRESH_OWNER: Row = { portalRole: 'member', isPrimary: true, name: 'Ana Owner' }
const PLAIN_MEMBER: Row = { portalRole: 'member', isPrimary: false, name: 'Morgan Member' }

const CATALOG: PlanCatalogEntry[] = [
  { id: 'scale', name: 'Scale', tag: '', feats: [], rec: true, monthlyRate: 4000, trackRate: 1500 },
]

function jsonReq(path: string, body: Row, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost:3000' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getReq(path: string): NextRequest {
  return new NextRequest('http://localhost:3000' + path, { method: 'GET' })
}

/** Seed the caller's contact row, plus whatever else the route reads after it. */
function seed(caller: Row | null, extra: Partial<Record<string, Row[][]>> = {}) {
  dbMock.state.queues = {
    contacts: [caller ? [caller] : [], ...(extra.contacts ?? [])],
    organisations: extra.organisations ?? [[{ name: 'Acme Co' }]],
    subscriptions: extra.subscriptions ?? [[{ planType: 'maintain' }]],
    brands: extra.brands ?? [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  vi.mocked(loadPlanCatalog).mockResolvedValue(CATALOG)
  dbMock.state.queues = {}
  dbMock.state.inserts = []
  dbMock.state.updates = []
})

// ---------------------------------------------------------------------------
// The decision, per write route
// ---------------------------------------------------------------------------

describe('POST /api/portal/brands', () => {
  it('lets an explicit admin and a fresh owner create a brand', async () => {
    seed(EXPLICIT_ADMIN)
    expect((await brandsPost(jsonReq('/api/portal/brands', { name: 'Acme Main' }))).status).toBe(201)

    seed(FRESH_OWNER)
    const owner = await brandsPost(jsonReq('/api/portal/brands', { name: 'Acme Sub' }))
    expect(owner.status).toBe(201)
    expect(dbMock.state.inserts.filter(r => r._table === 'brands')).toHaveLength(2)
  })

  it('403s a plain member and a session with no contact row', async () => {
    seed(PLAIN_MEMBER)
    const member = await brandsPost(jsonReq('/api/portal/brands', { name: 'Nope' }))
    expect(member.status).toBe(403)
    expect((await member.json() as { error: string }).error).toBe('Only workspace admins can manage brands')

    seed(null)
    expect((await brandsPost(jsonReq('/api/portal/brands', { name: 'Nope' }))).status).toBe(403)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('PATCH /api/portal/organisation', () => {
  it('lets an explicit admin and a fresh owner rename their organisation', async () => {
    seed(EXPLICIT_ADMIN)
    expect(
      (await organisationPatch(jsonReq('/api/portal/organisation', { name: 'Acme Ltd' }, 'PATCH'))).status,
    ).toBe(200)

    seed(FRESH_OWNER)
    expect(
      (await organisationPatch(jsonReq('/api/portal/organisation', { name: 'Acme Group' }, 'PATCH'))).status,
    ).toBe(200)
    expect(dbMock.state.updates.filter(r => r._table === 'organisations')).toHaveLength(2)
  })

  it('403s a plain member and a session with no contact row', async () => {
    seed(PLAIN_MEMBER)
    const member = await organisationPatch(jsonReq('/api/portal/organisation', { name: 'Nope' }, 'PATCH'))
    expect(member.status).toBe(403)
    expect((await member.json() as { error: string }).error).toBe(
      'Only workspace admins can update the organisation',
    )

    seed(null)
    expect(
      (await organisationPatch(jsonReq('/api/portal/organisation', { name: 'Nope' }, 'PATCH'))).status,
    ).toBe(403)
    expect(dbMock.state.updates).toHaveLength(0)
  })
})

describe('POST /api/portal/people', () => {
  it('lets an explicit admin and a fresh owner invite a teammate', async () => {
    // Caller row, then the "is this email already on the roster" probe.
    seed(EXPLICIT_ADMIN, { contacts: [[]] })
    expect(
      (await peoplePost(jsonReq('/api/portal/people', { email: 'sam@acme.test' }))).status,
    ).toBe(201)

    seed(FRESH_OWNER, { contacts: [[]] })
    expect(
      (await peoplePost(jsonReq('/api/portal/people', { email: 'raj@acme.test' }))).status,
    ).toBe(201)
    expect(dbMock.state.inserts.filter(r => r._table === 'contacts')).toHaveLength(2)
  })

  it('403s a plain member and a session with no contact row', async () => {
    seed(PLAIN_MEMBER, { contacts: [[]] })
    const member = await peoplePost(jsonReq('/api/portal/people', { email: 'sam@acme.test' }))
    expect(member.status).toBe(403)
    expect((await member.json() as { error: string }).error).toBe(
      'Only workspace admins can invite teammates',
    )

    seed(null, { contacts: [[]] })
    expect(
      (await peoplePost(jsonReq('/api/portal/people', { email: 'sam@acme.test' }))).status,
    ).toBe(403)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('PATCH /api/portal/people', () => {
  it('counts the last admin through the same rule, so a primary owner counts', async () => {
    // Caller (fresh owner) -> target (a promoted teammate) -> the roster the
    // last-admin guard counts. The owner reads 'member' in portal_role, so a
    // `WHERE portal_role = 'admin'` count would see one admin and refuse.
    seed(FRESH_OWNER, {
      contacts: [
        [{ id: 'c_team', portalRole: 'admin', isPrimary: false }],
        [FRESH_OWNER, { portalRole: 'admin', isPrimary: false }],
      ],
    })
    const res = await peoplePatch(
      jsonReq('/api/portal/people', { id: 'c_team', portalRole: 'member' }, 'PATCH'),
    )
    expect(res.status).toBe(200)
    expect(dbMock.state.updates.filter(r => r._table === 'contacts')).toHaveLength(1)
  })

  it('still refuses to demote the only admin the workspace has', async () => {
    seed(EXPLICIT_ADMIN, {
      contacts: [
        [{ id: 'c_self', portalRole: 'admin', isPrimary: false }],
        [{ portalRole: 'admin', isPrimary: false }],
      ],
    })
    const res = await peoplePatch(
      jsonReq('/api/portal/people', { id: 'c_self', portalRole: 'member' }, 'PATCH'),
    )
    expect(res.status).toBe(409)
    expect(dbMock.state.updates).toHaveLength(0)
  })
})

describe('POST /api/portal/invites', () => {
  it('lets an explicit admin and a fresh owner send invitations', async () => {
    // Caller row, then the roster read.
    seed(EXPLICIT_ADMIN, { contacts: [[]] })
    const admin = await invitesPost(jsonReq('/api/portal/invites', { emails: ['sam@acme.test'] }))
    expect(admin.status).toBe(200)
    expect((await admin.json() as { invited: number }).invited).toBe(1)

    seed(FRESH_OWNER, { contacts: [[]] })
    const owner = await invitesPost(jsonReq('/api/portal/invites', { emails: ['raj@acme.test'] }))
    expect(owner.status).toBe(200)
    expect((await owner.json() as { invited: number }).invited).toBe(1)
  })

  it('403s a plain member and a session with no contact row', async () => {
    seed(PLAIN_MEMBER, { contacts: [[]] })
    const member = await invitesPost(jsonReq('/api/portal/invites', { emails: ['sam@acme.test'] }))
    expect(member.status).toBe(403)
    expect((await member.json() as { error: string }).error).toBe(
      'Only workspace admins can invite teammates',
    )

    seed(null, { contacts: [[]] })
    expect(
      (await invitesPost(jsonReq('/api/portal/invites', { emails: ['sam@acme.test'] }))).status,
    ).toBe(403)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('POST /api/portal/subscription/change-request', () => {
  it('lets an explicit admin and a fresh owner ask for a change', async () => {
    seed(EXPLICIT_ADMIN)
    expect(
      (await changeRequestPost(
        jsonReq('/api/portal/subscription/change-request', { kind: 'tracks', targetTracks: 2 }),
      )).status,
    ).toBe(200)

    seed(FRESH_OWNER)
    expect(
      (await changeRequestPost(
        jsonReq('/api/portal/subscription/change-request', { kind: 'plan', targetPlanId: 'scale' }),
      )).status,
    ).toBe(200)
  })

  it('403s a plain member and a session with no contact row', async () => {
    seed(PLAIN_MEMBER)
    const member = await changeRequestPost(
      jsonReq('/api/portal/subscription/change-request', { kind: 'tracks', targetTracks: 2 }),
    )
    expect(member.status).toBe(403)
    expect((await member.json() as { error: string }).error).toBe(
      'Only workspace admins can request plan changes',
    )

    seed(null)
    expect(
      (await changeRequestPost(
        jsonReq('/api/portal/subscription/change-request', { kind: 'tracks', targetTracks: 2 }),
      )).status,
    ).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// The read side: the browser must not have to guess
// ---------------------------------------------------------------------------

interface ProfilePayload {
  contact: { portalRole?: string | null; isPrimary?: boolean | number | null } | null
  orgId: string
  isAdmin: boolean
}

describe('GET /api/portal/profile', () => {
  it('returns portalRole and the server-decided isAdmin for a fresh owner', async () => {
    seed({ id: 'c1', name: 'Ana Owner', email: 'ana@acme.test', ...FRESH_OWNER })
    const res = await profileGet(getReq('/api/portal/profile'))
    expect(res.status).toBe(200)
    const json = await res.json() as ProfilePayload
    // The raw column still reads the NOT NULL default, and the verdict is still
    // admin. That gap is exactly what the settings sub-nav used to get wrong.
    expect(json.contact?.portalRole).toBe('member')
    expect(json.contact?.isPrimary).toBe(true)
    expect(json.isAdmin).toBe(true)
  })

  it('returns isAdmin true for an explicit admin and false for a member', async () => {
    seed({ id: 'c2', ...EXPLICIT_ADMIN })
    const admin = await profileGet(getReq('/api/portal/profile'))
    const adminJson = await admin.json() as ProfilePayload
    expect(adminJson.contact?.portalRole).toBe('admin')
    expect(adminJson.isAdmin).toBe(true)

    seed({ id: 'c3', ...PLAIN_MEMBER })
    const member = await profileGet(getReq('/api/portal/profile'))
    const memberJson = await member.json() as ProfilePayload
    expect(memberJson.contact?.portalRole).toBe('member')
    expect(memberJson.isAdmin).toBe(false)
  })

  it('reports a session with no contact row as not an admin', async () => {
    seed(null)
    const res = await profileGet(getReq('/api/portal/profile'))
    const json = await res.json() as ProfilePayload
    expect(json.contact).toBeNull()
    expect(json.isAdmin).toBe(false)
  })
})
