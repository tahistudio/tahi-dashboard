/**
 * POST / DELETE /api/admin/requests/[id]/handoff
 *
 * The studio half of the client hand-off. What is actually being guarded:
 *
 *   - admin auth, then access scoping on the REQUEST'S org, so a scoped team
 *     member cannot hand off work for a client they cannot see;
 *   - the contact has to belong to that same client, or a hand-off could put
 *     one client's request in another client's portal and mail them its title;
 *   - the participant row carries the role the REASON implies, not a fixed one;
 *   - the pointer, the audit row and the notification all happen, because each
 *     one is the only source of a different thing (now / history / the client
 *     actually finding out);
 *   - a contact with no seat gets an app invite minted first, so the email's
 *     button does not land them on a sign-in wall.
 *
 * Fake-D1 pattern borrowed from app/api/admin/calls/__tests__.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrg: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), logAuditStrict: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/notify-request-team', () => ({ notifyRequestTeam: vi.fn() }))
vi.mock('@/lib/onboarding-invites', () => ({ ensureClientInvite: vi.fn() }))

import { getRequestAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import { ensureClientInvite } from '@/lib/onboarding-invites'
import { NextRequest, NextResponse } from 'next/server'
import { POST, DELETE } from '@/app/api/admin/requests/[id]/handoff/route'

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

function post(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/requests/req-1/handoff', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function del(body: unknown = {}) {
  return new NextRequest('http://localhost:3000/api/admin/requests/req-1/handoff', {
    method: 'DELETE',
    body: JSON.stringify(body),
  })
}

const REQUEST = {
  id: 'req-1',
  orgId: 'org-a',
  title: 'Spring landing page',
  requestNumber: 42,
  assigneeId: 'tm-1',
  waitingOnContactId: null,
  waitingReason: null,
  waitingSince: null,
}

const CONTACT = {
  id: 'contact-1',
  name: 'Ngaire Hutchins',
  email: 'ngaire@mahanaorchards.co.nz',
  clerkUserId: 'user_ngaire',
}

/** Find the args of the Nth call of a method across the whole query log. */
function nthSet(queries: QueryRecord[][], n: number): unknown {
  const sets = queries.flat().filter(c => c.method === 'set')
  return sets[n]?.args[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' } as never)
  vi.mocked(requireAccessToOrg).mockResolvedValue(null as never)
  vi.mocked(ensureClientInvite).mockResolvedValue({
    id: 'inv-1',
    token: 'tok',
    path: '/onboarding?invite=tok',
    link: 'https://portal.tahi.studio/onboarding?invite=tok',
    expiresAt: '2026-10-01T00:00:00.000Z',
    reused: false,
  } as never)
})

describe('POST handoff, refusals', () => {
  it('403s a non-admin caller before touching the database', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post({ contactId: 'contact-1', reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('400s a reason outside the closed set', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post({ contactId: 'contact-1', reason: 'blocked' }), params('req-1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('reason must be') })
    expect(queries).toHaveLength(0)
  })

  it('400s a missing contactId', async () => {
    const { handle } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post({ reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(400)
  })

  it('400s an unparseable dueAt, writing nothing', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(
      post({ contactId: 'contact-1', reason: 'approval', dueAt: 'next tuesday' }),
      params('req-1'),
    )
    expect(res.status).toBe(400)
    expect(queries).toHaveLength(0)
  })

  it('404s an unknown request', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post({ contactId: 'contact-1', reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(404)
  })

  it('defers to access scoping on the request\'s own org', async () => {
    vi.mocked(requireAccessToOrg).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }) as never,
    )
    const { handle } = makeDb([[REQUEST]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post({ contactId: 'contact-1', reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(403)
    expect(vi.mocked(requireAccessToOrg)).toHaveBeenCalledWith(
      expect.anything(), 'user_member', 'org-a',
    )
  })

  it('404s a contact that does not belong to this client, and writes nothing', async () => {
    const { handle, queries } = makeDb([[REQUEST], []])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post({ contactId: 'contact-elsewhere', reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Contact not found for this client' })
    expect(queries).toHaveLength(2)
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled()
  })
})

describe('POST handoff, the write', () => {
  it('writes an approver participant row, the pointer, the audit and the notification', async () => {
    const { handle, queries } = makeDb([[REQUEST], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post({
      contactId: 'contact-1',
      reason: 'approval',
      note: '  Sign off the hero copy  ',
      dueAt: '2026-09-22',
    }), params('req-1'))

    expect(res.status).toBe(200)

    const inserted = queries.flat().find(c => c.method === 'values')?.args[0] as Record<string, unknown>
    expect(inserted).toMatchObject({
      requestId: 'req-1',
      participantId: 'contact-1',
      participantType: 'contact',
      role: 'approver',
    })

    // set #0 soft-deletes any row under the other hand-off role; set #1 is the
    // pointer itself.
    expect(nthSet(queries, 1)).toMatchObject({
      waitingOnContactId: 'contact-1',
      waitingReason: 'approval',
      waitingDueAt: '2026-09-22T00:00:00.000Z',
      waitingNote: 'Sign off the hero copy',
      waitingNudgedAt: null,
    })

    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'request.handed_off',
        entityId: 'req-1',
        metadata: expect.objectContaining({ contactId: 'contact-1', reason: 'approval', role: 'approver' }),
      }),
    )

    expect(vi.mocked(createNotification)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        recipient: { contactId: 'contact-1' },
        type: 'request_waiting_on_you',
        title: 'Needs your approval: "Spring landing page"',
        entityType: 'request',
        entityId: 'req-1',
        email: expect.objectContaining({ template: 'request-waiting-on-you' }),
      }),
    )

    const body = await res.json() as { request: { waitingOn: Record<string, unknown> } }
    expect(body.request.waitingOn).toMatchObject({
      contactId: 'contact-1',
      contactName: 'Ngaire Hutchins',
      contactEmail: 'ngaire@mahanaorchards.co.nz',
      reason: 'approval',
      reasonLabel: 'Needs your approval',
      daysWaiting: 0,
    })
  })

  it('writes a contributor row for every reason that is not approval', async () => {
    const { handle, queries } = makeDb([[REQUEST], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await POST(post({ contactId: 'contact-1', reason: 'file' }), params('req-1'))

    const inserted = queries.flat().find(c => c.method === 'values')?.args[0] as Record<string, unknown>
    expect(inserted).toMatchObject({ role: 'contributor' })
  })

  it('does not insert a second participant row when one is already active', async () => {
    const { handle, queries } = makeDb([[REQUEST], [CONTACT], [], [{ id: 'part-1' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(post({ contactId: 'contact-1', reason: 'approval' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(queries.flat().some(c => c.method === 'values')).toBe(false)
  })

  it('mints an app invite for a contact with no seat, and points the email at it', async () => {
    const { handle } = makeDb([[REQUEST], [{ ...CONTACT, clerkUserId: null }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    await POST(post({ contactId: 'contact-1', reason: 'content' }), params('req-1'))

    expect(vi.mocked(ensureClientInvite)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        flow: 'client',
        orgId: 'org-a',
        contactEmail: 'ngaire@mahanaorchards.co.nz',
      }),
    )
  })

  it('mints nothing for a contact who already has a seat', async () => {
    const { handle } = makeDb([[REQUEST], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)
    await POST(post({ contactId: 'contact-1', reason: 'content' }), params('req-1'))
    expect(vi.mocked(ensureClientInvite)).not.toHaveBeenCalled()
  })

  it('still answers 200 when the notification send blows up', async () => {
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('resend down'))
    const { handle } = makeDb([[REQUEST], [CONTACT]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await POST(post({ contactId: 'contact-1', reason: 'other' }), params('req-1'))
    expect(res.status).toBe(200)
  })
})

describe('DELETE handoff', () => {
  const handedOff = {
    ...REQUEST,
    waitingOnContactId: 'contact-1',
    waitingReason: 'approval',
    waitingSince: '2026-09-15T09:00:00.000Z',
  }

  it('403s a non-admin caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client' } as never)
    const { handle } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await DELETE(del(), params('req-1'))).status).toBe(403)
  })

  it('clears every pointer column, audits and tells the owner', async () => {
    const { handle, queries } = makeDb([[handedOff]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await DELETE(del({ note: 'I will just call them' }), params('req-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ request: { id: 'req-1', waitingOn: null } })

    expect(nthSet(queries, 0)).toMatchObject({
      waitingOnContactId: null,
      waitingReason: null,
      waitingSince: null,
      waitingDueAt: null,
      waitingNote: null,
      waitingNudgedAt: null,
    })
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'request.handed_back', entityId: 'req-1' }),
    )
    expect(vi.mocked(notifyRequestTeam)).toHaveBeenCalledTimes(1)
  })

  it('is a silent no-op on a request that is already back with us', async () => {
    const { handle, queries } = makeDb([[REQUEST]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await DELETE(del(), params('req-1'))
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(vi.mocked(logAudit)).not.toHaveBeenCalled()
    expect(vi.mocked(notifyRequestTeam)).not.toHaveBeenCalled()
  })

  it('404s an unknown request', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)
    expect((await DELETE(del(), params('req-1'))).status).toBe(404)
  })
})
