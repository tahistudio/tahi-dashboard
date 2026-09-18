/**
 * POST /api/portal/requests/[id]/handback
 *
 * The client's way out of a hand-off, and the one route in this feature where
 * the authorisation question is genuinely interesting: a request handed to the
 * finance lead for a spend decision is not something a colleague gets to wave
 * away, so "any contact at the org" is the wrong answer. The named person, or
 * a workspace admin, and nobody else.
 *
 * Also guarded here: org scoping (another client's request is Not found, never
 * Forbidden), the whole pointer being cleared rather than half of it, and the
 * studio actually being told, because this is the only signal that a hand-off
 * is not going to resolve itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requirePortalFeature: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), logAuditStrict: vi.fn() }))
vi.mock('@/lib/notify-request-team', () => ({ notifyRequestTeam: vi.fn() }))
vi.mock('@/lib/acting-as', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/acting-as')>()),
  recordActingWrite: vi.fn(),
}))

import { getPortalAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { requirePortalFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/portal/requests/[id]/handback/route'

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

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function post(body: unknown = {}) {
  return new NextRequest('http://localhost:3000/api/portal/requests/req-1/handback', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const HANDED_OFF = {
  id: 'req-1',
  orgId: 'org-a',
  title: 'Spring landing page',
  assigneeId: 'tm-1',
  waitingOnContactId: 'contact-1',
  waitingReason: 'approval',
  waitingSince: '2026-09-15T09:00:00.000Z',
}

const NAMED = { id: 'contact-1', name: 'Ngaire Hutchins', portalRole: 'member', isPrimary: false }
const COLLEAGUE = { id: 'contact-2', name: 'Tama Rewi', portalRole: 'member', isPrimary: false }
const ADMIN = { id: 'contact-3', name: 'Pip Ngata', portalRole: 'admin', isPrimary: false }

function firstSet(queries: QueryRecord[][]): unknown {
  return queries.flat().find(c => c.method === 'set')?.args[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requirePortalFeature).mockResolvedValue(null as never)
  vi.mocked(getPortalAuth).mockResolvedValue({
    orgId: 'org-a', userId: 'user_ngaire', clerkOrgId: 'org_clerk_a', contactId: null,
  } as never)
})

describe('POST handback, refusals', () => {
  it('403s a caller with no client org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue({ orgId: null, userId: 'u' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await POST(post(), params('req-1'))).status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('403s the Tahi org, which has the studio route for this', async () => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue({ orgId: 'org_tahi', userId: 'u' } as never)
    const { handle } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await POST(post(), params('req-1'))).status).toBe(403)
    delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
  })

  it('404s a request that is not this org\'s', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post(), params('req-1'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Not found' })
  })

  it('403s a colleague who is neither the named person nor an admin', async () => {
    const { handle, queries } = makeDb([[HANDED_OFF], [COLLEAGUE]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post(), params('req-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(2)
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled()
  })

  it('403s a caller with no contact row at this org at all', async () => {
    const { handle } = makeDb([[HANDED_OFF], []])
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await POST(post(), params('req-1'))).status).toBe(403)
  })

  it('400s a note that is not a string', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await POST(post({ note: 42 }), params('req-1'))).status).toBe(400)
    expect(queries).toHaveLength(0)
  })
})

describe('POST handback, the write', () => {
  it('lets the named person hand it back, clearing every pointer column', async () => {
    const { handle, queries } = makeDb([[HANDED_OFF], [NAMED]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post({ note: 'Not mine to approve, try Pip' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, waitingOn: null })

    expect(firstSet(queries)).toMatchObject({
      waitingOnContactId: null,
      waitingReason: null,
      waitingSince: null,
      waitingDueAt: null,
      waitingNote: null,
      waitingNudgedAt: null,
    })
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'request.handed_back',
        userType: 'contact',
        metadata: expect.objectContaining({
          reason: 'client_handed_back',
          contactId: 'contact-1',
          daysWaiting: expect.any(Number),
        }),
      }),
    )
  })

  it('carries the client\'s note into what the studio is told', async () => {
    const { handle } = makeDb([[HANDED_OFF], [NAMED]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await POST(post({ note: 'Not mine to approve, try Pip' }), params('req-1'))

    expect(vi.mocked(notifyRequestTeam)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: 'req-1', orgId: 'org-a' }),
      expect.objectContaining({
        title: 'Handed back to us: "Spring landing page"',
        body: expect.stringContaining('Not mine to approve, try Pip'),
      }),
    )
  })

  it('lets a workspace admin hand back a colleague\'s item, audited as such', async () => {
    const { handle } = makeDb([[HANDED_OFF], [ADMIN]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post(), params('req-1'))
    expect(res.status).toBe(200)
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'client_admin_handed_back' }),
      }),
    )
  })

  it('is a silent no-op on a request nobody is waiting on', async () => {
    const { handle } = makeDb([[{ ...HANDED_OFF, waitingOnContactId: null }], [NAMED]])
    vi.mocked(db).mockResolvedValue(handle as never)

    // The caller is not the named person (there is none), so only the admin
    // branch can reach the no-op. That is the real shape: a stale button.
    const res = await POST(post(), params('req-1'))
    expect(res.status).toBe(403)
  })

  it('is a silent no-op for an admin when the pointer is already clear', async () => {
    const { handle, queries } = makeDb([[{ ...HANDED_OFF, waitingOnContactId: null }], [ADMIN]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post(), params('req-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, waitingOn: null })
    expect(queries).toHaveLength(2)
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled()
  })
})
