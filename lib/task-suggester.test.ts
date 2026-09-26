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
  CONTEXT_CONTACT_LIMIT,
  CONTEXT_REQUEST_LIMIT,
  CONTEXT_TASK_LIMIT,
  MAX_SUGGESTIONS,
  MAX_SWEEP_BATCH,
  SUGGESTER_SYSTEM_PROMPT,
  SWEEP_BATCH,
  SuggesterUnavailableError,
  buildSecondReadMessage,
  buildSuggestionContext,
  mergeSecondRead,
  parseSecondPass,
  parseSuggestionsBlock,
  parseSweepLimit,
  runSuggestionSweep,
  suggestFromTranscript,
  suggestionContextWindows,
  validateSuggestionItems,
  type SuggestFromTranscriptInput,
  type SuggestionContext,
  type SuggestionDraft,
} from '@/lib/task-suggester'
import { HANDOFF_REASONS } from '@/lib/request-handoff-copy'
import { REQUEST_CATEGORIES, REQUEST_PRIORITIES, REQUEST_TYPES } from '@/lib/request-vocabulary'

// The SDK, for the one block that checks the request a real read sends. Every
// other test either has no key (so no SDK) or injects its own suggest.
const sdk = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  reply: '',
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => {
        sdk.calls.push(params)
        return {
          content: [{ type: 'text', text: sdk.reply }],
          usage: { input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 4000 },
        }
      },
    }
  },
}))

// The real module, with one spy over the writer, so a test can read the drafts
// the sweep hands it. Everything else behaves exactly as it does in production.
vi.mock('@/lib/task-suggestions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/task-suggestions')>()
  return { ...actual, insertSuggestions: vi.fn(actual.insertSuggestions) }
})

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
  requests: [{ id: 'req-1', number: 42, title: 'Spring landing page', status: 'in_progress', waitingOn: false, delivered: false, currentAssigneeId: null, currentAssigneeName: null }],
  members: [{ id: 'tm-1', name: 'Liam' }, { id: 'tm-2', name: 'Staci' }],
  contacts: [
    { id: 'con-1', name: 'Ella Brown', email: 'ella@elevate.uk' },
    { id: 'con-2', name: 'Sam Reed', email: 'sam@elevate.uk' },
  ],
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

  it('looks back ninety days for delivered work, which is what gets re-asked for', () => {
    expect(suggestionContextWindows(new Date('2026-09-19T00:00:00Z')).deliveredSince).toBe('2026-06-21T00:00:00Z')
  })
})

describe('buildSuggestionContext', () => {
  it('caps the task and request lists and decorates assignees from the roster', async () => {
    const { handle, selects } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [{ id: 'task-1', title: 'Rebuild the pricing page', status: 'in_progress', assigneeId: 'tm-1', dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
      [{ id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress', waitingOnContactId: 'con-1' }],
      [{ id: 'con-1', name: 'Ella Brown', email: 'ella@elevate.uk' }],
    ])

    const ctx = await buildSuggestionContext(handle, 'org-a')

    expect(ctx.members).toEqual([{ id: 'tm-1', name: 'Liam' }])
    expect(ctx.tasks[0].assigneeName).toBe('Liam')
    expect(ctx.requests[0].number).toBe(42)

    const limits = selects.flatMap(s => s.args[s.methods.indexOf('limit') - 1] ?? [])
    expect(limits).toContain(CONTEXT_TASK_LIMIT)
    expect(limits).toContain(CONTEXT_REQUEST_LIMIT)
  })

  it('carries the org contacts and says which requests are already with somebody', async () => {
    const { handle, selects } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [{ id: 'task-1', title: 'Rebuild the pricing page', status: 'in_progress', assigneeId: 'tm-1', dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
      [
        { id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress', waitingOnContactId: 'con-1' },
        { id: 'req-2', requestNumber: 43, title: 'Careers page', status: 'in_review', waitingOnContactId: null },
      ],
      [{ id: 'con-1', name: 'Ella Brown', email: 'ella@elevate.uk' }],
    ])

    const ctx = await buildSuggestionContext(handle, 'org-a')

    expect(ctx.contacts).toEqual([{ id: 'con-1', name: 'Ella Brown', email: 'ella@elevate.uk' }])
    expect(ctx.requests.map(r => r.waitingOn)).toEqual([true, false])

    const limits = selects.flatMap(s => s.args[s.methods.indexOf('limit') - 1] ?? [])
    expect(limits).toContain(CONTEXT_CONTACT_LIMIT)
  })

  it('names the current owner of an open request off the roster, for "owns this client\'s work" (CN.2 section 5)', async () => {
    const { handle } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [],
      [
        { id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress', waitingOnContactId: null, assigneeId: 'tm-1' },
        { id: 'req-2', requestNumber: 43, title: 'Careers page', status: 'in_review', waitingOnContactId: null, assigneeId: null },
      ],
      [],
    ])

    const ctx = await buildSuggestionContext(handle, 'org-a')

    expect(ctx.requests[0]).toMatchObject({ currentAssigneeId: 'tm-1', currentAssigneeName: 'Liam' })
    expect(ctx.requests[1]).toMatchObject({ currentAssigneeId: null, currentAssigneeName: null })
  })

  it('shows work delivered lately, marked delivered, so it is not proposed again', async () => {
    // The commonest duplicate there is: a client mentions the thing the studio
    // finished six weeks ago, the model sees nothing like it in a list of open
    // work, and proposes it as new. Delivered rows are in the list, and say so.
    const { handle } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [],
      [
        { id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'delivered', waitingOnContactId: null },
        { id: 'req-2', requestNumber: 43, title: 'Careers page', status: 'in_review', waitingOnContactId: null },
      ],
      [],
    ])

    const ctx = await buildSuggestionContext(handle, 'org-a')

    expect(ctx.requests.map(r => r.delivered)).toEqual([true, false])
  })

  it('asks for no requests at all when the transcript is studio housekeeping', async () => {
    const { handle, selects } = makeDb([
      [{ id: 'tm-1', name: 'Liam' }],
      [{ id: 'task-9', title: 'Renew the domain', status: 'todo', assigneeId: null, dueDate: null, updatedAt: '2026-09-10T00:00:00Z' }],
    ])

    const ctx = await buildSuggestionContext(handle, null)

    expect(ctx.requests).toEqual([])
    expect(ctx.contacts).toEqual([])
    // Roster and tasks only: a null org has no client requests or contacts to read.
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
      proposal: { title: 'Add an FAQ section to the pricing page', description: 'From the call.', type: 'internal_client_task', suggestedAssigneeName: 'Liam', assigneeReason: 'said he would write it' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
      rationale: 'The client asked for it.',
      confidence: 0.9,
    }])

    expect(dropped).toEqual([])
    expect(suggestions).toHaveLength(1)
    // Resolved because exactly one roster name matches. Never guessed.
    const proposal = suggestions[0].proposal as { suggestedAssigneeId?: string; suggestedAssigneeName?: string; assigneeReason?: string }
    expect(proposal.suggestedAssigneeId).toBe('tm-1')
    expect(proposal.suggestedAssigneeName).toBe('Liam')
    expect(proposal.assigneeReason).toBe('said he would write it')
  })

  it('leaves suggestedAssigneeId null when the name matches nobody on the roster', () => {
    const { suggestions } = validate([{
      kind: 'create_task',
      proposal: { title: 'Add an FAQ section to the pricing page', type: 'internal_client_task', suggestedAssigneeName: 'Someone Else' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }])
    const proposal = suggestions[0].proposal as { suggestedAssigneeId: string | null; suggestedAssigneeName: string | null }
    expect(proposal.suggestedAssigneeId).toBeNull()
    expect(proposal.suggestedAssigneeName).toBe('Someone Else')
  })

  it('leaves both null when the suggester named nobody', () => {
    const { suggestions } = validate([{
      kind: 'create_task',
      proposal: { title: 'Add an FAQ section to the pricing page', type: 'internal_client_task' },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
    }])
    const proposal = suggestions[0].proposal as { suggestedAssigneeId: string | null; suggestedAssigneeName: string | null }
    expect(proposal.suggestedAssigneeId).toBeNull()
    expect(proposal.suggestedAssigneeName).toBeNull()
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

// ── The request kinds ────────────────────────────────────────────────────────
// CN.1b. A call with a client mostly produces client-facing work, and
// client-facing work is a request. The suggester has to tell the two apart
// before a human ever sees the row, because an inbox that files a client
// deliverable as an internal task quietly hides it from the client.

const REQUEST_TRANSCRIPT = [
  'Liam: right, the pricing page rebuild is finished and live as of this morning.',
  'Client: we also need a new FAQ section on the pricing page before the launch.',
  'Liam: the spring landing page has to go live on the twenty fifth instead.',
  'Liam: Ella, we need the brand photography from you before we can finish the spring landing page.',
  'Liam: I will check our own hosting invoice internally before the next billing run.',
].join('\n')

const validateRequestItems = (items: unknown[]) =>
  validateSuggestionItems(items, { source: REQUEST_TRANSCRIPT, context: CONTEXT })

describe('the system prompt', () => {
  it('sends work on the client site to requests and keeps tasks for what the client never sees', () => {
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('The test is what the client will see')
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('even when Liam or Staci is the one doing it')
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('When in doubt it is a request')
  })

  it('asks for an owner suggestion on the three kinds CN.2 section 5 names', () => {
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('suggestedAssigneeName')
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('assigneeReason')
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('owns this client\'s work')
    // Printed on create_task, create_request and update_request's own shapes.
    expect(SUGGESTER_SYSTEM_PROMPT.match(/suggestedAssigneeName/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('prints the request vocabulary rather than repeating it by hand', () => {
    for (const category of REQUEST_CATEGORIES) expect(SUGGESTER_SYSTEM_PROMPT).toContain(`"${category}"`)
    for (const type of REQUEST_TYPES) expect(SUGGESTER_SYSTEM_PROMPT).toContain(`"${type}"`)
    for (const priority of REQUEST_PRIORITIES) expect(SUGGESTER_SYSTEM_PROMPT).toContain(`"${priority}"`)
    for (const reason of HANDOFF_REASONS) expect(SUGGESTER_SYSTEM_PROMPT).toContain(`"${reason}"`)
  })

  it('states the rule that decides between a task and a request', () => {
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('create_request')
    expect(SUGGESTER_SYSTEM_PROMPT).toContain('hand_off_request')
    expect(SUGGESTER_SYSTEM_PROMPT.toLowerCase()).toContain('never both')
  })
})

describe('validateSuggestionItems for the request kinds', () => {
  it('keeps a client deliverable as a create_request with no target', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'create_request',
      proposal: {
        title: 'Add an FAQ section to the pricing page',
        description: 'The client asked for it on the call.',
        category: 'content',
        type: 'small_task',
        priority: 'standard',
        requesterName: 'Ella Brown',
      },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
      confidence: 0.9,
    }])

    expect(dropped).toEqual([])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].targetTaskId).toBeNull()
    expect(suggestions[0].targetRequestId).toBeNull()
    // Exactly one contact of this org matches the name, so the id is safe.
    expect((suggestions[0].proposal as { requesterContactId: string | null }).requesterContactId).toBe('con-1')
  })

  it('leaves the requester id null when the name matches nobody at the client', () => {
    const { suggestions } = validateRequestItems([{
      kind: 'create_request',
      proposal: {
        title: 'Add an FAQ section to the pricing page',
        category: 'content',
        type: 'small_task',
        priority: 'standard',
        requesterName: 'Someone Else',
      },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
    }])

    const proposal = suggestions[0].proposal as { requesterContactId: string | null; requesterName: string | null }
    expect(proposal.requesterContactId).toBeNull()
    expect(proposal.requesterName).toBe('Someone Else')
  })

  it('drops a create_request whose category is not one the dialog offers', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'create_request',
      proposal: { title: 'Add an FAQ section to the pricing page', category: 'marketing', type: 'small_task', priority: 'standard' },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('invalid_request_category')
  })

  it('drops a create_request whose priority is outside the two-value vocabulary', () => {
    const { dropped } = validateRequestItems([{
      kind: 'create_request',
      proposal: { title: 'Add an FAQ section to the pricing page', category: 'content', type: 'small_task', priority: 'urgent' },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
    }])
    expect(dropped[0].reason).toBe('invalid_request_priority')
  })

  it('resolves a create_request owner exactly, and leaves it null when nobody named matches (CN.2 section 5)', () => {
    const named = validateRequestItems([{
      kind: 'create_request',
      proposal: {
        title: 'Add an FAQ section to the pricing page', category: 'content', type: 'small_task', priority: 'standard',
        suggestedAssigneeName: 'Staci', assigneeReason: 'said she would send the headers',
      },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
    }])
    const namedProposal = named.suggestions[0].proposal as { suggestedAssigneeId: string | null; suggestedAssigneeName: string | null; assigneeReason: string | null }
    expect(namedProposal.suggestedAssigneeId).toBe('tm-2')
    expect(namedProposal.assigneeReason).toBe('said she would send the headers')

    const unmatched = validateRequestItems([{
      kind: 'create_request',
      proposal: {
        title: 'Add an FAQ section to the pricing page', category: 'content', type: 'small_task', priority: 'standard',
        suggestedAssigneeName: 'Nobody On The Roster',
      },
      quote: 'we also need a new FAQ section on the pricing page before the launch.',
    }])
    const unmatchedProposal = unmatched.suggestions[0].proposal as { suggestedAssigneeId: string | null }
    expect(unmatchedProposal.suggestedAssigneeId).toBeNull()
  })

  it('keeps an update_request that names an open request from the context', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'update_request',
      targetRequestId: 'req-1',
      proposal: { fields: { dueDate: '2026-09-25' }, note: 'Moved on the call.' },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])

    expect(dropped).toEqual([])
    expect(suggestions[0].targetRequestId).toBe('req-1')
    expect(suggestions[0].targetTaskId).toBeNull()
  })

  it('resolves an update_request owner the same way, repeating the request\'s current owner when the model echoed it (CN.2 section 5)', () => {
    const { suggestions } = validateRequestItems([{
      kind: 'update_request',
      targetRequestId: 'req-1',
      proposal: {
        fields: { dueDate: '2026-09-25' },
        suggestedAssigneeName: 'Liam', assigneeReason: 'owns this client\'s work',
      },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])
    const proposal = suggestions[0].proposal as { suggestedAssigneeId: string | null; assigneeReason: string | null }
    expect(proposal.suggestedAssigneeId).toBe('tm-1')
    expect(proposal.assigneeReason).toBe('owns this client\'s work')
  })

  it('drops an update_request whose target is not an open request it was shown', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'update_request',
      targetRequestId: 'req-999',
      proposal: { fields: { dueDate: '2026-09-25' } },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('unknown_target_request')
  })

  it('drops an update_request that changes nothing', () => {
    const { dropped } = validateRequestItems([{
      kind: 'update_request',
      targetRequestId: 'req-1',
      proposal: { note: 'Just a note really.' },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])
    expect(dropped[0].reason).toBe('no_request_fields')
  })

  it('keeps a request_note on an open request', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'request_note',
      targetRequestId: 'req-1',
      proposal: { body: 'The launch date moved to the twenty fifth.' },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])

    expect(dropped).toEqual([])
    expect(suggestions[0].targetRequestId).toBe('req-1')
  })

  it('drops a request_note with no body', () => {
    const { dropped } = validateRequestItems([{
      kind: 'request_note',
      targetRequestId: 'req-1',
      proposal: { body: '  ' },
      quote: 'the spring landing page has to go live on the twenty fifth instead.',
    }])
    expect(dropped[0].reason).toBe('empty_note')
  })

  it('resolves the contact on a hand off from the context, by name', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'hand_off_request',
      targetRequestId: 'req-1',
      proposal: { contactName: 'Ella Brown', reason: 'content', dueAt: '2026-09-22' },
      quote: 'Ella, we need the brand photography from you before we can finish the spring landing page.',
    }])

    expect(dropped).toEqual([])
    expect((suggestions[0].proposal as { contactId: string | null }).contactId).toBe('con-1')
  })

  it('resolves the contact on a hand off by email as well, case folded', () => {
    const { suggestions } = validateRequestItems([{
      kind: 'hand_off_request',
      targetRequestId: 'req-1',
      proposal: { contactName: 'ELLA@elevate.uk', reason: 'file' },
      quote: 'Ella, we need the brand photography from you before we can finish the spring landing page.',
    }])
    expect((suggestions[0].proposal as { contactId: string | null }).contactId).toBe('con-1')
  })

  it('still suggests a hand off whose person cannot be resolved, with the id left null', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'hand_off_request',
      targetRequestId: 'req-1',
      proposal: { contactName: 'the marketing team', reason: 'content' },
      quote: 'Ella, we need the brand photography from you before we can finish the spring landing page.',
    }])

    expect(dropped).toEqual([])
    expect((suggestions[0].proposal as { contactId: string | null }).contactId).toBeNull()
  })

  it('drops a hand off whose reason is not one of the six', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'hand_off_request',
      targetRequestId: 'req-1',
      proposal: { contactName: 'Ella Brown', reason: 'vibes' },
      quote: 'Ella, we need the brand photography from you before we can finish the spring landing page.',
    }])

    expect(suggestions).toEqual([])
    expect(dropped[0].reason).toBe('invalid_handoff_reason')
  })

  it('leaves the studio its own follow-up as a task, not a request', () => {
    const { suggestions, dropped } = validateRequestItems([{
      kind: 'create_task',
      proposal: { title: 'Check the hosting invoice before the next billing run', type: 'tahi_internal' },
      quote: 'I will check our own hosting invoice internally before the next billing run.',
    }])

    expect(dropped).toEqual([])
    expect(suggestions[0].kind).toBe('create_task')
    expect(suggestions[0].targetRequestId).toBeNull()
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
    [{ id: 'req-1', requestNumber: 42, title: 'Spring landing page', status: 'in_progress', waitingOnContactId: null }],
    [{ id: 'con-1', name: 'Ella Brown', email: 'ella@elevate.uk' }],
  ]
}

const okSuggest = vi.fn(async () => ({
  suggestions: [{
    kind: 'create_task' as const,
    targetTaskId: null,
    targetRequestId: null,
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

  it('resolves the org through the deal when the call has none', async () => {
    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: null, meetingType: 'client', dealId: 'deal-1', attendees: '[]' }],
      [{ orgId: 'org-9' }],                 // deals lookup
      ...contextSelects(),
      [],                                   // insertSuggestions: no existing keys
      [],                                   // resurfaceSnoozed
      [],                                   // repair: nothing orgless
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.eligible).toBe(1)
    expect(summary.inserted).toBe(1)
    const written = inserts.find(i => i.table === schema.taskSuggestions)
    expect(JSON.stringify(written?.values)).toContain('org-9')
  })

  it('resolves the org through the guests when they are contacts at exactly one client', async () => {
    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: null, meetingType: 'client', dealId: null, attendees: JSON.stringify([{ email: 'Ella@elevate.uk' }, { email: 'staci@tahi.studio' }]) }],
      [{ orgId: 'org-e', email: 'ella@elevate.uk' }],   // contacts lookup
      ...contextSelects(),
      [],
      [],
      [],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.eligible).toBe(1)
    expect(JSON.stringify(inserts.find(i => i.table === schema.taskSuggestions)?.values)).toContain('org-e')
  })

  it('leaves the org empty when the guests span two clients', async () => {
    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: null, meetingType: 'client', dealId: null, attendees: JSON.stringify([{ email: 'a@one.com' }, { email: 'b@two.com' }]) }],
      [{ orgId: 'org-a', email: 'a@one.com' }, { orgId: 'org-b', email: 'b@two.com' }],
      ...contextSelects().slice(0, 2),
      [],
      [],
      [],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.eligible).toBe(1)
    expect(JSON.stringify(inserts.find(i => i.table === schema.taskSuggestions)?.values)).not.toContain('org-a')
  })

  it('repairs pending suggestions that were written without an org', async () => {
    const { handle, updates } = makeDb([
      [],                                   // no transcripts waiting
      [],                                   // resurfaceSnoozed: nothing due
      [{ id: 'sug-1', callKind: 'discovery', callId: 'call-1', kind: 'create_task', proposal: JSON.stringify({ title: 'Send headers', orgId: null }) }],
      [{ orgId: null, meetingType: 'client', dealId: 'deal-1', attendees: '[]' }],
      [{ orgId: 'org-9' }],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.repaired).toBe(1)
    const fix = updates.find(u => u.table === schema.taskSuggestions)
    expect(fix).toBeTruthy()
    const set = fix!.set as { orgId: string; proposal: string }
    expect(set.orgId).toBe('org-9')
    expect(JSON.parse(set.proposal)).toMatchObject({ title: 'Send headers', orgId: 'org-9' })
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

    // One read: this test is about the gate, and a second read's own drops
    // would muddy the count below. The second read has its own block.
    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z'), secondPass: false })

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
      // two snoozes due (snoozeUntil in the past), read then flipped in one batch
      [{ id: 'sug-1', snoozeUntil: '2026-09-18T19:00:00Z' }, { id: 'sug-2', snoozeUntil: '2026-09-18T19:00:00Z' }],
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z') })

    expect(summary.looked).toBe(0)
    expect(summary.resurfaced).toBe(2)
    const back = updates.find(u => u.table === schema.taskSuggestions)
    expect((back!.set as { status: string }).status).toBe('pending')
  })

  it('carries the target request through to the row it writes, on the call org', async () => {
    const handOff = vi.fn(async () => ({
      suggestions: [{
        kind: 'hand_off_request' as const,
        targetTaskId: null,
        targetRequestId: 'req-1',
        proposal: { contactName: 'Ella Brown', contactId: 'con-1', reason: 'content' },
        quote: 'We also need a new FAQ section on the pricing page before the launch.',
        rationale: null,
        confidence: 0.8,
      }],
      usage: { model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 0 },
      dropped: [],
    }))

    const { handle } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: 'org-a', meetingType: null }],
      ...contextSelects(),
      [],                                   // insertSuggestions: no existing keys
      [],                                   // resurfaceSnoozed
      [],                                   // repair: nothing orgless
    ])

    await runSuggestionSweep(handle, { suggest: handOff, now: new Date('2026-09-19T00:00:00Z') })

    const { insertSuggestions } = await import('@/lib/task-suggestions')
    const drafts = vi.mocked(insertSuggestions).mock.calls.at(-1)?.[1]
    expect(drafts?.[0]).toMatchObject({
      kind: 'hand_off_request',
      orgId: 'org-a',
      targetRequestId: 'req-1',
      targetTaskId: null,
    })
  })

  it('drops a create this client already has waiting, and says so in the run log', async () => {
    const { handle, inserts } = makeDb([
      [TRANSCRIPT_ROW],
      [{ orgId: 'org-9', meetingType: 'client', dealId: null, attendees: '[]' }],
      ...contextSelects(),
      // One pending create suggestion for this client, from an earlier call,
      // saying the same thing in different words.
      [{ id: 'sug-9', orgId: 'org-9', kind: 'create_task', status: 'pending', proposal: JSON.stringify({ title: 'FAQ section on the pricing page' }), dedupeKey: 'zzz' }],
      [],                                   // resurfaceSnoozed
      [],                                   // repair: nothing orgless
    ])

    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, now: new Date('2026-09-19T00:00:00Z'), secondPass: false })

    expect(summary.inserted).toBe(0)
    expect(summary.dropReasons.similar_pending).toBe(1)
    // The model's own drop plus this one: "proposed but not kept" is one number.
    expect(summary.dropped).toBe(2)
    expect(inserts.find(i => i.table === schema.taskSuggestions)).toBeUndefined()
  })
})

// ── The manual cutover pass ──────────────────────────────────────────────────
// The GitHub job keeps the default of five. A human draining a backlog of
// eight calls in one go passes ?limit=20, and nothing beyond twenty, because
// one run is one model bill and an unbounded one is an unbounded bill.

describe('parseSweepLimit', () => {
  it('falls back to the cron default when nothing was asked for', () => {
    expect(parseSweepLimit(null)).toBe(SWEEP_BATCH)
    expect(parseSweepLimit('')).toBe(SWEEP_BATCH)
    expect(parseSweepLimit('not a number')).toBe(SWEEP_BATCH)
  })

  it('takes a number a human typed', () => {
    expect(parseSweepLimit('8')).toBe(8)
    expect(parseSweepLimit('20')).toBe(MAX_SWEEP_BATCH)
  })

  it('clamps both ends rather than refusing', () => {
    expect(parseSweepLimit('0')).toBe(1)
    expect(parseSweepLimit('-4')).toBe(1)
    expect(parseSweepLimit('500')).toBe(MAX_SWEEP_BATCH)
    expect(parseSweepLimit('7.9')).toBe(7)
  })
})

// ── The second read and the union (CN.1c) ────────────────────────────────────
// Sonnet 5 refuses a temperature, so one read of a call is one sample: the
// same three Elevate calls gave five items and then none. Two things follow.
// Each call is read twice, the second time with the first read shown and the
// question "anything missed?". And a read never takes anything away: what
// earlier reads left on file stays, and the writer files only what is new.

const FAQ: SuggestionDraft = {
  kind: 'create_task',
  targetTaskId: null,
  targetRequestId: null,
  proposal: { title: 'Add an FAQ section to the pricing page' },
  quote: 'We also need a new FAQ section on the pricing page before the launch.',
  rationale: null,
  confidence: 0.8,
}

const MOVE_EMAIL: SuggestionDraft = {
  kind: 'update_task',
  targetTaskId: 'task-2',
  targetRequestId: null,
  proposal: { fields: { dueDate: '2026-09-25' } },
  quote: 'I will get the launch email moved to the twenty fifth.',
  rationale: null,
  confidence: 0.7,
}

/** The same FAQ item in the second read's own words. */
const FAQ_REWORDED: SuggestionDraft = {
  ...FAQ,
  proposal: { title: 'Add a FAQ section to the pricing page' },
  quote: 'We also need a new FAQ section on the pricing page',
}

const USAGE = { model: 'claude-sonnet-5', inputTokens: 4000, outputTokens: 500 }

/** A model stand-in that answers the first read and the second differently. */
function twoReads(first: SuggestionDraft[], second: SuggestionDraft[] | Error) {
  return vi.fn(async (input: SuggestFromTranscriptInput) => {
    if (input.alreadyProposed === undefined) return { suggestions: first, usage: USAGE, dropped: [] }
    if (second instanceof Error) throw second
    return { suggestions: second, usage: USAGE, dropped: [] }
  })
}

/** Every select a sweep over one client transcript makes, in order. */
function oneClientTranscript(onFile: unknown[] = []) {
  return [
    [TRANSCRIPT_ROW],
    [{ orgId: 'org-a', meetingType: null }],
    ...contextSelects(),
    onFile,                               // insertSuggestions: keys, pending creates, rows on file
    [],                                   // resurfaceSnoozed
    [],                                   // repair: nothing orgless
  ]
}

const NOW_CN1C = new Date('2026-09-19T00:00:00Z')

async function lastDrafts() {
  const { insertSuggestions } = await import('@/lib/task-suggestions')
  return vi.mocked(insertSuggestions).mock.calls.at(-1)?.[1] ?? []
}

describe('parseSecondPass', () => {
  it('is on when the query says nothing', () => {
    expect(parseSecondPass(null)).toBe(true)
    expect(parseSecondPass('')).toBe(true)
  })

  it('is off for the four words that mean off, in any case', () => {
    for (const off of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) expect(parseSecondPass(off)).toBe(false)
  })

  it('stays on for anything it does not recognise', () => {
    expect(parseSecondPass('1')).toBe(true)
    expect(parseSecondPass('maybe')).toBe(true)
  })
})

describe('buildSecondReadMessage', () => {
  it('lists every item of the first read with its kind, target and quote', () => {
    const message = buildSecondReadMessage([FAQ, MOVE_EMAIL], 10)
    expect(message).toContain('ALREADY PROPOSED FROM THIS CALL')
    expect(message).toContain('1. create_task | "Add an FAQ section to the pricing page"')
    expect(message).toContain('2. update_task on task-2 | changes dueDate')
    expect(message).toContain(`quote "${FAQ.quote}"`)
    expect(message).toContain('At most 10 new items')
  })

  it('asks again when the first read found nothing, which is when it helps most', () => {
    const message = buildSecondReadMessage([], 12)
    expect(message).toContain('An earlier read of these same notes proposed no items.')
    expect(message).toContain('propose only what the earlier read missed')
  })

  it('tells the model not to hand the list back in new words', () => {
    expect(buildSecondReadMessage([FAQ], 1)).toContain('Never repeat, reword, merge or split an item above.')
    expect(buildSecondReadMessage([FAQ], 1)).toContain('At most 1 new item.')
  })

  it('carries no dash of any kind into the prompt', () => {
    // Built from code points, so this file never holds the glyphs it checks for.
    const message = buildSecondReadMessage([FAQ, MOVE_EMAIL], 3)
    for (const dash of [0x2013, 0x2014]) expect(message).not.toContain(String.fromCharCode(dash))
  })
})

describe('mergeSecondRead', () => {
  it('adds only what the first read did not have, and counts the repeat', () => {
    const merged = mergeSecondRead([FAQ], { suggestions: [FAQ_REWORDED, MOVE_EMAIL], dropped: [] }, 11)
    expect(merged.added).toEqual([MOVE_EMAIL])
    expect(merged.dropped.map(d => d.reason)).toEqual(['second_read_repeat'])
  })

  it('drops an item the second read repeats within itself', () => {
    const merged = mergeSecondRead([], {
      suggestions: [MOVE_EMAIL, { ...MOVE_EMAIL, proposal: { fields: { dueDate: '2026-09-26' } } }],
      dropped: [],
    }, 12)
    expect(merged.added).toEqual([MOVE_EMAIL])
    expect(merged.dropped.map(d => d.reason)).toEqual(['second_read_repeat'])
  })

  it('keeps the two reads inside the ceiling one read has', () => {
    const merged = mergeSecondRead([FAQ], {
      suggestions: [MOVE_EMAIL, { ...MOVE_EMAIL, kind: 'note', proposal: { body: 'The launch email moves to the twenty fifth.' } }],
      dropped: [],
    }, 1)
    expect(merged.added).toEqual([MOVE_EMAIL])
    expect(merged.dropped.map(d => d.reason)).toEqual(['over_limit'])
  })

  it('carries the second read\'s own validation drops through', () => {
    const merged = mergeSecondRead([], { suggestions: [], dropped: [{ reason: 'quote_not_in_source', raw: {} }] }, 12)
    expect(merged.dropped).toEqual([{ reason: 'quote_not_in_source', raw: {} }])
  })
})

describe('runSuggestionSweep reads every call twice', () => {
  it('shows the second read the first, and hands the writer the union of the two', async () => {
    const suggest = twoReads([FAQ], [FAQ_REWORDED, MOVE_EMAIL])
    const { handle, inserts } = makeDb(oneClientTranscript())

    const summary = await runSuggestionSweep(handle, { suggest, now: NOW_CN1C })

    expect(suggest).toHaveBeenCalledTimes(2)
    const [first, second] = suggest.mock.calls.map(call => call[0])
    // The notes are cached on the first read because a second read follows.
    expect(first).toMatchObject({ cacheSource: true })
    expect(first.alreadyProposed).toBeUndefined()
    expect(second).toMatchObject({ cacheSource: true, alreadyProposed: [FAQ], maxNew: MAX_SUGGESTIONS - 1 })
    expect(second.transcript).toBe(first.transcript)
    expect(second.context).toBe(first.context)

    expect(await lastDrafts()).toMatchObject([
      { kind: 'create_task', proposal: { title: 'Add an FAQ section to the pricing page' } },
      { kind: 'update_task', targetTaskId: 'task-2' },
    ])
    expect(summary.inserted).toBe(2)
    expect(summary.secondPass).toEqual({ enabled: true, ran: 1, proposed: 1, failed: [] })
    expect(summary.dropReasons.second_read_repeat).toBe(1)

    // Each read is its own line in the spend log.
    const stages = inserts
      .filter(i => i.table === schema.aiCostLog)
      .map(i => (i.values as { stage: string }).stage)
    expect(stages).toEqual(['suggest', 'second_pass'])
  })

  it('gives an empty first read a second, independent chance', async () => {
    const suggest = twoReads([], [MOVE_EMAIL])
    const { handle } = makeDb(oneClientTranscript())

    const summary = await runSuggestionSweep(handle, { suggest, now: NOW_CN1C })

    expect(suggest.mock.calls[1][0].alreadyProposed).toEqual([])
    expect(summary.inserted).toBe(1)
    expect(summary.secondPass?.proposed).toBe(1)
  })

  it('writes the first read when the second one throws, and says so', async () => {
    const suggest = twoReads([FAQ], new Error('529 overloaded'))
    const { handle, updates } = makeDb(oneClientTranscript())

    const summary = await runSuggestionSweep(handle, { suggest, now: NOW_CN1C })

    expect(summary.inserted).toBe(1)
    expect(summary.skipped).toEqual([])
    expect(summary.secondPass?.failed).toEqual([{ transcriptId: 'ct-1', reason: 'suggester_failed: 529 overloaded' }])
    expect(updates.find(u => u.table === schema.callTranscripts)).toBeTruthy()
  })

  it('reads once, uncached, when the caller switches the second read off', async () => {
    const suggest = twoReads([FAQ], [MOVE_EMAIL])
    const { handle } = makeDb(oneClientTranscript())

    const summary = await runSuggestionSweep(handle, { suggest, now: NOW_CN1C, secondPass: false })

    expect(suggest).toHaveBeenCalledTimes(1)
    expect(suggest.mock.calls[0][0].cacheSource).toBeUndefined()
    expect(summary.inserted).toBe(1)
    expect(summary.secondPass).toEqual({ enabled: false, ran: 0, proposed: 0, failed: [] })
  })

  it('skips the second read when the first already filled the ceiling', async () => {
    const full = Array.from({ length: MAX_SUGGESTIONS }, (_, i) => ({
      ...FAQ,
      proposal: { title: `Distinct piece of work number ${i} for the launch` },
    }))
    const suggest = twoReads(full, [MOVE_EMAIL])
    const { handle } = makeDb(oneClientTranscript())

    const summary = await runSuggestionSweep(handle, { suggest, now: NOW_CN1C })

    expect(suggest).toHaveBeenCalledTimes(1)
    expect(summary.secondPass?.ran).toBe(0)
  })
})

describe('runSuggestionSweep over a transcript read before', () => {
  // What an earlier read left for ct-1: a pending create, a snoozed note and
  // a rejected update, as insertSuggestions reads them back.
  const EARLIER = [
    { id: 'sug-pending', orgId: 'org-a', transcriptId: 'ct-1', kind: 'create_task', targetTaskId: null, targetRequestId: null, status: 'pending', proposal: JSON.stringify({ title: 'Add an FAQ section to the pricing page' }), dedupeKey: 'k-pending' },
    { id: 'sug-snoozed', orgId: 'org-a', transcriptId: 'ct-1', kind: 'note', targetTaskId: 'task-1', targetRequestId: null, status: 'snoozed', proposal: JSON.stringify({ body: 'The pricing page rebuild is live.' }), dedupeKey: 'k-snoozed' },
    { id: 'sug-rejected', orgId: 'org-a', transcriptId: 'ct-1', kind: 'update_task', targetTaskId: 'task-2', targetRequestId: null, status: 'rejected', proposal: JSON.stringify({ fields: { dueDate: '2026-09-24' } }), dedupeKey: 'k-rejected' },
  ]

  it('leaves every row an earlier read filed alone when the new read omits them', async () => {
    const newItem: SuggestionDraft = {
      kind: 'add_subtasks',
      targetTaskId: 'task-1',
      targetRequestId: null,
      proposal: { subtasks: ['Write the FAQ answers'] },
      quote: 'We also need a new FAQ section on the pricing page before the launch.',
      rationale: null,
      confidence: 0.6,
    }
    const { handle, inserts, updates } = makeDb(oneClientTranscript(EARLIER))

    const summary = await runSuggestionSweep(handle, { suggest: twoReads([newItem], []), now: NOW_CN1C })

    // Nothing expired, nothing rewritten: the only write to the table is the new row.
    expect(updates.filter(u => u.table === schema.taskSuggestions)).toEqual([])
    const written = inserts.filter(i => i.table === schema.taskSuggestions)
    expect(written).toHaveLength(1)
    expect(written[0].values).toMatchObject({ kind: 'add_subtasks', status: 'pending' })
    expect(summary.inserted).toBe(1)
  })

  it('files nothing a new read proposes again in other words, pending, snoozed or decided', async () => {
    const again: SuggestionDraft[] = [
      FAQ_REWORDED,
      {
        ...MOVE_EMAIL,
        kind: 'note',
        targetTaskId: 'task-1',
        proposal: { body: 'The pricing page rebuild is live now.' },
        quote: 'the pricing page rebuild is finished and live as of this morning.',
      },
      MOVE_EMAIL,
    ]
    const { handle, inserts, updates } = makeDb(oneClientTranscript(EARLIER))

    const summary = await runSuggestionSweep(handle, { suggest: twoReads(again, []), now: NOW_CN1C })

    expect(summary.inserted).toBe(0)
    // The reworded create meets the pending one in the CN.1d guard first
    // (same client, still waiting); the note repeats the snoozed row and the
    // update the rejected one, which only the transcript's own record sees.
    expect(summary.dropReasons.similar_pending).toBe(1)
    expect(summary.duplicates).toBe(2)
    expect(inserts.filter(i => i.table === schema.taskSuggestions)).toEqual([])
    expect(updates.filter(u => u.table === schema.taskSuggestions)).toEqual([])
  })

  it('lets an item an expired row held come back', async () => {
    const expired = [{ ...EARLIER[0], id: 'sug-expired', status: 'expired', dedupeKey: 'expired:sug-expired' }]
    const { handle } = makeDb(oneClientTranscript(expired))

    const summary = await runSuggestionSweep(handle, { suggest: twoReads([FAQ], []), now: NOW_CN1C })

    expect(summary.inserted).toBe(1)
    expect(summary.duplicates).toBe(0)
  })
})

describe('runSuggestionSweep over named transcripts', () => {
  it('reads nothing at all when asked for no transcript by name', async () => {
    const { handle, selects } = makeDb([[TRANSCRIPT_ROW]])
    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, transcriptIds: [] })
    expect(selects).toHaveLength(0)
    expect(summary.looked).toBe(0)
    expect(okSuggest).not.toHaveBeenCalled()
  })

  it('reads the named transcripts, as many as were named', async () => {
    const { handle, selects } = makeDb(oneClientTranscript())
    const summary = await runSuggestionSweep(handle, { suggest: okSuggest, transcriptIds: ['ct-1', 'ct-9', 'ct-1'], now: NOW_CN1C })

    expect(summary.looked).toBe(1)
    const read = selects[0]
    expect(read.args[read.methods.indexOf('limit') - 1]).toEqual([2])
  })
})

describe('suggestFromTranscript, the request each read sends', () => {
  const INPUT: SuggestFromTranscriptInput = {
    transcript: TRANSCRIPT,
    wrapUp: null,
    callTitle: 'Check-in',
    callDate: '2026-09-19',
    context: CONTEXT,
  }

  beforeEach(() => {
    sdk.calls.length = 0
    sdk.reply = [
      'One more thing came up.',
      '<suggestions>[',
      '{"kind":"update_task","targetTaskId":"task-2","proposal":{"fields":{"dueDate":"2026-09-25"}},"quote":"I will get the launch email moved to the twenty fifth.","confidence":0.7},',
      '{"kind":"note","targetTaskId":"task-1","proposal":{"body":"x"},"quote":"nobody said this"}',
      ']</suggestions>',
    ].join('\n')
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  })

  afterEach(() => { vi.unstubAllEnvs() })

  type Block = { type: string; text: string; cache_control?: { type: string } }
  const userContent = (index: number) => (sdk.calls[index].messages as Array<{ content: string | Block[] }>)[0].content

  it('sends the notes as plain text when no second read follows', async () => {
    await suggestFromTranscript(INPUT)
    expect(typeof userContent(0)).toBe('string')
  })

  it('caches the notes on both reads and asks the question after them', async () => {
    await suggestFromTranscript({ ...INPUT, cacheSource: true })
    const result = await suggestFromTranscript({ ...INPUT, alreadyProposed: [FAQ], maxNew: 11 })

    const first = userContent(0) as Block[]
    const second = userContent(1) as Block[]
    expect(first).toHaveLength(1)
    expect(first[0].cache_control).toEqual({ type: 'ephemeral' })
    // Byte for byte the same notes, which is what lets the second read hit the cache.
    expect(second[0]).toEqual(first[0])
    expect(second[1].cache_control).toBeUndefined()
    expect(second[1].text).toContain('ALREADY PROPOSED FROM THIS CALL')
    expect(second[1].text).toContain('At most 11 new items')
    // The system prompt is the same cached block on every read.
    expect(sdk.calls[1].system).toEqual(sdk.calls[0].system)

    // The second read's answer is validated like any read's.
    expect(result.suggestions.map(s => s.kind)).toEqual(['update_task'])
    expect(result.dropped.map(d => d.reason)).toEqual(['quote_not_in_source'])
    expect(result.usage.inputTokens).toBe(4300)
  })
})
