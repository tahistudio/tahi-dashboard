/**
 * PATCH /api/admin/call-transcripts/[id]: attaching parked call notes.
 *
 * This is the route that turns "the matcher refused to guess" into "Liam said
 * which call it was", so the cases that matter are the refusals: a bad kind, a
 * call that does not exist, and a call belonging to a client this caller
 * cannot see. The mirror onto a discovery call is the other half: it must
 * happen when that call has no transcript, and must never overwrite one.
 *
 * Same fake-D1 pattern as app/api/admin/calls/__tests__/prep-note.test.ts.
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

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/call-transcripts/[id]/route'

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
  return new NextRequest('http://localhost:3000/api/admin/call-transcripts/ct-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const parkedRow = {
  id: 'ct-1',
  callKind: null,
  callId: null,
  source: 'gemini_drive',
  externalId: 'drive-1',
  title: 'Meeting (Tim Lyons) - Notes by Gemini',
  receivedAt: '2026-09-18T03:00:00Z',
  hash: 'abcd1234',
  text: 'Tim: we agreed on the new homepage',
  summary: 'Agreed the homepage scope.',
  wrapUp: 'SUMMARY\nAgreed the homepage scope.',
  matchedBy: null,
  unlinkedReason: 'ambiguous',
  createdAt: '2026-09-18T03:05:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveAccessScoping).mockResolvedValue(null)
})

describe('PATCH /api/admin/call-transcripts/[id], validation', () => {
  it('400s an unknown call kind without reading anything', async () => {
    const { handle, queries } = makeDb([])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'zoom', callId: 'c-1' }), params('ct-1'))
    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('400s a missing callId', async () => {
    const { handle } = makeDb([])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'discovery', callId: '   ' }), params('ct-1'))
    expect(res.status).toBe(400)
  })

  it('404s an unknown transcript', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'discovery', callId: 'disc-1' }), params('ct-nope'))
    expect(res.status).toBe(404)
  })

  it('404s when the target call does not exist, writing nothing', async () => {
    const { handle, queries } = makeDb([[parkedRow], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'scheduled', callId: 'sched-nope' }), params('ct-1'))
    expect(res.status).toBe(404)
    expect(queries.some(q => q[0].method === 'update')).toBe(false)
  })
})

describe('PATCH /api/admin/call-transcripts/[id], access scope', () => {
  it('403s a caller with no access to the target call\'s client', async () => {
    const { handle, queries } = makeDb([[parkedRow], [{ orgId: 'org-a' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    vi.mocked(resolveAccessScoping).mockResolvedValue(['org-b'])

    const res = await PATCH(req({ callKind: 'scheduled', callId: 'sched-1' }), params('ct-1'))
    expect(res.status).toBe(403)
    expect(queries.some(q => q[0].method === 'update')).toBe(false)
  })

  it('403s a caller with no access rules at all', async () => {
    const { handle } = makeDb([[parkedRow], [{ orgId: 'org-a' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    vi.mocked(resolveAccessScoping).mockResolvedValue([])

    const res = await PATCH(req({ callKind: 'scheduled', callId: 'sched-1' }), params('ct-1'))
    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/admin/call-transcripts/[id], attaching', () => {
  it('links a scheduled call and leaves scheduled_calls alone', async () => {
    const { handle, queries } = makeDb([[parkedRow], [{ orgId: 'org-a' }], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'scheduled', callId: 'sched-1' }), params('ct-1'))
    expect(res.status).toBe(200)
    const payload = await res.json() as { mirrored: boolean; callKind: string }
    expect(payload).toMatchObject({ callKind: 'scheduled', mirrored: false })

    const updates = queries.filter(q => q[0].method === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].find(c => c.method === 'set')?.args[0]).toMatchObject({
      callKind: 'scheduled',
      callId: 'sched-1',
      matchedBy: 'manual',
      unlinkedReason: null,
    })
  })

  it('copies text and summary onto a discovery call that has none', async () => {
    const { handle, queries } = makeDb([
      [parkedRow],
      [{ orgId: null }],
      [],
      [{ transcript: null, summary: null }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'discovery', callId: 'disc-1' }), params('ct-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mirrored: true })

    const updates = queries.filter(q => q[0].method === 'update')
    expect(updates).toHaveLength(2)
    expect(updates[1].find(c => c.method === 'set')?.args[0]).toMatchObject({
      transcript: parkedRow.text,
      summary: parkedRow.summary,
      transcriptSource: 'gemini_drive',
    })
  })

  it('never overwrites a transcript already on the discovery call', async () => {
    const { handle, queries } = makeDb([
      [parkedRow],
      [{ orgId: null }],
      [],
      [{ transcript: 'pasted by hand', summary: 'mine' }],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(req({ callKind: 'discovery', callId: 'disc-1' }), params('ct-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mirrored: false })
    expect(queries.filter(q => q[0].method === 'update')).toHaveLength(1)
  })
})
