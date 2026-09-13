/**
 * PATCH /api/admin/calls/[id]: prepNote field coverage.
 *
 * scheduled_calls has no dedicated prep_note column: prepNote is an alias
 * that writes into the existing notes column (see the route's own doc
 * comment). Same fake-D1 pattern as patch-link-fields.test.ts in this
 * directory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
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
import { PATCH } from '@/app/api/admin/calls/[id]/route'

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
  return new NextRequest('http://localhost:3000/api/admin/calls/call-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const existingCall = { orgId: 'org-a', title: 'Check-in', description: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

describe('PATCH /api/admin/calls/[id], prepNote', () => {
  it('writes a trimmed prepNote into the notes column', async () => {
    const { handle, queries } = makeDb([[existingCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: '  Confirm renewal date  ' }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ notes: 'Confirm renewal date' })
  })

  it('clears notes with an empty prepNote string', async () => {
    const { handle, queries } = makeDb([[existingCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: '' }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ notes: null })
  })

  it('clears notes with a null prepNote', async () => {
    const { handle, queries } = makeDb([[existingCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: null }), params('call-1'))
    expect(res.status).toBe(200)
    const updateCall = queries[1].find(c => c.method === 'set')
    expect(updateCall?.args[0]).toMatchObject({ notes: null })
  })

  it('400s a prepNote over 4000 characters, writing nothing', async () => {
    const { handle, queries } = makeDb([[existingCall]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ prepNote: 'x'.repeat(4001) }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('prepNote')
    expect(queries).toHaveLength(1)
  })
})
