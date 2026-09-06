/**
 * The gates on /api/portal/messages and /api/admin/messages.
 *
 * The reader itself (lib/messages-store.ts) is covered in
 * lib/__tests__/messages-store.test.ts and is MOCKED here, so what these
 * assert is only the thing a route is for: who gets in, what a write is
 * allowed to be, and what is refused before a single message is read.
 *
 *   PORTAL   getPortalAuth -> refuse the Tahi org -> requirePortalFeature
 *            ('messages') -> (writes) refuse a read-only preview. A client can
 *            never set isInternal, never address another client's channel, and
 *            never open a request their org and brand links do not cover.
 *   ADMIN    getRequestAuth -> isTahiAdmin -> requireFeature('messages') ->
 *            scopedOrgIds. A scoped team member naming another client's
 *            request is refused before the thread is read, and an internal
 *            note never reaches the client fan-out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Chain extends Promise<Row[]> {
  leftJoin: () => Chain
  innerJoin: () => Chain
  where: () => Chain
  orderBy: () => Chain
  limit: () => Chain
}

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/access-scope', () => ({
  scopedOrgIds: vi.fn().mockResolvedValue({ kind: 'all' }),
}))

vi.mock('@/lib/sanitize-rich-text', () => ({ sanitizeRichText: (s: string) => s ?? '' }))

vi.mock('@/lib/notifications', () => ({
  createNotifications: vi.fn().mockResolvedValue({ delivered: 0, skipped: 0 }),
  notifyOrgContacts: vi.fn().mockResolvedValue(undefined),
  notifyTeamMember: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notify-request-team', () => ({
  notifyRequestTeam: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notification-email', () => ({
  channelMessageEmailPlan: vi.fn(() => ({ subject: 'channel', render: () => null })),
  threadReplyEmailPlan: vi.fn(() => ({ subject: 'thread', render: () => null })),
  messageSummary: (s: string) => s ?? '',
  toPlainText: (s: string) => s ?? '',
  truncate: (s: string) => s ?? '',
}))

vi.mock('@/lib/messages-store', () => ({
  loadInboxThreads: vi.fn().mockResolvedValue({ threads: [], channelsByOrg: new Map() }),
  loadThreadMessages: vi.fn().mockResolvedValue([]),
  readThreadCursor: vi.fn().mockResolvedValue(null),
  markThreadRead: vi.fn().mockResolvedValue('2026-09-06T00:00:00.000Z'),
  attachFilesToMessage: vi.fn().mockResolvedValue(0),
  loadOrgChannels: vi.fn().mockResolvedValue(new Map()),
  loadOrgNames: vi.fn().mockResolvedValue(new Map([['org_client', 'Mahana Orchards']])),
  loadClientScope: vi.fn().mockResolvedValue({ contactId: 'ct_1', brandIds: null }),
  clientCanSeeRequest: vi.fn(),
}))

vi.mock('@/lib/org-channel', () => ({
  ORG_CHANNEL_TYPE: 'org_channel',
  resolveOrgChannel: vi.fn().mockResolvedValue('conv_1'),
  resolveRequestThread: vi.fn().mockResolvedValue('conv_thread'),
  orgChannelParticipants: vi.fn().mockResolvedValue([]),
  syncConversationParticipants: vi.fn().mockResolvedValue(undefined),
  threadPeople: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: { _table: 'contacts', id: 'id', orgId: 'org_id', clerkUserId: 'clerk_user_id', name: 'name' },
    teamMembers: { _table: 'team_members', id: 'id', clerkUserId: 'clerk_user_id', name: 'name' },
    organisations: { _table: 'organisations', id: 'id', name: 'name', status: 'status' },
    conversations: { _table: 'conversations', id: 'id', orgId: 'org_id', type: 'type' },
    requests: { _table: 'requests', id: 'id', orgId: 'org_id', title: 'title', requestNumber: 'request_number', status: 'status', assigneeId: 'assignee_id', brandId: 'brand_id', isInternal: 'is_internal' },
    messages: { _table: 'messages' },
    voiceNotes: { _table: 'voice_notes' },
  },
}))

vi.mock('@/lib/db', () => {
  const state = { queues: {} as Record<string, Row[][]>, inserts: [] as Array<{ table: string; row: Row }> }
  function chainFor(rows: Row[]): Chain {
    const chain = Promise.resolve(rows) as Chain
    chain.leftJoin = () => chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }
  const database = {
    select: () => ({
      from: (table: { _table?: string } | undefined) => {
        const name = table?._table ?? ''
        const queue = state.queues[name] ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    }),
    insert: (table: { _table?: string } | undefined) => ({
      values: async (row: Row) => { state.inserts.push({ table: table?._table ?? '', row }) },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return { db: vi.fn().mockResolvedValue(database), __mock: { state } }
})

import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth, getRequestAuth } from '@/lib/server-auth'
import { requirePortalFeature, requireFeature } from '@/lib/require-feature'
import { scopedOrgIds } from '@/lib/access-scope'
import { clientCanSeeRequest, loadInboxThreads, markThreadRead } from '@/lib/messages-store'
import { notifyOrgContacts } from '@/lib/notifications'
import { resolveOrgChannel } from '@/lib/org-channel'

import { GET as portalList } from '@/app/api/portal/messages/route'
import { GET as portalThread, POST as portalSend } from '@/app/api/portal/messages/[source]/[id]/route'
import { POST as portalRead } from '@/app/api/portal/messages/[source]/[id]/read/route'
import { GET as adminList } from '@/app/api/admin/messages/route'
import { GET as adminThread, POST as adminSend } from '@/app/api/admin/messages/[source]/[id]/route'

const mock = (dbModule as unknown as { __mock: { state: { queues: Record<string, Row[][]>; inserts: Array<{ table: string; row: Row }> } } }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>
type RequestAuth = Awaited<ReturnType<typeof getRequestAuth>>

function portalAuth(over: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client', orgId: 'org_client', sessionId: 's', clerkOrgId: 'org_client',
    impersonating: false, ...over,
  } as PortalAuth
}
function adminAuth(over: Partial<RequestAuth> = {}): RequestAuth {
  return { userId: 'user_liam', orgId: 'org_tahi', sessionId: 's', ...over } as RequestAuth
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`)
}
function post(url: string, body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = (source: string, id: string) => ({ params: Promise.resolve({ source, id }) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  mock.state.queues = {}
  mock.state.inserts = []
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  vi.mocked(getRequestAuth).mockResolvedValue(adminAuth())
  vi.mocked(requirePortalFeature).mockResolvedValue(null)
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
  vi.mocked(loadInboxThreads).mockResolvedValue({ threads: [], channelsByOrg: new Map() })
  vi.mocked(resolveOrgChannel).mockResolvedValue('conv_1')
  vi.mocked(markThreadRead).mockResolvedValue('2026-09-06T00:00:00.000Z')
})

// ---------------------------------------------------------------------------
// Portal
// ---------------------------------------------------------------------------

describe('GET /api/portal/messages', () => {
  it('refuses the Tahi org outright', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    expect((await portalList(get('/api/portal/messages'))).status).toBe(403)
  })

  it('refuses an anonymous caller', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ userId: null }))
    expect((await portalList(get('/api/portal/messages'))).status).toBe(403)
  })

  it('honours the messages feature switch', async () => {
    vi.mocked(requirePortalFeature).mockResolvedValue(
      Response.json({ error: 'Forbidden', code: 'feature_disabled' }, { status: 403 }) as never,
    )
    const res = await portalList(get('/api/portal/messages'))
    expect(res.status).toBe(403)
    expect(vi.mocked(requirePortalFeature).mock.calls[0][1]).toBe('messages')
  })

  it('reads as the caller own org, and never names the client back to them', async () => {
    const res = await portalList(get('/api/portal/messages'))
    expect(res.status).toBe(200)
    const call = vi.mocked(loadInboxThreads).mock.calls[0][1]
    expect(call.scope).toMatchObject({ orgIds: ['org_client'], audience: 'client' })
  })

  it('shows a studio line before it exists, without writing one', async () => {
    const res = await portalList(get('/api/portal/messages'))
    const json = (await res.json()) as { threads: Array<{ source: string; id: string; title: string }> }
    expect(json.threads[0]).toMatchObject({ source: 'channel', id: '', title: 'Tahi Studio' })
    expect(mock.state.inserts).toHaveLength(0)
  })
})

describe('GET /api/portal/messages/<source>/<id>', () => {
  it('rejects a source it does not know rather than guessing a store', async () => {
    const res = await portalThread(get('/api/portal/messages/org/org_2'), params('org', 'org_2'))
    expect(res.status).toBe(404)
  })

  it('404s a request outside the caller org and brand links', async () => {
    vi.mocked(clientCanSeeRequest).mockResolvedValue(null)
    const res = await portalThread(get('/api/portal/messages/request/r_other'), params('request', 'r_other'))
    expect(res.status).toBe(404)
  })

  it('resolves the channel from the authenticated org, ignoring the id in the path', async () => {
    await portalThread(get('/api/portal/messages/channel/conv_someone_else'), params('channel', 'conv_someone_else'))
    expect(vi.mocked(resolveOrgChannel).mock.calls[0][1]).toBe('org_client')
    expect(vi.mocked(resolveOrgChannel).mock.calls[0][2]).toMatchObject({ create: false })
  })

  it('never offers a client the internal tab', async () => {
    vi.mocked(clientCanSeeRequest).mockResolvedValue({
      id: 'r1', orgId: 'org_client', title: 'Palette', requestNumber: 1049,
      status: 'in_progress', assigneeId: null, brandId: null,
    })
    const res = await portalThread(get('/api/portal/messages/request/r1'), params('request', 'r1'))
    const json = (await res.json()) as { thread: { canInternal: boolean; canPost: boolean } }
    expect(json.thread.canInternal).toBe(false)
    expect(json.thread.canPost).toBe(true)
  })

  it('marks a preview read-only rather than letting an admin reply as the client', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true, clerkOrgId: 'org_tahi' }))
    const res = await portalThread(get('/api/portal/messages/channel/new'), params('channel', 'new'))
    const json = (await res.json()) as { thread: { canPost: boolean } }
    expect(json.thread.canPost).toBe(false)
  })
})

describe('POST /api/portal/messages/<source>/<id>', () => {
  beforeEach(() => {
    mock.state.queues = {
      contacts: [[{ id: 'ct_1', name: 'Ana Rewiri' }]],
      organisations: [[{ name: 'Mahana Orchards' }]],
    }
  })

  it('refuses a write from a read-only client-view preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true, clerkOrgId: 'org_tahi' }))
    const res = await portalSend(post('/api/portal/messages/channel/new', { body: 'hi' }), params('channel', 'new'))
    expect(res.status).toBe(403)
    expect(mock.state.inserts).toHaveLength(0)
  })

  it('refuses an empty send with no attachment and no voice note', async () => {
    const res = await portalSend(post('/api/portal/messages/channel/new', { body: '   ' }), params('channel', 'new'))
    expect(res.status).toBe(400)
  })

  it('writes an external contact message and creates the room on the way', async () => {
    const res = await portalSend(post('/api/portal/messages/channel/new', { body: '<p>Kia ora</p>' }), params('channel', 'new'))
    expect(res.status).toBe(201)
    expect(vi.mocked(resolveOrgChannel).mock.calls[0][2]).toMatchObject({ create: true })
    const message = mock.state.inserts.find(i => i.table === 'messages')
    expect(message?.row).toMatchObject({
      conversationId: 'conv_1',
      requestId: null,
      orgId: 'org_client',
      authorType: 'contact',
      authorId: 'ct_1',
      isInternal: false,
    })
  })

  it('ignores an isInternal a caller tries to smuggle into the body', async () => {
    await portalSend(
      post('/api/portal/messages/channel/new', { body: '<p>sneaky</p>', isInternal: true }),
      params('channel', 'new'),
    )
    const message = mock.state.inserts.find(i => i.table === 'messages')
    expect(message?.row.isInternal).toBe(false)
  })

  it('keeps a request-thread message on its request AND in the room', async () => {
    vi.mocked(clientCanSeeRequest).mockResolvedValue({
      id: 'r1', orgId: 'org_client', title: 'Palette', requestNumber: 1049,
      status: 'in_progress', assigneeId: 'tm_liam', brandId: null,
    })
    const res = await portalSend(post('/api/portal/messages/request/r1', { body: '<p>question</p>' }), params('request', 'r1'))
    expect(res.status).toBe(201)
    const message = mock.state.inserts.find(i => i.table === 'messages')
    expect(message?.row).toMatchObject({ requestId: 'r1', conversationId: 'conv_thread' })
  })
})

describe('POST /api/portal/messages/<source>/<id>/read', () => {
  it('refuses to move a cursor from a read-only preview', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true, clerkOrgId: 'org_tahi' }))
    const res = await portalRead(post('/api/portal/messages/channel/new/read'), params('channel', 'new'))
    expect(res.status).toBe(403)
    expect(vi.mocked(markThreadRead)).not.toHaveBeenCalled()
  })

  it('is a no-op on a studio line that has no row yet', async () => {
    vi.mocked(resolveOrgChannel).mockResolvedValue(null)
    const res = await portalRead(post('/api/portal/messages/channel/new/read'), params('channel', 'new'))
    expect(res.status).toBe(200)
    expect(vi.mocked(markThreadRead)).not.toHaveBeenCalled()
  })

  it('refuses to stamp a request the client cannot open', async () => {
    vi.mocked(clientCanSeeRequest).mockResolvedValue(null)
    const res = await portalRead(post('/api/portal/messages/request/r_other/read'), params('request', 'r_other'))
    expect(res.status).toBe(404)
    expect(vi.mocked(markThreadRead)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

describe('GET /api/admin/messages', () => {
  it('refuses a non-Tahi caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue(adminAuth({ orgId: 'org_client' }))
    expect((await adminList(get('/api/admin/messages'))).status).toBe(403)
  })

  it('honours the same feature key the client side is gated on', async () => {
    vi.mocked(requireFeature).mockResolvedValue(
      Response.json({ error: 'Forbidden' }, { status: 403 }) as never,
    )
    expect((await adminList(get('/api/admin/messages'))).status).toBe(403)
    expect(vi.mocked(requireFeature).mock.calls[0][1]).toBe('messages')
  })

  it('returns an empty inbox for a team member scoped to nothing', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })
    const res = await adminList(get('/api/admin/messages'))
    const json = (await res.json()) as { threads: unknown[]; clients: unknown[] }
    expect(json.threads).toEqual([])
    expect(json.clients).toEqual([])
    expect(vi.mocked(loadInboxThreads)).not.toHaveBeenCalled()
  })

  it('refuses a client the caller is not scoped to, even when named directly', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    const res = await adminList(get('/api/admin/messages?orgId=org_b'))
    const json = (await res.json()) as { threads: unknown[] }
    expect(json.threads).toEqual([])
    expect(vi.mocked(loadInboxThreads)).not.toHaveBeenCalled()
  })

  it('reads the whole room for the studio, internal notes included', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_a'] })
    mock.state.queues = { organisations: [[{ id: 'org_a' }]] }
    await adminList(get('/api/admin/messages'))
    expect(vi.mocked(loadInboxThreads).mock.calls[0][1].scope).toMatchObject({
      orgIds: ['org_a'], audience: 'studio', brandIds: null,
    })
  })
})

describe('/api/admin/messages/<source>/<id>', () => {
  const REQUEST_ROW = {
    id: 'r1', orgId: 'org_a', title: 'Palette', requestNumber: 1049,
    status: 'in_progress', assigneeId: 'tm_other', brandId: 'brand_a', isInternal: false,
  }

  it('refuses a request outside the caller scope before reading a message', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_b'] })
    mock.state.queues = { requests: [[REQUEST_ROW]] }
    const res = await adminThread(get('/api/admin/messages/request/r1'), params('request', 'r1'))
    expect(res.status).toBe(403)
  })

  it('offers the internal tab on a client request', async () => {
    mock.state.queues = { requests: [[REQUEST_ROW]], organisations: [[{ name: 'Mahana Orchards' }]] }
    const res = await adminThread(get('/api/admin/messages/request/r1'), params('request', 'r1'))
    const json = (await res.json()) as { thread: { canInternal: boolean; orgName: string } }
    expect(json.thread.canInternal).toBe(true)
    expect(json.thread.orgName).toBe('Mahana Orchards')
  })

  it('drops the internal tab on a Tahi-internal request, where everything already is', async () => {
    mock.state.queues = {
      requests: [[{ ...REQUEST_ROW, isInternal: true }]],
      organisations: [[{ name: 'Tahi Studio' }]],
    }
    const res = await adminThread(get('/api/admin/messages/request/r1'), params('request', 'r1'))
    const json = (await res.json()) as { thread: { canInternal: boolean } }
    expect(json.thread.canInternal).toBe(false)
  })

  it('an internal note never reaches the client fan-out', async () => {
    mock.state.queues = {
      requests: [[REQUEST_ROW]],
      team_members: [[{ id: 'tm_liam', name: 'Liam Miller' }]],
      organisations: [[{ name: 'Mahana Orchards' }]],
    }
    const res = await adminSend(
      post('/api/admin/messages/request/r1', { body: '<p>studio only</p>', isInternal: true }),
      params('request', 'r1'),
    )
    expect(res.status).toBe(201)
    expect(mock.state.inserts.find(i => i.table === 'messages')?.row.isInternal).toBe(true)
    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
  })

  it('an ordinary message on a Tahi-internal request also stays in the building', async () => {
    mock.state.queues = {
      requests: [[{ ...REQUEST_ROW, isInternal: true }]],
      team_members: [[{ id: 'tm_liam', name: 'Liam Miller' }]],
      organisations: [[{ name: 'Tahi Studio' }]],
    }
    await adminSend(
      post('/api/admin/messages/request/r1', { body: '<p>ordinary</p>' }),
      params('request', 'r1'),
    )
    expect(vi.mocked(notifyOrgContacts)).not.toHaveBeenCalled()
  })

  it('a client-facing reply is brand-scoped, so only contacts who can open it hear', async () => {
    mock.state.queues = {
      requests: [[REQUEST_ROW]],
      team_members: [[{ id: 'tm_liam', name: 'Liam Miller' }]],
      organisations: [[{ name: 'Mahana Orchards' }]],
    }
    await adminSend(post('/api/admin/messages/request/r1', { body: '<p>reply</p>' }), params('request', 'r1'))
    const call = vi.mocked(notifyOrgContacts).mock.calls[0]
    expect(call[1]).toBe('org_a')
    expect(call[3]).toEqual({ brandId: 'brand_a' })
  })

  it('a channel message is org-wide, with no brand filter to narrow it', async () => {
    mock.state.queues = {
      conversations: [[{ id: 'conv_1', orgId: 'org_a', type: 'org_channel' }]],
      team_members: [[{ id: 'tm_liam', name: 'Liam Miller' }]],
      organisations: [[{ name: 'Mahana Orchards' }]],
    }
    await adminSend(post('/api/admin/messages/channel/conv_1', { body: '<p>hello</p>' }), params('channel', 'conv_1'))
    const call = vi.mocked(notifyOrgContacts).mock.calls[0]
    expect(call[1]).toBe('org_a')
    expect(call[3]).toBeUndefined()
  })

  it('refuses a channel whose client is outside the caller scope', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org_b'] })
    mock.state.queues = { conversations: [[{ id: 'conv_1', orgId: 'org_a', type: 'org_channel' }]] }
    const res = await adminThread(get('/api/admin/messages/channel/conv_1'), params('channel', 'conv_1'))
    expect(res.status).toBe(403)
  })
})
