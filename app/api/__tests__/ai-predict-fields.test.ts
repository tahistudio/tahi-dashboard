/**
 * POST /api/admin/ai/predict-fields, on the paths where it must say nothing.
 *
 * The route's whole value is what it refuses to return, so that is what these
 * cover: a title too thin to reason from never reaches the model, a field the
 * model was not confident about never reaches the wire, a value outside the
 * vocabulary is dropped rather than coerced to a default (which is exactly
 * what the triage route does, and exactly what this must not), and a field the
 * operator already filled is never answered even when the model answers it.
 *
 * Same mocked-SDK harness as ai-request-wizard-routes.test.ts. The database is
 * a chainable stub keyed by table name so the grounding queries resolve
 * without a D1, and the cost ledger is asserted as a call rather than a row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMessage = vi.fn()

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMessage }
  },
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi', sessionId: 's' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

// Only the write is stubbed. estimateCostUsd stays real, because the ceiling
// this route enforces is exactly "what does the rate card say these tokens
// cost", and a stub would make the cap tests assert their own arithmetic.
vi.mock('@/lib/ai-cost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-cost')>()),
  recordCost: vi.fn().mockResolvedValue(1),
}))

// Every column reads back as "table.column", and the table object carries its
// own name so the query stub can key its rows on it.
vi.mock('@/db/d1', () => {
  const tables = new Map<string, unknown>()
  const schema = new Proxy({}, {
    get: (_target, name: string) => {
      if (!tables.has(name)) {
        tables.set(name, new Proxy({}, {
          get: (_t, key: string | symbol) => (key === '__table' ? name : `${name}.${String(key)}`),
        }))
      }
      return tables.get(name)
    },
  })
  return { schema }
})

vi.mock('drizzle-orm', () => ({
  sql: (...parts: unknown[]) => ({ sql: parts }),
  and: (...clauses: unknown[]) => ({ and: clauses }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ gte: [a, b] }),
  isNull: (a: unknown) => ({ isNull: a }),
  desc: (a: unknown) => ({ desc: a }),
}))

vi.mock('@/lib/db', () => {
  const chain = () => {
    let table = ''
    const node: Record<string, unknown> = {}
    const same = () => node
    node.from = (t: { __table?: string }) => { table = t?.__table ?? ''; return node }
    for (const m of ['where', 'orderBy', 'limit', 'groupBy', 'having', 'offset', 'innerJoin', 'leftJoin']) {
      node[m] = same
    }
    node.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(state.rows[table] ?? []).then(resolve, reject)
    return node
  }
  return {
    db: vi.fn().mockResolvedValue({
      select: () => chain(),
      insert: () => ({ values: () => Promise.resolve() }),
    }),
  }
})

import { POST } from '@/app/api/admin/ai/predict-fields/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { recordCost } from '@/lib/ai-cost'
import type { PredictFieldsResponse } from '@/lib/predict/types'

const TODAY = '2026-09-05'
const GOOD_TITLE = 'Rebuild the pricing page hero'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/ai/predict-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: 'request',
      title: GOOD_TITLE,
      orgId: 'org_1',
      empty: ['dueDate', 'priority', 'estimatedHours'],
      todayIso: TODAY,
      ...body,
    }),
  })
}

function modelAnswers(payload: Record<string, unknown>) {
  createMessage.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    usage: { input_tokens: 900, output_tokens: 80 },
  })
}

async function post(body: Record<string, unknown> = {}): Promise<PredictFieldsResponse> {
  const res = await POST(makeRequest(body))
  expect(res.status).toBe(200)
  return await res.json() as PredictFieldsResponse
}

/** A cohort of delivered requests, so the grounding has something to read. */
function seedCohort(): void {
  state.rows.requests = Array.from({ length: 8 }, (_, i) => ({
    category: 'design',
    priority: 'standard',
    assigneeId: 'tm_1',
    estimatedHours: 6,
    turnaroundDays: 4 + (i % 2),
  }))
  state.rows.teamMembers = [{ id: 'tm_1', name: 'Staci', title: 'Designer', role: 'member' }]
  state.rows.organisations = [{ name: 'Kowhai Co', planType: 'scale' }]
}

beforeEach(() => {
  vi.clearAllMocks()
  state.rows = {}
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi', sessionId: 's' })
})

describe('the gate', () => {
  it('403s a caller who is not the studio', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(403)
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('answers a thin title with an empty object and never reaches the model', async () => {
    const body = await post({ title: 'fix it' })
    expect(body.suggestions).toEqual({})
    expect(body.reason).toBe('thin_context')
    expect(createMessage).not.toHaveBeenCalled()
    expect(recordCost).not.toHaveBeenCalled()
  })

  it('answers a request with no client the same way', async () => {
    const body = await post({ orgId: null })
    expect(body.reason).toBe('thin_context')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('tells "nothing left to fill" apart from "your title is too thin"', async () => {
    // Two different situations with two different answers for the caller. The
    // brief was fine here; there was simply nothing left to ask about, which
    // is not a complaint about anything the operator typed.
    const body = await post({ empty: [] })
    expect(body.reason).toBe('nothing_to_fill')
    expect(body.suggestions).toEqual({})
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('takes a studio task with no client', async () => {
    modelAnswers({})
    const body = await post({
      subject: 'task',
      orgId: null,
      level: 'tahi_internal',
      title: 'Write the quarterly capacity review',
      empty: ['dueDate'],
    })
    expect(body.reason).toBeUndefined()
    expect(createMessage).toHaveBeenCalledTimes(1)
  })
})

describe('what survives the model', () => {
  it('keeps a confident, in-vocabulary answer', async () => {
    seedCohort()
    modelAnswers({
      dueDate: { value: '2026-09-12', reason: 'Comparable work takes about a week.', confidence: 0.82 },
    })
    const body = await post({})
    expect(body.suggestions.dueDate?.value).toBe('2026-09-12')
    expect(body.suggestions.dueDate?.reason).toContain('week')
    expect(body.degraded).toBeUndefined()
  })

  it('drops a field the model was not confident about', async () => {
    modelAnswers({
      dueDate: { value: '2026-09-12', reason: 'A guess.', confidence: 0.4 },
      priority: { value: 'high', reason: 'The brief says urgent.', confidence: 0.9 },
    })
    const body = await post({})
    expect(body.suggestions.dueDate).toBeUndefined()
    expect(body.suggestions.priority?.value).toBe('high')
  })

  it('drops an out-of-vocabulary priority rather than coercing it to standard', async () => {
    // The deleted ai/suggest route emitted exactly this value, which a request
    // cannot store, and triage's parser would have written 'standard' instead
    // and looked just as sure about it.
    modelAnswers({
      priority: { value: 'urgent', reason: 'It reads as urgent.', confidence: 0.95 },
    })
    const body = await post({})
    expect(body.suggestions.priority).toBeUndefined()
    expect(body.suggestions).toEqual({})
  })

  it('takes urgent on a task, where the vocabulary has three values', async () => {
    modelAnswers({
      priority: { value: 'urgent', reason: 'It reads as urgent.', confidence: 0.95 },
    })
    const body = await post({
      subject: 'task',
      level: 'internal_client_task',
      empty: ['priority'],
    })
    expect(body.suggestions.priority?.value).toBe('urgent')
  })

  it('drops a due date in the past', async () => {
    modelAnswers({
      dueDate: { value: '2026-09-01', reason: 'Yesterday, somehow.', confidence: 0.9 },
    })
    expect((await post({})).suggestions.dueDate).toBeUndefined()
  })

  it('drops an assignee id that is not on the roster', async () => {
    seedCohort()
    modelAnswers({
      assigneeId: { value: 'tm_invented', reason: 'They usually take these.', confidence: 0.9 },
    })
    const body = await post({ subject: 'task', level: 'internal_client_task', empty: ['assigneeId'] })
    expect(body.suggestions.assigneeId).toBeUndefined()
  })

  it('drops an estimate outside the sane range', async () => {
    modelAnswers({
      estimatedHours: { value: 900, reason: 'A big one.', confidence: 0.9 },
    })
    expect((await post({})).suggestions.estimatedHours).toBeUndefined()
  })

  it('never returns a field the operator already filled', async () => {
    modelAnswers({
      priority: { value: 'high', reason: 'It reads as urgent.', confidence: 0.95 },
    })
    const body = await post({ filled: { priority: 'standard' } })
    expect(body.suggestions.priority).toBeUndefined()
  })

  it('never returns a field that was not asked for', async () => {
    modelAnswers({
      category: { value: 'design', reason: 'It is a visual change.', confidence: 0.95 },
    })
    const body = await post({ empty: ['dueDate'] })
    expect(body.suggestions.category).toBeUndefined()
  })

  it('never returns a request-only field on a task', async () => {
    modelAnswers({
      size: { value: 'large', reason: 'Multi-day.', confidence: 0.95 },
    })
    const body = await post({
      subject: 'task',
      level: 'internal_client_task',
      empty: ['size', 'dueDate'],
    })
    expect(body.suggestions.size).toBeUndefined()
  })

  it('answers an unparseable reply with an empty object rather than an error', async () => {
    createMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sorry, I cannot.' }] })
    const body = await post({})
    expect(body.suggestions).toEqual({})
  })

  it('keeps a large size for a plan that has a multi-day track', async () => {
    seedCohort()
    modelAnswers({ size: { value: 'large', reason: 'It spans several days.', confidence: 0.9 } })
    const body = await post({ empty: ['size'] })
    expect(body.suggestions.size?.value).toBe('large')
  })

  it('drops a large size for a plan that has none, rather than leaving the dialog to undo it', async () => {
    // The prompt says so too, but a sentence in a prompt is a request. Without
    // the parser rule the dialog's own guard rewrote type back to small_task a
    // beat later while the chip and the reason kept arguing for multi-day.
    seedCohort()
    state.rows.organisations = [{ name: 'Kowhai Co', planType: 'maintain' }]
    modelAnswers({ size: { value: 'large', reason: 'It spans several days.', confidence: 0.9 } })
    const body = await post({ empty: ['size'] })
    expect(body.suggestions.size).toBeUndefined()
  })
})

describe('cost and limits', () => {
  it('logs exactly one cost row per model call', async () => {
    modelAnswers({})
    await post({})
    expect(recordCost).toHaveBeenCalledTimes(1)
    const [, input] = vi.mocked(recordCost).mock.calls[0]
    expect(input).toMatchObject({
      scope: 'wizard',
      stage: 'predict_fields',
      scopeId: 'user_1',
      provider: 'anthropic',
      inputTokens: 900,
      outputTokens: 80,
    })
  })

  it('answers ai_rate_limited over the daily ceiling, without calling the model', async () => {
    state.rows.aiCostLog = [
      { cents: 150, scopeId: 'user_2', createdAt: new Date().toISOString() },
      { cents: 120, scopeId: 'user_3', createdAt: new Date().toISOString() },
    ]
    const body = await post({})
    expect(body.reason).toBe('ai_rate_limited')
    expect(body.suggestions).toEqual({})
    expect(createMessage).not.toHaveBeenCalled()
    expect(recordCost).not.toHaveBeenCalled()
  })

  it('answers ai_rate_limited once one operator has burned their hour', async () => {
    const now = new Date().toISOString()
    state.rows.aiCostLog = Array.from({ length: 60 }, () => ({ cents: 1, scopeId: 'user_1', createdAt: now }))
    const body = await post({})
    expect(body.reason).toBe('ai_rate_limited')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('reads the day\'s spend from the tokens, not the rounded-up cents column', async () => {
    // estimateCostCents is Math.ceil(usd * 100), so a Haiku pass at ~900 in /
    // 80 out really costs about 0.13 cents and is STORED as 1. Summing the
    // column made a $2 ceiling into a cap of 200 calls a day studio-wide.
    // Two hundred rows here is about 26 cents of real Haiku spend, so the
    // door stays open. Another operator's rows, so the hourly ceiling is not
    // what is being measured.
    const now = new Date().toISOString()
    state.rows.aiCostLog = Array.from({ length: 200 }, () => ({
      cents: 1,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      inputTokens: 900,
      outputTokens: 80,
      scopeId: 'user_other',
      createdAt: now,
    }))
    modelAnswers({})
    const body = await post({})
    expect(body.reason).toBeUndefined()
    expect(createMessage).toHaveBeenCalledTimes(1)
  })

  it('still trips once the tokens really do add up to the ceiling', async () => {
    const now = new Date().toISOString()
    state.rows.aiCostLog = Array.from({ length: 40 }, () => ({
      cents: 1,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      inputTokens: 4_000_000,
      outputTokens: 200_000,
      scopeId: 'user_other',
      createdAt: now,
    }))
    const body = await post({})
    expect(body.reason).toBe('ai_rate_limited')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('lets another operator through on the same ledger', async () => {
    const now = new Date().toISOString()
    state.rows.aiCostLog = Array.from({ length: 60 }, () => ({ cents: 1, scopeId: 'user_other', createdAt: now }))
    modelAnswers({})
    const body = await post({})
    expect(body.reason).toBeUndefined()
    expect(createMessage).toHaveBeenCalledTimes(1)
  })
})

describe('degraded paths', () => {
  it('falls back to the keyword tables with no key, and says so', async () => {
    delete process.env.ANTHROPIC_API_KEY
    seedCohort()
    const body = await post({ title: 'The checkout page is broken and urgent' })
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('ai_unavailable')
    expect(body.suggestions.priority?.value).toBe('high')
    // A grounded date, from the seeded cohort's median rather than the model.
    expect(body.suggestions.dueDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(createMessage).not.toHaveBeenCalled()
    expect(recordCost).not.toHaveBeenCalled()
  })

  it('says nothing at all with no key and no cohort', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const body = await post({})
    expect(body.degraded).toBe(true)
    expect(body.suggestions).toEqual({})
  })

  it('falls back rather than erroring when the model call times out', async () => {
    seedCohort()
    createMessage.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
    const body = await post({ title: 'The checkout page is broken and urgent' })
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('timeout')
    expect(body.suggestions.priority?.value).toBe('high')
  })

  it('falls back rather than erroring when the model is busy', async () => {
    createMessage.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 429 }))
    const body = await post({})
    expect(body.degraded).toBe(true)
    expect(body.reason).toBe('ai_rate_limited')
  })

  it('carries the cache marker, which is inert at this prompt length', async () => {
    // Haiku 4.5 will not cache a prefix under 4096 tokens and the system block
    // is about 480, so the API ignores this marker in silence: no error, and
    // cache_read_input_tokens stays 0. Nothing here pays a discounted rate
    // today. It is asserted only so the marker is not deleted by accident
    // before the prompt or the model crosses that line, and this name says so
    // rather than claiming a saving nobody has measured.
    modelAnswers({})
    await post({})
    const [params] = createMessage.mock.calls[0] as [{
      system: Array<{ cache_control?: { type: string } }>
      max_tokens: number
    }]
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(params.max_tokens).toBe(500)
  })

  it('puts a ceiling on how long a dialog waits', async () => {
    modelAnswers({})
    await post({})
    const [, options] = createMessage.mock.calls[0] as [unknown, { signal?: AbortSignal }]
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })
})
