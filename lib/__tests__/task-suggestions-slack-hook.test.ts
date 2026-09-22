/**
 * The Slack half of a decision made anywhere else.
 *
 * A founder approves a suggestion in the dashboard. The other founder is
 * holding the same message in Slack, with an Approve button on it. Unless
 * that message is rewritten, the studio has a button that creates a second
 * task for work that already exists.
 *
 * So decideSuggestion calls the mirror hook after it writes, on every
 * surface and every decision (CN.2 contract section 3). What is pinned here
 * is that it calls it, that it calls it with the row AS DECIDED rather than
 * as it was read, and that Slack being broken cannot turn a decision that
 * landed into one that reports as failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'

const mirrored: Array<{ id: string; status: string; decidedById: string | null; applyError: string | null }> = []
const reposted: string[] = []
let mirrorThrows = false
let repostThrows = false

vi.mock('@/lib/slack/mirror', () => ({
  mirrorSuggestionDecision: async (_drizzle: unknown, row: { id: string; status: string; decidedById: string | null; applyError: string | null }) => {
    if (mirrorThrows) throw new Error('slack is on fire')
    mirrored.push({ id: row.id, status: row.status, decidedById: row.decidedById, applyError: row.applyError })
    return 1
  },
  repostSuggestion: async (_drizzle: unknown, row: { id: string }) => {
    if (repostThrows) throw new Error('slack is on fire')
    reposted.push(row.id)
    return 1
  },
}))

let createOk = true

vi.mock('@/lib/task-writes', () => ({
  createTaskRecord: async (_drizzle: unknown, input: Record<string, unknown>) => (
    createOk
      ? { ok: true, task: { id: 'task_new', title: input.title } }
      : { ok: false, failure: { status: 400, error: 'Nope' } }
  ),
  updateTaskRecord: async () => ({ ok: true, task: { id: 't1', title: 'Ship it', status: 'done' } }),
}))

vi.mock('@/lib/task-comments', () => ({
  postTaskComment: async () => ({ id: 'c1' }),
  postRequestBotMessage: async () => 'm1',
}))

vi.mock('@/lib/request-writes', () => ({
  createRequestRecord: async () => ({ ok: true, request: { id: 'req_new', orgId: 'o1', title: 'Hero video', status: 'submitted', requestNumber: 12 } }),
  updateRequestRecord: async () => ({ ok: true, request: { id: 'r1', orgId: 'o1', title: 'Hero video', status: 'in_progress', requestNumber: 12 } }),
  handOffRequest: async () => ({ ok: true, handOff: { requestId: 'r1' } }),
}))

vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }))

const { decideSuggestion, resurfaceSnoozed } = await import('../task-suggestions')

const TABLE_KEYS = new Map<unknown, string>([
  [schema.taskSuggestions, 'task_suggestions'],
  [schema.tasks, 'tasks'],
  [schema.taskSubtasks, 'task_subtasks'],
  [schema.organisations, 'organisations'],
  [schema.discoveryCalls, 'discovery_calls'],
  [schema.scheduledCalls, 'scheduled_calls'],
  [schema.requests, 'requests'],
])

function fakeDb(rows: Record<string, Array<Record<string, unknown>>>) {
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
    insert: () => ({ values: async () => ({}) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }
  return database as unknown as Parameters<typeof decideSuggestion>[0]
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
    targetRequestId: null,
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
    appliedRequestId: null,
    applyError: null,
    dedupeKey: 'key1',
    slackChannelId: 'D_LIAM',
    slackMessageTs: '1758500000.0001',
    createdAt: '2026-09-19T01:00:00Z',
    updatedAt: '2026-09-19T01:00:00Z',
    ...overrides,
  }
}

const CTX = { actorId: 'tm_liam', via: 'dashboard' as const }

beforeEach(() => {
  mirrored.length = 0
  reposted.length = 0
  mirrorThrows = false
  repostThrows = false
  createOk = true
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the Slack rewrite hook on decideSuggestion', () => {
  it('rewrites the Slack copies when the dashboard approves', async () => {
    const db = fakeDb({ task_suggestions: [suggestionRow()] })
    const result = await decideSuggestion(db, 's1', { action: 'approve', force: true }, CTX)
    expect(result?.changed).toBe(true)
    expect(mirrored).toEqual([{ id: 's1', status: 'applied', decidedById: 'tm_liam', applyError: null }])
  })

  it('rewrites them when the dashboard rejects', async () => {
    const db = fakeDb({ task_suggestions: [suggestionRow()] })
    await decideSuggestion(db, 's1', { action: 'reject' }, CTX)
    expect(mirrored[0].status).toBe('rejected')
  })

  it('rewrites them when the row is snoozed, so nobody approves a row that left', async () => {
    const db = fakeDb({ task_suggestions: [suggestionRow()] })
    await decideSuggestion(db, 's1', { action: 'snooze', until: '2026-09-23T07:00:00Z' }, CTX)
    expect(mirrored[0].status).toBe('snoozed')
  })

  it('passes the failure through, so the message says what did not land', async () => {
    createOk = false
    const db = fakeDb({ task_suggestions: [suggestionRow()] })
    await decideSuggestion(db, 's1', { action: 'approve', force: true }, CTX)
    expect(mirrored[0].status).toBe('failed')
    expect(mirrored[0].applyError).toBeTruthy()
  })

  it('does not rewrite anything on a second click, because nothing changed', async () => {
    const db = fakeDb({ task_suggestions: [suggestionRow({ status: 'applied', appliedTaskId: 'task_new' })] })
    const result = await decideSuggestion(db, 's1', { action: 'approve' }, CTX)
    expect(result?.changed).toBe(false)
    expect(mirrored).toHaveLength(0)
  })

  it('does not rewrite on a refused approve, because the row is still waiting', async () => {
    const db = fakeDb({ task_suggestions: [suggestionRow({ kind: 'hand_off_request', targetRequestId: 'r1', proposal: JSON.stringify({ contactName: 'Ngaire', reason: 'approval' }) })] })
    const result = await decideSuggestion(db, 's1', { action: 'approve' }, CTX)
    expect(result?.changed).toBe(false)
    expect(mirrored).toHaveLength(0)
  })

  it('still reports the decision when Slack throws', async () => {
    mirrorThrows = true
    const db = fakeDb({ task_suggestions: [suggestionRow()] })
    const result = await decideSuggestion(db, 's1', { action: 'approve', force: true }, CTX)
    expect(result?.changed).toBe(true)
    expect(result?.appliedTaskId).toBe('task_new')
  })
})

describe('a snooze coming back', () => {
  it('re-posts the resurfaced row to the DMs that held it', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const db = fakeDb({ task_suggestions: [suggestionRow({ status: 'snoozed', snoozeUntil: '2026-09-21T07:00:00Z' })] })
    expect(await resurfaceSnoozed(db, new Date('2026-09-22T07:00:00Z'))).toBe(1)
    expect(reposted).toEqual(['s1'])
  })

  it('re-posts nothing without a bot token, which is the studio before the app is installed', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
    const db = fakeDb({ task_suggestions: [suggestionRow({ status: 'snoozed', snoozeUntil: '2026-09-21T07:00:00Z' })] })
    expect(await resurfaceSnoozed(db, new Date('2026-09-22T07:00:00Z'))).toBe(1)
    expect(reposted).toHaveLength(0)
  })

  it('still resurfaces the row when Slack throws', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    repostThrows = true
    const db = fakeDb({ task_suggestions: [suggestionRow({ status: 'snoozed', snoozeUntil: '2026-09-21T07:00:00Z' })] })
    expect(await resurfaceSnoozed(db, new Date('2026-09-22T07:00:00Z'))).toBe(1)
  })

  it('re-posts nothing when nothing was due', async () => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
    const db = fakeDb({ task_suggestions: [suggestionRow({ status: 'snoozed', snoozeUntil: '2026-10-01T07:00:00Z' })] })
    expect(await resurfaceSnoozed(db, new Date('2026-09-22T07:00:00Z'))).toBe(0)
    expect(reposted).toHaveLength(0)
  })
})
