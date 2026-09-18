/**
 * GET /api/admin/requests: the `waitingOn` field and the `?waitingOn=client`
 * filter.
 *
 * Two separate promises, both of which the UI slice above this depends on:
 *
 *   1. EVERY row carries `waitingOn`, null or resolved, so the list and the
 *      kanban card can draw the chip without a second fetch;
 *   2. `?waitingOn=client` narrows to requests actually handed to somebody,
 *      which is what the rail's saved view and the MCP tool both ask, and
 *      `?waitingOlderThanDays=` narrows that to the ones that have gone quiet.
 *
 * The filter is asserted by walking the WHERE clause drizzle built for the
 * columns it names, rather than by counting rows: the fake D1 here returns
 * whatever it is handed regardless of the predicate, so a row count would pass
 * with the filter deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))
vi.mock('@/lib/request-participants', () => ({ loadRequestParticipants: vi.fn() }))
vi.mock('@/lib/blockers-server', () => ({ openBlockerCounts: vi.fn() }))
vi.mock('@/lib/request-handoff', () => ({ loadWaitingOn: vi.fn() }))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { loadRequestParticipants } from '@/lib/request-participants'
import { openBlockerCounts } from '@/lib/blockers-server'
import { loadWaitingOn } from '@/lib/request-handoff'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/requests/route'

type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, calls: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[][] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const calls: QueryRecord[] = [{ method, args }]
    queries.push(calls)
    return makeChain(queue.length ? queue.shift() : [], calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

/**
 * Every column name drizzle put into a WHERE clause, however deeply nested the
 * and() / or() tree is. Enough to prove a predicate was added without
 * pretending to execute SQL.
 */
function columnNames(node: unknown, seen = new Set<unknown>()): string[] {
  if (!node || typeof node !== 'object' || seen.has(node)) return []
  seen.add(node)
  const out: string[] = []
  const record = node as Record<string, unknown>
  if (typeof record.name === 'string' && typeof record.columnType === 'string') {
    out.push(record.name)
  }
  for (const [key, value] of Object.entries(record)) {
    // `table` back-references the whole requests table, whose own column map
    // names every column in the schema. Following it would make this assert
    // "the requests table has a waiting_since column", which is true with the
    // filter deleted.
    if (key === 'table') continue
    if (Array.isArray(value)) for (const v of value) out.push(...columnNames(v, seen))
    else if (value && typeof value === 'object') out.push(...columnNames(value, seen))
  }
  return out
}

const ROW = {
  id: 'req-1',
  orgId: 'org-a',
  title: 'Spring landing page',
  status: 'in_progress',
}

function get(query = '') {
  return new NextRequest(`http://localhost:3000/api/admin/requests${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
  vi.mocked(loadRequestParticipants).mockResolvedValue(new Map())
  vi.mocked(openBlockerCounts).mockResolvedValue({})
  vi.mocked(loadWaitingOn).mockResolvedValue(new Map())
})

describe('GET /api/admin/requests, waitingOn', () => {
  it('carries a null waitingOn on a request that is with the studio', async () => {
    const { handle } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(get())
    expect(res.status).toBe(200)
    const body = await res.json() as { requests: Array<Record<string, unknown>> }
    expect(body.requests[0]).toMatchObject({ id: 'req-1', waitingOn: null })
  })

  it('carries the resolved pointer on a request that is with a client', async () => {
    const waitingOn = {
      contactId: 'contact-1',
      contactName: 'Ngaire Hutchins',
      reason: 'approval',
      reasonLabel: 'Needs your approval',
      since: '2026-09-15T09:00:00.000Z',
      dueAt: null,
      note: null,
      daysWaiting: 3,
    }
    vi.mocked(loadWaitingOn).mockResolvedValue(new Map([['req-1', waitingOn]]) as never)
    const { handle } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as { requests: Array<Record<string, unknown>> }
    expect(body.requests[0].waitingOn).toEqual(waitingOn)
  })

  it('does not filter on the pointer without the flag', async () => {
    const { handle, queries } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await GET(get('?status=all'))
    const where = queries[0].find(c => c.method === 'where')?.args[0]
    expect(columnNames(where)).not.toContain('waiting_on_contact_id')
  })

  it('filters to handed-off requests with ?waitingOn=client', async () => {
    const { handle, queries } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await GET(get('?status=all&waitingOn=client'))
    const names = columnNames(queries[0].find(c => c.method === 'where')?.args[0])
    expect(names).toContain('waiting_on_contact_id')
    expect(names).not.toContain('waiting_since')
  })

  it('adds the age cutoff with ?waitingOlderThanDays', async () => {
    const { handle, queries } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await GET(get('?status=all&waitingOn=client&waitingOlderThanDays=5'))
    const names = columnNames(queries[0].find(c => c.method === 'where')?.args[0])
    expect(names).toContain('waiting_on_contact_id')
    expect(names).toContain('waiting_since')
  })

  it('ignores a nonsense waitingOlderThanDays rather than 400ing the list', async () => {
    const { handle, queries } = makeDb([[ROW]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(get('?status=all&waitingOn=client&waitingOlderThanDays=soon'))
    expect(res.status).toBe(200)
    const names = columnNames(queries[0].find(c => c.method === 'where')?.args[0])
    expect(names).not.toContain('waiting_since')
  })
})
