/**
 * Access scoping, vocabulary and effects on the admin request write paths.
 *
 * These cover the holes the requests technical audit found:
 *
 *   B1  the bulk PATCH / POST applied to any id or org with no scope check
 *       and no status whitelist
 *   I1  the create route inserted into any clientOrgId it was handed
 *   I2  the steps routes never resolved the owning request
 *   I3  the messages routes never resolved the owning request
 *   I4  time entries, files, calls and voice notes never did either
 *   I7  the admin create numbered requests off a global MAX
 *   I8  the bulk PATCH fired none of the single PATCH's notifications
 *   I9  a body with no parentRequestId key silently un-nested a request
 *
 * The leaf resolver (`resolveAccessScoping`) is mocked so a test can say
 * "this caller sees org-a"; everything above it, including requireAccessToOrg
 * and getOrgScope, is the real thing. The fake D1 records every query so the
 * SQL a route actually built can be asserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notifyTeamMember: vi.fn().mockResolvedValue(undefined),
  notifyOrgContacts: vi.fn().mockResolvedValue(undefined),
  notifyMentionedPerson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/events', () => ({
  dispatchDomainEvent: vi.fn().mockResolvedValue(undefined),
}))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { notifyOrgContacts, notifyTeamMember } from '@/lib/notifications'
import { dispatchDomainEvent } from '@/lib/events'
import { NextRequest } from 'next/server'

import { POST as createRequest } from '@/app/api/admin/requests/route'
import { PATCH as bulkPatch, POST as bulkCreate } from '@/app/api/admin/requests/bulk/route'
import { GET as stepsList, POST as stepCreate } from '@/app/api/admin/requests/[id]/steps/route'
import { GET as messagesList } from '@/app/api/admin/requests/[id]/messages/route'
import { GET as timeEntriesList } from '@/app/api/admin/requests/[id]/time-entries/route'
import { GET as filesList } from '@/app/api/admin/requests/[id]/files/route'
import { GET as callsList } from '@/app/api/admin/requests/[id]/calls/route'
import { GET as voiceNotesList } from '@/app/api/admin/requests/[id]/voice-notes/route'
import { POST as nest } from '@/app/api/admin/requests/[id]/nest/route'

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
    return
  }
  // A raw `sql` template pushes its interpolated values into the chunk list
  // unwrapped, so a bare primitive at this depth is a bound parameter.
  if (node === null || ['string', 'number', 'boolean'].includes(typeof node)) {
    out.params.push(node)
  }
}

function collect(record: QueryRecord, method: string): Collected {
  const out: Collected = { cols: [], params: [], text: '' }
  for (const call of record.calls) {
    if (call.method === method) walk(call.args, out)
  }
  return out
}

function methodsUsed(queries: QueryRecord[]): string[] {
  return queries.map((q) => q.calls[0].method)
}

// ---------------------------------------------------------------------------
// Scope fixtures
// ---------------------------------------------------------------------------
function unrestricted() {
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
}

function scopedTo(orgIds: string[]) {
  vi.mocked(resolveAccessScoping).mockResolvedValue(orgIds)
}

type RequestOptions = ConstructorParameters<typeof NextRequest>[1]

function req(url: string, init?: RequestOptions) {
  return new NextRequest(`http://localhost:3000${url}`, init)
}

function jsonReq(url: string, method: string, body: unknown) {
  return req(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A body-less POST, which is how a truncated or retried call arrives. */
function emptyReq(url: string, method: string) {
  return req(url, { method, headers: { 'Content-Type': 'application/json' } })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// I1 + I7: POST /api/admin/requests
// ---------------------------------------------------------------------------
describe('POST /api/admin/requests', () => {
  const body = { clientOrgId: 'org-b', title: 'Homepage refresh' }

  it('403s a scoped caller filing work against another client, before any write', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb([[{ id: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createRequest(jsonReq('/api/admin/requests', 'POST', body))
    expect(res.status).toBe(403)
    expect(methodsUsed(queries)).not.toContain('run')
  })

  it('404s an unknown client org rather than writing an orphan row', async () => {
    unrestricted()
    const { handle, queries } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createRequest(jsonReq('/api/admin/requests', 'POST', { ...body, clientOrgId: 'org-typo' }))
    expect(res.status).toBe(404)
    expect(methodsUsed(queries)).not.toContain('run')
  })

  it('numbers the new request per client, not off a global MAX', async () => {
    scopedTo(['org-b'])
    const { handle, queries } = makeDb([[{ id: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createRequest(jsonReq('/api/admin/requests', 'POST', body))
    expect(res.status).toBe(201)

    const insert = queries.find((q) => q.calls[0].method === 'run')
    expect(insert).toBeTruthy()
    const sql = collect(insert!, 'run')
    expect(sql.text).toContain('MAX(request_number) FROM requests WHERE org_id')
    expect(sql.text).not.toContain('MAX(request_number) FROM requests), 0)')
    expect(sql.params).toContain('org-b')
  })

  it('rejects a brand that belongs to another client', async () => {
    unrestricted()
    // org lookup hits, brand lookup misses
    const { handle, queries } = makeDb([[{ id: 'org-b' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createRequest(jsonReq('/api/admin/requests', 'POST', { ...body, brandId: 'brand-of-someone-else' }))
    expect(res.status).toBe(400)
    expect(methodsUsed(queries)).not.toContain('run')
  })

  it('stores a brand that does belong to the client', async () => {
    unrestricted()
    const { handle, queries } = makeDb([[{ id: 'org-b' }], [{ id: 'brand-1' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await createRequest(jsonReq('/api/admin/requests', 'POST', { ...body, brandId: 'brand-1' }))
    expect(res.status).toBe(201)

    const insert = queries.find((q) => q.calls[0].method === 'run')
    const sql = collect(insert!, 'run')
    expect(sql.text).toContain('brand_id')
    expect(sql.params).toContain('brand-1')
  })
})

// ---------------------------------------------------------------------------
// B1 + I8: PATCH /api/admin/requests/bulk
// ---------------------------------------------------------------------------
describe('PATCH /api/admin/requests/bulk', () => {
  it('403s the whole batch and names the ids outside the caller scope', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb([[
      { id: 'req-a', orgId: 'org-a', title: 'Mine', assigneeId: null },
      { id: 'req-b', orgId: 'org-b', title: 'Theirs', assigneeId: null },
    ]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a', 'req-b'],
      archived: true,
    }))
    expect(res.status).toBe(403)
    const json = await res.json() as { ids?: string[] }
    expect(json.ids).toEqual(['req-b'])
    // Nothing was half-applied.
    expect(methodsUsed(queries)).not.toContain('update')
  })

  it('rejects a status outside the vocabulary before it reaches the database', async () => {
    unrestricted()
    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a'],
      status: 'Delivered',
    }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toContain('status must be one of')
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })

  it('reports the rows it actually touched, not the ids it was handed', async () => {
    unrestricted()
    const { handle } = makeDb([[
      { id: 'req-a', orgId: 'org-a', title: 'One', assigneeId: null },
    ]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a', 'gone-1', 'gone-2'],
      status: 'in_progress',
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, notFound: ['gone-1', 'gone-2'] })
  })

  it('fires the same notifications and domain event per row as the single PATCH', async () => {
    unrestricted()
    const { handle } = makeDb([[
      { id: 'req-a', orgId: 'org-a', title: 'One', assigneeId: 'tm-1' },
      { id: 'req-b', orgId: 'org-b', title: 'Two', assigneeId: null },
    ]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a', 'req-b'],
      status: 'delivered',
    }))
    expect(res.status).toBe(200)

    expect(vi.mocked(notifyOrgContacts)).toHaveBeenCalledTimes(2)
    // Only the row that has an assignee gets the assignee notification.
    expect(vi.mocked(notifyTeamMember)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dispatchDomainEvent)).toHaveBeenCalledTimes(2)
    const [, event] = vi.mocked(dispatchDomainEvent).mock.calls[0]
    expect(event.type).toBe('request_status_changed')
    expect(event.data?.status).toBe('delivered')
  })

  it('treats archived: true as the archived status for the effects too', async () => {
    unrestricted()
    const { handle } = makeDb([[
      { id: 'req-a', orgId: 'org-a', title: 'One', assigneeId: null },
    ]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a'],
      archived: true,
    }))
    expect(res.status).toBe(200)
    const [, event] = vi.mocked(dispatchDomainEvent).mock.calls[0]
    expect(event.data?.status).toBe('archived')
  })

  it('fires nothing when only the assignee moved', async () => {
    unrestricted()
    const { handle } = makeDb([[
      { id: 'req-a', orgId: 'org-a', title: 'One', assigneeId: null },
    ]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkPatch(jsonReq('/api/admin/requests/bulk', 'PATCH', {
      ids: ['req-a'],
      assigneeId: 'tm-2',
    }))
    expect(res.status).toBe(200)
    expect(vi.mocked(dispatchDomainEvent)).not.toHaveBeenCalled()
    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// B1: POST /api/admin/requests/bulk (cross-client create)
// ---------------------------------------------------------------------------
describe('POST /api/admin/requests/bulk', () => {
  it('403s a batch that names a client outside the caller scope', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb([[{ id: 'org-a' }, { id: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkCreate(jsonReq('/api/admin/requests/bulk', 'POST', {
      orgIds: ['org-a', 'org-b'],
      title: 'Quarterly check-in',
    }))
    expect(res.status).toBe(403)
    const json = await res.json() as { orgIds?: string[] }
    expect(json.orgIds).toEqual(['org-b'])
    expect(methodsUsed(queries)).not.toContain('run')
  })

  it('404s an unknown client org', async () => {
    unrestricted()
    const { handle, queries } = makeDb([[{ id: 'org-a' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkCreate(jsonReq('/api/admin/requests/bulk', 'POST', {
      orgIds: ['org-a', 'org-typo'],
      title: 'Quarterly check-in',
    }))
    expect(res.status).toBe(404)
    expect(methodsUsed(queries)).not.toContain('run')
  })

  it('numbers each created request inside its own client sequence', async () => {
    unrestricted()
    const { handle, queries } = makeDb([[{ id: 'org-a' }, { id: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await bulkCreate(jsonReq('/api/admin/requests/bulk', 'POST', {
      orgIds: ['org-a', 'org-b'],
      title: 'Quarterly check-in',
    }))
    expect(res.status).toBe(201)
    const json = await res.json() as { created: number; ids: string[] }
    expect(json.created).toBe(2)

    const inserts = queries.filter((q) => q.calls[0].method === 'run')
    expect(inserts).toHaveLength(2)
    for (const insert of inserts) {
      const sql = collect(insert, 'run')
      expect(sql.text).toContain('MAX(request_number) FROM requests WHERE org_id')
    }
  })
})

// ---------------------------------------------------------------------------
// I2, I3, I4: the per-request sub-routes
// ---------------------------------------------------------------------------
describe('request sub-routes resolve the owning request', () => {
  const cases: Array<{
    name: string
    call: (id: string) => Promise<Response>
  }> = [
    { name: 'steps GET', call: (id) => stepsList(req(`/api/admin/requests/${id}/steps`), params(id)) },
    { name: 'messages GET', call: (id) => messagesList(req(`/api/admin/requests/${id}/messages`), params(id)) },
    { name: 'time entries GET', call: (id) => timeEntriesList(req(`/api/admin/requests/${id}/time-entries`), params(id)) },
    { name: 'files GET', call: (id) => filesList(req(`/api/admin/requests/${id}/files`), params(id)) },
    { name: 'calls GET', call: (id) => callsList(req(`/api/admin/requests/${id}/calls`), params(id)) },
    { name: 'voice notes GET', call: (id) => voiceNotesList(req(`/api/admin/requests/${id}/voice-notes`), params(id)) },
  ]

  for (const c of cases) {
    it(`403s ${c.name} on another client's request`, async () => {
      scopedTo(['org-a'])
      const { handle } = makeDb([[{ orgId: 'org-b' }]])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await c.call('req-b')
      expect(res.status).toBe(403)
    })

    it(`404s ${c.name} on a request that does not exist`, async () => {
      unrestricted()
      const { handle } = makeDb([[]])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await c.call('nope')
      expect(res.status).toBe(404)
    })
  }

  it('403s a step create against another client request, before the insert', async () => {
    scopedTo(['org-a'])
    const { handle, queries } = makeDb([[{ orgId: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await stepCreate(
      jsonReq('/api/admin/requests/req-b/steps', 'POST', { title: 'Injected step' }),
      params('req-b'),
    )
    expect(res.status).toBe(403)
    expect(methodsUsed(queries)).not.toContain('insert')
  })
})

// ---------------------------------------------------------------------------
// I9: nest
// ---------------------------------------------------------------------------
describe('POST /api/admin/requests/[id]/nest', () => {
  it('400s a body with no parentRequestId key rather than un-nesting', async () => {
    unrestricted()
    const { handle } = makeDb([[{ id: 'req-a', orgId: 'org-a' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await nest(jsonReq('/api/admin/requests/req-a/nest', 'POST', {}), params('req-a'))
    expect(res.status).toBe(400)
    const json = await res.json() as { error?: string }
    expect(json.error).toContain('parentRequestId is required')
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })

  it('400s a malformed or empty body', async () => {
    unrestricted()
    const res = await nest(emptyReq('/api/admin/requests/req-a/nest', 'POST'), params('req-a'))
    expect(res.status).toBe(400)
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })

  it('400s a parentRequestId that is not a string or null', async () => {
    unrestricted()
    const res = await nest(
      jsonReq('/api/admin/requests/req-a/nest', 'POST', { parentRequestId: 7 }),
      params('req-a'),
    )
    expect(res.status).toBe(400)
    expect(vi.mocked(db)).not.toHaveBeenCalled()
  })

  it('still un-nests on an explicit null', async () => {
    unrestricted()
    const { handle } = makeDb([[{ id: 'req-a', orgId: 'org-a' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await nest(
      jsonReq('/api/admin/requests/req-a/nest', 'POST', { parentRequestId: null }),
      params('req-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, parentRequestId: null })
  })

  it('403s a scoped caller on another client request', async () => {
    scopedTo(['org-a'])
    const { handle } = makeDb([[{ id: 'req-b', orgId: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await nest(
      jsonReq('/api/admin/requests/req-b/nest', 'POST', { parentRequestId: null }),
      params('req-b'),
    )
    expect(res.status).toBe(403)
  })
})
