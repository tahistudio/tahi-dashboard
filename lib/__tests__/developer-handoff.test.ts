/**
 * lib/developer-handoff.ts: developer resolution, the request and task
 * paths, the self-handoff rule, and the guarantee that nothing sends email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))

type Row = Record<string, unknown>

interface Handles {
  queues: Record<string, Row[][]>
  inserts: Array<{ table: string; values: Row }>
  updates: Array<{ table: string; set: Row }>
  allRows: Row[]
  allThrows: boolean
}

const h: Handles = { queues: {}, inserts: [], updates: [], allRows: [], allThrows: false }

vi.mock('@/db/d1', () => {
  const t = (name: string, cols: string[]) =>
    Object.fromEntries([['_table', name], ...cols.map(c => [c, c])])
  return {
    schema: {
      settings: t('settings', ['key', 'value']),
      teamMembers: t('team_members', ['id', 'name', 'clerkUserId']),
      requests: t('requests', ['id', 'orgId', 'title', 'assigneeId', 'updatedAt']),
      requestParticipants: t('request_participants', ['id', 'requestId', 'participantId', 'participantType', 'removedAt']),
      messages: t('messages', []),
      tasks: t('tasks', ['id', 'title', 'assigneeId']),
    },
  }
})

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  const sql = (strings: TemplateStringsArray) => ({ text: strings.join('?') })
  return { and: stub, eq: stub, or: stub, isNull: stub, sql }
})

const notifyTeamMember = vi.fn()
vi.mock('@/lib/notifications', () => ({
  notifyTeamMember: (...args: unknown[]) => notifyTeamMember(...args),
}))

const postTaskComment = vi.fn()
const postRequestBotMessage = vi.fn()
vi.mock('@/lib/task-comments', () => ({
  postTaskComment: (...args: unknown[]) => postTaskComment(...args),
  postRequestBotMessage: (...args: unknown[]) => postRequestBotMessage(...args),
}))

const resolveTeamMember = vi.fn()
vi.mock('@/lib/team-identity', () => ({
  resolveTeamMember: (...args: unknown[]) => resolveTeamMember(...args),
}))

const sendEmail = vi.fn()
vi.mock('@/lib/email-delivery', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email-delivery')>('@/lib/email-delivery')
  return { ...actual, deliverEmail: (...args: unknown[]) => sendEmail(...args) }
})

const sendNotificationEmails = vi.fn()
vi.mock('@/lib/notification-email', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notification-email')>('@/lib/notification-email')
  return { ...actual, sendNotificationEmails: (...args: unknown[]) => sendNotificationEmails(...args) }
})

function fakeDb() {
  type Chain = Promise<Row[]> & { where: () => Chain; limit: () => Chain }
  const chainFor = (rows: Row[]): Chain => {
    const c = Promise.resolve(rows) as Chain
    c.where = () => c
    c.limit = () => c
    return c
  }
  return {
    select: () => ({
      from: (table: { _table: string }) => {
        const q = h.queues[table._table] ?? []
        return chainFor(q.length > 0 ? (q.shift() as Row[]) : [])
      },
    }),
    insert: (table: { _table: string }) => ({
      values: (values: Row) => {
        h.inserts.push({ table: table._table, values })
        return Promise.resolve()
      },
    }),
    update: (table: { _table: string }) => ({
      set: (set: Row) => ({
        where: () => {
          h.updates.push({ table: table._table, set })
          return Promise.resolve()
        },
      }),
    }),
    all: async () => {
      if (h.allThrows) throw new Error('D1_ERROR: no such column: mcp_profile')
      return h.allRows
    },
  } as unknown as Parameters<typeof import('@/lib/developer-handoff').handOffToDeveloper>[0]
}

import { handOffToDeveloper, resolveDeveloper } from '@/lib/developer-handoff'

const LIAM: Row = { id: 'tm_liam', name: 'Liam', clerkUserId: 'user_liam' }

beforeEach(() => {
  vi.clearAllMocks()
  h.queues = {}
  h.inserts = []
  h.updates = []
  h.allRows = []
  h.allThrows = false
  notifyTeamMember.mockResolvedValue({ delivered: 1, skipped: 0 })
  postTaskComment.mockResolvedValue({ id: 'cmt_1' })
  postRequestBotMessage.mockResolvedValue('bot_msg_1')
  resolveTeamMember.mockResolvedValue({ id: 'tm_staci', role: 'member', name: 'Staci' })
})

describe('resolveDeveloper', () => {
  it('uses the setting when it names a team member id', async () => {
    h.queues = { settings: [[{ value: 'tm_liam' }]], team_members: [[LIAM]] }
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ id: 'tm_liam', name: 'Liam' })
  })

  it('uses the setting when it names a Clerk user id', async () => {
    h.queues = { settings: [[{ value: ' user_liam ' }]], team_members: [[LIAM]] }
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ id: 'tm_liam', clerkUserId: 'user_liam' })
  })

  it('answers 409 when the setting names nobody, without falling back', async () => {
    h.allRows = [{ id: 'tm_liam' }]
    h.queues = { settings: [[{ value: 'ghost' }]], team_members: [[]] }
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ ok: false, status: 409, code: 'no_developer' })
  })

  it('falls back to the single full-profile row', async () => {
    h.allRows = [{ id: 'tm_liam' }]
    h.queues = { team_members: [[LIAM]] }
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ id: 'tm_liam' })
  })

  it('answers 409 naming the setting when two rows are full profile', async () => {
    h.allRows = [{ id: 'tm_liam' }, { id: 'tm_staci' }]
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ ok: false, status: 409 })
    expect((dev as { message: string }).message).toContain('mcp.developerTeamMemberId')
  })

  it('answers 409 when no row is full profile', async () => {
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ ok: false, status: 409 })
  })

  it('treats a missing mcp_profile column as no match', async () => {
    h.allThrows = true
    const dev = await resolveDeveloper(fakeDb())
    expect(dev).toMatchObject({ ok: false, status: 409 })
  })
})

describe('handOffToDeveloper, request path', () => {
  const request: Row = { id: 'req_1', orgId: 'org_a', title: 'Checkout rebuild' }

  function seedRequest(participants: Row[], assigneeId: string | null = null) {
    h.queues = {
      settings: [[{ value: 'tm_liam' }]],
      team_members: [[LIAM]],
      requests: [[{ ...request, assigneeId }]],
      request_participants: [participants],
    }
  }

  it('adds the developer as assignee, posts an internal note and notifies', async () => {
    seedRequest([])
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Needs a custom <b>Stripe</b> embed', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: true, developerTeamMemberId: 'tm_liam', addedAsAssignee: true, notified: true })
    const participant = h.inserts.find(i => i.table === 'request_participants')
    expect(participant?.values).toMatchObject({
      requestId: 'req_1', participantId: 'tm_liam', participantType: 'team_member', role: 'assignee',
    })
    const message = h.inserts.find(i => i.table === 'messages')
    expect(message?.values).toMatchObject({
      requestId: 'req_1', isInternal: true, authorId: 'tm_staci', authorType: 'team_member',
      body: 'Developer handoff: Needs a custom Stripe embed',
    })
    expect(notifyTeamMember).toHaveBeenCalledTimes(1)
    const [, recipient, payload] = notifyTeamMember.mock.calls[0] as [unknown, string, Record<string, unknown>]
    expect(recipient).toBe('tm_liam')
    expect(payload).toMatchObject({ type: 'request_assigned', entityType: 'request', entityId: 'req_1' })
    expect(payload).not.toHaveProperty('email')
  })

  it('sets requests.assigneeId when it is null', async () => {
    seedRequest([])
    await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Wire the webhook', actorUserId: 'user_staci',
    })
    const update = h.updates.find(u => u.table === 'requests' && 'assigneeId' in u.set)
    expect(update?.set).toMatchObject({ assigneeId: 'tm_liam' })
    expect(typeof update?.set.updatedAt).toBe('string')
  })

  it('reports added when only assigneeId was null and the participant row existed', async () => {
    seedRequest([{ id: 'rp_1' }])
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Wire the webhook', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: true, addedAsAssignee: true })
    expect(h.inserts.some(i => i.table === 'request_participants')).toBe(false)
  })

  it('never overwrites an existing requests.assigneeId', async () => {
    seedRequest([], 'tm_other')
    await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Wire the webhook', actorUserId: 'user_staci',
    })
    expect(h.updates.some(u => u.table === 'requests' && 'assigneeId' in u.set)).toBe(false)
  })

  it('leaves an existing active participant row alone', async () => {
    seedRequest([{ id: 'rp_1' }], 'tm_other')
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Wire the webhook', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: true, addedAsAssignee: false })
    expect(h.inserts.some(i => i.table === 'request_participants')).toBe(false)
    expect(h.inserts.some(i => i.table === 'messages')).toBe(true)
  })

  it('posts as the Tahi bot when the author is unknown', async () => {
    resolveTeamMember.mockResolvedValue(null)
    seedRequest([])
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'req_1', note: 'Wire the webhook', actorUserId: 'api-service',
    })
    expect(res).toMatchObject({ ok: true, noteId: 'bot_msg_1' })
    expect(postRequestBotMessage).toHaveBeenCalledWith(expect.anything(), 'req_1', { body: 'Developer handoff: Wire the webhook' })
    expect(h.inserts.some(i => i.table === 'messages')).toBe(false)
  })

  it('answers 404 for a missing request', async () => {
    h.queues = { settings: [[{ value: 'tm_liam' }]], team_members: [[LIAM]], requests: [[]] }
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'request', subjectId: 'nope', note: 'x', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: false, status: 404 })
  })
})

describe('handOffToDeveloper, task path', () => {
  function seedTask(assigneeId: string | null) {
    h.queues = {
      settings: [[{ value: 'tm_liam' }]],
      team_members: [[LIAM]],
      tasks: [[{ id: 'task_1', title: 'Fix the form', assigneeId }]],
    }
  }

  it('assigns the developer when the task has no assignee', async () => {
    seedTask(null)
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'task', subjectId: 'task_1', note: 'Needs JS', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: true, addedAsAssignee: true, noteId: 'cmt_1', notified: true })
    expect(h.updates.find(u => u.table === 'tasks')?.set).toMatchObject({ assigneeId: 'tm_liam', assigneeType: 'team_member' })
    expect(postTaskComment).toHaveBeenCalledWith(expect.anything(), {
      taskId: 'task_1',
      author: { authorType: 'team_member', authorId: 'tm_staci' },
      body: 'Developer handoff: Needs JS',
    })
    expect(notifyTeamMember.mock.calls[0][2]).toMatchObject({ type: 'task_assigned', entityType: 'task' })
  })

  it('never reassigns a task that already has an assignee', async () => {
    seedTask('tm_staci')
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'task', subjectId: 'task_1', note: 'Needs JS', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: true, addedAsAssignee: false, notified: true })
    expect(h.updates.some(u => u.table === 'tasks')).toBe(false)
    expect(postTaskComment).toHaveBeenCalledTimes(1)
  })
})

describe('handOffToDeveloper, rules', () => {
  it('skips the notification when the developer hands off to themself', async () => {
    resolveTeamMember.mockResolvedValue({ id: 'tm_liam', role: 'admin', name: 'Liam' })
    h.queues = {
      settings: [[{ value: 'tm_liam' }]],
      team_members: [[LIAM]],
      tasks: [[{ id: 'task_1', title: 'Fix the form', assigneeId: null }]],
    }
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'task', subjectId: 'task_1', note: 'Mine', actorUserId: 'user_liam',
    })
    expect(res).toMatchObject({ ok: true, notified: false })
    expect(postTaskComment).toHaveBeenCalledTimes(1)
    expect(notifyTeamMember).not.toHaveBeenCalled()
  })

  it('rejects an empty or over-long note, a bad subject type and an empty id', async () => {
    const db = fakeDb()
    expect(await handOffToDeveloper(db, { subjectType: 'task', subjectId: 't', note: '  <p> </p> ', actorUserId: null }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await handOffToDeveloper(db, { subjectType: 'task', subjectId: 't', note: 'a'.repeat(2001), actorUserId: null }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await handOffToDeveloper(db, { subjectType: 'deal' as 'task', subjectId: 't', note: 'x', actorUserId: null }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await handOffToDeveloper(db, { subjectType: 'task', subjectId: ' ', note: 'x', actorUserId: null }))
      .toMatchObject({ ok: false, status: 400 })
  })

  it('answers 409 and writes nothing when no developer resolves', async () => {
    const res = await handOffToDeveloper(fakeDb(), {
      subjectType: 'task', subjectId: 'task_1', note: 'x', actorUserId: 'user_staci',
    })
    expect(res).toMatchObject({ ok: false, status: 409 })
    expect(h.inserts).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('sends no email on any path', async () => {
    h.queues = {
      settings: [[{ value: 'tm_liam' }], [{ value: 'tm_liam' }]],
      team_members: [[LIAM], [LIAM]],
      requests: [[{ id: 'req_1', orgId: 'org_a', title: 'T' }]],
      request_participants: [[]],
      tasks: [[{ id: 'task_1', title: 'T', assigneeId: null }]],
    }
    await handOffToDeveloper(fakeDb(), { subjectType: 'request', subjectId: 'req_1', note: 'x', actorUserId: 'user_staci' })
    await handOffToDeveloper(fakeDb(), { subjectType: 'task', subjectId: 'task_1', note: 'x', actorUserId: 'user_staci' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendNotificationEmails).not.toHaveBeenCalled()
    for (const call of notifyTeamMember.mock.calls) {
      expect(call[2]).not.toHaveProperty('email')
    }
  })
})
