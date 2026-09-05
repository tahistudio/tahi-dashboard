/**
 * Unit tests for /api/notifications.
 *
 * Two things the bell depends on:
 *   - the unread count is COUNTED, not derived from the 20 rows the popover
 *     renders (50 unread used to be read out as "20 unread"),
 *   - opening a request can clear that request's rows in one call, always
 *     scoped to the caller's own notifications.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op: string; col?: unknown; val?: unknown; parts?: unknown[] }

const state: {
  page: Row[]
  countRows: Row[]
  countWheres: Op[]
  updateWheres: Op[]
  limits: number[]
} = { page: [], countRows: [], countWheres: [], updateWheres: [], limits: [] }

vi.mock('@/lib/server-auth', () => ({ getRequestAuth: vi.fn() }))

vi.mock('@/db/d1', () => ({
  schema: {
    notifications: {
      id: 'notifications.id',
      userId: 'notifications.userId',
      read: 'notifications.read',
      entityType: 'notifications.entityType',
      entityId: 'notifications.entityId',
      createdAt: 'notifications.createdAt',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown): Op => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]): Op => ({ __op: 'and', parts }),
  desc: (col: unknown): Op => ({ __op: 'desc', col }),
  count: (): Op => ({ __op: 'count' }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    // A bare select() is the page; select({ n: count() }) is the tally.
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (w: Op) => {
          if (projection) {
            state.countWheres.push(w)
            return Promise.resolve(state.countRows)
          }
          return {
            orderBy: () => ({
              limit: (n: number) => {
                state.limits.push(n)
                return Promise.resolve(state.page)
              },
            }),
          }
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: (w: Op) => {
          state.updateWheres.push(w)
          return Promise.resolve(undefined)
        },
      }),
    }),
  }),
}))

import { GET, PATCH } from '@/app/api/notifications/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

type Auth = Awaited<ReturnType<typeof getRequestAuth>>

function auth(overrides: Partial<Auth> = {}): Auth {
  return { userId: 'user_1', orgId: 'org_1', sessionId: 'sess_1', ...overrides } as Auth
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost:3000/api/notifications', { method: 'GET' })
}

function makePatch(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Walk a captured `and(...)` for an eq(col, val). */
function whereHasEq(w: Op | undefined, col: unknown, val: unknown): boolean {
  if (!w) return false
  const parts = (w.parts ?? []) as Op[]
  return parts.some(p => p.__op === 'eq' && p.col === col && p.val === val)
}

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue(auth())
    state.page = []
    state.countRows = []
    state.countWheres = []
    state.updateWheres = []
    state.limits = []
  })

  it('reports the counted unread total, not the size of the page', async () => {
    // 20 rows returned, all read; 50 unread rows exist behind them.
    state.page = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, read: true }))
    state.countRows = [{ n: 50 }]

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: Row[]; unreadCount: number }
    expect(json.items).toHaveLength(20)
    expect(json.unreadCount).toBe(50)
    expect(state.limits).toEqual([20])
  })

  it('counts only the caller\'s unread rows', async () => {
    state.countRows = [{ n: 0 }]
    await GET(makeGet())
    const where = state.countWheres[0]
    expect(whereHasEq(where, 'notifications.userId', 'user_1')).toBe(true)
    expect(whereHasEq(where, 'notifications.read', false)).toBe(true)
  })

  it('reports zero when the count comes back empty', async () => {
    state.countRows = []
    const res = await GET(makeGet())
    const json = await res.json() as { unreadCount: number }
    expect(json.unreadCount).toBe(0)
  })

  it('401s without a user', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce(auth({ userId: null }))
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue(auth())
    state.updateWheres = []
  })

  it('clears every row pointing at one request, scoped to the caller', async () => {
    const res = await PATCH(makePatch({ entityType: 'request', entityId: 'r1' }))
    expect(res.status).toBe(200)
    const where = state.updateWheres[0]
    expect(whereHasEq(where, 'notifications.userId', 'user_1')).toBe(true)
    expect(whereHasEq(where, 'notifications.entityType', 'request')).toBe(true)
    expect(whereHasEq(where, 'notifications.entityId', 'r1')).toBe(true)
  })

  it('rejects a half-specified entity rather than clearing everything', async () => {
    const res = await PATCH(makePatch({ entityType: 'request' }))
    expect(res.status).toBe(400)
    expect(state.updateWheres).toHaveLength(0)
  })

  it('still marks a single row and the whole inbox', async () => {
    expect((await PATCH(makePatch({ id: 'n1' }))).status).toBe(200)
    expect((await PATCH(makePatch({ all: true }))).status).toBe(200)
    expect(state.updateWheres).toHaveLength(2)
  })

  it('400s on an unreadable body', async () => {
    const req = new NextRequest('http://localhost:3000/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('401s without a user', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce(auth({ userId: null }))
    const res = await PATCH(makePatch({ all: true }))
    expect(res.status).toBe(401)
  })
})
