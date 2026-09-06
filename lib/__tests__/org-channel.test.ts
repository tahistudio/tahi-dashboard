/**
 * lib/org-channel.ts: the two rooms the inbox resolves lazily.
 *
 * The contract under test is IDEMPOTENCE, because both resolvers are
 * find-or-create and a find-or-create races itself:
 *
 *   - a GET must never write. `create: false` on an org with no channel
 *     returns null and inserts nothing, so a client opening the page (or the
 *     studio glancing at a client they have never messaged) does not mint a
 *     row.
 *   - a second call finds the first call's row instead of adding another.
 *   - when two writers race and the unique index from migration 0092 refuses
 *     the loser's insert, the loser RE-READS and returns the winner's row
 *     rather than throwing a 500 at a message that was about to be sent.
 *   - a request thread resolves through pickThreadConversationId, the same
 *     deterministic choice the request detail makes, so the two surfaces can
 *     never disagree about which row a request's thread is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

interface Chain extends Promise<Row[]> {
  innerJoin: () => Chain
  where: () => Chain
  orderBy: () => Chain
  limit: () => Chain
}

vi.mock('@/db/d1', () => ({
  schema: {
    conversations: { _table: 'conversations', id: 'id', orgId: 'org_id', type: 'type', requestId: 'request_id', visibility: 'visibility', createdAt: 'created_at' },
    conversationParticipants: { _table: 'conversation_participants', id: 'id', conversationId: 'conversation_id', participantId: 'participant_id', participantType: 'participant_type' },
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    contacts: { _table: 'contacts', id: 'id', orgId: 'org_id' },
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', avatarUrl: 'avatar_url' },
    teamMemberAccess: { _table: 'team_member_access', id: 'id', teamMemberId: 'team_member_id', role: 'role' },
    teamMemberAccessOrgs: { _table: 'team_member_access_orgs', accessId: 'access_id', orgId: 'org_id' },
    requestParticipants: { _table: 'request_participants', requestId: 'request_id', participantId: 'participant_id', participantType: 'participant_type', removedAt: 'removed_at' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
  and: (...parts: unknown[]) => ({ __op: 'and', parts }),
  inArray: (col: unknown, vals: unknown) => ({ __op: 'in', col, vals }),
  isNull: (col: unknown) => ({ __op: 'isNull', col }),
}))

import { resolveOrgChannel, resolveRequestThread, orgChannelParticipants, syncConversationParticipants } from '@/lib/org-channel'

type DrizzleDB = Parameters<typeof resolveOrgChannel>[0]

interface Fake {
  queues: Record<string, Row[][]>
  inserts: Array<{ table: string; row: Row }>
  /** Tables whose next insert should throw, standing in for the unique index. */
  rejectInsert: Set<string>
  db: DrizzleDB
}

function fakeDb(): Fake {
  const state: Omit<Fake, 'db'> = { queues: {}, inserts: [], rejectInsert: new Set() }

  function chainFor(rows: Row[]): Chain {
    const chain = Promise.resolve(rows) as Chain
    chain.innerJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }

  const db = {
    select: () => ({
      from: (table: { _table?: string } | undefined) => {
        const name = table?._table ?? ''
        const queue = state.queues[name] ?? []
        return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
      },
    }),
    insert: (table: { _table?: string } | undefined) => ({
      values: async (row: Row) => {
        const name = table?._table ?? ''
        if (state.rejectInsert.has(name)) {
          state.rejectInsert.delete(name)
          throw new Error('UNIQUE constraint failed')
        }
        state.inserts.push({ table: name, row })
      },
    }),
  } as unknown as DrizzleDB

  return { ...state, db }
}

let fake: Fake

beforeEach(() => {
  fake = fakeDb()
})

const OPTS = { create: false, createdById: 'user_1' }

describe('resolveOrgChannel', () => {
  it('returns the existing room without writing anything', async () => {
    fake.queues.conversations = [[{ id: 'conv_1', createdAt: '2026-01-01T00:00:00.000Z' }]]
    const id = await resolveOrgChannel(fake.db, 'org_1', OPTS)
    expect(id).toBe('conv_1')
    expect(fake.inserts).toHaveLength(0)
  })

  it('a GET never mints a room: no channel and create false answers null', async () => {
    fake.queues.conversations = [[]]
    const id = await resolveOrgChannel(fake.db, 'org_1', OPTS)
    expect(id).toBeNull()
    expect(fake.inserts).toHaveLength(0)
  })

  it('creates one on a write, named after the client', async () => {
    fake.queues.conversations = [[]]
    fake.queues.organisations = [[{ name: 'Mahana Orchards' }]]
    const id = await resolveOrgChannel(fake.db, 'org_1', { create: true, createdById: 'user_1' })
    expect(id).toBeTruthy()
    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0].table).toBe('conversations')
    expect(fake.inserts[0].row).toMatchObject({
      type: 'org_channel',
      orgId: 'org_1',
      requestId: null,
      // Always external. Per-message isInternal is what hides a studio note;
      // the room itself is the shared one.
      visibility: 'external',
      name: 'Mahana Orchards',
    })
  })

  it('picks the oldest when a pre-index database carries two', async () => {
    fake.queues.conversations = [[
      { id: 'conv_new', createdAt: '2026-05-01T00:00:00.000Z' },
      { id: 'conv_old', createdAt: '2026-01-01T00:00:00.000Z' },
    ]]
    expect(await resolveOrgChannel(fake.db, 'org_1', OPTS)).toBe('conv_old')
  })

  it('re-reads the winner when the unique index refuses a raced insert', async () => {
    // Two tabs post in the same second: the loser's INSERT hits
    // idx_conversations_org_channel and must resolve to the winner's row
    // rather than 500 the message that triggered it.
    fake.queues.conversations = [[], [{ id: 'conv_winner', createdAt: '2026-01-01T00:00:00.000Z' }]]
    fake.queues.organisations = [[{ name: 'Mahana Orchards' }]]
    fake.rejectInsert.add('conversations')
    expect(await resolveOrgChannel(fake.db, 'org_1', { create: true, createdById: 'user_1' })).toBe('conv_winner')
  })

  it('throws only when the race is lost AND the winner cannot be found', async () => {
    fake.queues.conversations = [[], []]
    fake.queues.organisations = [[{ name: 'Mahana Orchards' }]]
    fake.rejectInsert.add('conversations')
    await expect(resolveOrgChannel(fake.db, 'org_1', { create: true, createdById: 'user_1' }))
      .rejects.toThrow(/org channel/i)
  })
})

describe('resolveRequestThread', () => {
  const input = { requestId: 'req_1', orgId: 'org_1', title: 'Brand palette extension' }

  it('reuses the row the request already has', async () => {
    fake.queues.conversations = [[
      { id: 'conv_1', type: 'request_thread', visibility: 'external', createdAt: '2026-01-01T00:00:00.000Z' },
    ]]
    expect(await resolveRequestThread(fake.db, input, OPTS)).toBe('conv_1')
    expect(fake.inserts).toHaveLength(0)
  })

  it('prefers an external row over a legacy internal one, matching the request detail', async () => {
    fake.queues.conversations = [[
      { id: 'conv_internal', type: 'request_thread', visibility: 'internal', createdAt: '2025-01-01T00:00:00.000Z' },
      { id: 'conv_external', type: 'request_thread', visibility: 'external', createdAt: '2026-01-01T00:00:00.000Z' },
    ]]
    expect(await resolveRequestThread(fake.db, input, OPTS)).toBe('conv_external')
  })

  it('answers null on a read, so a GET never mints a second room per page load', async () => {
    // The bug this replaces: the detail page held conversationId in state that
    // started null and was never hydrated, so the first message after every
    // load minted a fresh request_thread row.
    fake.queues.conversations = [[]]
    expect(await resolveRequestThread(fake.db, input, OPTS)).toBeNull()
    expect(fake.inserts).toHaveLength(0)
  })

  it('creates one on a write, always external and named after the request', async () => {
    fake.queues.conversations = [[]]
    const id = await resolveRequestThread(fake.db, input, { create: true, createdById: 'user_1' })
    expect(id).toBeTruthy()
    expect(fake.inserts[0].row).toMatchObject({
      type: 'request_thread',
      requestId: 'req_1',
      orgId: 'org_1',
      visibility: 'external',
      name: 'Brand palette extension',
    })
  })

  it('re-reads the winner when the unique index refuses a raced insert', async () => {
    fake.queues.conversations = [
      [],
      [{ id: 'conv_winner', type: 'request_thread', visibility: 'external', createdAt: '2026-01-01T00:00:00.000Z' }],
    ]
    fake.rejectInsert.add('conversations')
    expect(await resolveRequestThread(fake.db, input, { create: true, createdById: 'user_1' })).toBe('conv_winner')
  })
})

describe('orgChannelParticipants', () => {
  it('is every contact at the org plus the team assigned to it', async () => {
    fake.queues.contacts = [[{ id: 'ct_1' }, { id: 'ct_2' }]]
    fake.queues.team_member_access = [[{ pmId: 'tm_pm' }]]
    const seeds = await orgChannelParticipants(fake.db, 'org_1')
    expect(seeds).toEqual([
      { participantId: 'ct_1', participantType: 'contact' },
      { participantId: 'ct_2', participantType: 'contact' },
      { participantId: 'tm_pm', participantType: 'team_member' },
    ])
  })

  it('seeds the whole studio when nobody is assigned yet', async () => {
    // Otherwise a client with no PM would have a room only they are standing in.
    fake.queues.contacts = [[{ id: 'ct_1' }]]
    fake.queues.team_member_access = [[]]
    fake.queues.team_members = [[{ id: 'tm_liam' }, { id: 'tm_staci' }]]
    const seeds = await orgChannelParticipants(fake.db, 'org_1')
    expect(seeds.filter(s => s.participantType === 'team_member').map(s => s.participantId))
      .toEqual(['tm_liam', 'tm_staci'])
  })
})

describe('syncConversationParticipants', () => {
  it('adds only the people who are not in the room already', async () => {
    fake.queues.conversation_participants = [[{ participantId: 'ct_1' }]]
    await syncConversationParticipants(fake.db, 'conv_1', [
      { participantId: 'ct_1', participantType: 'contact' },
      { participantId: 'tm_liam', participantType: 'team_member' },
    ])
    expect(fake.inserts.map(i => i.row.participantId)).toEqual(['tm_liam'])
  })

  it('swallows the unique-index refusal on a concurrent add', async () => {
    fake.queues.conversation_participants = [[]]
    fake.rejectInsert.add('conversation_participants')
    await expect(syncConversationParticipants(fake.db, 'conv_1', [
      { participantId: 'tm_liam', participantType: 'team_member' },
    ])).resolves.toBeUndefined()
  })
})
