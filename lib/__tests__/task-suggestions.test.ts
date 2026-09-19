/**
 * lib/task-suggestions.ts, the approval gate between "a call said so" and
 * "a task changed".
 *
 * What is pinned here:
 *
 *   THE DEDUPE KEY, because it is the only thing standing between a cron that
 *   re-reads a transcript and a Suggestions view full of the same row twice.
 *   It has to be stable across runs and blind to the casing and spacing a
 *   model will not reproduce byte for byte.
 *
 *   THE STATUS TRANSITIONS, because two surfaces decide the same row (the
 *   dashboard now, Slack in Phase 2) and the second click must be a no-op
 *   rather than a second task.
 *
 *   THE APPLY, per kind, including the Tahi bot line it leaves behind and the
 *   fact that a failure is recorded on the row rather than thrown at whoever
 *   clicked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { schema } from '@/db/d1'

const created: Array<Record<string, unknown>> = []
const updatedTasks: Array<{ taskId: string; patch: Record<string, unknown> }> = []
const comments: Array<Record<string, unknown>> = []
const audits: Array<Record<string, unknown>> = []

const requestMessages: Array<Record<string, unknown>> = []
const createdRequests: Array<Record<string, unknown>> = []
const updatedRequests: Array<{ requestId: string; patch: Record<string, unknown> }> = []
const handOffs: Array<{ requestId: string; input: Record<string, unknown> }> = []

let createResult: { ok: boolean; id?: string; title?: string; error?: string } = { ok: true, id: 'task_new', title: 'Cut the hero video' }
let updateResult: { ok: boolean; title?: string; status?: string; error?: string } = { ok: true, title: 'Ship the retainer deck', status: 'done' }
let createRequestResult: { ok: boolean; id?: string; title?: string; error?: string } = { ok: true, id: 'req_new', title: 'Cut a 30s hero video' }
let updateRequestResult: { ok: boolean; error?: string } = { ok: true }
let handOffResult: { ok: boolean; error?: string } = { ok: true }
let commentThrows = false

vi.mock('@/lib/task-writes', () => ({
  createTaskRecord: async (_drizzle: unknown, input: Record<string, unknown>) => {
    created.push(input)
    return createResult.ok
      ? { ok: true, task: { id: createResult.id, title: createResult.title ?? input.title } }
      : { ok: false, failure: { status: 400, error: createResult.error ?? 'Nope' } }
  },
  updateTaskRecord: async (_drizzle: unknown, taskId: string, patch: Record<string, unknown>) => {
    updatedTasks.push({ taskId, patch })
    return updateResult.ok
      ? { ok: true, task: { id: taskId, title: updateResult.title, status: updateResult.status } }
      : { ok: false, failure: { status: 400, error: updateResult.error ?? 'Nope' } }
  },
}))

vi.mock('@/lib/task-comments', () => ({
  postTaskComment: async (_drizzle: unknown, input: Record<string, unknown>) => {
    if (commentThrows) throw new Error('Task not found')
    comments.push(input)
    return { id: 'c1', ...input }
  },
  postRequestBotMessage: async (_drizzle: unknown, requestId: string, input: Record<string, unknown>) => {
    if (commentThrows) throw new Error('Request not found')
    requestMessages.push({ requestId, ...input })
    return 'm1'
  },
}))

vi.mock('@/lib/request-writes', () => ({
  createRequestRecord: async (_drizzle: unknown, input: Record<string, unknown>) => {
    createdRequests.push(input)
    return createRequestResult.ok
      ? { ok: true, request: { id: createRequestResult.id, orgId: input.clientOrgId, title: createRequestResult.title ?? input.title, status: 'submitted', requestNumber: null } }
      : { ok: false, failure: { status: 400, error: createRequestResult.error ?? 'Nope' } }
  },
  updateRequestRecord: async (_drizzle: unknown, requestId: string, patch: Record<string, unknown>) => {
    updatedRequests.push({ requestId, patch })
    return updateRequestResult.ok
      ? { ok: true, request: { id: requestId, orgId: 'o1', title: 'Homepage refresh', status: 'in_progress', requestNumber: 12 } }
      : { ok: false, failure: { status: 400, error: updateRequestResult.error ?? 'Nope' } }
  },
  handOffRequest: async (_drizzle: unknown, requestId: string, input: Record<string, unknown>) => {
    handOffs.push({ requestId, input })
    return handOffResult.ok
      ? { ok: true, handOff: { requestId, waitingOn: { contactId: input.contactId, contactName: 'Ngaire Reid', reason: input.reason, reasonLabel: 'They need to approve it', since: '2026-09-19T01:00:00Z', dueAt: null, note: null, daysWaiting: 0, contactEmail: null } } }
      : { ok: false, failure: { status: 404, error: handOffResult.error ?? 'Nope' } }
  },
}))

vi.mock('@/lib/audit', () => ({
  logAudit: async (_drizzle: unknown, entry: Record<string, unknown>) => { audits.push(entry) },
}))

const {
  buildDedupeKey,
  countSuggestions,
  insertSuggestions,
  listSuggestions,
  decideSuggestion,
  applySuggestion,
  snoozePreset,
  resurfaceSnoozed,
} = await import('../task-suggestions')

type Rows = Record<string, Array<Record<string, unknown>>>

const TABLE_KEYS = new Map<unknown, string>([
  [schema.taskSuggestions, 'task_suggestions'],
  [schema.tasks, 'tasks'],
  [schema.taskSubtasks, 'task_subtasks'],
  [schema.organisations, 'organisations'],
  [schema.discoveryCalls, 'discovery_calls'],
  [schema.scheduledCalls, 'scheduled_calls'],
  [schema.requests, 'requests'],
])

function fakeDb(rows: Rows) {
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = []
  const updated: Array<{ table: string; values: Record<string, unknown> }> = []

  const name = (table: unknown): string => TABLE_KEYS.get(table) ?? 'unknown'

  function reader(table: unknown) {
    const data = rows[name(table)] ?? []
    const node: Record<string, unknown> = {}
    node.where = () => node
    node.orderBy = () => node
    node.limit = () => node
    node.then = <T>(resolve: (value: Array<Record<string, unknown>>) => T) => Promise.resolve(data).then(resolve)
    return node
  }

  const database = {
    select: () => ({ from: (table: unknown) => reader(table) }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => { inserted.push({ table: name(table), values }) },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updated.push({ table: name(table), values }) },
      }),
    }),
  }

  return { database: database as unknown as Parameters<typeof listSuggestions>[0], inserted, updated }
}

function suggestionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    orgId: 'o1',
    sourceKind: 'call',
    transcriptId: 'tr1',
    callKind: 'scheduled',
    callId: 'call_1',
    kind: 'create_task',
    targetTaskId: null,
    proposal: JSON.stringify({ title: 'Cut the hero video', type: 'client_task', orgId: 'o1' }),
    quote: 'We still need the hero video cut down to thirty seconds.',
    rationale: 'Asked for on the call.',
    confidence: 0.82,
    status: 'pending',
    snoozeUntil: null,
    approverType: 'founders',
    approverId: null,
    decidedById: null,
    decidedVia: null,
    decidedAt: null,
    appliedAt: null,
    appliedTaskId: null,
    applyError: null,
    dedupeKey: 'key1',
    slackChannelId: null,
    slackMessageTs: null,
    createdAt: '2026-09-19T01:00:00Z',
    updatedAt: '2026-09-19T01:00:00Z',
    ...overrides,
  }
}

const CTX = { actorId: 'user_liam', via: 'dashboard' as const }

beforeEach(() => {
  created.length = 0
  updatedTasks.length = 0
  comments.length = 0
  audits.length = 0
  requestMessages.length = 0
  createdRequests.length = 0
  updatedRequests.length = 0
  handOffs.length = 0
  createResult = { ok: true, id: 'task_new', title: 'Cut the hero video' }
  updateResult = { ok: true, title: 'Ship the retainer deck', status: 'done' }
  createRequestResult = { ok: true, id: 'req_new', title: 'Cut a 30s hero video' }
  updateRequestResult = { ok: true }
  handOffResult = { ok: true }
  commentThrows = false
})

describe('buildDedupeKey', () => {
  const base = {
    sourceKind: 'call',
    transcriptId: 'tr1',
    kind: 'create_task' as const,
    targetTaskId: null,
    proposal: { title: 'Cut the hero video' },
  }

  it('is stable across runs, which is what makes a re-read insert nothing', async () => {
    expect(await buildDedupeKey(base)).toBe(await buildDedupeKey({ ...base }))
  })

  it('is a sha-256 hex digest', async () => {
    expect(await buildDedupeKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ignores the casing and spacing a model will not reproduce byte for byte', async () => {
    const noisy = { ...base, proposal: { title: '  CUT the   Hero Video ' } }
    expect(await buildDedupeKey(noisy)).toBe(await buildDedupeKey(base))
  })

  it('separates a different title, a different kind and a different target', async () => {
    const other = await buildDedupeKey({ ...base, proposal: { title: 'Cut the sizzle reel' } })
    const otherKind = await buildDedupeKey({ ...base, kind: 'note', proposal: { body: 'Cut the hero video' } })
    const otherTarget = await buildDedupeKey({ ...base, targetTaskId: 't9' })
    const first = await buildDedupeKey(base)
    expect(new Set([first, other, otherKind, otherTarget]).size).toBe(4)
  })

  it('reads an update off its field diff, whatever order the keys arrive in', async () => {
    const a = await buildDedupeKey({ ...base, kind: 'update_task', targetTaskId: 't1', proposal: { fields: { status: 'done', dueDate: '2026-10-01' } } })
    const b = await buildDedupeKey({ ...base, kind: 'update_task', targetTaskId: 't1', proposal: { fields: { dueDate: '2026-10-01', status: 'done' } } })
    expect(a).toBe(b)
  })
})

describe('insertSuggestions', () => {
  it('inserts a new row and reports it', async () => {
    const { database, inserted } = fakeDb({ task_suggestions: [] })
    const result = await insertSuggestions(database, [{
      orgId: 'o1', sourceKind: 'call', transcriptId: 'tr1', callKind: 'scheduled', callId: 'c1',
      kind: 'create_task', targetTaskId: null, proposal: { title: 'Cut the hero video' },
      quote: 'We still need the hero video.',
    }])

    expect(result).toEqual({ inserted: 1, duplicates: 0 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0].values.status).toBe('pending')
    expect(inserted[0].values.approverType).toBe('founders')
    expect(inserted[0].values.dedupeKey).toMatch(/^[0-9a-f]{64}$/)
    expect(inserted[0].values.proposal).toBe(JSON.stringify({ title: 'Cut the hero video' }))
  })

  it('ignores a row whose dedupe key is already on the table', async () => {
    const draft = {
      orgId: 'o1', sourceKind: 'call', transcriptId: 'tr1', callKind: 'scheduled', callId: 'c1',
      kind: 'create_task' as const, targetTaskId: null, proposal: { title: 'Cut the hero video' },
      quote: 'We still need the hero video.',
    }
    const key = await buildDedupeKey(draft)
    const { database, inserted } = fakeDb({ task_suggestions: [{ dedupeKey: key }] })

    const result = await insertSuggestions(database, [draft])
    expect(result).toEqual({ inserted: 0, duplicates: 1 })
    expect(inserted).toHaveLength(0)
  })

  it('collapses duplicates inside one batch, not just against the table', async () => {
    const draft = {
      orgId: null, sourceKind: 'call', transcriptId: 'tr1', callKind: null, callId: null,
      kind: 'note' as const, targetTaskId: 't1', proposal: { body: 'Send the invoice on Friday' },
      quote: 'Send the invoice on Friday.',
    }
    const { database, inserted } = fakeDb({ task_suggestions: [] })

    const result = await insertSuggestions(database, [draft, { ...draft }])
    expect(result).toEqual({ inserted: 1, duplicates: 1 })
    expect(inserted).toHaveLength(1)
  })
})

describe('snoozePreset', () => {
  it('sends tonight to 7pm in Auckland when the evening has not arrived', async () => {
    // 2026-09-19T01:00:00Z is 1pm Auckland (NZST, UTC+12).
    const until = snoozePreset('tonight', new Date('2026-09-19T01:00:00Z'))
    expect(until).toBe('2026-09-19T07:00:00.000Z')
  })

  it('sends tonight to tomorrow evening once 7pm has passed', async () => {
    // 2026-09-19T09:00:00Z is 9pm Auckland.
    const until = snoozePreset('tonight', new Date('2026-09-19T09:00:00Z'))
    expect(until).toBe('2026-09-20T07:00:00.000Z')
  })

  it('sends this week to Friday 9am in Auckland', async () => {
    // 2026-09-15 is a Tuesday.
    const until = snoozePreset('this_week', new Date('2026-09-15T01:00:00Z'))
    expect(until).toBe('2026-09-17T21:00:00.000Z')
  })

  it('skips to next Friday once Friday morning has passed', async () => {
    // 2026-09-18T22:00:00Z is Saturday 10am Auckland, so this Friday is gone.
    const until = snoozePreset('this_week', new Date('2026-09-18T22:00:00Z'))
    expect(until.slice(0, 10)).toBe('2026-09-24')
  })
})

describe('decideSuggestion', () => {
  it('approves a pending row, applies it and stamps the task it created', async () => {
    const { database, updated } = fakeDb({
      task_suggestions: [suggestionRow()],
      scheduled_calls: [{ title: 'Glasswall kickoff', scheduledAt: '2026-09-18T21:00:00Z' }],
      tasks: [{ id: 'task_new', requestId: null, orgId: 'o1' }],
    })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)

    expect(result?.changed).toBe(true)
    expect(result?.appliedTaskId).toBe('task_new')
    expect(result?.suggestion.status).toBe('applied')
    expect(created).toHaveLength(1)
    const write = updated.find(u => u.table === 'task_suggestions')
    expect(write?.values.status).toBe('applied')
    expect(write?.values.appliedTaskId).toBe('task_new')
    expect(write?.values.decidedById).toBe('user_liam')
    expect(write?.values.decidedVia).toBe('dashboard')
  })

  it('leaves an applied row alone rather than applying it twice', async () => {
    const { database, updated } = fakeDb({ task_suggestions: [suggestionRow({ status: 'applied', appliedTaskId: 'task_old' })] })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)

    expect(result?.changed).toBe(false)
    expect(result?.suggestion.status).toBe('applied')
    expect(created).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  it('approves a snoozed row, because snoozed is still open', async () => {
    const { database } = fakeDb({
      task_suggestions: [suggestionRow({ status: 'snoozed', snoozeUntil: '2026-09-19T07:00:00Z' })],
      tasks: [{ id: 'task_new', requestId: null, orgId: 'o1' }],
    })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)
    expect(result?.changed).toBe(true)
    expect(result?.suggestion.status).toBe('applied')
  })

  it('rejects without touching a task', async () => {
    const { database, updated } = fakeDb({ task_suggestions: [suggestionRow()] })

    const result = await decideSuggestion(database, 's1', { action: 'reject' }, CTX)

    expect(result?.changed).toBe(true)
    expect(result?.suggestion.status).toBe('rejected')
    expect(created).toHaveLength(0)
    expect(comments).toHaveLength(0)
    expect(updated[0].values.decidedAt).toBeTruthy()
  })

  it('snoozes to the time it is handed', async () => {
    const { database, updated } = fakeDb({ task_suggestions: [suggestionRow()] })

    const result = await decideSuggestion(database, 's1', { action: 'snooze', until: '2026-09-19T07:00:00Z' }, CTX)

    expect(result?.changed).toBe(true)
    expect(result?.suggestion.status).toBe('snoozed')
    expect(updated[0].values.snoozeUntil).toBe('2026-09-19T07:00:00Z')
  })

  it('applies the tweaked proposal, not the one the model wrote', async () => {
    const { database, updated } = fakeDb({
      task_suggestions: [suggestionRow()],
      tasks: [{ id: 'task_new', requestId: null, orgId: 'o1' }],
    })

    await decideSuggestion(
      database,
      's1',
      { action: 'approve', proposalOverride: { title: 'Cut the hero video to 20s', type: 'client_task', orgId: 'o1' } },
      CTX,
    )

    expect(created[0].title).toBe('Cut the hero video to 20s')
    const write = updated.find(u => u.table === 'task_suggestions')
    expect(String(write?.values.proposal)).toContain('20s')
  })

  it('records a failed apply on the row instead of throwing at whoever clicked', async () => {
    createResult = { ok: false, error: 'Client is required for a client task' }
    const { database, updated } = fakeDb({ task_suggestions: [suggestionRow()] })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)

    expect(result?.suggestion.status).toBe('failed')
    expect(result?.suggestion.applyError).toBe('Client is required for a client task')
    expect(updated[0].values.status).toBe('failed')
  })

  it('records a thrown apply as failed rather than letting it escape', async () => {
    commentThrows = true
    const { database } = fakeDb({
      task_suggestions: [suggestionRow()],
      tasks: [{ id: 'task_new', requestId: null, orgId: 'o1' }],
    })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)
    expect(result?.suggestion.status).toBe('failed')
    expect(result?.suggestion.applyError).toContain('Task not found')
  })

  it('answers null for a suggestion that does not exist', async () => {
    const { database } = fakeDb({ task_suggestions: [] })
    expect(await decideSuggestion(database, 'ghost', { action: 'reject' }, CTX)).toBeNull()
  })
})

describe('applySuggestion by kind', () => {
  it('creates a task and posts the bot line with the quote and the source', async () => {
    const { database } = fakeDb({
      scheduled_calls: [{ title: 'Glasswall kickoff', scheduledAt: '2026-09-18T21:00:00Z' }],
    })

    const outcome = await applySuggestion(database, suggestionRow() as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedTaskId).toBe('task_new')
    expect(comments).toHaveLength(1)
    expect(comments[0].taskId).toBe('task_new')
    expect((comments[0].author as { authorType: string }).authorType).toBe('bot')
    expect(comments[0].quote).toBe('We still need the hero video cut down to thirty seconds.')
    expect(comments[0].sourceRef).toBe('suggestion:s1')
    expect(String(comments[0].body)).toContain('Glasswall kickoff')
    expect(String(comments[0].body)).toContain('Cut the hero video')
  })

  it('writes the audit entry as system, naming who approved it', async () => {
    const { database } = fakeDb({})
    await applySuggestion(database, suggestionRow() as never, CTX)

    expect(audits[0].action).toBe('task_suggestion.applied')
    expect(audits[0].userType).toBe('system')
    expect(audits[0].metadata).toEqual({ suggestionId: 's1', via: 'dashboard', decidedById: 'user_liam' })
  })

  it('applies an update through the task patch path', async () => {
    const row = suggestionRow({
      kind: 'update_task',
      targetTaskId: 't1',
      proposal: JSON.stringify({ fields: { status: 'in_progress', dueDate: '2026-10-02' } }),
    })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedTaskId).toBe('t1')
    expect(updatedTasks[0]).toEqual({ taskId: 't1', patch: { status: 'in_progress', dueDate: '2026-10-02' } })
    expect(String(comments[0].body)).toContain('status')
  })

  it('completes a task by setting done, not by trusting the proposal', async () => {
    const row = suggestionRow({ kind: 'complete_task', targetTaskId: 't1', proposal: JSON.stringify({ note: 'Shipped on Thursday' }) })
    const { database } = fakeDb({})

    await applySuggestion(database, row as never, CTX)

    expect(updatedTasks[0].patch).toEqual({ status: 'done' })
  })

  it('appends subtasks, skipping the ones already on the task', async () => {
    const row = suggestionRow({
      kind: 'add_subtasks',
      targetTaskId: 't1',
      proposal: JSON.stringify({ subtasks: ['Export the cut', '  export the CUT ', 'Send for review'] }),
    })
    const { database, inserted } = fakeDb({ task_subtasks: [{ title: 'Export the cut' }] })

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    const subtasks = inserted.filter(i => i.table === 'task_subtasks')
    expect(subtasks.map(s => s.values.title)).toEqual(['Send for review'])
  })

  it('posts a note as one bot comment and changes nothing else', async () => {
    const row = suggestionRow({ kind: 'note', targetTaskId: 't1', proposal: JSON.stringify({ body: 'They want the invoice split in two' }) })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(created).toHaveLength(0)
    expect(updatedTasks).toHaveLength(0)
    expect(comments).toHaveLength(1)
    expect(String(comments[0].body)).toContain('They want the invoice split in two')
  })

  it('refuses a kind that names no task rather than guessing one', async () => {
    const row = suggestionRow({ kind: 'update_task', targetTaskId: null, proposal: JSON.stringify({ fields: { status: 'done' } }) })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('no task')
    expect(updatedTasks).toHaveLength(0)
  })
})

describe('resurfaceSnoozed', () => {
  it('returns rows whose snooze has passed to pending, and leaves the rest', async () => {
    const { database, updated } = fakeDb({
      task_suggestions: [
        { id: 's1', snoozeUntil: '2026-09-19T07:00:00Z' },
        { id: 's2', snoozeUntil: '2026-09-25T07:00:00Z' },
        { id: 's3', snoozeUntil: null },
      ],
    })

    const count = await resurfaceSnoozed(database, new Date('2026-09-20T00:00:00Z'))

    expect(count).toBe(1)
    expect(updated).toHaveLength(1)
    expect(updated[0].values.status).toBe('pending')
    expect(updated[0].values.snoozeUntil).toBeNull()
  })

  it('writes nothing when no snooze has come due', async () => {
    const { database, updated } = fakeDb({ task_suggestions: [{ id: 's2', snoozeUntil: '2026-09-25T07:00:00Z' }] })
    expect(await resurfaceSnoozed(database, new Date('2026-09-20T00:00:00Z'))).toBe(0)
    expect(updated).toHaveLength(0)
  })
})

describe('listSuggestions', () => {
  it('decorates each row with the call, the client and the task it names', async () => {
    const { database } = fakeDb({
      task_suggestions: [suggestionRow({ kind: 'update_task', targetTaskId: 't1' })],
      organisations: [{ id: 'o1', name: 'Glasswall' }],
      scheduled_calls: [{ id: 'call_1', title: 'Glasswall kickoff', scheduledAt: '2026-09-18T21:00:00Z' }],
      tasks: [{ id: 't1', title: 'Ship the retainer deck', status: 'in_progress' }],
    })

    const items = await listSuggestions(database, { status: 'pending', orgIds: 'all', limit: 100 })

    expect(items).toHaveLength(1)
    expect(items[0].orgName).toBe('Glasswall')
    expect(items[0].callTitle).toBe('Glasswall kickoff')
    expect(items[0].callScheduledAt).toBe('2026-09-18T21:00:00Z')
    expect(items[0].targetTaskTitle).toBe('Ship the retainer deck')
    expect(items[0].targetTaskStatus).toBe('in_progress')
  })

  it('counts pending, snoozed and the distinct calls behind them', async () => {
    const { database } = fakeDb({
      task_suggestions: [
        { status: 'pending', callId: 'call_1' },
        { status: 'pending', callId: 'call_1' },
        { status: 'pending', callId: 'call_2' },
        { status: 'snoozed', callId: 'call_3' },
        { status: 'pending', callId: null },
      ],
    })

    // Two calls, not three: a snoozed row is not waiting on anybody, and a
    // suggestion with no call cannot be counted as one.
    expect(await countSuggestions(database, { orgIds: 'all' })).toEqual({ pending: 4, snoozed: 1, calls: 2 })
  })

  it('answers an empty list for a caller scoped to no clients at all', async () => {
    const { database } = fakeDb({ task_suggestions: [suggestionRow()] })
    const items = await listSuggestions(database, { orgIds: [], limit: 100 })
    // An empty scope still admits studio housekeeping, so the read runs; what
    // it must never do is throw or widen itself back to every client.
    expect(Array.isArray(items)).toBe(true)
  })
})

// ─── CN.1b: the request kinds ────────────────────────────────────────────────
//
// A call with a client mostly produces REQUESTS, not tasks: requests are the
// client-facing work and tasks run the studio. What is pinned below is the
// half of that which can go quietly wrong.
//
//   THE DEDUPE KEYS, because a request suggestion re-read off the same
//   transcript must collapse the way a task one does, and a request kind must
//   never collide with the task kind it rhymes with.
//
//   THE APPLY, per kind, through lib/request-writes.ts (the same code the
//   request routes use), with the Tahi bot line landing on the REQUEST thread
//   rather than on a task thread.
//
//   THE HAND-OFF WITH NOBODY NAMED, which is the one proposal the model is
//   allowed to make and the gate is not allowed to apply.

function requestRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return suggestionRow({
    kind: 'create_request',
    targetTaskId: null,
    targetRequestId: null,
    appliedRequestId: null,
    proposal: JSON.stringify({
      title: 'Cut a 30s hero video',
      description: 'Trim the launch film for the homepage.',
      category: 'design',
      type: 'small_task',
      priority: 'standard',
    }),
    ...overrides,
  })
}

describe('buildDedupeKey over the request kinds', () => {
  const base = {
    sourceKind: 'call',
    transcriptId: 'tr1',
    kind: 'create_request' as const,
    targetTaskId: null,
    targetRequestId: null,
    proposal: { title: 'Cut a 30s hero video' },
  }

  it('reads a create_request off its normalised title, like a create_task', async () => {
    const noisy = { ...base, proposal: { title: '  CUT a   30s Hero Video ' } }
    expect(await buildDedupeKey(noisy)).toBe(await buildDedupeKey(base))
  })

  it('never collides with the task kind it rhymes with', async () => {
    const asTask = await buildDedupeKey({ ...base, kind: 'create_task' })
    expect(await buildDedupeKey(base)).not.toBe(asTask)
  })

  it('separates two updates to different requests', async () => {
    const one = await buildDedupeKey({
      ...base, kind: 'update_request', targetRequestId: 'r1', proposal: { fields: { status: 'in_progress' } },
    })
    const two = await buildDedupeKey({
      ...base, kind: 'update_request', targetRequestId: 'r2', proposal: { fields: { status: 'in_progress' } },
    })
    expect(one).not.toBe(two)
  })

  it('reads an update_request off its field diff, whatever order the keys arrive in', async () => {
    const a = await buildDedupeKey({
      ...base, kind: 'update_request', targetRequestId: 'r1', proposal: { fields: { status: 'on_hold', dueDate: '2026-10-01' } },
    })
    const b = await buildDedupeKey({
      ...base, kind: 'update_request', targetRequestId: 'r1', proposal: { fields: { dueDate: '2026-10-01', status: 'on_hold' } },
    })
    expect(a).toBe(b)
  })

  it('reads a request_note off the first 80 characters of its body', async () => {
    const long = 'x'.repeat(200)
    const a = await buildDedupeKey({ ...base, kind: 'request_note', targetRequestId: 'r1', proposal: { body: long } })
    const b = await buildDedupeKey({ ...base, kind: 'request_note', targetRequestId: 'r1', proposal: { body: `${long}, and one more thing` } })
    expect(a).toBe(b)
  })

  it('reads a hand_off_request off the person, case folded', async () => {
    const a = await buildDedupeKey({ ...base, kind: 'hand_off_request', targetRequestId: 'r1', proposal: { contactName: 'Ngaire Reid', reason: 'approval' } })
    const b = await buildDedupeKey({ ...base, kind: 'hand_off_request', targetRequestId: 'r1', proposal: { contactName: '  ngaire reid ', reason: 'content' } })
    const c = await buildDedupeKey({ ...base, kind: 'hand_off_request', targetRequestId: 'r1', proposal: { contactName: 'Tama Wiremu', reason: 'approval' } })
    // The same person on the same request is one ask however the reason is
    // worded; a different person is a different ask.
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})

describe('applySuggestion over the request kinds', () => {
  it('creates a request on the suggestion org and posts the bot line on its thread', async () => {
    const { database } = fakeDb({
      scheduled_calls: [{ title: 'Glasswall kickoff', scheduledAt: '2026-09-18T21:00:00Z' }],
    })

    const outcome = await applySuggestion(database, requestRow() as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedRequestId).toBe('req_new')
    // A request suggestion never touches a task.
    expect(outcome.appliedTaskId).toBeNull()
    expect(created).toHaveLength(0)

    expect(createdRequests).toHaveLength(1)
    expect(createdRequests[0].clientOrgId).toBe('o1')
    expect(createdRequests[0].title).toBe('Cut a 30s hero video')
    expect(createdRequests[0].category).toBe('design')

    expect(comments).toHaveLength(0)
    expect(requestMessages).toHaveLength(1)
    expect(requestMessages[0].requestId).toBe('req_new')
    expect(requestMessages[0].quote).toBe('We still need the hero video cut down to thirty seconds.')
    expect(String(requestMessages[0].body)).toContain('Glasswall kickoff')
    expect(String(requestMessages[0].body)).toContain('Cut a 30s hero video')
  })

  it('names the person who asked for it, when the call named one', async () => {
    const row = requestRow({
      proposal: JSON.stringify({ title: 'Cut a 30s hero video', category: 'design', requesterName: 'Ngaire Reid' }),
    })
    const { database } = fakeDb({})

    await applySuggestion(database, row as never, CTX)
    expect(String(requestMessages[0].body)).toContain('Ngaire Reid')
  })

  it('refuses a create_request with no client rather than filing orphan work', async () => {
    const row = requestRow({ orgId: null })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('client')
    expect(createdRequests).toHaveLength(0)
  })

  it('updates a request through the request patch path, fields only', async () => {
    const row = requestRow({
      kind: 'update_request',
      targetRequestId: 'r1',
      proposal: JSON.stringify({
        fields: { status: 'on_hold', dueDate: '2026-10-02', title: 'Renamed behind our backs' },
        note: 'They want it parked until the brand lands.',
      }),
    })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedRequestId).toBe('r1')
    expect(updatedRequests).toHaveLength(1)
    expect(updatedRequests[0].requestId).toBe('r1')
    // Only the fields the contract lists reach the patch: a title the model
    // slipped in is not one a call suggestion may rewrite.
    expect(updatedRequests[0].patch).toEqual({ status: 'on_hold', dueDate: '2026-10-02' })
    expect(String(requestMessages[0].body)).toContain('status')
    expect(String(requestMessages[0].body)).toContain('parked until the brand lands')
  })

  it('posts a request note as one bot line and changes nothing else', async () => {
    const row = requestRow({
      kind: 'request_note',
      targetRequestId: 'r1',
      proposal: JSON.stringify({ body: 'They want the invoice split in two' }),
    })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedRequestId).toBe('r1')
    expect(createdRequests).toHaveLength(0)
    expect(updatedRequests).toHaveLength(0)
    expect(requestMessages).toHaveLength(1)
    expect(String(requestMessages[0].body)).toContain('They want the invoice split in two')
  })

  it('hands a request to the named contact and says so on the thread', async () => {
    const row = requestRow({
      kind: 'hand_off_request',
      targetRequestId: 'r1',
      proposal: JSON.stringify({
        contactName: 'Ngaire Reid',
        contactId: 'c1',
        reason: 'approval',
        dueAt: '2026-10-02',
        note: 'Sign off the homepage copy.',
      }),
    })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(true)
    expect(outcome.appliedRequestId).toBe('r1')
    expect(handOffs).toHaveLength(1)
    expect(handOffs[0].requestId).toBe('r1')
    expect(handOffs[0].input).toEqual({
      contactId: 'c1',
      reason: 'approval',
      dueAt: '2026-10-02',
      note: 'Sign off the homepage copy.',
    })
    expect(String(requestMessages[0].body)).toContain('Ngaire Reid')
  })

  it('refuses a request kind that names no request rather than guessing one', async () => {
    const row = requestRow({ kind: 'update_request', targetRequestId: null, proposal: JSON.stringify({ fields: { status: 'on_hold' } }) })
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, row as never, CTX)

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('no request')
    expect(updatedRequests).toHaveLength(0)
  })

  it('records a refused request write on the row rather than throwing', async () => {
    createRequestResult = { ok: false, error: 'Unknown client org' }
    const { database } = fakeDb({})

    const outcome = await applySuggestion(database, requestRow() as never, CTX)

    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('Unknown client org')
    expect(requestMessages).toHaveLength(0)
  })
})

describe('decideSuggestion over the request kinds', () => {
  it('stamps the request an approved suggestion created, not a task id', async () => {
    const { database, updated } = fakeDb({ task_suggestions: [requestRow()] })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)

    expect(result?.changed).toBe(true)
    expect(result?.appliedRequestId).toBe('req_new')
    expect(result?.appliedTaskId).toBeNull()
    const write = updated.find(u => u.table === 'task_suggestions')
    expect(write?.values.status).toBe('applied')
    expect(write?.values.appliedRequestId).toBe('req_new')
  })

  it('refuses a hand-off nobody is named on, and writes nothing', async () => {
    const row = requestRow({
      kind: 'hand_off_request',
      targetRequestId: 'r1',
      proposal: JSON.stringify({ contactName: 'Somebody at the client', contactId: null, reason: 'approval' }),
    })
    const { database, updated } = fakeDb({ task_suggestions: [row] })

    const result = await decideSuggestion(database, 's1', { action: 'approve' }, CTX)

    // Not 'failed': the suggestion is fine, the human just has to pick the
    // person on Tweak first. A failed row would read as the gate's fault.
    expect(result?.changed).toBe(false)
    expect(result?.error).toBe('contact_required')
    expect(result?.suggestion.status).toBe('pending')
    expect(handOffs).toHaveLength(0)
    expect(updated).toHaveLength(0)
  })

  it('accepts the same hand-off once Tweak has picked the person', async () => {
    const row = requestRow({
      kind: 'hand_off_request',
      targetRequestId: 'r1',
      proposal: JSON.stringify({ contactName: 'Somebody at the client', contactId: null, reason: 'approval' }),
    })
    const { database } = fakeDb({ task_suggestions: [row] })

    const result = await decideSuggestion(
      database,
      's1',
      { action: 'approve', proposalOverride: { contactName: 'Ngaire Reid', contactId: 'c1', reason: 'approval' } },
      CTX,
    )

    expect(result?.changed).toBe(true)
    expect(result?.error).toBeUndefined()
    expect(handOffs[0].input.contactId).toBe('c1')
  })

  it('still rejects a contact-less hand-off without touching anything', async () => {
    const row = requestRow({
      kind: 'hand_off_request',
      targetRequestId: 'r1',
      proposal: JSON.stringify({ contactName: 'Somebody at the client', reason: 'approval' }),
    })
    const { database, updated } = fakeDb({ task_suggestions: [row] })

    const result = await decideSuggestion(database, 's1', { action: 'reject' }, CTX)

    expect(result?.changed).toBe(true)
    expect(result?.suggestion.status).toBe('rejected')
    expect(handOffs).toHaveLength(0)
    expect(updated).toHaveLength(1)
  })
})

describe('listSuggestions over the request kinds', () => {
  it('decorates a row with the request it names', async () => {
    const { database } = fakeDb({
      task_suggestions: [requestRow({ kind: 'update_request', targetRequestId: 'r1' })],
      organisations: [{ id: 'o1', name: 'Glasswall' }],
      requests: [{ id: 'r1', requestNumber: 12, title: 'Homepage refresh', status: 'in_progress' }],
    })

    const items = await listSuggestions(database, { status: 'pending', orgIds: 'all', limit: 100 })

    expect(items).toHaveLength(1)
    expect(items[0].targetRequestNumber).toBe(12)
    expect(items[0].targetRequestTitle).toBe('Homepage refresh')
    expect(items[0].targetRequestStatus).toBe('in_progress')
    // A request row names no task, and says so rather than borrowing one.
    expect(items[0].targetTaskTitle).toBeNull()
  })

  it('leaves the request fields null on a task suggestion', async () => {
    const { database } = fakeDb({
      task_suggestions: [suggestionRow()],
      requests: [{ id: 'r1', requestNumber: 12, title: 'Homepage refresh', status: 'in_progress' }],
    })

    const items = await listSuggestions(database, { status: 'pending', orgIds: 'all', limit: 100 })
    expect(items[0].targetRequestNumber).toBeNull()
    expect(items[0].targetRequestTitle).toBeNull()
    expect(items[0].targetRequestStatus).toBeNull()
  })
})
