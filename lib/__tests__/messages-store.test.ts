/**
 * lib/messages-store.ts: the reader both audiences share.
 *
 * The point of one reader is that a client's inbox and the studio's cannot
 * drift into two different ideas of what is visible, so what is asserted here
 * is the SHAPE OF THE QUERY as much as the shape of the answer:
 *
 *   - a client's message read carries is_internal = 0 AND deleted_at IS NULL;
 *     the studio's carries deleted_at IS NULL and nothing else, because the
 *     studio sees the whole room.
 *   - a client's request read carries is_internal = 0 on the REQUEST too, and
 *     their brand links when they have any.
 *   - unread comes from the right cursor per store, counts nobody's own
 *     messages, and treats a null cursor as "everything visible except mine".
 *   - every attachment stamp is scoped to the org, and on a request thread to
 *     the request as well.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { __op?: string; col?: unknown; val?: unknown; parts?: unknown[]; vals?: unknown }

interface Chain extends Promise<Row[]> {
  leftJoin: () => Chain
  innerJoin: () => Chain
  where: (w: unknown) => Chain
  orderBy: () => Chain
  limit: () => Chain
  offset: () => Chain
}

vi.mock('@/db/d1', () => ({
  schema: {
    messages: {
      _table: 'messages',
      id: 'messages.id', requestId: 'messages.request_id', conversationId: 'messages.conversation_id',
      orgId: 'messages.org_id', authorId: 'messages.author_id', authorType: 'messages.author_type',
      body: 'messages.body', isInternal: 'messages.is_internal', createdAt: 'messages.created_at',
      editedAt: 'messages.edited_at', deletedAt: 'messages.deleted_at',
    },
    requests: {
      _table: 'requests',
      id: 'requests.id', orgId: 'requests.org_id', title: 'requests.title',
      requestNumber: 'requests.request_number', status: 'requests.status',
      updatedAt: 'requests.updated_at', isInternal: 'requests.is_internal',
      brandId: 'requests.brand_id', assigneeId: 'requests.assignee_id',
    },
    requestReads: {
      _table: 'request_reads',
      id: 'request_reads.id', requestId: 'request_reads.request_id',
      userId: 'request_reads.user_id', userType: 'request_reads.user_type',
      lastReadAt: 'request_reads.last_read_at',
    },
    conversationParticipants: {
      _table: 'conversation_participants',
      id: 'cp.id', conversationId: 'cp.conversation_id', participantId: 'cp.participant_id',
      participantType: 'cp.participant_type', lastReadAt: 'cp.last_read_at',
    },
    conversations: { _table: 'conversations', id: 'conversations.id', orgId: 'conversations.org_id', type: 'conversations.type', createdAt: 'conversations.created_at' },
    organisations: { _table: 'organisations', id: 'organisations.id', name: 'organisations.name', status: 'organisations.status' },
    contacts: { _table: 'contacts', id: 'contacts.id', name: 'contacts.name', orgId: 'contacts.org_id', clerkUserId: 'contacts.clerk_user_id' },
    teamMembers: { _table: 'team_members', id: 'team_members.id', name: 'team_members.name', avatarUrl: 'team_members.avatar_url' },
    brandContacts: { _table: 'brand_contacts', contactId: 'brand_contacts.contact_id', brandId: 'brand_contacts.brand_id' },
    files: { _table: 'files', id: 'files.id', messageId: 'files.message_id', orgId: 'files.org_id', requestId: 'files.request_id', filename: 'files.filename', storageKey: 'files.storage_key', mimeType: 'files.mime_type', sizeBytes: 'files.size_bytes' },
    voiceNotes: { _table: 'voice_notes', messageId: 'voice_notes.message_id', storageKey: 'voice_notes.storage_key', durationSeconds: 'voice_notes.duration_seconds', mimeType: 'voice_notes.mime_type' },
  },
}))

vi.mock('drizzle-orm', () => {
  const sqlTag = Object.assign(
    () => ({ __sql: true, as: () => ({ __sql: true }) }),
    { raw: () => ({ __sql: true }) },
  )
  return {
    eq: (col: unknown, val: unknown): Op => ({ __op: 'eq', col, val }),
    ne: (col: unknown, val: unknown): Op => ({ __op: 'ne', col, val }),
    gte: (col: unknown, val: unknown): Op => ({ __op: 'gte', col, val }),
    and: (...parts: unknown[]): Op => ({ __op: 'and', parts }),
    inArray: (col: unknown, vals: unknown): Op => ({ __op: 'in', col, vals }),
    isNull: (col: unknown): Op => ({ __op: 'isNull', col }),
    desc: (col: unknown): Op => ({ __op: 'desc', col }),
    asc: (col: unknown): Op => ({ __op: 'asc', col }),
    sql: sqlTag,
  }
})

import {
  attachFilesToMessage,
  loadInboxThreads,
  loadThreadMessages,
  markThreadRead,
  type InboxViewer,
} from '@/lib/messages-store'

type DrizzleDB = Parameters<typeof loadInboxThreads>[0]

interface Fake {
  queues: Record<string, Row[][]>
  wheres: Array<{ table: string; where: Op }>
  inserts: Array<{ table: string; row: Row }>
  updates: Array<{ table: string; patch: Row; where: Op | null }>
  db: DrizzleDB
}

function fakeDb(): Fake {
  const state = {
    queues: {} as Record<string, Row[][]>,
    wheres: [] as Array<{ table: string; where: Op }>,
    inserts: [] as Array<{ table: string; row: Row }>,
    updates: [] as Array<{ table: string; patch: Row; where: Op | null }>,
  }

  function chainFor(table: string, rows: Row[]): Chain {
    const chain = Promise.resolve(rows) as Chain
    chain.leftJoin = () => chain
    chain.innerJoin = () => chain
    chain.where = (w: unknown) => { state.wheres.push({ table, where: w as Op }); return chain }
    chain.orderBy = () => chain
    chain.limit = () => chain
    chain.offset = () => chain
    return chain
  }

  const db = {
    select: () => ({
      from: (table: { _table?: string } | undefined) => {
        const name = table?._table ?? ''
        const queue = state.queues[name] ?? []
        return chainFor(name, queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    }),
    insert: (table: { _table?: string } | undefined) => ({
      values: async (row: Row) => { state.inserts.push({ table: table?._table ?? '', row }) },
    }),
    update: (table: { _table?: string } | undefined) => ({
      set: (patch: Row) => ({
        where: async (w: unknown) => {
          state.updates.push({ table: table?._table ?? '', patch, where: (w ?? null) as Op | null })
        },
      }),
    }),
  } as unknown as DrizzleDB

  return { ...state, db }
}

/** Walk a captured `and(...)` for an op on a column. */
function has(where: Op | undefined, op: string, col: unknown, val?: unknown): boolean {
  if (!where) return false
  const parts = (where.parts ?? [where]) as Op[]
  return parts.some(p =>
    p.__op === op && p.col === col && (val === undefined || p.val === val))
}

function whereFor(fake: Fake, table: string, index = 0): Op | undefined {
  return fake.wheres.filter(w => w.table === table)[index]?.where
}

const CLIENT: InboxViewer = { clerkUserId: 'user_client', domainId: 'ct_1', userType: 'contact' }
const STUDIO: InboxViewer = { clerkUserId: 'user_liam', domainId: 'tm_liam', userType: 'team_member' }

let fake: Fake
beforeEach(() => { fake = fakeDb() })

describe('loadInboxThreads - what a client may never see', () => {
  it('reads only non-internal, non-deleted messages for a client', async () => {
    fake.queues.requests = [[{ id: 'r1', orgId: 'org_1', title: 'Palette', requestNumber: 1049, status: 'in_progress', updatedAt: '2026-09-01T00:00:00.000Z' }]]
    await loadInboxThreads(fake.db, {
      viewer: CLIENT,
      scope: { orgIds: ['org_1'], brandIds: null, audience: 'client' },
      channelsByOrg: new Map(),
      orgNames: new Map([['org_1', 'Mahana Orchards']]),
    })
    const messageWhere = whereFor(fake, 'messages')
    expect(has(messageWhere, 'eq', 'messages.is_internal', false)).toBe(true)
    expect(has(messageWhere, 'isNull', 'messages.deleted_at')).toBe(true)
  })

  it('reads internal notes for the studio, but still never a deleted row', async () => {
    fake.queues.requests = [[{ id: 'r1', orgId: 'org_1', title: 'Palette', requestNumber: 1049, status: 'in_progress', updatedAt: '2026-09-01T00:00:00.000Z' }]]
    await loadInboxThreads(fake.db, {
      viewer: STUDIO,
      scope: { orgIds: ['org_1'], brandIds: null, audience: 'studio' },
      channelsByOrg: new Map(),
      orgNames: new Map([['org_1', 'Mahana Orchards']]),
    })
    const messageWhere = whereFor(fake, 'messages')
    expect(has(messageWhere, 'eq', 'messages.is_internal', false)).toBe(false)
    expect(has(messageWhere, 'isNull', 'messages.deleted_at')).toBe(true)
  })

  it('never offers a client a Tahi-internal request, and narrows to their brands', async () => {
    fake.queues.requests = [[]]
    await loadInboxThreads(fake.db, {
      viewer: CLIENT,
      scope: { orgIds: ['org_1'], brandIds: ['brand_a'], audience: 'client' },
      channelsByOrg: new Map(),
      orgNames: new Map(),
    })
    const requestWhere = whereFor(fake, 'requests')
    expect(has(requestWhere, 'eq', 'requests.is_internal', false)).toBe(true)
    expect(has(requestWhere, 'in', 'requests.brand_id')).toBe(true)
  })

  it('returns nothing at all for a brand-linked contact with an empty brand set', async () => {
    const out = await loadInboxThreads(fake.db, {
      viewer: CLIENT,
      scope: { orgIds: ['org_1'], brandIds: [], audience: 'client' },
      channelsByOrg: new Map(),
      orgNames: new Map(),
    })
    expect(out.threads).toEqual([])
    expect(fake.wheres).toHaveLength(0)
  })

  it('returns nothing when the caller is scoped to no org', async () => {
    const out = await loadInboxThreads(fake.db, {
      viewer: STUDIO,
      scope: { orgIds: [], brandIds: null, audience: 'studio' },
      channelsByOrg: new Map(),
      orgNames: new Map(),
    })
    expect(out.threads).toEqual([])
  })
})

describe('loadInboxThreads - the rows it builds', () => {
  it('counts unread off the right cursor and never the reader own messages', async () => {
    fake.queues.requests = [[{ id: 'r1', orgId: 'org_1', title: 'Palette', requestNumber: 1049, status: 'in_progress', updatedAt: '2026-09-01T00:00:00.000Z' }]]
    fake.queues.messages = [[
      { id: 'm1', requestId: 'r1', conversationId: null, authorId: 'tm_liam', authorType: 'team_member', isInternal: false, createdAt: '2026-09-05T09:00:00.000Z', deletedAt: null, body: '<p>Round three</p>' },
      { id: 'm2', requestId: 'r1', conversationId: null, authorId: 'ct_1', authorType: 'contact', isInternal: false, createdAt: '2026-09-05T10:00:00.000Z', deletedAt: null, body: '<p>Thanks</p>' },
      { id: 'm3', requestId: 'r1', conversationId: null, authorId: 'tm_liam', authorType: 'team_member', isInternal: false, createdAt: '2026-09-05T11:00:00.000Z', deletedAt: null, body: '<p>Anything else?</p>' },
    ]]
    fake.queues.request_reads = [[{ requestId: 'r1', lastReadAt: '2026-09-05T09:30:00.000Z' }]]
    fake.queues.team_members = [[{ id: 'tm_liam', name: 'Liam Miller', avatarUrl: null }]]

    const out = await loadInboxThreads(fake.db, {
      viewer: CLIENT,
      scope: { orgIds: ['org_1'], brandIds: null, audience: 'client' },
      channelsByOrg: new Map(),
      orgNames: new Map(),
    })

    expect(out.threads).toHaveLength(1)
    const row = out.threads[0]
    // m2 is theirs and m1 predates the cursor, so only m3 counts.
    expect(row.unreadCount).toBe(1)
    expect(row.source).toBe('request')
    expect(row.href).toBe('/requests/r1')
    expect(row.lastMessage).toMatchObject({ snippet: 'Anything else?', authorName: 'Liam Miller' })
    // A client is never told which client they are.
    expect(row.orgName).toBeNull()
  })

  it('reads the channel cursor from the participant row, not from request_reads', async () => {
    fake.queues.requests = [[]]
    fake.queues.messages = [[
      { id: 'm1', requestId: null, conversationId: 'conv_1', authorId: 'tm_liam', authorType: 'team_member', isInternal: false, createdAt: '2026-09-05T09:00:00.000Z', deletedAt: null, body: '<p>Kia ora</p>' },
      { id: 'm2', requestId: null, conversationId: 'conv_1', authorId: 'tm_liam', authorType: 'team_member', isInternal: false, createdAt: '2026-09-05T11:00:00.000Z', deletedAt: null, body: '<p>One more thing</p>' },
    ]]
    fake.queues.conversation_participants = [[{ conversationId: 'conv_1', lastReadAt: '2026-09-05T10:00:00.000Z' }]]
    fake.queues.team_members = [[{ id: 'tm_liam', name: 'Liam Miller', avatarUrl: null }]]

    const out = await loadInboxThreads(fake.db, {
      viewer: CLIENT,
      scope: { orgIds: ['org_1'], brandIds: null, audience: 'client' },
      channelsByOrg: new Map([['org_1', 'conv_1']]),
      orgNames: new Map([['org_1', 'Mahana Orchards']]),
    })

    const channel = out.threads.find(t => t.source === 'channel')
    expect(channel?.unreadCount).toBe(1)
    expect(channel?.title).toBe('Tahi Studio')
    const cpWhere = whereFor(fake, 'conversation_participants')
    expect(has(cpWhere, 'eq', 'cp.participant_id', 'ct_1')).toBe(true)
  })

  it('names the client on a studio row and drops a silent delivered request', async () => {
    fake.queues.requests = [[
      { id: 'r_live', orgId: 'org_1', title: 'Palette', requestNumber: 1049, status: 'in_progress', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'r_done', orgId: 'org_1', title: 'Old labels', requestNumber: 1038, status: 'delivered', updatedAt: '2025-01-01T00:00:00.000Z' },
    ]]
    const out = await loadInboxThreads(fake.db, {
      viewer: STUDIO,
      scope: { orgIds: ['org_1'], brandIds: null, audience: 'studio' },
      channelsByOrg: new Map(),
      orgNames: new Map([['org_1', 'Mahana Orchards']]),
    })
    expect(out.threads.map(t => t.id)).toEqual(['r_live'])
    expect(out.threads[0].orgName).toBe('Mahana Orchards')
  })
})

describe('loadThreadMessages', () => {
  it('holds a client to non-internal, non-deleted rows and to their own org files', async () => {
    fake.queues.messages = [[
      { id: 'm1', authorId: 'tm_liam', authorType: 'team_member', body: '<p>Hi</p>', isInternal: false, createdAt: '2026-09-05T09:00:00.000Z', editedAt: null },
    ]]
    fake.queues.team_members = [[{ id: 'tm_liam', name: 'Liam Miller', avatarUrl: null }]]

    const out = await loadThreadMessages(fake.db, {
      source: 'request', id: 'r1', orgId: 'org_1', viewer: CLIENT, audience: 'client',
    })

    const messageWhere = whereFor(fake, 'messages')
    expect(has(messageWhere, 'eq', 'messages.request_id', 'r1')).toBe(true)
    expect(has(messageWhere, 'eq', 'messages.is_internal', false)).toBe(true)
    expect(has(messageWhere, 'isNull', 'messages.deleted_at')).toBe(true)

    const fileWhere = whereFor(fake, 'files')
    expect(has(fileWhere, 'eq', 'files.org_id', 'org_1')).toBe(true)

    expect(out[0]).toMatchObject({ authorName: 'Liam Miller', isOwn: false, isInternal: false })
  })

  it('marks the reader own message under either of their two ids', async () => {
    fake.queues.messages = [[
      { id: 'm1', authorId: 'ct_1', authorType: 'contact', body: '<p>Mine</p>', isInternal: false, createdAt: '2026-09-05T09:00:00.000Z', editedAt: null },
      { id: 'm2', authorId: 'user_client', authorType: 'contact', body: '<p>Also mine</p>', isInternal: false, createdAt: '2026-09-05T10:00:00.000Z', editedAt: null },
      { id: 'm3', authorId: 'tm_liam', authorType: 'team_member', body: '<p>Theirs</p>', isInternal: false, createdAt: '2026-09-05T11:00:00.000Z', editedAt: null },
    ]]
    fake.queues.team_members = [[{ id: 'tm_liam', name: 'Liam Miller', avatarUrl: null }]]
    fake.queues.contacts = [[{ id: 'ct_1', name: 'Ana Rewiri' }]]

    const out = await loadThreadMessages(fake.db, {
      source: 'request', id: 'r1', orgId: 'org_1', viewer: CLIENT, audience: 'client',
    })
    expect(out.map(m => m.isOwn)).toEqual([true, true, false])
  })

  it('serves a voice note through the org-scoped serve route', async () => {
    fake.queues.messages = [[
      { id: 'm1', authorId: 'tm_liam', authorType: 'team_member', body: '', isInternal: false, createdAt: '2026-09-05T09:00:00.000Z', editedAt: null },
    ]]
    fake.queues.voice_notes = [[{ messageId: 'm1', storageKey: 'org_1/general/v.webm', durationSeconds: 42, mimeType: 'audio/webm' }]]
    const out = await loadThreadMessages(fake.db, {
      source: 'channel', id: 'conv_1', orgId: 'org_1', viewer: CLIENT, audience: 'client',
    })
    expect(out[0].voiceNote).toEqual({
      url: '/api/uploads/serve?key=org_1%2Fgeneral%2Fv.webm',
      durationSeconds: 42,
    })
  })

  it('reads a channel by conversation id and a request by request id', async () => {
    fake.queues.messages = [[]]
    await loadThreadMessages(fake.db, {
      source: 'channel', id: 'conv_1', orgId: 'org_1', viewer: STUDIO, audience: 'studio',
    })
    expect(has(whereFor(fake, 'messages'), 'eq', 'messages.conversation_id', 'conv_1')).toBe(true)
  })
})

describe('markThreadRead', () => {
  it('writes a request receipt against the Clerk id and the user type', async () => {
    fake.queues.request_reads = [[]]
    await markThreadRead(fake.db, { source: 'request', id: 'r1', viewer: CLIENT })
    expect(fake.inserts[0].table).toBe('request_reads')
    expect(fake.inserts[0].row).toMatchObject({ requestId: 'r1', userId: 'user_client', userType: 'contact' })
  })

  it('moves the existing receipt instead of adding a second row', async () => {
    fake.queues.request_reads = [[{ id: 'read_1' }]]
    await markThreadRead(fake.db, { source: 'request', id: 'r1', viewer: CLIENT })
    expect(fake.inserts).toHaveLength(0)
    expect(fake.updates[0].table).toBe('request_reads')
  })

  it('writes a channel cursor against the DOMAIN id, a different identity space', async () => {
    fake.queues.conversation_participants = [[]]
    await markThreadRead(fake.db, { source: 'channel', id: 'conv_1', viewer: CLIENT })
    expect(fake.inserts[0].table).toBe('conversation_participants')
    expect(fake.inserts[0].row).toMatchObject({ conversationId: 'conv_1', participantId: 'ct_1', participantType: 'contact' })
  })

  it('falls back to the Clerk id when there is no domain row, so a badge can still clear', async () => {
    // Somebody invited but not yet linked to a contacts row. Refusing to
    // write anything here left them with an unread count that only ever
    // counted up. The cursor is theirs alone and nothing else reads it, so a
    // Clerk-keyed row is the honest place to put it.
    fake.queues.conversation_participants = [[]]
    await markThreadRead(fake.db, {
      source: 'channel', id: 'conv_1',
      viewer: { clerkUserId: 'user_x', domainId: null, userType: 'contact' },
    })
    expect(fake.inserts[0].table).toBe('conversation_participants')
    expect(fake.inserts[0].row).toMatchObject({ conversationId: 'conv_1', participantId: 'user_x' })
  })
})

describe('attachFilesToMessage', () => {
  it('scopes a request-thread stamp to the org AND the request', async () => {
    await attachFilesToMessage(fake.db, {
      messageId: 'm1', fileIds: ['f1', 'f2'], orgId: 'org_1', requestId: 'r1',
    })
    const update = fake.updates[0]
    expect(update.table).toBe('files')
    expect(update.patch).toEqual({ messageId: 'm1' })
    expect(has(update.where ?? undefined, 'eq', 'files.org_id', 'org_1')).toBe(true)
    expect(has(update.where ?? undefined, 'eq', 'files.request_id', 'r1')).toBe(true)
  })

  it('scopes a channel stamp to the org, which is all a channel has', async () => {
    await attachFilesToMessage(fake.db, { messageId: 'm1', fileIds: ['f1'], orgId: 'org_1', requestId: null })
    expect(has(fake.updates[0].where ?? undefined, 'eq', 'files.org_id', 'org_1')).toBe(true)
    expect(has(fake.updates[0].where ?? undefined, 'eq', 'files.request_id')).toBe(false)
  })

  it('writes nothing when there is nothing to attach', async () => {
    expect(await attachFilesToMessage(fake.db, { messageId: 'm1', fileIds: [], orgId: 'org_1' })).toBe(0)
    expect(fake.updates).toHaveLength(0)
  })

  it('only ever claims a file nobody has claimed', async () => {
    // Without this, naming a file already hanging off somebody else's message
    // in the same org re-parented it onto yours and silently stripped the
    // attachment off theirs. Same tenant, still data loss.
    await attachFilesToMessage(fake.db, { messageId: 'm1', fileIds: ['f1'], orgId: 'org_1', requestId: 'r1' })
    expect(has(fake.updates[0].where ?? undefined, 'isNull', 'files.message_id')).toBe(true)
  })
})
