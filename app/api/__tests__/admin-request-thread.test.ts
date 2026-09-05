/**
 * GET /api/admin/requests/[id]/messages - the studio half of the request
 * thread.
 *
 * Access scoping for this route is covered in admin-requests-scoping.test.ts.
 * What is asserted here is the SQL the read actually builds, because two of
 * its rules are invisible in the rows it returns:
 *
 *   1. a soft-deleted message stays out of the thread. "Delete" used to mean
 *      "stamp a column" and the row kept rendering, so the filter has to be
 *      pinned to the query rather than to a fixture,
 *   2. the file lookup is SLICED. D1 caps a statement at 100 bound parameters
 *      and a thread is unbounded, so one IN over every message id threw
 *      somewhere around the 99th message and took the whole thread with it.
 *
 * The fake D1 is the recorder from admin-requests-scoping.test.ts: real
 * drizzle, real schema, every call captured so the built statement can be
 * walked for its columns and bound parameters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))

vi.mock('@/lib/notifications', () => ({
  notifyTeamMember: vi.fn().mockResolvedValue(undefined),
  notifyOrgContacts: vi.fn().mockResolvedValue(undefined),
  notifyMentionedPerson: vi.fn().mockResolvedValue(undefined),
}))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/requests/[id]/messages/route'
import { THREAD_ID_CHUNK } from '@/lib/request-thread'

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
  const entry = (method: string, args: unknown[], result: unknown) => {
    const record: QueryRecord = { calls: [{ method, args }] }
    queries.push(record)
    return makeChain(result, record)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args, queue.length ? queue.shift() : []),
    insert: (...args: unknown[]) => entry('insert', args, []),
    update: (...args: unknown[]) => entry('update', args, []),
    delete: (...args: unknown[]) => entry('delete', args, []),
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

const used = (record: QueryRecord, method: string) =>
  record.calls.some(c => c.method === method)

/** The thread read is the only query that orders its rows. */
const threadQuery = (queries: QueryRecord[]) => queries.find(q => used(q, 'orderBy'))

/** The file lookups are the ones filtering on files.message_id. */
const fileQueries = (queries: QueryRecord[]) =>
  queries.filter(q => !used(q, 'orderBy') && collect(q, 'where').cols.includes('message_id'))

function req(id: string) {
  return new NextRequest(`http://localhost:3000/api/admin/requests/${id}/messages`, { method: 'GET' })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

/** A thread of n messages, as the messages select would return it. */
function thread(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    authorId: 'tm1',
    authorType: 'team_member',
    body: 'x',
    isInternal: false,
    editedAt: null,
    createdAt: `t${i}`,
    teamMemberName: 'Ana',
    teamMemberAvatar: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

describe('GET /api/admin/requests/[id]/messages', () => {
  it('leaves a soft-deleted message out of the thread', async () => {
    const { handle, queries } = makeDb([[{ orgId: 'org-a' }], thread(2)])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('r1'), params('r1'))
    expect(res.status).toBe(200)

    const where = collect(threadQuery(queries)!, 'where')
    expect(where.cols).toContain('deleted_at')
    expect(where.text).toContain('is null')
    // Still scoped to this request, not just filtered.
    expect(where.cols).toContain('request_id')
    expect(where.params).toContain('r1')
  })

  it('slices the file lookup so a long thread cannot blow the D1 parameter cap', async () => {
    const msgs = thread(150)
    const { handle, queries } = makeDb([
      [{ orgId: 'org-a' }],
      msgs,
      // One result set per slice: a file at each end proves the union puts
      // both chunks back together.
      [{ id: 'f_first', messageId: 'm0', filename: 'first.png', mimeType: null, sizeBytes: 1, storageKey: 'k1' }],
      [{ id: 'f_last', messageId: 'm149', filename: 'last.png', mimeType: null, sizeBytes: 2, storageKey: 'k2' }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('r1'), params('r1'))
    expect(res.status).toBe(200)

    const files = fileQueries(queries)
    expect(files.length).toBeGreaterThan(1)
    for (const q of files) {
      expect(collect(q, 'where').params.length).toBeLessThanOrEqual(THREAD_ID_CHUNK)
    }
    // Every id is asked for exactly once, in order.
    expect(files.flatMap(q => collect(q, 'where').params.filter(p => typeof p === 'string')))
      .toEqual(msgs.map(m => m.id))

    const json = await res.json() as {
      items: Array<{ id: string; files: Array<{ filename: string }> }>
    }
    expect(json.items).toHaveLength(150)
    expect(json.items[0].files.map(f => f.filename)).toEqual(['first.png'])
    expect(json.items[149].files.map(f => f.filename)).toEqual(['last.png'])
  })

  it('asks for no files at all when the thread is empty', async () => {
    const { handle, queries } = makeDb([[{ orgId: 'org-a' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('r1'), params('r1'))
    expect(res.status).toBe(200)
    expect(fileQueries(queries)).toHaveLength(0)
  })

  it('hands the page the thread conversation to reuse instead of minting one', async () => {
    const { handle } = makeDb([
      [{ orgId: 'org-a' }],
      thread(1),
      [],
      // Two rows already exist from before the hydration fix; the external one
      // is the canonical thread whatever order they come back in.
      [
        { id: 'conv_internal', type: 'request_thread', visibility: 'internal', createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 'conv_external', type: 'request_thread', visibility: 'external', createdAt: '2026-09-01T00:00:00.000Z' },
      ],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('r1'), params('r1'))
    const json = await res.json() as { conversationId: string | null }
    expect(json.conversationId).toBe('conv_external')
  })

  it('reports no conversation when the request has never had one', async () => {
    const { handle } = makeDb([[{ orgId: 'org-a' }], thread(1), [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('r1'), params('r1'))
    const json = await res.json() as { conversationId: string | null }
    expect(json.conversationId).toBeNull()
  })
})
