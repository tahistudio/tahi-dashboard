/**
 * GET /api/portal/requests: the two hand-off lists the client home draws.
 *
 * The split is the point, and it is a privacy boundary as much as a UX one:
 *
 *   waitingOnYou  the CALLER'S own contact id and nobody else's, so the home's
 *                 prompt is a list of things this person can actually do;
 *   waitingOnOrg  everything else the studio is waiting on from this client,
 *                 and ONLY for a workspace admin. A member seeing their
 *                 colleagues' asks turns a to-do list into a roster of who is
 *                 holding things up.
 *
 * Also asserted: every row carries `waitingOn`, because the request card says
 * who a request is with whoever is reading it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requirePortalFeature: vi.fn() }))
vi.mock('@/lib/request-participants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/request-participants')>()),
  loadRequestParticipants: vi.fn(),
}))
vi.mock('@/lib/request-handoff', () => ({ loadWaitingOn: vi.fn() }))

import { db } from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { loadRequestParticipants } from '@/lib/request-participants'
import { loadWaitingOn } from '@/lib/request-handoff'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/portal/requests/route'

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

const MINE = { id: 'req-1', title: 'Hero copy', requestNumber: 1, status: 'in_progress' }
const THEIRS = { id: 'req-2', title: 'Packhouse photos', requestNumber: 2, status: 'in_progress' }

function waiting(contactId: string, contactName: string, days: number) {
  return {
    contactId,
    contactName,
    reason: 'approval' as const,
    reasonLabel: 'Needs your approval',
    since: '2026-09-15T09:00:00.000Z',
    dueAt: null,
    note: null,
    daysWaiting: days,
  }
}

const POINTERS = new Map([
  ['req-1', waiting('contact-1', 'Ngaire Hutchins', 2)],
  ['req-2', waiting('contact-2', 'Tama Rewi', 6)],
])

function get() {
  return new NextRequest('http://localhost:3000/api/portal/requests?status=active')
}

type Body = {
  requests: Array<Record<string, unknown>>
  waitingOnYou: Array<{ requestId: string }>
  waitingOnOrg: Array<{ requestId: string }>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requirePortalFeature).mockResolvedValue(null as never)
  vi.mocked(loadRequestParticipants).mockResolvedValue(new Map())
  vi.mocked(loadWaitingOn).mockResolvedValue(POINTERS as never)
  vi.mocked(getPortalAuth).mockResolvedValue({
    orgId: 'org-a', userId: 'user_ngaire', clerkOrgId: 'org_clerk_a', contactId: null,
  } as never)
})

describe('GET /api/portal/requests, the hand-off lists', () => {
  it('gives a member their own items and nothing of their colleagues\'', async () => {
    const self = { id: 'contact-1', portalRole: 'member', isPrimary: false }
    const { handle } = makeDb([[self], [], [MINE, THEIRS]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.waitingOnYou.map(i => i.requestId)).toEqual(['req-1'])
    expect(body.waitingOnOrg).toEqual([])
  })

  it('gives a workspace admin their own items AND the rest of the team\'s', async () => {
    const self = { id: 'contact-1', portalRole: 'admin', isPrimary: false }
    const { handle } = makeDb([[self], [], [MINE, THEIRS]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.waitingOnYou.map(i => i.requestId)).toEqual(['req-1'])
    expect(body.waitingOnOrg.map(i => i.requestId)).toEqual(['req-2'])
  })

  it('treats the primary contact as an admin, matching every other portal gate', async () => {
    const self = { id: 'contact-1', portalRole: 'member', isPrimary: true }
    const { handle } = makeDb([[self], [], [MINE, THEIRS]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.waitingOnOrg.map(i => i.requestId)).toEqual(['req-2'])
  })

  it('sorts the longest wait first, which is the one costing the studio time', async () => {
    const self = { id: 'contact-1', portalRole: 'admin', isPrimary: false }
    const third = { id: 'req-3', title: 'Domain access', requestNumber: 3, status: 'in_progress' }
    vi.mocked(loadWaitingOn).mockResolvedValue(new Map([
      ['req-1', waiting('contact-2', 'Tama Rewi', 2)],
      ['req-2', waiting('contact-2', 'Tama Rewi', 9)],
      ['req-3', waiting('contact-2', 'Tama Rewi', 5)],
    ]) as never)
    const { handle } = makeDb([[self], [], [MINE, THEIRS, third]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.waitingOnOrg.map(i => i.requestId)).toEqual(['req-2', 'req-3', 'req-1'])
  })

  it('puts waitingOn on every row, resolved or null', async () => {
    const self = { id: 'contact-1', portalRole: 'member', isPrimary: false }
    const untouched = { id: 'req-9', title: 'With us', requestNumber: 9, status: 'in_progress' }
    const { handle } = makeDb([[self], [], [MINE, untouched]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.requests[0]).toMatchObject({ id: 'req-1', waitingOn: { contactId: 'contact-1' } })
    expect(body.requests[1]).toMatchObject({ id: 'req-9', waitingOn: null })
  })

  it('shows a caller with no contact row nothing at all, not the whole org', async () => {
    const { handle } = makeDb([[], [MINE, THEIRS]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const body = await (await GET(get())).json() as Body
    expect(body.waitingOnYou).toEqual([])
    expect(body.waitingOnOrg).toEqual([])
  })
})
