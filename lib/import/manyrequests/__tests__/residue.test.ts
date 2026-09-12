/**
 * The residue sweep (MC.9).
 *
 * The interesting behaviour here is the same as the rest of the cleanup: what
 * it REFUSES. A structural class only fires on a provably dangling parent id,
 * and an audited id is worthless on its own, so every allowlist entry has to
 * clear its own sanity predicate before the row is touched.
 *
 * The harness is the cleanup harness with one addition: the fake delete
 * actually removes the rows it matched, and the fake select honours a where
 * clause. Without that, "a second run plans nothing" could not be tested at
 * all, because the seed rows would still be sitting there after the apply.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Recorded {
  deletes: string[]
}

const recorded: Recorded = { deletes: [] }
let tableRows: Record<string, Array<Record<string, unknown>>> = {}

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, or: stub, inArray: stub, isNull: stub, sql: stub }
})

/**
 * Columns are their own camelCase row key, so a recorded where clause can be
 * resolved back to the field it filters on.
 */
function fakeTable(name: string, columns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { __table: name }
  for (const column of columns) out[column] = column
  return out
}

vi.mock('@/db/d1', () => ({
  schema: {
    organisations: fakeTable('organisations', ['id', 'name', 'status']),
    subscriptions: fakeTable('subscriptions', ['id', 'orgId', 'manyrequestsId', 'stripeSubscriptionId']),
    tracks: fakeTable('tracks', ['id', 'subscriptionId', 'currentRequestId']),
    requests: fakeTable('requests', ['id', 'trackId', 'manyrequestsId']),
    tasks: fakeTable('tasks', ['id', 'title', 'trackId', 'orgId']),
    taskSubtasks: fakeTable('task_subtasks', ['id', 'taskId']),
    workBlockers: fakeTable('work_blockers', ['id', 'blockedType', 'blockedId', 'blockerType', 'blockerId']),
    timeEntries: fakeTable('time_entries', ['id', 'source', 'hours', 'orgId', 'requestId']),
    conversations: fakeTable('conversations', ['id', 'type', 'name', 'requestId', 'orgId']),
    conversationParticipants: fakeTable('conversation_participants', ['id', 'conversationId']),
    messages: fakeTable('messages', ['id', 'conversationId', 'orgId', 'requestId', 'manyrequestsId']),
    notifications: fakeTable('notifications', ['id', 'userId', 'userType', 'entityType', 'entityId']),
    contacts: fakeTable('contacts', ['id', 'clerkUserId']),
    teamMembers: fakeTable('team_members', ['id', 'clerkUserId']),
    invoices: fakeTable('invoices', ['id', 'orgId']),
    requestParticipants: fakeTable('request_participants', ['id', 'requestId']),
    requestReads: fakeTable('request_reads', ['id', 'requestId']),
    scheduledCalls: fakeTable('scheduled_calls', ['id', 'orgId']),
  },
}))

import { planResidue, RESIDUE_ALLOWLIST, type ResidueClass, type ResiduePlan } from '../residue'
import { runCleanup } from '../cleanup'
import type { DB } from '@/db/d1'

// ── the audited ids under test ───────────────────────────────────────────────

const TASK_GET_MONEYS = 'efa2daf2-329b-4087-ab5a-dbafe5cc8aab'
const TASK_GET_MONEYSD = 'd8dbfc14-24a8-48e7-a14d-12960acdbe65'
const SUBTASK_ONE = 'ad8161b7-6d7a-4a54-acca-58fe1cf25efa'
const DEAD_TASK = 'c4409924-dbee-4e5d-b0d9-6e8806817734'
const BLOCKER_DEMO_PAIR = 'f49e4ab9-816b-467f-ae47-b6593076589c'
const TIMER_SMOKE = '60858e75-7f05-4b63-ad11-18fa9356c3d8'
const CONVERSATION_TEST = '2ee90ded-57e0-4b87-9dac-233795f99e57'
const NOTIFICATION_RETRET = '6e07cd0a-8c9e-4c05-8e86-e49d0de6708c'
const NOTIFICATION_RETRET_ENTITY = 'a3cf20b5-7bd3-47dd-a080-aba22d4b2f04'

// ── the fake D1 ──────────────────────────────────────────────────────────────

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

interface WhereFilter {
  column?: string
  ids?: string[]
  nullColumns: string[]
}

/**
 * Read a recorded where clause back into something the fake can act on. The
 * drizzle stubs turn `inArray(col, ids)` into `{ args: [col, ids] }` and
 * `isNull(col)` into `{ args: [col] }`, and `and(...)` nests them.
 */
function readWhere(condition: unknown): WhereFilter {
  const filter: WhereFilter = { nullColumns: [] }
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const args = (node as { args?: unknown[] }).args
    if (!Array.isArray(args)) return
    if (args.length === 2 && typeof args[0] === 'string' && Array.isArray(args[1])) {
      filter.column = args[0]
      filter.ids = args[1] as string[]
      return
    }
    if (args.length === 1 && typeof args[0] === 'string') {
      filter.nullColumns.push(args[0])
      return
    }
    for (const arg of args) walk(arg)
  }
  walk(condition)
  return filter
}

function matches(row: Record<string, unknown>, filter: WhereFilter): boolean {
  if (filter.column && filter.ids && !filter.ids.includes(String(row[filter.column]))) return false
  return filter.nullColumns.every((column) => row[column] === null || row[column] === undefined)
}

function query(rows: Array<Record<string, unknown>>) {
  const thenable = {
    where: (condition: unknown) => query(rows.filter((row) => matches(row, readWhere(condition)))),
    limit: () => query(rows),
    then: <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(rows).then(resolve),
  }
  return thenable
}

function fakeDb(): DB {
  return {
    select: () => ({ from: (table: unknown) => query(tableRows[tableName(table)] ?? []) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        const name = tableName(table)
        recorded.deletes.push(name)
        const filter = readWhere(condition)
        tableRows[name] = (tableRows[name] ?? []).filter((row) => !matches(row, filter))
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as DB
}

function rowsOf(plan: ResiduePlan, residueClass: ResidueClass): Array<{ table: string; id: string; reason: string }> {
  return plan.groups.find((group) => group.class === residueClass)?.rows ?? []
}

function refusalsOf(plan: ResiduePlan, residueClass: ResidueClass) {
  return plan.groups.find((group) => group.class === residueClass)?.refusals ?? []
}

function idsOf(plan: ResiduePlan, residueClass: ResidueClass): string[] {
  return rowsOf(plan, residueClass).map((row) => row.id)
}

beforeEach(() => {
  recorded.deletes = []
  tableRows = {}
})

describe('orphan_tracks', () => {
  it('finds a track whose subscription is gone, and leaves one whose subscription is live', async () => {
    tableRows.subscriptions = [{ id: 'sub_live', orgId: 'org_a', manyrequestsId: null, stripeSubscriptionId: null }]
    tableRows.tracks = [
      { id: 'track_orphan', subscriptionId: 'sub_gone' },
      { id: 'track_live', subscriptionId: 'sub_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_tracks')).toEqual(['track_orphan'])
    expect(rowsOf(plan, 'orphan_tracks')[0].reason).toContain('sub_gone')
  })

  it('refuses an orphan track that still holds work, because that is work and not residue', async () => {
    tableRows.tracks = [{ id: 'track_busy', subscriptionId: 'sub_gone' }]
    tableRows.requests = [{ id: 'r1', trackId: 'track_busy', manyrequestsId: '344' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_tracks')).toEqual([])
    expect(refusalsOf(plan, 'orphan_tracks')[0]).toMatchObject({ id: 'track_busy', reason: 'predicate_failed' })
  })

  it('refuses an orphan track whose current_request_id points at a request that still exists, even with no request or task keyed to the track', async () => {
    tableRows.tracks = [{ id: 'track_busy', subscriptionId: 'sub_gone', currentRequestId: 'req_live' }]
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_tracks')).toEqual([])
    expect(refusalsOf(plan, 'orphan_tracks')[0]).toMatchObject({ id: 'track_busy', reason: 'predicate_failed' })
    expect(refusalsOf(plan, 'orphan_tracks')[0].detail).toContain('req_live')
  })

  it('takes an orphan track whose current_request_id points at a request that no longer exists', async () => {
    tableRows.tracks = [{ id: 'track_orphan', subscriptionId: 'sub_gone', currentRequestId: 'req_gone' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_tracks')).toEqual(['track_orphan'])
  })
})

describe('orphan_subtasks', () => {
  it('finds a checklist item whose task is gone', async () => {
    tableRows.tasks = [{ id: 'task_live', title: 'Real work', trackId: null, orgId: 'org_a' }]
    tableRows.task_subtasks = [
      { id: 'sub_orphan', taskId: 'task_gone' },
      { id: 'sub_live', taskId: 'task_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_subtasks')).toEqual(['sub_orphan'])
  })
})

describe('orphan_blockers', () => {
  it('finds a blocker whose blocking request no longer exists, and keeps one with both ends alive', async () => {
    tableRows.tasks = [{ id: 'task_live', title: 'Real work', trackId: null, orgId: 'org_a' }]
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    tableRows.work_blockers = [
      { id: 'blocker_dangling', blockedType: 'request', blockedId: 'req_live', blockerType: 'request', blockerId: 'req_gone' },
      { id: 'blocker_live', blockedType: 'task', blockedId: 'task_live', blockerType: 'request', blockerId: 'req_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_blockers')).toEqual(['blocker_dangling'])
    expect(rowsOf(plan, 'orphan_blockers')[0].reason).toContain('req_gone')
  })

  it('refuses a blocker whose end types it cannot resolve rather than guessing', async () => {
    tableRows.work_blockers = [
      { id: 'blocker_weird', blockedType: 'invoice', blockedId: 'x', blockerType: 'task', blockerId: 'y' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_blockers')).toEqual([])
    expect(refusalsOf(plan, 'orphan_blockers')[0]).toMatchObject({ id: 'blocker_weird', reason: 'predicate_failed' })
  })
})

describe('orphan_request_threads', () => {
  it('takes an empty thread whose request is gone, and its participants with it', async () => {
    tableRows.conversations = [
      { id: 'conv_orphan', type: 'request_thread', name: 'test', requestId: 'req_gone', orgId: 'org_physitrack' },
      { id: 'conv_live', type: 'request_thread', name: 'Real', requestId: 'req_live', orgId: 'org_a' },
    ]
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    tableRows.conversation_participants = [
      { id: 'part_1', conversationId: 'conv_orphan' },
      { id: 'part_2', conversationId: 'conv_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_request_threads')).toEqual(['conv_orphan', 'part_1'])
  })

  it('refuses a dangling thread that still holds messages, because a message is content', async () => {
    tableRows.conversations = [
      { id: 'conv_spoken', type: 'request_thread', name: 'test', requestId: 'req_gone', orgId: 'org_a' },
    ]
    tableRows.messages = [{ id: 'm1', conversationId: 'conv_spoken', orgId: 'org_a', requestId: null, manyrequestsId: null }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_request_threads')).toEqual([])
    expect(refusalsOf(plan, 'orphan_request_threads')[0]).toMatchObject({ id: 'conv_spoken', reason: 'predicate_failed' })
  })
})

describe('orphan_notifications', () => {
  it('finds a notification whose request is gone and one whose contact recipient is gone', async () => {
    tableRows.contacts = [{ id: 'contact_live', clerkUserId: 'user_live' }]
    tableRows.team_members = [{ id: 'member_live', clerkUserId: 'user_liam' }]
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    tableRows.notifications = [
      { id: 'n_dead_request', userId: 'member_live', userType: 'team_member', entityType: 'request', entityId: 'req_gone' },
      { id: 'n_dead_contact', userId: 'contact_gone', userType: 'contact', entityType: 'request', entityId: 'req_live' },
      { id: 'n_live', userId: 'member_live', userType: 'team_member', entityType: 'request', entityId: 'req_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual(['n_dead_request', 'n_dead_contact'])
  })

  it('never calls a Clerk shaped recipient missing, because D1 cannot prove a Clerk user is gone', async () => {
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    tableRows.notifications = [
      { id: 'n_clerk', userId: 'user_3FIxghTGGdoGhO5MjRYHFgtzvd5', userType: 'team_member', entityType: 'request', entityId: 'req_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual([])
  })

  it('takes a task-entity notification pointing at a P18 residue task planned in this same run', async () => {
    tableRows.tasks = [{ id: TASK_GET_MONEYS, title: 'Get moneys', trackId: null, orgId: 'org_stride' }]
    tableRows.notifications = [
      { id: 'n_task_residue', userId: 'member_live', userType: 'team_member', entityType: 'task', entityId: TASK_GET_MONEYS },
    ]
    tableRows.team_members = [{ id: 'member_live', clerkUserId: 'user_liam' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual(['n_task_residue'])
    expect(rowsOf(plan, 'orphan_notifications')[0].reason).toContain(TASK_GET_MONEYS)
  })

  it('leaves a task-entity notification pointing at a live task alone', async () => {
    tableRows.tasks = [{ id: 'task_live', title: 'Real work', trackId: null, orgId: 'org_a' }]
    tableRows.team_members = [{ id: 'member_live', clerkUserId: 'user_liam' }]
    tableRows.notifications = [
      { id: 'n_task_live', userId: 'member_live', userType: 'team_member', entityType: 'task', entityId: 'task_live' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual([])
  })

  it('takes a task-entity notification whose task id no longer exists', async () => {
    tableRows.team_members = [{ id: 'member_live', clerkUserId: 'user_liam' }]
    tableRows.notifications = [
      { id: 'n_task_gone', userId: 'member_live', userType: 'team_member', entityType: 'task', entityId: 'task_gone' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual(['n_task_gone'])
  })
})

describe('seed_subscriptions', () => {
  const acme = 'd753f180-1111-2222-3333-444444444444'

  function seedAcme(): void {
    tableRows.organisations = [{ id: acme, name: 'Acme Corp', status: 'archived' }]
    tableRows.subscriptions = [{ id: 'sub_seed', orgId: acme, manyrequestsId: null, stripeSubscriptionId: null }]
    tableRows.tracks = [
      { id: 'track_a', subscriptionId: 'sub_seed' },
      { id: 'track_b', subscriptionId: 'sub_seed' },
    ]
  }

  it('takes the tracks and the subscription, and never the organisation', async () => {
    seedAcme()
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual(['track_a', 'track_b', 'sub_seed'])
    const everyTable = plan.groups.flatMap((group) => group.rows.map((row) => row.table))
    expect(everyTable).not.toContain('organisations')
  })

  it('leaves the organisation row in place after the apply', async () => {
    seedAcme()
    await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    expect(tableRows.organisations).toHaveLength(1)
    expect(tableRows.subscriptions).toHaveLength(0)
    expect(tableRows.tracks).toHaveLength(0)
    expect(recorded.deletes).not.toContain('organisations')
  })

  it('leaves a subscription on an organisation that still holds an invoice', async () => {
    seedAcme()
    tableRows.invoices = [{ id: 'inv_1', orgId: acme }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual([])
  })

  it('refuses a subscription the import adopted', async () => {
    seedAcme()
    tableRows.subscriptions = [{ id: 'sub_seed', orgId: acme, manyrequestsId: '91', stripeSubscriptionId: null }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual([])
    expect(refusalsOf(plan, 'seed_subscriptions')[0]).toMatchObject({ id: 'sub_seed', reason: 'manyrequests_keyed' })
  })

  it('leaves a subscription whose organisation is still active', async () => {
    seedAcme()
    tableRows.organisations = [{ id: acme, name: 'Acme Corp', status: 'active' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual([])
  })

  it('leaves a subscription whose track current_request_id points at a request that still exists', async () => {
    seedAcme()
    tableRows.tracks = [
      { id: 'track_a', subscriptionId: 'sub_seed', currentRequestId: 'req_live' },
      { id: 'track_b', subscriptionId: 'sub_seed' },
    ]
    tableRows.requests = [{ id: 'req_live', trackId: null, manyrequestsId: '344' }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual([])
  })

  it('takes a subscription whose track current_request_id points at a request that no longer exists', async () => {
    seedAcme()
    tableRows.tracks = [
      { id: 'track_a', subscriptionId: 'sub_seed', currentRequestId: 'req_gone' },
      { id: 'track_b', subscriptionId: 'sub_seed' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'seed_subscriptions')).toEqual(['track_a', 'track_b', 'sub_seed'])
  })
})

describe('known_residue: the audited rows and their predicates', () => {
  it('takes an audited demo task whose title still matches, and its checklist items and blockers with it', async () => {
    tableRows.tasks = [
      { id: TASK_GET_MONEYS, title: 'Get moneys', trackId: null, orgId: 'org_stride' },
      { id: TASK_GET_MONEYSD, title: 'Get moneysd', trackId: null, orgId: null },
    ]
    tableRows.task_subtasks = [{ id: 'sub_on_demo', taskId: TASK_GET_MONEYS }]
    tableRows.work_blockers = [
      { id: BLOCKER_DEMO_PAIR, blockedType: 'task', blockedId: TASK_GET_MONEYS, blockerType: 'task', blockerId: TASK_GET_MONEYSD },
    ]
    const plan = await planResidue(fakeDb())
    const ids = idsOf(plan, 'known_residue')
    expect(ids).toContain(TASK_GET_MONEYS)
    expect(ids).toContain(TASK_GET_MONEYSD)
    expect(ids).toContain('sub_on_demo')
    expect(ids).toContain(BLOCKER_DEMO_PAIR)
  })

  it('refuses a reused id as predicate_failed rather than deleting it', async () => {
    tableRows.tasks = [
      { id: TASK_GET_MONEYS, title: 'Q4 invoice reconciliation for Glasswall', trackId: null, orgId: 'org_glasswall' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).toEqual([])
    const refusal = refusalsOf(plan, 'known_residue').find((row) => row.id === TASK_GET_MONEYS)
    expect(refusal?.reason).toBe('predicate_failed')
    expect(refusal?.detail).toContain('Glasswall')
  })

  it('refuses an audited row that has since picked up a ManyRequests key', async () => {
    tableRows.tasks = [
      { id: TASK_GET_MONEYS, title: 'Get moneys', trackId: null, orgId: 'org_stride', manyrequestsId: '512' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).toEqual([])
    const refusal = refusalsOf(plan, 'known_residue').find((row) => row.id === TASK_GET_MONEYS)
    expect(refusal?.reason).toBe('manyrequests_keyed')
  })

  it('reports an allowlisted row that no longer exists as already_gone, not an error', async () => {
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).toEqual([])
    const refusals = refusalsOf(plan, 'known_residue')
    expect(refusals).toHaveLength(RESIDUE_ALLOWLIST.length)
    expect(refusals.every((row) => row.reason === 'already_gone')).toBe(true)
  })

  it('refuses a timer smoke entry that has grown into real logged time', async () => {
    tableRows.time_entries = [
      { id: TIMER_SMOKE, source: 'live_timer', hours: 2.5, orgId: 'org_tahi_scratch', requestId: null },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).not.toContain(TIMER_SMOKE)
    const refusal = refusalsOf(plan, 'known_residue').find((row) => row.id === TIMER_SMOKE)
    expect(refusal?.reason).toBe('predicate_failed')
    expect(refusal?.detail).toContain('9000s')
  })

  it('takes a sub-minute timer smoke entry', async () => {
    tableRows.time_entries = [
      { id: TIMER_SMOKE, source: 'live_timer', hours: 0.0053, orgId: 'org_tahi_scratch', requestId: null },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).toContain(TIMER_SMOKE)
  })

  it('refuses an audited conversation that has since collected a message', async () => {
    tableRows.conversations = [{ id: CONVERSATION_TEST, type: 'group', name: 'Test', requestId: null, orgId: null }]
    tableRows.messages = [{ id: 'm1', conversationId: CONVERSATION_TEST, orgId: 'org_a', requestId: null, manyrequestsId: null }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).not.toContain(CONVERSATION_TEST)
    const refusal = refusalsOf(plan, 'known_residue').find((row) => row.id === CONVERSATION_TEST)
    expect(refusal?.reason).toBe('predicate_failed')
  })

  it('takes an audited empty conversation and its participants', async () => {
    tableRows.conversations = [{ id: CONVERSATION_TEST, type: 'group', name: 'Test', requestId: null, orgId: null }]
    tableRows.conversation_participants = [{ id: 'part_test', conversationId: CONVERSATION_TEST }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'known_residue')).toContain(CONVERSATION_TEST)
    expect(idsOf(plan, 'known_residue')).toContain('part_test')
  })

  it('does not list a row twice when a structural class already caught it', async () => {
    tableRows.task_subtasks = [{ id: SUBTASK_ONE, taskId: DEAD_TASK }]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_subtasks')).toContain(SUBTASK_ONE)
    expect(idsOf(plan, 'known_residue')).not.toContain(SUBTASK_ONE)
    const everyId = plan.groups.flatMap((group) => group.rows.map((row) => row.id))
    expect(everyId.filter((id) => id === SUBTASK_ONE)).toHaveLength(1)
  })

  it('refuses an audited notification that now points somewhere else', async () => {
    tableRows.requests = [{ id: NOTIFICATION_RETRET_ENTITY, trackId: null, manyrequestsId: '400' }]
    tableRows.contacts = [{ id: 'contact_live', clerkUserId: null }]
    tableRows.notifications = [
      { id: NOTIFICATION_RETRET, userId: 'contact_live', userType: 'contact', entityType: 'message', entityId: 'something_else' },
    ]
    const plan = await planResidue(fakeDb())
    expect(idsOf(plan, 'orphan_notifications')).toEqual([])
    const refusal = refusalsOf(plan, 'known_residue').find((row) => row.id === NOTIFICATION_RETRET)
    expect(refusal?.reason).toBe('predicate_failed')
  })
})

describe('the sweep through runCleanup', () => {
  function seedEverything(): void {
    tableRows.organisations = [{ id: 'org_acme', name: 'Acme Corp', status: 'archived' }]
    tableRows.subscriptions = [{ id: 'sub_seed', orgId: 'org_acme', manyrequestsId: null, stripeSubscriptionId: null }]
    tableRows.tracks = [
      { id: 'track_seed', subscriptionId: 'sub_seed' },
      { id: 'track_orphan', subscriptionId: 'sub_gone' },
    ]
    tableRows.tasks = [{ id: TASK_GET_MONEYS, title: 'Get moneys', trackId: null, orgId: 'org_stride' }]
    tableRows.task_subtasks = [{ id: 'sub_on_demo', taskId: TASK_GET_MONEYS }]
    tableRows.work_blockers = [
      { id: BLOCKER_DEMO_PAIR, blockedType: 'task', blockedId: TASK_GET_MONEYS, blockerType: 'task', blockerId: TASK_GET_MONEYSD },
    ]
    tableRows.time_entries = [{ id: TIMER_SMOKE, source: 'live_timer', hours: 0.0053, orgId: 'org_tahi', requestId: null }]
    tableRows.conversations = [
      { id: 'conv_orphan', type: 'request_thread', name: 'test', requestId: 'req_gone', orgId: 'org_a' },
    ]
    tableRows.conversation_participants = [{ id: 'part_1', conversationId: 'conv_orphan' }]
    tableRows.notifications = [
      { id: 'n_dead_request', userId: 'user_liam', userType: 'team_member', entityType: 'request', entityId: 'req_gone' },
    ]
  }

  it('plans the sweep and writes nothing on the default dry run', async () => {
    seedEverything()
    const plan = await runCleanup(fakeDb(), { dryRun: true, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    expect(plan.residue?.totals.rows).toBeGreaterThan(0)
    expect(plan.residue?.applied.total).toBe(0)
    expect(recorded.deletes).toEqual([])
    expect(tableRows.tracks).toHaveLength(2)
  })

  it('plans nothing at all when the caller does not ask for it', async () => {
    seedEverything()
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false })
    expect(plan.residue).toBeNull()
    expect(recorded.deletes).toEqual([])
  })

  it('deletes children before parents', async () => {
    seedEverything()
    await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    const order = recorded.deletes
    const at = (table: string) => order.indexOf(table)
    expect(at('conversation_participants')).toBeLessThan(at('conversations'))
    expect(at('task_subtasks')).toBeLessThan(at('tasks'))
    expect(at('work_blockers')).toBeLessThan(at('tasks'))
    expect(at('tracks')).toBeLessThan(at('subscriptions'))
  })

  it('counts what it removed, per class, and folds the total into rowsDeleted', async () => {
    seedEverything()
    const plan = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    const applied = plan.residue?.applied
    expect(applied?.byClass.orphan_tracks).toBe(1)
    expect(applied?.byClass.orphan_request_threads).toBe(2)
    expect(applied?.byClass.orphan_notifications).toBe(1)
    expect(applied?.byClass.seed_subscriptions).toBe(2)
    expect(applied?.byClass.known_residue).toBe(3)
    expect(plan.applied.rowsDeleted).toBe(applied?.total)
  })

  it('is idempotent: the second run plans nothing', async () => {
    seedEverything()
    await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    recorded.deletes = []
    const second = await runCleanup(fakeDb(), { dryRun: false, archive: [], hardDelete: [], wipeDemo: false, residue: true })
    expect(second.residue?.totals.rows).toBe(0)
    expect(second.residue?.applied.total).toBe(0)
    expect(recorded.deletes).toEqual([])
  })
})
