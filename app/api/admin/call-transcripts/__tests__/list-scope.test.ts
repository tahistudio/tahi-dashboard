/**
 * GET /api/admin/call-transcripts: what a restricted caller may read.
 *
 * These rows hold verbatim client conversation, so a linked transcript has to
 * be filtered by the org of the call it sits on. An UNLINKED one has no client
 * yet and follows the same allow-if-any-scope rule as a pre-client call, which
 * is the only way a scoped teammate could ever help place one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scope')>()),
  scopedOrgIds: vi.fn(),
}))

import { db } from '@/lib/db'
import { scopedOrgIds } from '@/lib/access-scope'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/call-transcripts/route'

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

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    callKind: null,
    callId: null,
    source: 'gemini_drive',
    externalId: 'drive-1',
    title: 'Meeting (Tim Lyons) - Notes by Gemini',
    receivedAt: '2026-09-18T03:00:00Z',
    summary: 'Agreed the homepage scope.',
    unlinkedReason: 'no_match',
    matchedBy: null,
    text: 'x'.repeat(400),
    ...over,
  }
}

function req(query = '') {
  return new NextRequest(`http://localhost:3000/api/admin/call-transcripts${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
})

describe('GET /api/admin/call-transcripts', () => {
  it('returns nothing to a caller with no access rules', async () => {
    const { handle, queries } = makeDb([])
    vi.mocked(db).mockResolvedValue(handle as never)
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })

    const res = await GET(req('?unlinked=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
    expect(queries).toHaveLength(0)
  })

  it('caps the preview and reports the full length', async () => {
    const { handle } = makeDb([[row()]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await GET(req('?unlinked=1'))
    const body = await res.json() as { items: Array<{ preview: string; textLength: number }> }
    expect(body.items[0].preview).toHaveLength(160)
    expect(body.items[0].textLength).toBe(400)
  })

  it('hides a linked transcript whose client is out of scope, keeps the unplaced one', async () => {
    const { handle } = makeDb([
      [
        row({ id: 'ct-out', callKind: 'scheduled', callId: 'sched-1', unlinkedReason: null }),
        row({ id: 'ct-parked' }),
      ],
      [{ id: 'sched-1', orgId: 'org-a' }],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org-b'] })

    const res = await GET(req())
    const body = await res.json() as { items: Array<{ id: string }> }
    expect(body.items.map(i => i.id)).toEqual(['ct-parked'])
  })

  it('keeps a linked transcript whose client is in scope', async () => {
    const { handle } = makeDb([
      [row({ id: 'ct-in', callKind: 'discovery', callId: 'disc-1', unlinkedReason: null })],
      [{ id: 'disc-1', orgId: 'org-b' }],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org-b'] })

    const res = await GET(req())
    const body = await res.json() as { items: Array<{ id: string }> }
    expect(body.items.map(i => i.id)).toEqual(['ct-in'])
  })
})
