/**
 * The three suggestion routes: the inbox read, one decision, and a bulk
 * decision.
 *
 * Their own job is small and is exactly what is pinned here: admit only the
 * Tahi admin org, apply the client's own access rule to each row (a
 * suggestion with no client being studio housekeeping that every admin
 * reaches, the same answer guardTask gives a task with no client), translate
 * the wire vocabulary into a DecisionInput, and decide each id in a bulk call
 * independently so one refusal does not swallow the rest.
 *
 * The rules underneath live in lib/task-suggestions.ts and are covered there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

let scoping: string[] | null = null
const decisions: Array<{ id: string; decision: Record<string, unknown>; ctx: Record<string, unknown> }> = []
const listCalls: Array<Record<string, unknown>> = []

let rows: Record<string, { id: string; orgId: string | null; status: string; appliedTaskId: string | null }> = {}
let deniedOrgIds: string[] = []
let decideThrowsFor: string | null = null

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async (req: Request) => (
    req.headers.get('x-test-auth') === 'client'
      ? { orgId: 'client-org', userId: 'user_client' }
      : { orgId: 'tahi-org', userId: 'user_1' }
  ),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async () => scoping,
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: async (_drizzle: unknown, _userId: string | null, targetOrgId: string | null) => (
    targetOrgId && deniedOrgIds.includes(targetOrgId)
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : null
  ),
}))

vi.mock('@/lib/db', () => ({ db: async () => ({}) }))

vi.mock('@/lib/task-suggestions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/task-suggestions')>('@/lib/task-suggestions')
  return {
    ...actual,
    listSuggestions: async (_drizzle: unknown, options: Record<string, unknown>) => {
      listCalls.push(options)
      return Object.values(rows).map(row => ({ ...row, callId: 'call_1', kind: 'create_task' }))
    },
    countSuggestions: async () => ({ pending: 4, snoozed: 1, calls: 2 }),
    loadSuggestion: async (_drizzle: unknown, id: string) => rows[id] ?? null,
    decideSuggestion: async (_drizzle: unknown, id: string, decision: Record<string, unknown>, ctx: Record<string, unknown>) => {
      if (decideThrowsFor === id) throw new Error('D1 fell over')
      decisions.push({ id, decision, ctx })
      const row = rows[id]
      if (!row) return null
      const status = decision.action === 'approve' ? 'applied' : decision.action === 'reject' ? 'rejected' : 'snoozed'
      return {
        suggestion: { ...row, status },
        changed: true,
        appliedTaskId: decision.action === 'approve' ? 'task_new' : null,
      }
    },
  }
})

const { GET } = await import('../route')
const { POST: DECIDE } = await import('../[id]/decide/route')
const { POST: BULK } = await import('../decide-bulk/route')

function req(url: string, init?: { method?: string; body?: unknown; auth?: 'client' }): Request {
  return new Request(url, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.auth ? { 'x-test-auth': init.auth } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
}

beforeEach(() => {
  scoping = null
  decisions.length = 0
  listCalls.length = 0
  deniedOrgIds = []
  decideThrowsFor = null
  rows = {
    s1: { id: 's1', orgId: 'o1', status: 'pending', appliedTaskId: null },
    s2: { id: 's2', orgId: 'o2', status: 'pending', appliedTaskId: null },
    s_studio: { id: 's_studio', orgId: null, status: 'pending', appliedTaskId: null },
  }
})

describe('GET /api/admin/task-suggestions', () => {
  it('403s a caller outside the Tahi admin org', async () => {
    const res = await GET(req('http://localhost/api/admin/task-suggestions', { auth: 'client' }) as never)
    expect(res.status).toBe(403)
  })

  it('defaults to the pending list, capped at a hundred', async () => {
    await GET(req('http://localhost/api/admin/task-suggestions') as never)
    expect(listCalls[0].status).toBe('pending')
    expect(listCalls[0].limit).toBe(100)
  })

  it('passes a scoped caller their own client list, not every client', async () => {
    scoping = ['o1']
    await GET(req('http://localhost/api/admin/task-suggestions') as never)
    expect(listCalls[0].orgIds).toEqual(['o1'])
  })

  it('passes "all" for an unrestricted caller', async () => {
    scoping = null
    await GET(req('http://localhost/api/admin/task-suggestions') as never)
    expect(listCalls[0].orgIds).toBe('all')
  })

  it('honours the status and call filters and a smaller limit', async () => {
    await GET(req('http://localhost/api/admin/task-suggestions?status=snoozed&callId=call_9&limit=10') as never)
    expect(listCalls[0]).toMatchObject({ status: 'snoozed', callId: 'call_9', limit: 10 })
  })

  it('returns the counts the inbox badge reads', async () => {
    const res = await GET(req('http://localhost/api/admin/task-suggestions') as never)
    const body = await res.json() as { items: unknown[]; counts: Record<string, number> }
    expect(body.items).toHaveLength(3)
    expect(body.counts).toEqual({ pending: 4, snoozed: 1, calls: 2 })
  })
})

describe('POST /api/admin/task-suggestions/[id]/decide', () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it('403s a caller outside the Tahi admin org', async () => {
    const res = await DECIDE(
      req('http://localhost/x', { method: 'POST', body: { action: 'approve' }, auth: 'client' }) as never,
      params('s1'),
    )
    expect(res.status).toBe(403)
    expect(decisions).toHaveLength(0)
  })

  it('404s an id that names nothing', async () => {
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'approve' } }) as never, params('ghost'))
    expect(res.status).toBe(404)
  })

  it('403s a suggestion on a client the caller cannot reach', async () => {
    deniedOrgIds = ['o2']
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'approve' } }) as never, params('s2'))
    expect(res.status).toBe(403)
    expect(decisions).toHaveLength(0)
  })

  it('lets any admin decide a suggestion with no client', async () => {
    deniedOrgIds = ['o1', 'o2']
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'approve' } }) as never, params('s_studio'))
    expect(res.status).toBe(200)
    expect(decisions[0].id).toBe('s_studio')
  })

  it('approves and reports the task it created', async () => {
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'approve' } }) as never, params('s1'))
    const body = await res.json() as { changed: boolean; appliedTaskId: string; suggestion: { status: string } }
    expect(body.changed).toBe(true)
    expect(body.appliedTaskId).toBe('task_new')
    expect(body.suggestion.status).toBe('applied')
  })

  it('carries a tweaked proposal through as an approve', async () => {
    await DECIDE(
      req('http://localhost/x', { method: 'POST', body: { action: 'approve', proposal: { title: 'Edited' } } }) as never,
      params('s1'),
    )
    expect(decisions[0].decision).toEqual({ action: 'approve', proposalOverride: { title: 'Edited' } })
  })

  it('resolves a snooze preset to a real instant', async () => {
    const res = await DECIDE(
      req('http://localhost/x', { method: 'POST', body: { action: 'snooze', snooze: 'tonight' } }) as never,
      params('s1'),
    )
    expect(res.status).toBe(200)
    const decision = decisions[0].decision as { action: string; until: string }
    expect(decision.action).toBe('snooze')
    expect(decision.until).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('takes an explicit snooze instant', async () => {
    await DECIDE(
      req('http://localhost/x', { method: 'POST', body: { action: 'snooze', snooze: { until: '2026-10-01T07:00:00Z' } } }) as never,
      params('s1'),
    )
    expect(decisions[0].decision).toEqual({ action: 'snooze', until: '2026-10-01T07:00:00Z' })
  })

  it('400s a snooze with no time at all rather than snoozing forever', async () => {
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'snooze' } }) as never, params('s1'))
    expect(res.status).toBe(400)
    expect(decisions).toHaveLength(0)
  })

  it('400s an action outside the three', async () => {
    const res = await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'delete' } }) as never, params('s1'))
    expect(res.status).toBe(400)
  })

  it('records the surface the decision was made on', async () => {
    await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'reject' } }) as never, params('s1'))
    expect(decisions[0].ctx).toEqual({ actorId: 'user_1', via: 'dashboard' })

    await DECIDE(req('http://localhost/x', { method: 'POST', body: { action: 'reject', via: 'mcp' } }) as never, params('s1'))
    expect(decisions[1].ctx).toEqual({ actorId: 'user_1', via: 'mcp' })
  })
})

describe('POST /api/admin/task-suggestions/decide-bulk', () => {
  it('403s a caller outside the Tahi admin org', async () => {
    const res = await BULK(req('http://localhost/x', { method: 'POST', body: { ids: ['s1'], action: 'approve' }, auth: 'client' }) as never)
    expect(res.status).toBe(403)
  })

  it('decides each id independently, never as one transaction', async () => {
    deniedOrgIds = ['o2']
    decideThrowsFor = 's_studio'
    const res = await BULK(req('http://localhost/x', {
      method: 'POST',
      body: { ids: ['s1', 's2', 'ghost', 's_studio'], action: 'approve' },
    }) as never)

    const body = await res.json() as { results: Array<{ id: string; changed: boolean; status: string | null; error?: string }> }
    expect(body.results).toHaveLength(4)
    expect(body.results[0]).toMatchObject({ id: 's1', changed: true, status: 'applied', appliedTaskId: 'task_new' })
    expect(body.results[1]).toMatchObject({ id: 's2', changed: false })
    expect(body.results[1].error).toContain('Forbidden')
    expect(body.results[2]).toMatchObject({ id: 'ghost', changed: false })
    expect(body.results[3].error).toContain('D1 fell over')
    // The one that worked still worked, which is the whole point.
    expect(decisions.map(d => d.id)).toEqual(['s1'])
  })

  it('400s an action outside approve and reject', async () => {
    const res = await BULK(req('http://localhost/x', { method: 'POST', body: { ids: ['s1'], action: 'snooze' } }) as never)
    expect(res.status).toBe(400)
  })

  it('400s an empty id list rather than reporting an empty success', async () => {
    const res = await BULK(req('http://localhost/x', { method: 'POST', body: { ids: [], action: 'approve' } }) as never)
    expect(res.status).toBe(400)
  })
})
