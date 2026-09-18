/**
 * GET/POST /api/admin/tasks/[id]/comments.
 *
 * The route's own job is small: gate on isTahiAdmin, gate again on
 * guardTask (the task's own client, same rule every task route applies),
 * resolve the caller's roster identity for a human POST, and translate
 * asBot into the bot identity for an automation POST. The write itself
 * (mirroring into the request thread) is lib/task-comments.ts#postTaskComment's
 * job and is covered there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let guardResult: NextResponse | null = null
const guardCalls: Array<{ userId: string | null; taskId: string }> = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async (req: Request) => {
    const auth = req.headers.get('x-test-auth')
    if (auth === 'client') return { orgId: 'client-org', userId: 'user_client' }
    return { orgId: 'tahi-org', userId: 'user_1' }
  },
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))

vi.mock('@/lib/task-access', () => ({
  guardTask: async (_drizzle: unknown, userId: string | null, taskId: string) => {
    guardCalls.push({ userId, taskId })
    return guardResult
  },
}))

let teamMember: { id: string; role: string | null; name: string | null } | null = { id: 'tm1', role: 'admin', name: 'Ana' }

vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: async () => teamMember,
}))

const posted: Array<Record<string, unknown>> = []
let commentRows: Array<Record<string, unknown>> = []

vi.mock('@/lib/task-comments', () => ({
  listTaskComments: async () => commentRows,
  postTaskComment: async (_drizzle: unknown, input: Record<string, unknown>) => {
    posted.push(input)
    return { id: 'c_new', taskId: input.taskId, ...(input.author as Record<string, unknown>), body: input.body, quote: null, sourceRef: null, createdAt: '2026-09-19T00:00:00Z' }
  },
}))

vi.mock('@/db/d1', () => ({
  schema: {
    tasks: { id: 'id' },
    teamMembers: { id: 'id', name: 'name' },
    contacts: { id: 'id', name: 'name' },
  },
}))

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  }),
}))

const { GET, POST } = await import('../[id]/comments/route')

const params = { params: Promise.resolve({ id: 't1' }) }

function req(method: string, body?: unknown, auth?: 'client'): Request {
  return new Request('http://localhost/api/admin/tasks/t1/comments', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { 'x-test-auth': auth } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/admin/tasks/[id]/comments', () => {
  beforeEach(() => {
    guardResult = null
    guardCalls.length = 0
    commentRows = []
  })

  it('403s a caller outside the Tahi admin org', async () => {
    const res = await GET(req('GET', undefined, 'client') as never, params)
    expect(res.status).toBe(403)
    expect(guardCalls).toHaveLength(0)
  })

  it('checks access to the task before answering', async () => {
    guardResult = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const res = await GET(req('GET') as never, params)
    expect(res.status).toBe(403)
    expect(guardCalls).toEqual([{ userId: 'user_1', taskId: 't1' }])
  })

  it('returns the thread, a bot row resolved to Tahi bot', async () => {
    commentRows = [
      { id: 'c1', taskId: 't1', authorType: 'bot', authorId: null, body: 'The call said this is done', quote: 'yep, shipped', sourceRef: 'call_1', createdAt: '2026-09-19T00:00:00Z' },
    ]
    const res = await GET(req('GET') as never, params)
    expect(res.status).toBe(200)
    const json = await res.json() as { comments: Array<{ authorName: string; authorType: string }> }
    expect(json.comments[0].authorName).toBe('Tahi bot')
    expect(json.comments[0].authorType).toBe('bot')
  })
})

describe('POST /api/admin/tasks/[id]/comments', () => {
  beforeEach(() => {
    guardResult = null
    guardCalls.length = 0
    posted.length = 0
    teamMember = { id: 'tm1', role: 'admin', name: 'Ana' }
  })

  it('403s a caller outside the Tahi admin org', async () => {
    const res = await POST(req('POST', { body: 'hi' }, 'client') as never, params)
    expect(res.status).toBe(403)
    expect(posted).toHaveLength(0)
  })

  it('400s an empty body', async () => {
    const res = await POST(req('POST', { body: '  ' }) as never, params)
    expect(res.status).toBe(400)
    expect(posted).toHaveLength(0)
  })

  it('checks access to the task before writing', async () => {
    guardResult = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const res = await POST(req('POST', { body: 'hi' }) as never, params)
    expect(res.status).toBe(403)
    expect(posted).toHaveLength(0)
  })

  it('posts as the signed-in team member by default', async () => {
    const res = await POST(req('POST', { body: 'Following up' }) as never, params)
    expect(res.status).toBe(201)
    expect(posted[0].author).toEqual({ authorType: 'team_member', authorId: 'tm1' })
    expect(posted[0].body).toBe('Following up')
  })

  it('falls back to the raw userId when the caller has no roster row', async () => {
    teamMember = null
    const res = await POST(req('POST', { body: 'x' }) as never, params)
    expect(res.status).toBe(201)
    expect(posted[0].author).toEqual({ authorType: 'team_member', authorId: 'user_1' })
  })

  it('posts as Tahi bot when asBot is set, the automation door', async () => {
    const res = await POST(req('POST', { body: 'The call said this is done', asBot: true }) as never, params)
    expect(res.status).toBe(201)
    expect(posted[0].author).toEqual({ authorType: 'bot', authorId: null })
  })
})
