/**
 * Route-level tests for per-org access scoping on the deals, conversations,
 * calls, time and announcements admin routes.
 *
 * The two leaf resolvers are mocked (`resolveAccessScoping` for the org list,
 * `resolvePermissions` for the admin bypass) and everything above them is real,
 * so `scopedOrgIds` / `requireAccessToOrg` and the route wiring are the things
 * actually under test. The fake D1 records every query so an "unrestricted
 * caller is not filtered" claim can be checked against the real SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn(),
}))

vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  resolvePermissions: vi.fn(),
}))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { resolvePermissions } from '@/lib/permissions'
import { NextRequest } from 'next/server'

import { GET as dealsList } from '@/app/api/admin/deals/route'
import { GET as dealDetail } from '@/app/api/admin/deals/[id]/route'
import { GET as dealActivities } from '@/app/api/admin/deals/[id]/activities/route'
import { PATCH as callPatch } from '@/app/api/admin/calls/[id]/route'
import { GET as timeList } from '@/app/api/admin/time/route'
import { POST as announcementCreate } from '@/app/api/admin/announcements/route'
import { PATCH as messagePatch } from '@/app/api/admin/conversations/[id]/messages/route'

// ---------------------------------------------------------------------------
// Fake D1: a chainable recorder. Only the chain is thenable, never the db
// handle itself (awaiting `db()` must not resolve the query).
// ---------------------------------------------------------------------------
type QueryRecord = { calls: Array<{ method: string; args: unknown[] }> }

function makeChain(result: unknown, record: QueryRecord): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        record.calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)
    return makeChain(queue.length ? queue.shift() : [], record)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
    all: async (...args: unknown[]) => {
      queries.push({ calls: [{ method: 'all', args }] })
      return []
    },
    run: async (...args: unknown[]) => {
      queries.push({ calls: [{ method: 'run', args }] })
      return {}
    },
  }
  return { handle, queries }
}

type Collected = { cols: string[]; params: unknown[]; text: string }

function walk(node: unknown, out: Collected): void {
  if (node instanceof SQL) {
    for (const chunk of node.queryChunks) walk(chunk, out)
    return
  }
  if (node instanceof Column) { out.cols.push(node.name); return }
  if (node instanceof Param) { out.params.push(node.value); return }
  if (Array.isArray(node)) { for (const item of node) walk(item, out); return }
  if (node && typeof node === 'object' && 'value' in node) {
    const value = (node as { value: unknown }).value
    if (Array.isArray(value)) out.text += value.join('')
  }
}

function whereOf(record: QueryRecord): Collected {
  const out: Collected = { cols: [], params: [], text: '' }
  for (const call of record.calls) {
    if (call.method === 'where') walk(call.args, out)
  }
  return out
}

// ---------------------------------------------------------------------------
// Scope fixtures
// ---------------------------------------------------------------------------
function unrestricted() {
  vi.mocked(resolvePermissions).mockResolvedValue({ isAdmin: true } as never)
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
}

function scopedTo(orgIds: string[]) {
  vi.mocked(resolvePermissions).mockResolvedValue({ isAdmin: false } as never)
  vi.mocked(resolveAccessScoping).mockResolvedValue(orgIds)
}

function scopedToNothing() {
  scopedTo([])
}

type RequestOptions = ConstructorParameters<typeof NextRequest>[1]

function req(url: string, init?: RequestOptions) {
  return new NextRequest(`http://localhost:3000${url}`, init)
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /api/admin/deals
// ---------------------------------------------------------------------------
describe('GET /api/admin/deals', () => {
  it('does not filter by org for an unrestricted caller', async () => {
    unrestricted()
    const { handle, queries } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealsList(req('/api/admin/deals?limit=100'))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: unknown[]; page: number; limit: number }
    expect(body).toEqual({ items: [], page: 1, limit: 100 })

    const where = whereOf(queries[0])
    expect(where.cols).not.toContain('org_id')
  })

  it('filters a scoped caller to their orgs and keeps unlinked deals on the board', async () => {
    scopedTo(['org-a', 'org-b'])
    const { handle, queries } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealsList(req('/api/admin/deals?limit=100'))
    expect(res.status).toBe(200)

    const where = whereOf(queries[0])
    expect(where.cols).toContain('org_id')
    expect(where.params).toContain('org-a')
    expect(where.params).toContain('org-b')
    // NULL-ORG RULE: an unassigned deal has no tenant, so it stays visible.
    expect(where.text).toContain('is null')
  })

  it('shows an empty scope nothing and never runs the query', async () => {
    scopedToNothing()
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealsList(req('/api/admin/deals?limit=100'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], page: 1, limit: 100 })
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Deal detail + sub-routes
// ---------------------------------------------------------------------------
describe('deal detail routes', () => {
  it('403s a scoped caller on another org deal', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ id: 'deal-1', orgId: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealDetail(req('/api/admin/deals/deal-1'), params('deal-1'))
    expect(res.status).toBe(403)
  })

  it('403s a scoped caller on another org deal activities', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ orgId: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealActivities(req('/api/admin/deals/deal-1/activities'), params('deal-1'))
    expect(res.status).toBe(403)
  })

  it('lets a scoped caller open an unlinked deal', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ orgId: null }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealActivities(req('/api/admin/deals/deal-1/activities'), params('deal-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })

  it('404s an unknown deal before any scope decision', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealActivities(req('/api/admin/deals/nope/activities'), params('nope'))
    expect(res.status).toBe(404)
  })

  it('hides an unlinked deal from a caller scoped to nothing', async () => {
    scopedToNothing()
    const { handle } = makeDb([[{ orgId: null }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await dealActivities(req('/api/admin/deals/deal-1/activities'), params('deal-1'))
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/calls/[id]
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/calls/[id]', () => {
  it('403s a scoped caller on another org call', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ orgId: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await callPatch(
      req('/api/admin/calls/call-1', { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }),
      params('call-1'),
    )
    expect(res.status).toBe(403)
  })

  it('updates a call inside the caller scope', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ orgId: 'org-a' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await callPatch(
      req('/api/admin/calls/call-1', { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }),
      params('call-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/time
// ---------------------------------------------------------------------------
describe('GET /api/admin/time', () => {
  it('filters a scoped caller to their orgs', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb([[], [{ totalHours: 0, billableHours: 0, entryCount: 0 }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await timeList(req('/api/admin/time'))
    expect(res.status).toBe(200)
    const where = whereOf(queries[0])
    expect(where.cols).toContain('org_id')
    expect(where.params).toContain('org-a')
    // Time is always attached to a client, so unassigned rows do not apply.
    expect(where.text).not.toContain('is null')
  })

  it('returns the empty payload shape for a caller scoped to nothing', async () => {
    scopedToNothing()
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await timeList(req('/api/admin/time'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [], page: 1, limit: 50, totalHours: 0, billableHours: 0, entryCount: 0, capacityHours: null,
    })
    expect(queries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/announcements
// ---------------------------------------------------------------------------
describe('POST /api/admin/announcements', () => {
  const bodyFor = (extra: Record<string, unknown>) => JSON.stringify({
    title: 'Heads up', content: 'Maintenance window', ...extra,
  })

  it('refuses a scoped caller a blast to every client', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await announcementCreate(
      req('/api/admin/announcements', { method: 'POST', body: bodyFor({ targetType: 'all', publish: true }) }),
    )
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('allows a scoped caller to target their own client', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await announcementCreate(
      req('/api/admin/announcements', {
        method: 'POST',
        body: bodyFor({ targetType: 'org', targetIds: ['org-a'] }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('refuses a scoped caller a target outside their scope', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await announcementCreate(
      req('/api/admin/announcements', {
        method: 'POST',
        body: bodyFor({ targetType: 'org', targetIds: ['org-a', 'org-z'] }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('leaves an unrestricted caller able to broadcast to everyone', async () => {
    unrestricted()
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await announcementCreate(
      req('/api/admin/announcements', { method: 'POST', body: bodyFor({ targetType: 'all' }) }),
    )
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/conversations/[id]/messages
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/conversations/[id]/messages', () => {
  it('403s a caller who is not a participant', async () => {
    unrestricted()
    // teamMembers lookup, then the (empty) participant lookup
    const { handle } = makeDb([[{ id: 'tm-1' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await messagePatch(
      req('/api/admin/conversations/conv-1/messages', {
        method: 'PATCH',
        body: JSON.stringify({ messageId: 'msg-1', deleted: true }),
      }),
      params('conv-1'),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Not a participant' })
  })

  it('403s a scoped participant on another org conversation', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([
      [{ id: 'tm-1' }],              // teamMembers
      [{ id: 'part-1' }],            // participant row exists
      [{ id: 'conv-1', orgId: 'org-b' }], // conversation belongs to another client
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await messagePatch(
      req('/api/admin/conversations/conv-1/messages', {
        method: 'PATCH',
        body: JSON.stringify({ messageId: 'msg-1', deleted: true }),
      }),
      params('conv-1'),
    )
    expect(res.status).toBe(403)
  })

  it('lets a scoped participant act in a Tahi-internal thread', async () => {
    scopedToNothing()
    const { handle } = makeDb([
      [{ id: 'tm-1' }],            // teamMembers
      [{ id: 'part-1' }],          // participant row exists
      [{ id: 'conv-1', orgId: null }], // internal thread: participation is the gate
      [{ id: 'msg-1' }],           // message belongs to the conversation
      [],                          // update
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await messagePatch(
      req('/api/admin/conversations/conv-1/messages', {
        method: 'PATCH',
        body: JSON.stringify({ messageId: 'msg-1', deleted: true }),
      }),
      params('conv-1'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })
})
