/**
 * The handover between the sweep and Slack.
 *
 * The sweep is what turns a transcribed call into pending suggestions. A
 * pending suggestion nobody sees is a suggestion nobody decides, so the same
 * pass posts them to the founders' DMs (CN.2 contract section 3).
 *
 * What is pinned here:
 *
 *   SLACK NEVER FAILS THE SWEEP. Not when the app is uninstalled, not when
 *   the post throws, not when the read throws. The suggestions are already
 *   written by then and the run has to report them.
 *
 *   NOTHING IS POSTED WITHOUT A BOT TOKEN. Which is also why every sweep test
 *   written before this one still passes: with no token the delivery reads
 *   nothing and touches nothing.
 *
 *   ONLY THE PENDING ROWS FOR THE CALL JUST SWEPT, so a decided row is never
 *   posted again and another call's inbox is not re-sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const listCalls: Array<Record<string, unknown>> = []
const postCalls: Array<{ rows: Array<{ id: string }> }> = []

let pendingRows: Array<Record<string, unknown>> = []
let listThrows = false
let postThrows = false

vi.mock('@/lib/task-suggestions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-suggestions')>()
  return {
    ...actual,
    insertSuggestions: vi.fn(async () => ({ inserted: 1, duplicates: 0, similarDropped: 0 })),
    resurfaceSnoozed: vi.fn(async () => 0),
    listSuggestions: vi.fn(async (_drizzle: unknown, options: Record<string, unknown>) => {
      listCalls.push(options)
      if (listThrows) throw new Error('no such column: status')
      return pendingRows
    }),
  }
})

vi.mock('@/lib/slack/mirror', () => ({
  postSuggestionsForCall: async (_drizzle: unknown, input: { rows: Array<{ id: string }> }) => {
    if (postThrows) throw new Error('slack chat.postMessage: not_in_channel')
    postCalls.push({ rows: [...input.rows] })
    return { posted: input.rows.length, failed: 0, founders: 2 }
  },
}))

const { runSuggestionSweep } = await import('../task-suggester')

const TRANSCRIPT_ROW = {
  id: 'ct-1',
  callKind: 'scheduled',
  callId: 'call-1',
  title: 'Kickoff call',
  receivedAt: '2026-09-18T20:00:00Z',
  text: 'Liam: we still need the hero video cut to thirty seconds.',
  wrapUp: null,
}

const SUGGESTED = {
  kind: 'create_task' as const,
  targetTaskId: null,
  targetRequestId: null,
  proposal: { title: 'Cut the hero video' },
  quote: 'we still need the hero video cut to thirty seconds.',
  rationale: null,
  confidence: 0.8,
}

const suggest = vi.fn(async () => ({
  suggestions: [SUGGESTED],
  usage: { model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 0 },
  dropped: [],
}))

/** Selects come off a queue in call order and fall back to empty, which is
 *  all the context builder needs to produce an empty context. */
function makeDb(queued: unknown[]) {
  const queue = [...queued]
  function chain(result: unknown): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(result).then(onOk, onErr)
        }
        if (typeof prop !== 'string') return undefined
        return () => proxy
      },
    })
    return proxy
  }
  const handle = {
    select: () => chain(queue.length ? queue.shift() : []),
    insert: () => ({ values: async () => ({ success: true }) }),
    update: () => ({ set: () => ({ where: async () => ({ success: true }) }) }),
  }
  return handle as unknown as Parameters<typeof runSuggestionSweep>[0]
}

function db() {
  return makeDb([[TRANSCRIPT_ROW], [{ orgId: 'org-1', meetingType: 'client' }]])
}

const NOW = new Date('2026-09-19T00:00:00Z')

beforeEach(() => {
  listCalls.length = 0
  postCalls.length = 0
  pendingRows = [{ id: 's1', kind: 'create_task', proposal: { title: 'Cut the hero video' }, quote: 'x' }]
  listThrows = false
  postThrows = false
  suggest.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('with the app installed', () => {
  beforeEach(() => { vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test') })

  it('posts the pending rows for the call it just swept', async () => {
    const summary = await runSuggestionSweep(db(), { suggest, now: NOW })
    expect(summary.inserted).toBe(1)
    expect(listCalls).toEqual([{ status: 'pending', callId: 'call-1', orgIds: 'all', limit: 50 }])
    expect(postCalls).toEqual([{ rows: pendingRows }])
    expect(summary.slackDelivered).toBe(1)
  })

  it('reports the sweep even when the post throws', async () => {
    postThrows = true
    const summary = await runSuggestionSweep(db(), { suggest, now: NOW })
    expect(summary.inserted).toBe(1)
    expect(summary.slackDelivered).toBe(0)
  })

  it('reports the sweep even when the read throws', async () => {
    listThrows = true
    const summary = await runSuggestionSweep(db(), { suggest, now: NOW })
    expect(summary.inserted).toBe(1)
    expect(postCalls).toHaveLength(0)
  })

  it('posts nothing when the call had nothing pending left', async () => {
    pendingRows = []
    await runSuggestionSweep(db(), { suggest, now: NOW })
    expect(postCalls).toHaveLength(0)
  })
})

describe('without the app installed', () => {
  beforeEach(() => { vi.stubEnv('SLACK_BOT_TOKEN', '') })

  it('reads nothing and posts nothing, which is why the older sweep tests still pass', async () => {
    const summary = await runSuggestionSweep(db(), { suggest, now: NOW })
    expect(summary.inserted).toBe(1)
    expect(listCalls).toHaveLength(0)
    expect(postCalls).toHaveLength(0)
    expect(summary.slackDelivered).toBe(0)
  })
})
