/**
 * PATCH /api/admin/calls/[id]: orgId reassignment + description coverage.
 *
 * This is the legacy scheduled_calls table (see the route's own doc
 * comment): no leadId / dealId / requestId / meetingType columns, so this
 * file only covers what actually exists on it, orgId (NOT NULL, so a
 * clear is refused, and a reassignment must both reference a real org and
 * stay inside the caller's access scope) plus description, and the
 * audit_log row either should leave.
 *
 * Fake D1 is the same queue-based chainable recorder as
 * app/api/__tests__/admin-scoping-routes.test.ts, which already covers the
 * status/notes/scheduledAt path on this same route, this file is
 * additive, not a replacement.
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
})

describe('PATCH /api/admin/calls/[id], orgId + description', () => {
  it('refuses to clear orgId (the column is NOT NULL)', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])
    const { handle, queries } = makeDb([[existingCall]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: null }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('orgId')
    expect(queries).toHaveLength(1)
  })

  it('400s an orgId that does not reference an existing organisation', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])
    const { handle, queries } = makeDb([[existingCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org-nope' }), params('call-1'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('orgId')
    expect(queries).toHaveLength(2)
  })

  it('403s a reassignment to an org outside the caller scope', async () => {
    // Scoped to org-a only: the call itself is inside scope, but the
    // target of the reassignment (org-b) is not.
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])
    const { handle, queries } = makeDb([[existingCall], [{ id: 'org-b' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org-b' }), params('call-1'))
    expect(res.status).toBe(403)
    // Existing-call lookup + the org-exists lookup, never reaches update.
    expect(queries).toHaveLength(2)
  })

  it('reassigns orgId to a real, in-scope org and writes an audit row', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(null) // unrestricted
    const { handle, queries } = makeDb([
      [existingCall],
      [{ id: 'org-b' }],
      [], // update
      [], // audit insert
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org-b' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(4)

    const updateSet = queries[2].find(c => c.method === 'set')
    expect(updateSet?.args[0]).toMatchObject({ orgId: 'org-b' })

    const insertValues = queries[3].find(c => c.method === 'values')
    const row = insertValues?.args[0] as { action: string; entityType: string; metadata: string }
    expect(row.action).toBe('scheduled_call_updated')
    expect(row.entityType).toBe('scheduled_call')
    const metadata = JSON.parse(row.metadata) as { changes: Record<string, { before: unknown; after: unknown }> }
    expect(metadata.changes.orgId).toEqual({ before: 'org-a', after: 'org-b' })
  })

  it('updates description and audits the change', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(null)
    const { handle, queries } = makeDb([[existingCall], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ description: 'Quarterly business review' }), params('call-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(3)

    const insertValues = queries[2].find(c => c.method === 'values')
    const row = insertValues?.args[0] as { metadata: string }
    const metadata = JSON.parse(row.metadata) as { changes: Record<string, { before: unknown; after: unknown }> }
    expect(metadata.changes.description).toEqual({ before: null, after: 'Quarterly business review' })
  })

  it('does not audit or requery the org when orgId is unchanged', async () => {
    vi.mocked(resolveAccessScoping).mockResolvedValue(null)
    const { handle, queries } = makeDb([[existingCall], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ orgId: 'org-a', status: 'completed' }), params('call-1'))
    expect(res.status).toBe(200)
    // Existing-call lookup + the update, no org-exists lookup, no audit
    // insert, because orgId didn't actually change.
    expect(queries).toHaveLength(2)
    expect(queries[1][0].method).toBe('update')
  })
})
