/**
 * POST /api/admin/requests/[id]/participants
 *
 * HO.4: this route used to hard-refuse any contact role but 'follower', from
 * back before lib/request-participants.ts grew the 'approver' / 'contributor'
 * / 'watcher' roles that a client hand-off (lib/request-handoff.ts) already
 * writes by itself. The rule this route now enforces both ways:
 *
 *   - a contact may be set to follower, watcher, approver or contributor
 *     (never pm or assignee - those are the studio's own staffing);
 *   - a team member may be set to pm, assignee or follower (never the
 *     client hand-off roles).
 *
 * Fake-D1 pattern borrowed from
 * app/api/admin/requests/[id]/__tests__/handoff.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrg: vi.fn() }))
vi.mock('@/lib/notifications', () => ({
  notifyTeamMember: vi.fn(),
  requestParticipantTitle: vi.fn(() => 'Added to a request'),
}))

import { getRequestAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { requireAccessToOrg } from '@/lib/require-access'
import { notifyTeamMember } from '@/lib/notifications'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/requests/[id]/participants/route'

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
  return new NextRequest('http://localhost:3000/api/admin/requests/req-1/participants', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const REQUEST = { orgId: 'org-a', title: 'Spring landing page', requestNumber: 42 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi' } as never)
  vi.mocked(requireAccessToOrg).mockResolvedValue(null as never)
})

describe('POST participants, contact roles', () => {
  it.each(['follower', 'watcher', 'approver', 'contributor'])(
    'accepts a contact as %s',
    async (role) => {
      // select request, select actor (skipped: team_member branch only), select existing (none)
      const { handle } = makeDb([[REQUEST], []])
      vi.mocked(db).mockResolvedValue(handle as never)

      const res = await POST(
        post({ participantId: 'contact-1', participantType: 'contact', role }),
        params('req-1'),
      )
      expect(res.status).toBe(201)
      const json = await res.json() as { participant: { role: string } }
      expect(json.participant.role).toBe(role)
    },
  )

  it.each(['pm', 'assignee'])('refuses a contact as %s', async (role) => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(
      post({ participantId: 'contact-1', participantType: 'contact', role }),
      params('req-1'),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'Contacts can only be a follower, watcher, approver or contributor',
    })
    // Refused before any write: only the missing-field / role / type checks ran.
    expect(queries).toHaveLength(0)
  })
})

describe('POST participants, team member roles', () => {
  it.each(['pm', 'assignee', 'follower'])('accepts a team member as %s', async (role) => {
    // Only the first select (the request row) matters here; every other call
    // this role can trigger (the pm soft-delete, the dedupe check, the actor
    // lookup for the notify branch) is happy to default to an empty result.
    const { handle } = makeDb([[REQUEST]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(
      post({ participantId: 'tm-1', participantType: 'team_member', role }),
      params('req-1'),
    )
    expect(res.status).toBe(201)
    const json = await res.json() as { participant: { role: string } }
    expect(json.participant.role).toBe(role)
  })

  it.each(['approver', 'contributor', 'watcher'])('refuses a team member as %s', async (role) => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(
      post({ participantId: 'tm-1', participantType: 'team_member', role }),
      params('req-1'),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'Team members can only be a pm, assignee or follower',
    })
    expect(queries).toHaveLength(0)
  })
})

describe('POST participants, refusals unrelated to the role/type pairing', () => {
  it('403s a non-admin caller before touching the database', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client' } as never)
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(
      post({ participantId: 'contact-1', participantType: 'contact', role: 'follower' }),
      params('req-1'),
    )
    expect(res.status).toBe(403)
    expect(queries).toHaveLength(0)
  })

  it('400s a role outside the closed set entirely', async () => {
    const { handle, queries } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(
      post({ participantId: 'contact-1', participantType: 'contact', role: 'owner' }),
      params('req-1'),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid role' })
    expect(queries).toHaveLength(0)
  })

  it('does not notify anyone when the new participant is a contact', async () => {
    const { handle } = makeDb([[REQUEST], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    await POST(
      post({ participantId: 'contact-1', participantType: 'contact', role: 'approver' }),
      params('req-1'),
    )
    expect(vi.mocked(notifyTeamMember)).not.toHaveBeenCalled()
  })
})
