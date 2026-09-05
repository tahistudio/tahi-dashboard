/**
 * POST /api/admin/requests/[id]/messages: what may leave the building.
 *
 * Two gates decide whether a message reaches the client side. An internal note
 * is a studio aside; a Tahi-internal REQUEST is invisible to the portal, so
 * even an ordinary message on one must not surface. Both were applied to the
 * org fan-out and neither to the @mention fan-out, which resolves a mention id
 * against contacts as well as team members: mentioning a client contact in an
 * internal note pinged that contact with the note's body and a deep link.
 *
 * Third gate, same audience: the portal request list is brand scoped, so the
 * fan-out is too. A contact linked to another brand cannot open the row the
 * subject line names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  leftJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: { queues: Record<string, Row[][]> }
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'org_tahi', userId: 'user_admin', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/notifications', () => ({
  notifyMentionedPerson: vi.fn().mockResolvedValue(undefined),
  notifyOrgContacts: vi.fn().mockResolvedValue(undefined),
  notifyTeamMember: vi.fn().mockResolvedValue({ delivered: 1, skipped: 0 }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      _table: 'requests',
      id: 'id',
      orgId: 'org_id',
      title: 'title',
      requestNumber: 'request_number',
      isInternal: 'is_internal',
      assigneeId: 'assignee_id',
      brandId: 'brand_id',
      updatedAt: 'updated_at',
    },
    messages: { _table: 'messages' },
    mentions: { _table: 'mentions' },
    files: { _table: 'files', id: 'id', orgId: 'org_id', messageId: 'message_id' },
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', clerkUserId: 'clerk_user_id' },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { and: stub, eq: stub, asc: stub, inArray: stub }
})

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {} }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.innerJoin = () => chain
    chain.leftJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }

  const select = vi.fn(() => ({
    from: (table: { _table?: string } | undefined) => {
      const queue = state.queues[table?._table ?? ''] ?? []
      return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
    },
  }))
  const insert = vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) }))
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update }),
    __mock: { state },
  }
})

import { POST as postMessage } from '@/app/api/admin/requests/[id]/messages/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { notifyMentionedPerson, notifyOrgContacts } from '@/lib/notifications'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

const params = { params: Promise.resolve({ id: 'req_1' }) }
const MENTION = '<p>Please look <span data-mention-type="person" data-mention-id="ct_1">@Jo</span></p>'

function messageRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/requests/req_1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function seed(request: Row): void {
  dbMock.state.queues = {
    requests: [[request]],
    team_members: [[{ id: 'tm_1', name: 'Staci Bonnie' }]],
  }
}

const clientVisibleRequest: Row = {
  orgId: 'org_client',
  title: 'Rebuild the checkout',
  requestNumber: 4,
  isInternal: false,
  assigneeId: null,
  brandId: 'brand_a',
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
})

describe('POST /api/admin/requests/[id]/messages, the client gates', () => {
  it('lets a normal reply reach the client contacts, scoped to the brand', async () => {
    seed(clientVisibleRequest)
    const res = await postMessage(messageRequest({ body: '<p>On it.</p>' }), params)
    expect(res.status).toBe(201)

    expect(notifyOrgContacts).toHaveBeenCalledTimes(1)
    const [, orgId, payload, audience] = vi.mocked(notifyOrgContacts).mock.calls[0]
    expect(orgId).toBe('org_client')
    expect(payload.email?.subject).toBe('[REQ-4] Staci Bonnie replied on "Rebuild the checkout"')
    expect(audience).toEqual({ brandId: 'brand_a' })
  })

  it('passes a null brand through rather than dropping the scoping', async () => {
    // The portal hides an unbranded request from a brand-scoped contact, so
    // "no brand" has to reach the audience filter as an explicit null.
    seed({ ...clientVisibleRequest, brandId: null })
    await postMessage(messageRequest({ body: '<p>On it.</p>' }), params)
    expect(vi.mocked(notifyOrgContacts).mock.calls[0][3]).toEqual({ brandId: null })
  })

  it('never fans an internal note out to the client', async () => {
    seed(clientVisibleRequest)
    const res = await postMessage(
      messageRequest({ body: '<p>Do not send this.</p>', isInternal: true }),
      params,
    )
    expect(res.status).toBe(201)
    expect(notifyOrgContacts).not.toHaveBeenCalled()
  })

  it('never fans a message on a Tahi-internal request out to the client', async () => {
    seed({ ...clientVisibleRequest, isInternal: true })
    await postMessage(messageRequest({ body: '<p>Ordinary message.</p>' }), params)
    expect(notifyOrgContacts).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/requests/[id]/messages, the mention gate', () => {
  it('lets a mention resolve to a contact on a client-visible message', async () => {
    seed(clientVisibleRequest)
    await postMessage(messageRequest({ body: MENTION }), params)
    expect(notifyMentionedPerson).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyMentionedPerson).mock.calls[0][1].allowContacts).toBe(true)
  })

  it('refuses the contacts fallback on an internal note', async () => {
    seed(clientVisibleRequest)
    await postMessage(messageRequest({ body: MENTION, isInternal: true }), params)
    expect(vi.mocked(notifyMentionedPerson).mock.calls[0][1].allowContacts).toBe(false)
  })

  it('refuses the contacts fallback on a Tahi-internal request', async () => {
    seed({ ...clientVisibleRequest, isInternal: true })
    await postMessage(messageRequest({ body: MENTION }), params)
    expect(vi.mocked(notifyMentionedPerson).mock.calls[0][1].allowContacts).toBe(false)
  })

  it('sends plain text to the bell, not a sliced tag', async () => {
    seed(clientVisibleRequest)
    await postMessage(messageRequest({ body: MENTION }), params)
    const body = vi.mocked(notifyMentionedPerson).mock.calls[0][1].body
    expect(body).toBe('Please look @Jo')
    expect(body).not.toContain('<')
  })
})
