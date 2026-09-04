/**
 * Unit tests for PATCH /api/portal/requests/[id] - the ONLY client-writable
 * transition on a portal request.
 *
 * Contract:
 *   - A client of the owning org may move client_review -> delivered.
 *   - Every other target status is rejected (400) before any write.
 *   - A delivered target is rejected (400) unless the request is in
 *     client_review.
 *   - A request that does not resolve under the caller's own org yields 404
 *     (the select is org-scoped + non-internal), and that scoping is asserted
 *     structurally on the captured where clause.
 *   - Tahi org / unauthenticated / impersonation are all 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op: string; col?: unknown; val?: unknown; parts?: unknown[] }

const state: { rows: Row[]; selectWheres: Op[]; updateSets: Row[] } = {
  rows: [],
  selectWheres: [],
  updateSets: [],
}

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
// The client feature_visibility gate is covered in portal-feature-visibility.test.ts;
// stub it so this file keeps its minimal schema mock (no feature_visibility table).
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/notifications', () => ({ notifyTeamMember: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      id: 'requests.id',
      orgId: 'requests.orgId',
      title: 'requests.title',
      status: 'requests.status',
      assigneeId: 'requests.assigneeId',
      isInternal: 'requests.isInternal',
      deliveredAt: 'requests.deliveredAt',
      updatedAt: 'requests.updatedAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]): Op => ({ __op: 'and', parts }),
  asc: (col: unknown): Op => ({ __op: 'asc', col }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: (w: Op) => {
          state.selectWheres.push(w)
          return { limit: () => Promise.resolve(state.rows) }
        },
      }),
    }),
    update: () => ({
      set: (patch: Row) => {
        state.updateSets.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }),
}))

import { PATCH } from '@/app/api/portal/requests/[id]/route'
import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

function makePatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/r1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'r1' }) }

/** Walk a captured `and(...)` for an eq(col, val). */
function whereHasEq(w: Op | undefined, col: unknown, val: unknown): boolean {
  if (!w) return false
  const parts = (w.parts ?? []) as Op[]
  return parts.some(p => p.__op === 'eq' && p.col === col && p.val === val)
}

describe('PATCH /api/portal/requests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.rows = []
    state.selectWheres = []
    state.updateSets = []
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  })

  it('lets a client approve client_review -> delivered on their own org', async () => {
    state.rows = [{ id: 'r1', orgId: 'org_client', title: 'Homepage', status: 'client_review', assigneeId: 'tm1' }]
    const res = await PATCH(makePatch({ status: 'delivered' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, status: 'delivered' })

    // The write set the delivered status + stamped deliveredAt.
    expect(state.updateSets).toHaveLength(1)
    expect(state.updateSets[0].status).toBe('delivered')
    expect(state.updateSets[0].deliveredAt).toBeTruthy()

    // The lookup was scoped to the caller org and non-internal requests.
    expect(whereHasEq(state.selectWheres[0], 'requests.orgId', 'org_client')).toBe(true)
    expect(whereHasEq(state.selectWheres[0], 'requests.isInternal', false)).toBe(true)
  })

  it('rejects any target status other than delivered, without a write', async () => {
    for (const status of ['in_progress', 'client_review', 'submitted', 'archived']) {
      const res = await PATCH(makePatch({ status }), ctx)
      expect(res.status).toBe(400)
    }
    expect(state.updateSets).toHaveLength(0)
  })

  it('rejects delivered unless the request is currently in client_review', async () => {
    state.rows = [{ id: 'r1', orgId: 'org_client', title: 'Homepage', status: 'submitted', assigneeId: null }]
    const res = await PATCH(makePatch({ status: 'delivered' }), ctx)
    expect(res.status).toBe(400)
    expect(state.updateSets).toHaveLength(0)
  })

  it('cannot touch another org request: the org-scoped lookup misses -> 404', async () => {
    // Caller is org_client; the target belongs to org_other, so the scoped
    // select returns no row.
    state.rows = []
    const res = await PATCH(makePatch({ status: 'delivered' }), ctx)
    expect(res.status).toBe(404)
    expect(state.updateSets).toHaveLength(0)
    expect(whereHasEq(state.selectWheres[0], 'requests.orgId', 'org_client')).toBe(true)
  })

  it('returns 403 for the Tahi org, unauthenticated callers, and impersonation', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    expect((await PATCH(makePatch({ status: 'delivered' }), ctx)).status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ userId: null, orgId: null }))
    expect((await PATCH(makePatch({ status: 'delivered' }), ctx)).status).toBe(403)

    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ impersonating: true }))
    expect((await PATCH(makePatch({ status: 'delivered' }), ctx)).status).toBe(403)

    expect(state.updateSets).toHaveLength(0)
  })
})
