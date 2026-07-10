/**
 * Unit tests for POST /api/portal/subscription/change-request.
 *
 * A client workspace admin asks to switch plan or change track count. The
 * route never mutates the subscription: it notifies every Tahi admin and
 * writes an audit entry, then the studio confirms by hand. Gates: portal
 * auth only (no Tahi org, no impersonation), client-admin contacts only,
 * and the requested plan must exist in the catalogue.
 *
 * We mock auth, db, notifications, audit, and the plan catalogue, then call
 * the handler directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlanCatalogEntry } from '@/lib/plan-catalog'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: { queues: Record<string, Row[][]> }
}

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/plan-catalog', () => ({
  loadPlanCatalog: vi.fn(),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: {
      _table: 'contacts',
      orgId: 'org_id',
      clerkUserId: 'clerk_user_id',
      portalRole: 'portal_role',
      name: 'name',
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

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {} }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }

  const select = vi.fn(() => ({
    from: (table: { _table?: string } | undefined) => {
      const queue = state.queues[table?._table ?? ''] ?? []
      return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
    },
  }))

  return {
    db: vi.fn().mockResolvedValue({ select }),
    __mock: { state },
  }
})

// Import after mocks are set up
import { POST } from '@/app/api/portal/subscription/change-request/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'
import { notifyAllAdmins } from '@/lib/notifications'
import { logAudit } from '@/lib/audit'
import { loadPlanCatalog } from '@/lib/plan-catalog'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client_admin',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

const CATALOG: PlanCatalogEntry[] = [
  { id: 'maintain', name: 'Maintain', tag: '', feats: [], rec: false, monthlyRate: 1500, trackRate: 1000 },
  { id: 'scale', name: 'Scale', tag: '', feats: [], rec: true, monthlyRate: 4000, trackRate: 1500 },
]

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/subscription/change-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function seed(opts: { contact?: Row[]; org?: Row[]; sub?: Row[] } = {}) {
  dbMock.state.queues = {
    contacts: [opts.contact ?? [{ portalRole: 'admin', name: 'Casey Client' }]],
    organisations: [opts.org ?? [{ name: 'Acme Co' }]],
    subscriptions: [opts.sub ?? [{ planType: 'maintain' }]],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/portal/subscription/change-request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    vi.mocked(loadPlanCatalog).mockResolvedValue(CATALOG)
    dbMock.state.queues = {}
  })

  it('returns 403 when unauthenticated, when called from the Tahi org, or when impersonating', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(
      portalAuth({ userId: null, orgId: null, clerkOrgId: null }),
    )
    const unauthenticated = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale' }))
    expect(unauthenticated.status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(
      portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }),
    )
    const tahiOrg = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale' }))
    expect(tahiOrg.status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ impersonating: true }))
    const impersonating = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale' }))
    expect(impersonating.status).toBe(403)
    const json = await impersonating.json() as { error?: string }
    expect(json.error).toBe('Read-only while viewing as a client')

    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a workspace admin contact', async () => {
    seed({ contact: [{ portalRole: 'member', name: 'Morgan Member' }] })
    const member = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale' }))
    expect(member.status).toBe(403)
    const json = await member.json() as { error?: string }
    expect(json.error).toBe('Only workspace admins can request plan changes')

    seed({ contact: [] })
    const noContact = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale' }))
    expect(noContact.status).toBe(403)

    expect(notifyAllAdmins).not.toHaveBeenCalled()
  })

  it('returns 400 for a bad kind, missing targets, and an unknown plan', async () => {
    seed()
    const badKind = await POST(makeRequest({ kind: 'downgrade' }))
    expect(badKind.status).toBe(400)

    seed()
    const noPlan = await POST(makeRequest({ kind: 'plan' }))
    expect(noPlan.status).toBe(400)
    const noPlanJson = await noPlan.json() as { error?: string }
    expect(noPlanJson.error).toBe('targetPlanId required for a plan change')

    seed()
    const noTracks = await POST(makeRequest({ kind: 'tracks' }))
    expect(noTracks.status).toBe(400)
    const noTracksJson = await noTracks.json() as { error?: string }
    expect(noTracksJson.error).toBe('targetTracks required for a track change')

    seed()
    const unknownPlan = await POST(makeRequest({ kind: 'plan', targetPlanId: 'enterprise' }))
    expect(unknownPlan.status).toBe(400)
    const unknownPlanJson = await unknownPlan.json() as { error?: string }
    expect(unknownPlanJson.error).toBe('Unknown plan')
    expect(loadPlanCatalog).toHaveBeenCalledTimes(1)

    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('notifies all admins and logs an audit entry for a plan change request', async () => {
    seed()

    const res = await POST(makeRequest({ kind: 'plan', targetPlanId: 'scale', note: '  Ready to grow  ' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(notifyAllAdmins).mock.calls[0][1]
    expect(payload.type).toBe('subscription_change_requested')
    expect(payload.entityType).toBe('organisation')
    expect(payload.entityId).toBe('org_client')
    expect(payload.title).toBe('Acme Co asked to switch to the Scale plan')
    expect(payload.body).toContain('Requested by Casey Client')
    expect(payload.body).toContain('Current plan: maintain.')
    expect(payload.body).toContain('Note: Ready to grow')

    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('subscription.change_requested')
    expect(entry.userId).toBe('user_client_admin')
    expect(entry.userType).toBe('contact')
    expect(entry.entityType).toBe('organisation')
    expect(entry.entityId).toBe('org_client')
    expect(entry.metadata).toMatchObject({
      kind: 'plan',
      targetPlanId: 'scale',
      targetTracks: null,
      note: 'Ready to grow',
      currentPlan: 'maintain',
    })
  })

  it('notifies all admins and logs an audit entry for a tracks change request', async () => {
    seed()

    const res = await POST(makeRequest({ kind: 'tracks', targetTracks: 2 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // Track changes never consult the plan catalogue.
    expect(loadPlanCatalog).not.toHaveBeenCalled()

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(notifyAllAdmins).mock.calls[0][1]
    expect(payload.type).toBe('subscription_change_requested')
    expect(payload.entityId).toBe('org_client')
    expect(payload.title).toBe('Acme Co asked to run 2 extra tracks')

    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('subscription.change_requested')
    expect(entry.metadata).toMatchObject({
      kind: 'tracks',
      targetPlanId: null,
      targetTracks: 2,
      note: null,
    })
  })
})
