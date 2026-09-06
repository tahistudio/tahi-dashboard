/**
 * Unit tests for /api/notifications.
 *
 * What the bell and the /notifications page depend on:
 *   - the unread count is COUNTED, not derived from the rows the popover
 *     renders (50 unread used to be read out as "20 unread"),
 *   - opening a request can clear that request's rows in one call, always
 *     scoped to the caller's own notifications,
 *   - the page can walk history: limit / cursor / since / before / kind /
 *     unread, all still scoped to the caller,
 *   - the rail's counts are COUNTED too (?facets=true): per view and per kind,
 *     around the window boundary, and never narrowed by the kind or unread
 *     filter the reader is currently holding,
 *   - only a service-token caller may read on behalf of another user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op: string; col?: unknown; val?: unknown; vals?: unknown[]; parts?: unknown[] }

const state: {
  page: Row[]
  countRows: Row[]
  countWheres: Op[]
  selectWheres: Op[]
  updateWheres: Op[]
  limits: number[]
  orderBys: unknown[][]
  /** One entry per grouped facet read, in call order: recent then past. */
  facetPages: Row[][]
  groupByWheres: Op[]
  groupByCols: unknown[][]
} = {
  page: [], countRows: [], countWheres: [], selectWheres: [],
  updateWheres: [], limits: [], orderBys: [],
  facetPages: [], groupByWheres: [], groupByCols: [],
}

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
  or: (...parts: unknown[]): Op => ({ __op: 'or', parts }),
  desc: (col: unknown): Op => ({ __op: 'desc', col }),
  count: (): Op => ({ __op: 'count' }),
  lt: (col: unknown, val: unknown): Op => ({ __op: 'lt', col, val }),
  gte: (col: unknown, val: unknown): Op => ({ __op: 'gte', col, val }),
  inArray: (col: unknown, vals: unknown[]): Op => ({ __op: 'inArray', col, vals }),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    // A bare select() is the page; select({ n: count() }) is the tally.
    select: (projection?: Record<string, unknown>) => ({
      from: () => ({
        where: (w: Op) => {
          if (projection) {
            state.countWheres.push(w)
            // A projected read is either the unread tally (awaited straight
            // away) or a facet read (which chains .groupBy). One object
            // serves both.
            return Object.assign(Promise.resolve(state.countRows), {
              groupBy: (...cols: unknown[]) => {
                state.groupByWheres.push(w)
                state.groupByCols.push(cols)
                return Promise.resolve(state.facetPages.shift() ?? [])
              },
            })
          }
          state.selectWheres.push(w)
          return {
            orderBy: (...cols: unknown[]) => {
              state.orderBys.push(cols)
              return {
                limit: (n: number) => {
                  state.limits.push(n)
                  return Promise.resolve(state.page)
                },
              }
            },
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

function makeGet(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/notifications${query}`, { method: 'GET' })
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

/** Walk a captured `and(...)` for any op on a column. */
function whereOp(w: Op | undefined, op: string, col: unknown): Op | undefined {
  if (!w) return undefined
  const parts = (w.parts ?? []) as Op[]
  return parts.find(p => p.__op === op && p.col === col)
}

function reset() {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue(auth())
  state.page = []
  state.countRows = []
  state.countWheres = []
  state.selectWheres = []
  state.updateWheres = []
  state.limits = []
  state.orderBys = []
  state.facetPages = []
  state.groupByWheres = []
  state.groupByCols = []
}

describe('GET /api/notifications', () => {
  beforeEach(reset)

  it('reports the counted unread total, not the size of the page', async () => {
    // 20 rows returned, all read; 50 unread rows exist behind them.
    state.page = Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, read: true, createdAt: '2026-09-01T00:00:00.000Z' }))
    state.countRows = [{ n: 50 }]

    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: Row[]; unreadCount: number; hasMore: boolean }
    expect(json.items).toHaveLength(20)
    expect(json.unreadCount).toBe(50)
    expect(json.hasMore).toBe(false)
    // limit + 1, so hasMore is known without a second query.
    expect(state.limits).toEqual([21])
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

  it('honours limit, caps it at 100, and pages one row past it', async () => {
    await GET(makeGet('?limit=50'))
    expect(state.limits).toEqual([51])
    reset()
    await GET(makeGet('?limit=9999'))
    expect(state.limits).toEqual([101])
    reset()
    await GET(makeGet('?limit=banana'))
    expect(state.limits).toEqual([21])
  })

  it('hands back a composite cursor when there is another page', async () => {
    // 3 rows for a limit of 2: the extra row means hasMore.
    state.page = [
      { id: 'a', createdAt: '2026-09-03T10:00:00.000Z' },
      { id: 'b', createdAt: '2026-09-02T10:00:00.000Z' },
      { id: 'c', createdAt: '2026-09-01T10:00:00.000Z' },
    ]
    const res = await GET(makeGet('?limit=2'))
    const json = await res.json() as { items: Row[]; hasMore: boolean; nextCursor: string | null }
    expect(json.items).toHaveLength(2)
    expect(json.hasMore).toBe(true)
    // createdAt|id, not a bare timestamp: batch inserts can share a millisecond.
    expect(json.nextCursor).toBe('2026-09-02T10:00:00.000Z|b')
  })

  it('walks ties by ordering on createdAt then id, and asking for both in the cursor', async () => {
    await GET(makeGet('?cursor=' + encodeURIComponent('2026-09-02T10:00:00.000Z|b')))
    expect(state.orderBys[0]).toHaveLength(2)
    const where = state.selectWheres[0]
    const ors = (where.parts as Op[]).filter(p => p.__op === 'or')
    expect(ors).toHaveLength(1)
    const branches = (ors[0].parts ?? []) as Op[]
    expect(branches[0].__op).toBe('lt')
    expect(branches[0].col).toBe('notifications.createdAt')
    expect(branches[1].__op).toBe('and')
  })

  it('applies the since / before window', async () => {
    await GET(makeGet('?since=2026-08-01T00:00:00.000Z&before=2026-09-01T00:00:00.000Z'))
    const where = state.selectWheres[0]
    expect(whereOp(where, 'gte', 'notifications.createdAt')?.val).toBe('2026-08-01T00:00:00.000Z')
    expect(whereOp(where, 'lt', 'notifications.createdAt')?.val).toBe('2026-09-01T00:00:00.000Z')
  })

  it('ignores an unparseable window rather than widening it', async () => {
    await GET(makeGet('?since=not-a-date'))
    const where = state.selectWheres[0]
    expect(whereOp(where, 'gte', 'notifications.createdAt')).toBeUndefined()
  })

  it('expands a kind filter to its entity types', async () => {
    await GET(makeGet('?kind=invoice,document'))
    const op = whereOp(state.selectWheres[0], 'inArray', 'notifications.entityType')
    expect(op?.vals).toEqual(['invoice', 'contract', 'proposal', 'schedule'])
  })

  it('narrows to nothing on an unknown kind rather than returning everything', async () => {
    await GET(makeGet('?kind=nonsense'))
    const op = whereOp(state.selectWheres[0], 'inArray', 'notifications.entityType')
    expect(op?.vals).toEqual([])
  })

  it('filters to unread when asked', async () => {
    await GET(makeGet('?unread=true'))
    expect(whereHasEq(state.selectWheres[0], 'notifications.read', false)).toBe(true)
  })

  it('always scopes the page to the caller', async () => {
    await GET(makeGet('?limit=100&kind=request'))
    expect(whereHasEq(state.selectWheres[0], 'notifications.userId', 'user_1')).toBe(true)
  })

  it('403s a browser session that asks to read somebody else\'s feed', async () => {
    const res = await GET(makeGet('?userId=user_2'))
    expect(res.status).toBe(403)
    expect(state.selectWheres).toHaveLength(0)
  })

  it('lets the service token read on behalf of a named user', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue(auth({ userId: 'api-service', sessionId: null }))
    const res = await GET(makeGet('?userId=user_2'))
    expect(res.status).toBe(200)
    expect(whereHasEq(state.selectWheres[0], 'notifications.userId', 'user_2')).toBe(true)
    expect(whereHasEq(state.countWheres[0], 'notifications.userId', 'user_2')).toBe(true)
  })
})

describe('GET /api/notifications?facets=true', () => {
  beforeEach(reset)

  interface Facets {
    views: { all: number; unread: number; past: number }
    kinds: {
      all: Record<string, number>
      unread: Record<string, number>
      past: Record<string, number>
    }
  }

  it('is absent unless asked for, so the bell pays nothing for it', async () => {
    const res = await GET(makeGet())
    const json = await res.json() as { facets?: Facets }
    expect(json.facets).toBeUndefined()
    expect(state.groupByWheres).toHaveLength(0)
  })

  it('folds entity types into kinds, per view', async () => {
    state.facetPages = [
      // recent: at or after the boundary
      [
        { entityType: 'request', read: false, n: 3 },
        { entityType: 'request', read: true, n: 5 },
        { entityType: 'contract', read: false, n: 2 },
      ],
      // past: before it
      [{ entityType: 'invoice', read: true, n: 4 }],
    ]
    const res = await GET(makeGet('?facets=true&since=2026-08-07T00:00:00.000Z'))
    const json = await res.json() as { facets: Facets }

    expect(json.facets.views).toEqual({ all: 10, unread: 5, past: 4 })
    // 'contract' is a document, and unread rows are a subset of all rows.
    expect(json.facets.kinds.all.request).toBe(8)
    expect(json.facets.kinds.all.document).toBe(2)
    expect(json.facets.kinds.unread.request).toBe(3)
    expect(json.facets.kinds.unread.document).toBe(2)
    expect(json.facets.kinds.past.invoice).toBe(4)
    // A kind with nothing behind it is zero, never missing: the rail greys
    // those rows out rather than dropping them.
    expect(json.facets.kinds.all.invoice).toBe(0)
  })

  it('counts around the boundary: at or after it, then before it', async () => {
    state.facetPages = [[], []]
    await GET(makeGet('?facets=true&since=2026-08-07T00:00:00.000Z'))
    expect(state.groupByWheres).toHaveLength(2)
    expect(whereOp(state.groupByWheres[0], 'gte', 'notifications.createdAt')?.val)
      .toBe('2026-08-07T00:00:00.000Z')
    expect(whereOp(state.groupByWheres[1], 'lt', 'notifications.createdAt')?.val)
      .toBe('2026-08-07T00:00:00.000Z')
    // Grouped by entity type and read, which is what the fold needs.
    expect(state.groupByCols[0]).toEqual(['notifications.entityType', 'notifications.read'])
  })

  it('takes the Past view\'s boundary from `before`, so one read serves every view', async () => {
    state.facetPages = [[], [{ entityType: 'request', read: false, n: 2 }]]
    const res = await GET(makeGet('?facets=true&before=2026-08-07T00:00:00.000Z'))
    const json = await res.json() as { facets: Facets }
    expect(whereOp(state.groupByWheres[0], 'gte', 'notifications.createdAt')?.val)
      .toBe('2026-08-07T00:00:00.000Z')
    expect(json.facets.views.past).toBe(2)
  })

  it('reads one side only when there is no window to be either side of', async () => {
    state.facetPages = [[{ entityType: 'request', read: false, n: 1 }]]
    const res = await GET(makeGet('?facets=true'))
    const json = await res.json() as { facets: Facets }
    expect(state.groupByWheres).toHaveLength(1)
    expect(json.facets.views).toEqual({ all: 1, unread: 1, past: 0 })
  })

  it('is never narrowed by the kind or unread filter the reader is holding', async () => {
    // Otherwise pressing one kind would zero every other one under them, and
    // the rail would disable the filters they were about to reach for.
    state.facetPages = [[], []]
    await GET(makeGet('?facets=true&since=2026-08-07T00:00:00.000Z&kind=invoice&unread=true'))
    const where = state.groupByWheres[0]
    expect(whereOp(where, 'inArray', 'notifications.entityType')).toBeUndefined()
    expect(whereHasEq(where, 'notifications.read', false)).toBe(false)
    // The page itself still is.
    expect(whereHasEq(state.selectWheres[0], 'notifications.read', false)).toBe(true)
  })

  it('scopes the counts to the caller, and to the named user for a service token', async () => {
    state.facetPages = [[], []]
    await GET(makeGet('?facets=true&since=2026-08-07T00:00:00.000Z'))
    expect(whereHasEq(state.groupByWheres[0], 'notifications.userId', 'user_1')).toBe(true)

    reset()
    vi.mocked(getRequestAuth).mockResolvedValue(auth({ userId: 'api-service', sessionId: null }))
    state.facetPages = [[], []]
    await GET(makeGet('?facets=true&since=2026-08-07T00:00:00.000Z&userId=user_2'))
    expect(whereHasEq(state.groupByWheres[0], 'notifications.userId', 'user_2')).toBe(true)
  })
})

describe('PATCH /api/notifications', () => {
  beforeEach(reset)

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

  it('narrows mark-all to the kinds the reader is looking at', async () => {
    await PATCH(makePatch({ all: true, kinds: ['invoice'] }))
    const where = state.updateWheres[0]
    expect(whereHasEq(where, 'notifications.userId', 'user_1')).toBe(true)
    const op = whereOp(where, 'inArray', 'notifications.entityType')
    expect(op?.vals).toEqual(['invoice'])
  })

  it('mark-all with no lens stays scoped to the caller and nothing else', async () => {
    await PATCH(makePatch({ all: true }))
    const where = state.updateWheres[0]
    expect((where.parts as Op[])).toHaveLength(1)
    expect(whereHasEq(where, 'notifications.userId', 'user_1')).toBe(true)
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
