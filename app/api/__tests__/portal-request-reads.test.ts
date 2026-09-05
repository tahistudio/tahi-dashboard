/**
 * Unit tests for POST /api/portal/requests/[id]/reads - the client half of
 * read state.
 *
 * Contract:
 *   - Writes a request_reads row with userType 'contact' and the caller's
 *     Clerk user id, so the studio can see the client opened the thread.
 *   - Upserts: a second visit moves lastReadAt instead of adding a row.
 *   - The request is resolved org-scoped and non-internal, so a client can
 *     never stamp a receipt on somebody else's request or on a Tahi-internal
 *     one (asserted structurally on the captured where clause).
 *   - Tahi org / unauthenticated / impersonation are all 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op: string; col?: unknown; val?: unknown; parts?: unknown[] }

const state: {
  selectQueue: Row[][]
  selectWheres: Op[]
  inserts: Row[]
  updateSets: Row[]
} = { selectQueue: [], selectWheres: [], inserts: [], updateSets: [] }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      id: 'requests.id',
      orgId: 'requests.orgId',
      isInternal: 'requests.isInternal',
    },
    requestReads: {
      id: 'requestReads.id',
      requestId: 'requestReads.requestId',
      userId: 'requestReads.userId',
      userType: 'requestReads.userType',
      lastReadAt: 'requestReads.lastReadAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]): Op => ({ __op: 'and', parts }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: (w: Op) => {
          state.selectWheres.push(w)
          const rows = state.selectQueue.shift() ?? []
          return { limit: () => Promise.resolve(rows) }
        },
      }),
    }),
    insert: () => ({
      values: (row: Row) => {
        state.inserts.push(row)
        return Promise.resolve(undefined)
      },
    }),
    update: () => ({
      set: (patch: Row) => {
        state.updateSets.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  }),
}))

import { POST } from '@/app/api/portal/requests/[id]/reads/route'
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

function makePost(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/r1/reads', { method: 'POST' })
}

const ctx = { params: Promise.resolve({ id: 'r1' }) }

/** Walk a captured `and(...)` for an eq(col, val). */
function whereHasEq(w: Op | undefined, col: unknown, val: unknown): boolean {
  if (!w) return false
  const parts = (w.parts ?? []) as Op[]
  return parts.some(p => p.__op === 'eq' && p.col === col && p.val === val)
}

describe('POST /api/portal/requests/[id]/reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    state.selectQueue = []
    state.selectWheres = []
    state.inserts = []
    state.updateSets = []
  })

  it('writes a contact receipt for the caller on first read', async () => {
    state.selectQueue = [[{ id: 'r1' }], []]
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; lastReadAt: string }
    expect(json.ok).toBe(true)

    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      requestId: 'r1',
      userId: 'user_client',
      userType: 'contact',
    })
    expect(state.inserts[0].lastReadAt).toBe(json.lastReadAt)
    expect(state.updateSets).toHaveLength(0)
  })

  it('moves the existing receipt instead of adding a second row', async () => {
    state.selectQueue = [[{ id: 'r1' }], [{ id: 'read_1' }]]
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as { lastReadAt: string }

    expect(state.inserts).toHaveLength(0)
    expect(state.updateSets).toEqual([{ lastReadAt: json.lastReadAt }])
  })

  it('resolves the request org-scoped and non-internal', async () => {
    state.selectQueue = [[{ id: 'r1' }], []]
    await POST(makePost(), ctx)
    const requestWhere = state.selectWheres[0]
    expect(whereHasEq(requestWhere, 'requests.id', 'r1')).toBe(true)
    expect(whereHasEq(requestWhere, 'requests.orgId', 'org_client')).toBe(true)
    expect(whereHasEq(requestWhere, 'requests.isInternal', false)).toBe(true)
  })

  it('looks the receipt up by request, caller and contact type', async () => {
    state.selectQueue = [[{ id: 'r1' }], []]
    await POST(makePost(), ctx)
    const readWhere = state.selectWheres[1]
    expect(whereHasEq(readWhere, 'requestReads.requestId', 'r1')).toBe(true)
    expect(whereHasEq(readWhere, 'requestReads.userId', 'user_client')).toBe(true)
    expect(whereHasEq(readWhere, 'requestReads.userType', 'contact')).toBe(true)
  })

  it('404s and writes nothing when the request is not the caller\'s', async () => {
    state.selectQueue = [[]]
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(404)
    expect(state.inserts).toHaveLength(0)
    expect(state.updateSets).toHaveLength(0)
  })

  it('refuses the Tahi org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses an unauthenticated caller', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ userId: null }))
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })

  it('refuses to stamp a receipt while impersonating the client', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ impersonating: true }))
    const res = await POST(makePost(), ctx)
    expect(res.status).toBe(403)
    expect(state.inserts).toHaveLength(0)
  })
})
