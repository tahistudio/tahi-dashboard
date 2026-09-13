/**
 * GET /api/admin/feedback, admin-only read of the beta feedback ball's
 * rows, the MCP tool list_feedback_comments' proxy target. Newest first,
 * with org_id / route / since / limit filters ANDed together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  where: (cond?: unknown) => SelectChain
  orderBy: () => SelectChain
  limit: (n: number) => SelectChain
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    feedbackComments: {
      _table: 'feedback_comments',
      id: 'id',
      orgId: 'org_id',
      route: 'route',
      createdAt: 'created_at',
    },
  },
}))

let lastWhereArg: unknown
let lastLimitArg: number | undefined
let rowsToReturn: Row[] = []

vi.mock('@/lib/db', () => {
  function chain(): SelectChain {
    const c = Promise.resolve(rowsToReturn) as SelectChain
    c.where = (cond?: unknown) => {
      lastWhereArg = cond
      return c
    }
    c.orderBy = () => c
    c.limit = (n: number) => {
      lastLimitArg = n
      return c
    }
    return c
  }
  const select = vi.fn(() => ({ from: () => chain() }))
  return { db: vi.fn().mockResolvedValue({ select }) }
})

import { GET } from '@/app/api/admin/feedback/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

function feedbackGet(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/feedback${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  lastWhereArg = undefined
  lastLimitArg = undefined
  rowsToReturn = []
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 's1' })
})

describe('GET /api/admin/feedback - auth', () => {
  it('403s a non-admin caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's1' })
    const res = await GET(feedbackGet())
    expect(res.status).toBe(403)
  })

  it('403s a signed-out caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const res = await GET(feedbackGet())
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin/feedback - listing', () => {
  it('returns rows newest first under items', async () => {
    rowsToReturn = [
      { id: 'fb_2', body: 'second', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'fb_1', body: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    const res = await GET(feedbackGet())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Row[] }
    expect(json.items).toHaveLength(2)
    expect(json.items[0].id).toBe('fb_2')
  })

  it('applies no where clause with no filters', async () => {
    await GET(feedbackGet())
    expect(lastWhereArg).toBeUndefined()
  })

  it('builds a where clause when org_id is given', async () => {
    await GET(feedbackGet('?org_id=org_abc'))
    expect(lastWhereArg).toBeDefined()
  })

  it('builds a where clause when route is given', async () => {
    await GET(feedbackGet('?route=%2Frequests%2Fabc'))
    expect(lastWhereArg).toBeDefined()
  })

  it('builds a where clause when since is given', async () => {
    await GET(feedbackGet('?since=2026-01-01T00:00:00.000Z'))
    expect(lastWhereArg).toBeDefined()
  })

  it('defaults the limit to 100', async () => {
    await GET(feedbackGet())
    expect(lastLimitArg).toBe(100)
  })

  it('honours a smaller limit', async () => {
    await GET(feedbackGet('?limit=5'))
    expect(lastLimitArg).toBe(5)
  })

  it('caps an oversized limit at 200', async () => {
    await GET(feedbackGet('?limit=5000'))
    expect(lastLimitArg).toBe(200)
  })

  it('ignores a junk limit and falls back to the default', async () => {
    await GET(feedbackGet('?limit=not-a-number'))
    expect(lastLimitArg).toBe(100)
  })
})
