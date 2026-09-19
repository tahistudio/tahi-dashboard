/**
 * lib/task-suggester.ts: what the model is allowed to get away with, and what
 * the sweep does with the transcripts it reads.
 *
 * The suggester is the only thing in the repo that spends money on a timer
 * with nobody watching and then puts words in a client conversation's mouth.
 * Two failure modes matter more than everything else here:
 *
 *   1. An item nobody said. Every suggestion has to quote the transcript
 *      verbatim, name a task that actually exists, and only call something
 *      done when the call said it was done. Anything else is dropped, and the
 *      drop is counted rather than swallowed.
 *   2. A transcript read twice. The high-water mark is stamped on every
 *      transcript the sweep LOOKS at, including the ones the gate skipped and
 *      the ones the model failed on, because the alternative is paying for the
 *      same call every thirty minutes forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'
import {
  CONTEXT_REQUEST_LIMIT,
  CONTEXT_TASK_LIMIT,
  MAX_SUGGESTIONS,
  SuggesterUnavailableError,
  buildSuggestionContext,
  parseSuggestionsBlock,
  runSuggestionSweep,
  suggestFromTranscript,
  suggestionContextWindows,
  validateSuggestionItems,
  type SuggestionContext,
} from '@/lib/task-suggester'

// ── A fake Drizzle handle ────────────────────────────────────────────────────
// Selects come off a queue in call order; inserts and updates are recorded so
// a test can assert what was written without a database.

interface Recorded { table: unknown; values?: unknown; set?: unknown }

function makeDb(selectResults: unknown[]) {
  const queue = [...selectResults]
  const selects: Array<{ methods: string[]; args: unknown[][] }> = []
  const inserts: Recorded[] = []
  const updates: Recorded[] = []

  function chain(result: unknown, record: { methods: string[]; args: unknown[][] }): Record<string, unknown> {
    const proxy: Record<string, unknown> = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr)
        }
        if (typeof prop !== 'string') return undefined
        return (...args: unknown[]) => {
          record.methods.push(prop)
          record.args.push(args)
          return proxy
        }
      },
    })
    return proxy
  }

  const handle = {
    select: () => {
      const record = { methods: ['select'], args: [] as unknown[][] }
      selects.push(record)
      return chain(queue.length ? queue.shift() : [], record)
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values })
        return Promise.resolve({ success: true })
      },
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: () => {
          updates.push({ table, set })
          return Promise.resolve({ success: true })
        },
      }),
    }),
  }

  // The three methods the suggester actually calls, shaped like Drizzle's.
  // Cast rather than typed, because reproducing DrizzleD1Database here would
  // be more fiction than the fake already is.
  const drizzle = handle as unknown as Parameters<typeof buildSuggestionContext>[0]
  return { handle: drizzle, selects, inserts, updates }
}

const CONTEXT: SuggestionContext = {
  tasks: [
    { id: 'task-1', title: 'Rebuild the pricing page', status: 'in_progress', assigneeName: 'Liam', dueDate: null, updatedAt: '2026-09-10T00:00:00Z' },
    { id: 'task-2', title: 'Write the launch email', status: 'todo', assigneeName: null, dueDate: '2026-09-25', updatedAt: '2026-09-12T00:00:00Z' },
  ],
  requests: [{ id: 'req-1', number: 42, title: 'Spring landing page', status: 'in_progress' }],
  members: [{ id: 'tm-1', name: 'Liam' }, { id: 'tm-2', name: 'Staci' }],
}

const TRANSCRIPT = [
  'Liam: right, the pricing page rebuild is finished and live as of this morning.',
  'Client: great. We also need a new FAQ section on the pricing page before the launch.',
  'Liam: noted. I will get the launch email moved to the twenty fifth.',
].join('\n')

// ── The windows and caps ─────────────────────────────────────────────────────

describe('suggestionContextWindows', () => {
  it('looks back sixty days for activity and fourteen for completions', () => {
    const w = suggestionContextWindows(new Date('2026-09-19T00:00:00Z'))
    expect(w.updatedSince).toBe('2026-07-21T00:00:00Z')
    expect(w.doneSince).toBe('2026-09-05T00:00:00Z')
  })
})

describe('buildSuggestionContext', () => {
  it('caps the task and request lists and decorates assignees from the roster', async () => {
    const { handle, selects } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [{ id: 'task-1', title: 'Rebuild the pricing page', status: 'in_progress', assigneeId: 'tm-1', dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
      [{ id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress' }],
    ])

    const ctx = await buildSuggestionContext(handle, 'org-a')

    expect(ctx.members).toEqual([{ id: 'tm-1', name: 'Liam' }])
    expect(ctx.tasks[0].assigneeName).toBe('Liam')
    expect(ctx.requests[0].number).toBe(42)

    const limits = selects.flatMap(s => s.args[s.methods.indexOf('limit') - 1] ?? [])
    expect(limits).toContain(CONTEXT_TASK_LIMIT)
    expect(limits).toContain(CONTEXT_REQUEST_LIMIT)
  })

  it('asks for no requests at all when the transcript is studio housekeeping', async () => {
    const { handle, selects } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [{ id: 'task-9', title: 'Renew the domain', status: 'todo', assigneeId: null, dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
    ])

    const ctx = await buildSuggestionContext(handle, null)

    expect(ctx.requests).toEqual([])
    // Roster and tasks only: a null org has no client requests to read.
    expect(selects).toHaveLength(2)
  })
})

// ── The parser ───────────────────────────────────────────────────────────────

describe('parseSuggestionsBlock', () => {
  it('reads the JSON array out of a reply with prose on both sides of it', () => {
    const text = [
      'Three things came out of this call.',
      '',
      '<suggestions>[{"kind":"note","targetTaskId":"task-1","proposal":{"body":"hi"},"quote":"q"}]</suggestions>',
      '',
      'Let me know if you want any of them changed.',
    ].join('\n')

    const parsed = parseSuggestionsBlock(text)

    expect(parsed.reply).toBe('Three things came out of this call.')
    expect(parsed.items).toHaveLength(1)
  })

  it('returns nothing rather than a guess when the block will not parse', () => {
    const parsed = parseSuggestionsBlock('Here you go <suggestions>[{"kind":</suggestions>')
    expect(parsed.items).toEqual([])
    expect(parsed.reply).toBe('Here you go')
  })

  it('returns nothing when there is no block at all', () => {
    const parsed = parseSuggestionsBlock('Nothing actionable was said on this call.')
    expect(parsed.items).toEqual([])
    expect(parsed.reply).toBe('Nothing actionable was said on this call.')
  })
})

// ── The validation ───────────────────────────────────────────────────────────

describe('validateSuggestionItems', () => {
  const validate = (items: unknown[]) =>
    validateSuggestionItems(items, { source: TRANSCRIPT, context: CONTEXT })

  it('keeps a create whose quote is in the transcript', () => {
    const { suggestions, dropped } = validate([{
      kind: 'create_task',
      proposal: { title: 'Add an FAQ section to the pricing page', description: 'From the call.', type: 'internal_client_task', assigneeName: 'Liam' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
      rationale: 'The client asked for it.',
      confidence: 0.9,
    }])

    expect(dropped).toEqual([])
    expect(suggestions).toHaveLength(1)
    // Resolved because exactly one roster name matches. Never guessed.
    expect((suggestions[0].proposal as { assigneeId?: string }).assigneeId).toBe('tm-1')
  })

  it('leaves assigneeId null when the name matches nobody on the roster', () => {
    const { suggestions } = validate([{
      kind: 'create_task',
      proposal: { title: 'Add an FAQ section to the pricing page', type: 'internal_client_task', assigneeName: 'Someone Else' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }])
    expect((suggestions[0].proposal as { assigneeId: string | null }).assigneeId).toBeNull()
  })

  it('drops an item whose quote is nowhere in the transcript', () => {
    const { suggestions, dropped } = validate([{
      kind: 'note',
      targetTaskId: 'task-1',
      proposal: { body: 'They want a discount.' },
      quote: 'We would like a thirty percent discount.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('quote_not_in_source')
  })

  it('accepts a quote that only differs by whitespace and case', () => {
    const { suggestions, dropped } = validate([{
      kind: 'note',
      targetTaskId: 'task-1',
      proposal: { body: 'Noted.' },
      quote: '  WE ALSO NEED a new FAQ   section on the pricing page before the launch. ',
    }])

    expect(dropped).toEqual([])
    expect(suggestions).toHaveLength(1)
  })

  it('drops an update that names a task the context never showed it', () => {
    const { suggestions, dropped } = validate([{
      kind: 'update_task',
      targetTaskId: 'task-999',
      proposal: { fields: { dueDate: '2026-09-25' } },
      quote: 'I will get the launch email moved to the twenty fifth.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('unknown_target_task')
  })

  it('drops an update with no target at all', () => {
    const { dropped } = validate([{
      kind: 'update_task',
      proposal: { fields: { dueDate: '2026-09-25' } },
      quote: 'I will get the launch email moved to the twenty fifth.',
    }])
    expect(dropped[0].reason).toBe('missing_target_task')
  })

  it('drops a completion whose quote never says it is done', () => {
    const { suggestions, dropped } = validate([{
      kind: 'complete_task',
      targetTaskId: 'task-2',
      proposal: {},
      quote: 'I will get the launch email moved to the twenty fifth.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('completion_without_completion_word')
  })

  it('keeps a completion the call actually closed', () => {
    const { suggestions, dropped } = validate([{
      kind: 'complete_task',
      targetTaskId: 'task-1',
      proposal: { note: 'Shipped this morning.' },
      quote: 'the pricing page rebuild is finished and live as of this morning.',
    }])

    expect(dropped).toEqual([])
    expect(suggestions).toHaveLength(1)
  })

  it('drops a create whose title is under four characters', () => {
    const { suggestions, dropped } = validate([{
      kind: 'create_task',
      proposal: { title: 'FAQ' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('title_too_short')
  })

  it('drops a kind it has never heard of', () => {
    const { dropped } = validate([{
      kind: 'delete_everything',
      proposal: {},
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }])
    expect(dropped[0].reason).toBe('unknown_kind')
  })

  it('stops at twelve and counts the rest as dropped', () => {
    const items = Array.from({ length: MAX_SUGGESTIONS + 3 }, (_, i) => ({
      kind: 'create_task',
      proposal: { title: `Add an FAQ section, variant ${i}` },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }))

    const { suggestions, dropped } = validate(items)

    expect(suggestions).toHaveLength(MAX_SUGGESTIONS)
    expect(dropped).toHaveLength(3)
    expect(dropped.every(d => d.reason === 'over_limit')).toBe(true)
  })
})

// ── The model call itself ────────────────────────────────────────────────────

describe('suggestFromTranscript without a key', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('refuses in production rather than inventing anything', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ANTHROPIC_API_KEY', '')

    await expect(suggestFromTranscript({
      transcript: TRANSCRIPT,
      wrapUp: null,
      callTitle: 'Check-in',
      callDate: '2026-09-19',
      context: CONTEXT,
    })).rejects.toBeInstanceOf(SuggesterUnavailableError)
  })

  it('falls back deterministically outside production, flagged degraded', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ANTHROPIC_API_KEY', '')

    const result = await suggestFromTranscript({
      transcript: TRANSCRIPT,
      wrapUp: null,
      callTitle: 'Check-in',
      callDate: '2026-09-19',
      context: CONTEXT,
    })

    expect(result.degraded).toBe(true)
    expect(result.usage.inputTokens).toBe(0)
    // Whatever it produced still had to survive the same validation.
    for (const s of result.suggestions) {
      expect(TRANSCRIPT.toLowerCase()).toContain(s.quote.toLowerCase().trim())
    }
  })
})

// ── The sweep ────────────────────────────────────────────────────────────────

const TRANSCRIPT_ROW = {
  id: 'ct-1',
  callKind: 'discovery',
  callId: 'disc-1',
  title: 'Acme check-in',
  receivedAt: '2026-09-18T02:00:00Z',
  text: TRANSCRIPT,
  wrapUp: null,
}

function contextSelects() {
  return [
    [{ id: 'tm-1', name: 'Liam' }],
    [{ id: 'task-1', title: 'Rebuild the pricing page', status: 'in_progress', assigneeId: 'tm-1', dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
    [{ id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress' }],
  ]
}

const okSuggest = vi.fn(async () => ({
  suggestions: [{
    kind: 'create_task' as const,
    targetTaskId: null,
    proposal: { title: 'Add an FAQ section to the pricing page' },
    quote: 'We also need a new FAQ section on the pricing page before the launch.',
    rationale: null,
    confidence: 0.8,
  }],
  usage: { model: 'claude-sonnet-5', inputTokens: 4000, outputTokens: 500 },
  dropped: [{ reason: 'quote_not_in_source', raw: {} }],
}))

beforeEach(() => { okSuggest.mockClear() })

describe('runSuggestionSweep', () => {
  it('skips a call with no client and stamps it anyway, so it is never read twice', async () => {
    const { handle, updates } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: null, meetingType: 'partnership' }],
      [],                                   // resurfaceSnoozed: nothing due
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(okSuggest).not.toHaveBeenCalled()
    expect(summary.looked).toBe(1)
    expect(summary.eligible).toBe(0)
    expect(summary.skipped).toEqual([{ transcriptId: 'ct-1', reason: 'no_client_org' }])

    const stamp = updates.find(u => u.table === schema.callTranscripts)
    expect(stamp).toBeTruthy()
    expect((stamp!.set as { suggestedAt: string }).suggestedAt).toBe('2026-09-19T00:00:00Z')
  })

  it('lets a discovery call through on meeting_type client even with no org', async () => {
    const { handle } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: null, meetingType: 'client' }],
      // A null org is studio housekeeping: roster and tasks, no client requests.
      ...contextSelects().slice(0, 2),
      [],                                   // insertSuggestions: no existing keys
      [],                                   // resurfaceSnoozed
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(okSuggest).toHaveBeenCalledTimes(1)
    expect(summary.eligible).toBe(1)
    expect(summary.inserted).toBe(1)
    expect(summary.dropped).toBe(1)
  })

  it('records the spend under the call_suggestions scope, against the transcript', async () => {
    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: 'org-a', meetingType: null }],
      ...contextSelects(),
      [],
      [],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    const cost = inserts.find(i => i.table === schema.aiCostLog)
    expect(cost).toBeTruthy()
    const values = cost!.values as { scope: string; scopeId: string; model: string; stage: string }
    expect(values.scope).toBe('call_suggestions')
    expect(values.scopeId).toBe('ct-1')
    expect(values.model).toBe('claude-sonnet-5')
    expect(summary.costCents).toBeGreaterThan(0)
  })

  it('counts a suggestion it has already written as a duplicate, not a second row', async () => {
    // The dedupe key the stub derives for this exact create, off this exact
    // transcript. Re-syncing a Drive doc must not refill the inbox.
    const { buildDedupeKey } = await import('@/lib/task-suggestions')
    const key = await buildDedupeKey({
      sourceKind: 'call',
      transcriptId: 'ct-1',
      kind: 'create_task',
      targetTaskId: null,
      proposal: { title: 'Add an FAQ section to the pricing page' },
    })

    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: 'org-a', meetingType: null }],
      ...contextSelects(),
      [{ dedupeKey: key }],                 // already in the table
      [],                                   // resurfaceSnoozed
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.duplicates).toBe(1)
    expect(summary.inserted).toBe(0)
    expect(inserts.find(i => i.table === schema.taskSuggestions)).toBeUndefined()
  })

  it('stamps the high-water mark even when the model call throws', async () => {
    const boom = vi.fn(async () => { throw new Error('529 overloaded') })
    const { handle, updates } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: 'org-a', meetingType: null }],
      ...contextSelects(),
      [],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: boom, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.inserted).toBe(0)
    expect(summary.skipped[0]).toEqual({ transcriptId: 'ct-1', reason: 'suggester_failed: 529 overloaded' })
    const stamp = updates.find(u => u.table === schema.callTranscripts)
    expect((stamp!.set as { suggestedAt: string }).suggestedAt).toBe('2026-09-19T00:00:00Z')
  })

  it('returns snoozed suggestions to pending on its way out', async () => {
    const { handle, updates } = makeDb([
      [],                                   // no transcripts waiting
      [{ id: 'sug-1' }, { id: 'sug-2' }],   // two snoozes due
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.looked).toBe(0)
    expect(summary.resurfaced).toBe(2)
    const back = updates.find(u => u.table === schema.taskSuggestions)
    expect((back!.set as { status: string }).status).toBe('pending')
  })
})
