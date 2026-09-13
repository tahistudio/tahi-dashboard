/**
 * PATCH /api/admin/discovery-calls/[id]: prepNote field coverage.
 *
 * prepNote carries no link/audit implications (it is not in
 * AUDITED_FIELDS), so these tests only cover its own validation: length
 * cap and empty-string-clears. Mirrors the fake D1 + mocking pattern in
 * patch-link-fields.test.ts in this same directory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/access-scoping', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access-scoping')>()),
  resolveAccessScoping: vi.fn(),
}))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/discovery-calls/[id]/route'

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

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/discovery-calls/call-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const baseCall = {
  id: 'call-1',
  leadId: null,
  dealId: null,
  requestId: null,
  taskId: null,
  orgId: null,
  title: 'Discovery call',
  meetingType: 'discovery',
  status: 'scheduled',
  outcome: null,
  prepNote: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

describe('PATCH /api/admin/discovery-calls/[id], prepNote', () => {
  it('saves a trimmed prep note', async () => {
    const { handle, queries } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: '  Bring the scope doc  ' }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ prepNote: 'Bring the scope doc' })
  })

  it('clears the prep note with an empty string', async () => {
    const withNote = { ...baseCall, prepNote: 'Old note' }
    const { handle, queries } = makeDb([[withNote], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: '' }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ prepNote: null })
  })

  it('clears the prep note with null', async () => {
    const withNote = { ...baseCall, prepNote: 'Old note' }
    const { handle, queries } = makeDb([[withNote], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: null }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ prepNote: null })
  })

  it('400s a prep note over 4000 characters, writing nothing', async () => {
    const { handle, queries } = makeDb([[baseCall]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: 'x'.repeat(4001) }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('prepNote')
    // Only the existing-call lookup ran, no update.
    expect(queries).toHaveLength(1)
  })

  it('accepts exactly 4000 characters', async () => {
    const { handle, queries } = makeDb([[baseCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const exact = 'x'.repeat(4000)
    const res = await PATCH(req({ prepNote: exact }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ prepNote: exact })
  })
})
