/**
 * DELETE /api/admin/subscriptions/[id]: removing a plan the client never
 * really had.
 *
 * Two prospects carried an active Scale subscription nothing was ever billed
 * against, minted at client creation before the sale closed. Cancelling keeps
 * the row for the books; this deletes it. Contract:
 *   - refused (409, one sentence) when any invoice references the subscription
 *   - refused (409, with the count) when any request sits on one of its
 *     tracks, whether as the track's current request or by requests.track_id
 *   - otherwise the tracks go, then the subscription, and the organisation
 *     drops to no plan when no other active subscription remains
 *   - an audit row records what went
 *   - the org verdict comes before any of that
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  sub: Row | null
  invoices: Row[]
  tracks: Row[]
  requestsOnTracks: Row[]
  otherActive: Row[]
  deletes: string[]
  updates: Array<{ table: string; patch: Row }>
} = { sub: null, invoices: [], tracks: [], requestsOnTracks: [], otherActive: [], deletes: [], updates: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    subscriptions: {
      __table: 'subscriptions',
      id: 'subscriptions.id',
      orgId: 'subscriptions.orgId',
      planType: 'subscriptions.planType',
      status: 'subscriptions.status',
    },
    invoices: { __table: 'invoices', id: 'invoices.id', subscriptionId: 'invoices.subscriptionId' },
    tracks: {
      __table: 'tracks',
      id: 'tracks.id',
      subscriptionId: 'tracks.subscriptionId',
      currentRequestId: 'tracks.currentRequestId',
    },
    requests: { __table: 'requests', id: 'requests.id', trackId: 'requests.trackId' },
    organisations: { __table: 'organisations', id: 'organisations.id', planType: 'organisations.planType' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]) => ({ __op: 'and', parts }),
  inArray: (col: unknown, vals: unknown[]) => ({ __op: 'inArray', col, vals }),
}))

const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'

/** Awaitable and chainable, so `.where()` and `.where().limit(1)` both work. */
function rows(result: Row[]) {
  return {
    limit: () => rows(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
}

function rowsFor(table: string, cond: { __op?: string }): Row[] {
  switch (table) {
    case 'subscriptions':
      // The lookup is `eq(id)`; the "any other active" check is `and(...)`.
      return cond.__op === 'and' ? state.otherActive : (state.sub ? [state.sub] : [])
    case 'invoices': return state.invoices
    case 'tracks': return state.tracks
    case 'requests': return state.requestsOnTracks
    default: return []
  }
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: { __op?: string }) => rows(rowsFor(tableName(table), cond)),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        state.deletes.push(tableName(table))
        return Promise.resolve(undefined)
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Row) => {
        state.updates.push({ table: tableName(table), patch })
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }),
}))

import { DELETE } from '@/app/api/admin/subscriptions/[id]/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'

const ctx = { params: Promise.resolve({ id: 'sub-1' }) }

function req(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/subscriptions/sub-1', { method: 'DELETE' })
}

beforeEach(() => {
  state.sub = { id: 'sub-1', orgId: 'org-1', planType: 'scale', status: 'active' }
  state.invoices = []
  state.tracks = [
    { id: 'trk-1', currentRequestId: null },
    { id: 'trk-2', currentRequestId: null },
  ]
  state.requestsOnTracks = []
  state.otherActive = []
  state.deletes = []
  state.updates = []
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  })
  vi.mocked(requireAccessToOrg).mockResolvedValue(null)
  vi.mocked(logAudit).mockClear()
})

describe('DELETE /api/admin/subscriptions/[id]', () => {
  it('404s an unknown subscription', async () => {
    state.sub = null
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(404)
    expect(state.deletes).toHaveLength(0)
  })

  it('refuses a plan that came across from ManyRequests, because it is the client history', async () => {
    state.sub = { id: 'sub-1', orgId: 'org-1', planType: 'hourly', status: 'active', manyrequestsId: '3:Glasswall Custom Retainer' }
    const res = await DELETE(req(), { params: Promise.resolve({ id: 'sub-1' }) })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('ManyRequests')
    expect(state.deletes).toHaveLength(0)
  })

  it('refuses when an invoice references the subscription, and deletes nothing', async () => {
    state.invoices = [{ id: 'inv-1' }, { id: 'inv-2' }]
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Cannot remove this plan: 2 invoices reference it. Cancel the subscription instead so the invoices keep their plan.')
    expect(state.deletes).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('reads as one invoice when there is one', async () => {
    state.invoices = [{ id: 'inv-1' }]
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('1 invoice references it')
  })

  it("refuses when a track's current request is set, saying how many", async () => {
    state.tracks = [{ id: 'trk-1', currentRequestId: 'req-9' }, { id: 'trk-2', currentRequestId: null }]
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Cannot remove this plan: 1 request sits on its tracks. Move them off the tracks first.')
    expect(state.deletes).toHaveLength(0)
  })

  it('counts requests whose track_id points at a track, without double counting the current one', async () => {
    state.tracks = [{ id: 'trk-1', currentRequestId: 'req-9' }, { id: 'trk-2', currentRequestId: null }]
    state.requestsOnTracks = [{ id: 'req-9' }, { id: 'req-10' }, { id: 'req-11' }]
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('3 requests sit on its tracks')
    expect(state.deletes).toHaveLength(0)
  })

  it('removes the empty tracks, then the subscription, and clears the plan when nothing else is active', async () => {
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; tracksRemoved: number; planCleared: boolean }
    expect(body).toEqual({ success: true, tracksRemoved: 2, planCleared: true })
    expect(state.deletes).toEqual(['tracks', 'subscriptions'])
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].table).toBe('organisations')
    expect(state.updates[0].patch).toMatchObject({ planType: 'none' })
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAudit).mock.calls[0][1]).toMatchObject({
      action: 'subscription.removed',
      userId: 'user_admin',
      entityType: 'subscription',
      entityId: 'sub-1',
      metadata: { orgId: 'org-1', planType: 'scale', tracksRemoved: 2, planCleared: true },
    })
  })

  it('skips the track delete when the subscription has no tracks', async () => {
    state.tracks = []
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(200)
    expect(state.deletes).toEqual(['subscriptions'])
    const body = await res.json() as { tracksRemoved: number }
    expect(body.tracksRemoved).toBe(0)
  })

  it('keeps the plan when another active subscription remains on the org', async () => {
    state.otherActive = [{ id: 'sub-2' }]
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(200)
    const body = await res.json() as { planCleared: boolean }
    expect(body.planCleared).toBe(false)
    expect(state.updates).toHaveLength(0)
    expect(state.deletes).toEqual(['tracks', 'subscriptions'])
  })

  it('answers 403 before looking at invoices or tracks when the caller cannot reach the org', async () => {
    state.invoices = [{ id: 'inv-1' }]
    vi.mocked(requireAccessToOrg).mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(403)
    expect(state.deletes).toHaveLength(0)
  })

  it('stays forbidden for a non-admin org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })
    const res = await DELETE(req(), ctx)
    expect(res.status).toBe(403)
    expect(state.deletes).toHaveLength(0)
  })
})
