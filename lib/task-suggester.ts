/**
 * lib/task-suggester.ts
 *
 * The half of "call notes to tasks" that reads a transcript and proposes work.
 * It never writes a task. It writes task_suggestions rows, and a human presses
 * a button.
 *
 * That restraint is the product. A suggester that is usually right is worse
 * than useless if a reader cannot tell which items are the right ones at a
 * glance, so the only currency here is the verbatim quote: every suggestion
 * carries the words it rests on, and anything whose quote cannot be found in
 * the transcript or the wrap up is dropped before it reaches the table. Four
 * more rules follow from the same idea and are enforced twice, once in the
 * system prompt and once in `validateSuggestionItems`, because a prompt is a
 * request and validation is a guarantee:
 *
 *   * an update or a completion or a note must name a task the model was
 *     actually shown, never an id it composed
 *   * a completion only when the call says the thing is done
 *   * a create needs a real title, not "FAQ"
 *   * twelve items is the ceiling, because a list nobody reads to the end is
 *     a list that gets approved without being read
 *
 * Owners, dates and hours are never invented: the model gives a NAME and
 * `resolveByName` turns it into an id only when exactly one person matches.
 *
 * The cron body lives here rather than in the route because a route.ts may
 * only export HTTP handlers, and a scheduled job that spends money and cannot
 * be unit tested is a scheduled job that quietly bills for nothing.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { SONNET_MODEL } from '@/lib/ai-models'
import { recordCost } from '@/lib/ai-cost'
import { resolveByName } from '@/lib/task-wizard-drafts'
import { insertSuggestions, resurfaceSnoozed, type SuggestionKind } from '@/lib/task-suggestions'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Caps and windows ─────────────────────────────────────────────────────────

/** Open work plus anything finished recently, so a completion can still be
 *  proposed for a task that was closed between the call and the sweep. */
export const CONTEXT_TASK_LIMIT = 80
export const CONTEXT_REQUEST_LIMIT = 40
export const CONTEXT_MEMBER_LIMIT = 40

/** More than this and the reviewer stops reading, which is the one failure
 *  this whole feature exists to avoid. */
export const MAX_SUGGESTIONS = 12

/** How far back the sweep will look for a transcript nobody has read yet.
 *  Older than this and the call has moved on without us. */
export const SWEEP_WINDOW_DAYS = 30

/** Transcripts per run. The cron fires every thirty minutes, so a backlog
 *  drains in hours, and one bad batch costs five calls rather than fifty. */
export const SWEEP_BATCH = 5

const TASK_ACTIVITY_DAYS = 60
const TASK_DONE_DAYS = 14
const MAX_OUTPUT_TOKENS = 3000
const MAX_TRANSCRIPT_CHARS = 60_000

/** The words that let a completion through. A call that says "I will finish
 *  it tonight" is a promise, not a completion, and the target task stays open
 *  until someone says otherwise. */
export const COMPLETION_WORDS = ['done', 'finished', 'completed', 'complete', 'shipped', 'live', 'sent', 'delivered'] as const

const KINDS: readonly SuggestionKind[] = ['create_task', 'update_task', 'complete_task', 'add_subtasks', 'note']

// ── Types ────────────────────────────────────────────────────────────────────

export interface SuggestionContextTask {
  id: string
  title: string
  status: string
  assigneeName: string | null
  dueDate: string | null
  updatedAt: string
}

export interface SuggestionContextRequest {
  id: string
  number: number | null
  title: string
  status: string
}

export interface SuggestionContextMember {
  id: string
  name: string
}

export interface SuggestionContext {
  tasks: SuggestionContextTask[]
  requests: SuggestionContextRequest[]
  members: SuggestionContextMember[]
}

export interface SuggestionDraft {
  kind: SuggestionKind
  targetTaskId: string | null
  proposal: Record<string, unknown>
  quote: string
  rationale: string | null
  confidence: number | null
}

export interface DroppedSuggestion {
  reason: string
  raw: unknown
}

export interface SuggesterUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface SuggestResult {
  suggestions: SuggestionDraft[]
  usage: SuggesterUsage
  dropped: DroppedSuggestion[]
  /** True only for the non-production fallback. Never set on a model answer. */
  degraded?: true
}

export interface SuggestFromTranscriptInput {
  transcript: string
  wrapUp: string | null
  callTitle: string | null
  callDate: string | null
  context: SuggestionContext
}

export type SuggestFn = (input: SuggestFromTranscriptInput) => Promise<SuggestResult>

/** Thrown when there is no way to reach the model and no honest fallback.
 *  Production never degrades: an empty inbox is readable, an invented one is
 *  not. */
export class SuggesterUnavailableError extends Error {
  constructor(message = 'The suggester could not reach the model.') {
    super(message)
    this.name = 'SuggesterUnavailableError'
  }
}

// ── Small helpers ────────────────────────────────────────────────────────────

function iso(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function daysBefore(at: Date, days: number): string {
  return iso(new Date(at.getTime() - days * 86_400_000))
}

/** Case folded and whitespace collapsed. A model that reflows a line while
 *  copying it is still quoting; a model that paraphrases it is not. */
function fold(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function suggestionContextWindows(at: Date): { updatedSince: string; doneSince: string } {
  return {
    updatedSince: daysBefore(at, TASK_ACTIVITY_DAYS),
    doneSince: daysBefore(at, TASK_DONE_DAYS),
  }
}

// ── The context ──────────────────────────────────────────────────────────────

/**
 * What the model is allowed to know: this client's live work, its open
 * requests, and the studio roster by name.
 *
 * A null org is studio housekeeping, the same shape a tahi_internal task with
 * no client is, and it deliberately reads no requests: a request always
 * belongs to a client, so there is nothing there to name.
 */
export async function buildSuggestionContext(
  database: Drizzle,
  orgId: string | null,
  at: Date = new Date(),
): Promise<SuggestionContext> {
  const { updatedSince, doneSince } = suggestionContextWindows(at)

  const memberRows = await database
    .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
    .from(schema.teamMembers)
    .orderBy(asc(schema.teamMembers.name))
    .limit(CONTEXT_MEMBER_LIMIT)

  const members: SuggestionContextMember[] = memberRows.map(m => ({ id: m.id, name: m.name }))
  const memberName = new Map(members.map(m => [m.id, m.name]))

  const liveOrRecentlyDone = or(
    ne(schema.tasks.status, 'done'),
    gte(schema.tasks.completedAt, doneSince),
  )

  const taskRows = await database
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      status: schema.tasks.status,
      assigneeId: schema.tasks.assigneeId,
      dueDate: schema.tasks.dueDate,
      updatedAt: schema.tasks.updatedAt,
    })
    .from(schema.tasks)
    .where(and(
      orgId ? eq(schema.tasks.orgId, orgId) : isNull(schema.tasks.orgId),
      gte(schema.tasks.updatedAt, updatedSince),
      liveOrRecentlyDone,
    ))
    .orderBy(desc(schema.tasks.updatedAt))
    .limit(CONTEXT_TASK_LIMIT)

  const tasks: SuggestionContextTask[] = taskRows.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assigneeName: t.assigneeId ? memberName.get(t.assigneeId) ?? null : null,
    dueDate: t.dueDate ?? null,
    updatedAt: t.updatedAt,
  }))

  if (!orgId) return { tasks, requests: [], members }

  const requestRows = await database
    .select({
      id: schema.requests.id,
      requestNumber: schema.requests.requestNumber,
      title: schema.requests.title,
      status: schema.requests.status,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, orgId),
      ne(schema.requests.status, 'delivered'),
      ne(schema.requests.status, 'archived'),
      ne(schema.requests.status, 'draft'),
    ))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(CONTEXT_REQUEST_LIMIT)

  const requests: SuggestionContextRequest[] = requestRows.map(r => ({
    id: r.id,
    number: r.requestNumber ?? null,
    title: r.title,
    status: r.status,
  }))

  return { tasks, requests, members }
}

// ── The parser ───────────────────────────────────────────────────────────────

/**
 * Free text, then one `<suggestions>[ ... ]</suggestions>` block.
 *
 * Same shape the two AI wizards already use, for the same reason: a model
 * writes better JSON when it is allowed to think out loud first. A block that
 * will not parse yields no items at all rather than a partial array, because
 * half a suggestion is a suggestion nobody said.
 */
export function parseSuggestionsBlock(text: string): { reply: string; items: unknown[] } {
  const match = text.match(/<suggestions>([\s\S]*?)<\/suggestions>/)
  if (!match) return { reply: text.trim(), items: [] }

  const reply = text.slice(0, text.indexOf('<suggestions>')).trim()

  try {
    const parsed: unknown = JSON.parse(match[1].trim())
    return { reply, items: Array.isArray(parsed) ? parsed : [] }
  } catch {
    return { reply, items: [] }
  }
}

// ── The validation ───────────────────────────────────────────────────────────

/**
 * Everything the prompt asked for, checked rather than trusted.
 *
 * Every rejection is returned with the raw item, so the cron summary can say
 * how many the model lost and a human can see the pattern instead of guessing
 * why the inbox is thinner than the call felt.
 */
export function validateSuggestionItems(
  items: readonly unknown[],
  opts: { source: string; context: SuggestionContext },
): { suggestions: SuggestionDraft[]; dropped: DroppedSuggestion[] } {
  const haystack = fold(opts.source)
  const knownTasks = new Set(opts.context.tasks.map(t => t.id))
  const suggestions: SuggestionDraft[] = []
  const dropped: DroppedSuggestion[] = []

  for (const raw of items) {
    if (suggestions.length >= MAX_SUGGESTIONS) {
      dropped.push({ reason: 'over_limit', raw })
      continue
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      dropped.push({ reason: 'not_an_object', raw })
      continue
    }
    const item = raw as Record<string, unknown>

    const kind = asString(item.kind) as SuggestionKind | null
    if (!kind || !KINDS.includes(kind)) {
      dropped.push({ reason: 'unknown_kind', raw })
      continue
    }

    const quote = asString(item.quote)
    if (!quote) {
      dropped.push({ reason: 'missing_quote', raw })
      continue
    }
    if (!haystack.includes(fold(quote))) {
      dropped.push({ reason: 'quote_not_in_source', raw })
      continue
    }

    const proposalRaw = item.proposal
    if (!proposalRaw || typeof proposalRaw !== 'object' || Array.isArray(proposalRaw)) {
      dropped.push({ reason: 'missing_proposal', raw })
      continue
    }
    const proposal = { ...(proposalRaw as Record<string, unknown>) }

    const targetTaskId = asString(item.targetTaskId)
    if (kind !== 'create_task') {
      if (!targetTaskId) {
        dropped.push({ reason: 'missing_target_task', raw })
        continue
      }
      if (!knownTasks.has(targetTaskId)) {
        dropped.push({ reason: 'unknown_target_task', raw })
        continue
      }
    }

    if (kind === 'complete_task' && !saysComplete(quote)) {
      dropped.push({ reason: 'completion_without_completion_word', raw })
      continue
    }

    if (kind === 'create_task') {
      const title = asString(proposal.title)
      if (!title || title.length < 4) {
        dropped.push({ reason: 'title_too_short', raw })
        continue
      }
      proposal.title = title
      // A NAME resolves to an id only when exactly one person matches. An
      // ambiguous or unknown name stays a name, and the reviewer picks.
      const assigneeName = asString(proposal.assigneeName)
      proposal.assigneeName = assigneeName
      proposal.assigneeId = resolveByName(assigneeName, opts.context.members)
    }

    if (kind === 'add_subtasks') {
      const subtasks = Array.isArray(proposal.subtasks)
        ? proposal.subtasks.map(asString).filter((s): s is string => s !== null)
        : []
      if (subtasks.length === 0) {
        dropped.push({ reason: 'no_subtasks', raw })
        continue
      }
      proposal.subtasks = subtasks
    }

    if (kind === 'note' && !asString(proposal.body)) {
      dropped.push({ reason: 'empty_note', raw })
      continue
    }

    suggestions.push({
      kind,
      targetTaskId: kind === 'create_task' ? null : targetTaskId,
      proposal,
      quote,
      rationale: asString(item.rationale),
      confidence: typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : null,
    })
  }

  return { suggestions, dropped }
}

function saysComplete(quote: string): boolean {
  const folded = fold(quote)
  return COMPLETION_WORDS.some(word => new RegExp(`\\b${word}\\b`).test(folded))
}

// ── The prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You read the notes from one call and propose changes to the studio's task list. You never make a change yourself. A person reads every item you write and presses a button, so your job is to be checkable, not to be comprehensive.

Rules, in order of importance:
1. Only what was said on this call. If it was not said, it does not exist.
2. Every item carries a quote: the exact words from the transcript or the wrap up, copied character for character. An item without a usable quote is thrown away before anyone sees it.
3. An update, a completion, a subtask list or a note must name a task from the TASKS list you were given, by its id. Never compose an id.
4. Propose a completion only when the call says the thing is done. "I will finish it tonight" is a promise, not a completion.
5. Never invent an owner, a date or an estimate. If a person was named, put the NAME in assigneeName and leave assigneeId out. If no date was said, leave dueDate out.
6. At most 12 items. Fewer good ones beat more.

Write in the studio's voice: plain sentences, no dashes of any kind, no exclamation marks, no filler.

Kinds and their proposal shapes:
- create_task: { "title": string, "description": string, "type": "client_task" | "internal_client_task" | "tahi_internal", "orgId": string | null, "requestId": string | null, "assigneeName": string | null, "dueDate": "YYYY-MM-DD" | null, "estimatedHours": number | null, "priority": "standard" | "high" | "urgent", "subtasks": string[] }
- update_task: { "fields": { "title"?, "description"?, "status"?, "priority"?, "dueDate"?, "estimatedHours"? }, "note"?: string }
- complete_task: { "note"?: string }
- add_subtasks: { "subtasks": string[] }
- note: { "body": string }

Answer with a short sentence saying what the call was about, then one block exactly like this at the end:

<suggestions>[{"kind":"create_task","proposal":{...},"quote":"...","rationale":"one sentence","confidence":0.8}]</suggestions>

Use "targetTaskId" alongside "kind" for every kind except create_task. If nothing actionable was said, write the sentence and an empty array.`

function buildUserMessage(input: SuggestFromTranscriptInput): string {
  const parts: string[] = []
  parts.push(`CALL: ${input.callTitle ?? 'Untitled call'}${input.callDate ? ` (${input.callDate})` : ''}`)

  if (input.context.tasks.length > 0) {
    parts.push(['TASKS (the only ids you may name):', ...input.context.tasks.map(t =>
      `- ${t.id} | ${t.title} | status ${t.status}${t.assigneeName ? ` | ${t.assigneeName}` : ''}${t.dueDate ? ` | due ${t.dueDate}` : ''}`,
    )].join('\n'))
  } else {
    parts.push('TASKS: none open for this client.')
  }

  if (input.context.requests.length > 0) {
    parts.push(['REQUESTS:', ...input.context.requests.map(r =>
      `- ${r.id} | #${r.number ?? '?'} ${r.title} | status ${r.status}`,
    )].join('\n'))
  }

  if (input.context.members.length > 0) {
    parts.push(`PEOPLE (names only): ${input.context.members.map(m => m.name).join(', ')}`)
  }

  if (input.wrapUp) {
    parts.push(`WRAP UP:\n${input.wrapUp.slice(0, MAX_TRANSCRIPT_CHARS)}`)
  }

  parts.push(`TRANSCRIPT:\n${input.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`)
  return parts.join('\n\n')
}

// ── The model call ───────────────────────────────────────────────────────────

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
  usage?: AnthropicUsage
}

/**
 * Sonnet, once, over one call.
 *
 * The system prompt is a cached block: it is long, it never changes, and the
 * sweep sends it five times an hour. The transcript itself is never cached,
 * because every call is a new one.
 */
export async function suggestFromTranscript(input: SuggestFromTranscriptInput): Promise<SuggestResult> {
  const source = `${input.transcript}\n${input.wrapUp ?? ''}`

  if (!process.env.ANTHROPIC_API_KEY) {
    // Production never degrades. An inbox that says nothing arrived is
    // readable; one full of keyword guesses that look exactly like model
    // output is not, and the operator would have no way to tell them apart.
    if (process.env.NODE_ENV === 'production') throw new SuggesterUnavailableError()
    return deterministicFallback(input, source)
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  }) as unknown as AnthropicResponse

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')

  const { items } = parseSuggestionsBlock(text)
  const { suggestions, dropped } = validateSuggestionItems(items, { source, context: input.context })

  const usage = response.usage
  return {
    suggestions,
    dropped,
    usage: {
      model: SONNET_MODEL,
      inputTokens: (usage?.input_tokens ?? 0)
        + (usage?.cache_read_input_tokens ?? 0)
        + (usage?.cache_creation_input_tokens ?? 0),
      outputTokens: usage?.output_tokens ?? 0,
    },
  }
}

/**
 * The non-production stand in: lines that read like a next step become create
 * suggestions, quoting themselves.
 *
 * It goes through exactly the same validation as a model answer, so a
 * developer working without a key sees the real shape of the inbox rather than
 * a looser one, and the result is flagged `degraded` so no surface can paint
 * it as a model answer.
 */
function deterministicFallback(input: SuggestFromTranscriptInput, source: string): SuggestResult {
  const signal = /\b(we need|i will|we should|can you|could you|next step|action item|please)\b/i
  const items = `${input.wrapUp ?? ''}\n${input.transcript}`
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 12 && signal.test(line))
    .slice(0, 3)
    .map(line => ({
      kind: 'create_task',
      proposal: {
        title: line.replace(/^[A-Za-z .'-]{1,40}:\s*/, '').slice(0, 120),
        description: `Proposed from "${input.callTitle ?? 'a call'}" without a model. Check it before approving.`,
        type: 'internal_client_task',
      },
      quote: line,
      rationale: 'Deterministic fallback, no model was reached.',
      confidence: 0.2,
    }))

  const { suggestions, dropped } = validateSuggestionItems(items, { source, context: input.context })
  return {
    suggestions,
    dropped,
    usage: { model: 'deterministic-fallback', inputTokens: 0, outputTokens: 0 },
    degraded: true,
  }
}

// ── The sweep ────────────────────────────────────────────────────────────────

export interface SweepSummary {
  looked: number
  eligible: number
  skipped: Array<{ transcriptId: string; reason: string }>
  inserted: number
  duplicates: number
  dropped: number
  resurfaced: number
  costCents: number
  /** Pending rows that had no org and gained one through the deal or attendee lookup. */
  repaired: number
}

export interface SweepOptions {
  now?: Date
  batch?: number
  windowDays?: number
  /** Injected in tests. Production always uses the real model call. */
  suggest?: SuggestFn
}

/**
 * One pass: read the oldest unread transcripts, gate them, suggest, stamp.
 *
 * The stamp is the load bearing part. It goes on every transcript the sweep
 * LOOKED at, including the ones the gate rejected and the ones the model threw
 * on, because `suggested_at IS NULL` has to keep meaning "never looked at". A
 * failure that leaves the column null is a transcript this job re-reads, and
 * re-pays for, every thirty minutes until somebody notices the bill.
 */
export async function runSuggestionSweep(
  database: Drizzle,
  options: SweepOptions = {},
): Promise<SweepSummary> {
  const at = options.now ?? new Date()
  const nowIso = iso(at)
  const suggest = options.suggest ?? suggestFromTranscript
  const since = daysBefore(at, options.windowDays ?? SWEEP_WINDOW_DAYS)

  const summary: SweepSummary = {
    looked: 0,
    eligible: 0,
    skipped: [],
    inserted: 0,
    duplicates: 0,
    dropped: 0,
    resurfaced: 0,
    costCents: 0,
    repaired: 0,
  }

  const transcripts = await database
    .select({
      id: schema.callTranscripts.id,
      callKind: schema.callTranscripts.callKind,
      callId: schema.callTranscripts.callId,
      title: schema.callTranscripts.title,
      receivedAt: schema.callTranscripts.receivedAt,
      text: schema.callTranscripts.text,
      wrapUp: schema.callTranscripts.wrapUp,
    })
    .from(schema.callTranscripts)
    .where(and(
      isNull(schema.callTranscripts.suggestedAt),
      isNotNull(schema.callTranscripts.callId),
      gte(schema.callTranscripts.receivedAt, since),
    ))
    .orderBy(asc(schema.callTranscripts.receivedAt))
    .limit(options.batch ?? SWEEP_BATCH)

  summary.looked = transcripts.length

  for (const transcript of transcripts) {
    const gate = await resolveCallGate(database, transcript.callKind, transcript.callId)

    if (!gate.eligible) {
      summary.skipped.push({ transcriptId: transcript.id, reason: gate.reason })
      await stamp(database, transcript.id, nowIso)
      continue
    }

    summary.eligible++

    let result: SuggestResult
    try {
      const context = await buildSuggestionContext(database, gate.orgId, at)
      result = await suggest({
        transcript: transcript.text,
        wrapUp: transcript.wrapUp,
        callTitle: transcript.title,
        callDate: transcript.receivedAt.slice(0, 10),
        context,
      })
    } catch (err) {
      // The summary has one slot for "this transcript produced nothing and
      // why", so a failure is reported there rather than in a field the
      // contract does not have. The stamp still goes on.
      const message = err instanceof Error ? err.message : String(err)
      summary.skipped.push({ transcriptId: transcript.id, reason: `suggester_failed: ${message}` })
      await stamp(database, transcript.id, nowIso)
      continue
    }

    summary.dropped += result.dropped.length

    if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
      // The same cast /clients/[id]/health-summary uses: recordCost is typed
      // against the schema-aware handle from lib/db, and withCronRun hands a
      // bare D1 one. Same object, narrower type.
      summary.costCents += await recordCost(database as unknown as Parameters<typeof recordCost>[0], {
        scope: 'call_suggestions',
        scopeId: transcript.id,
        stage: 'suggest',
        provider: 'anthropic',
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        note: transcript.title ?? undefined,
      })
    }

    const written = await insertSuggestions(database, result.suggestions.map(s => ({
      orgId: gate.orgId,
      sourceKind: 'call',
      transcriptId: transcript.id,
      callKind: transcript.callKind,
      callId: transcript.callId,
      kind: s.kind,
      targetTaskId: s.targetTaskId,
      proposal: s.proposal,
      quote: s.quote,
      rationale: s.rationale,
      confidence: s.confidence,
      approverType: 'founders',
    })))

    summary.inserted += written.inserted
    summary.duplicates += written.duplicates

    await stamp(database, transcript.id, nowIso)
  }

  summary.resurfaced = await resurfaceSnoozed(database, new Date(nowIso))
  summary.repaired = await repairOrglessSuggestions(database, nowIso)

  return summary
}

type Gate =
  | { eligible: true; orgId: string | null; orgVia: 'call' | 'deal' | 'attendees' | null }
  | { eligible: false; reason: string }

/** The attendee emails on a discovery call, lower-cased, studio addresses dropped. */
function attendeeEmails(attendees: string | null): string[] {
  if (!attendees) return []
  try {
    const parsed: unknown = JSON.parse(attendees)
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const a of parsed) {
      const email = a && typeof a === 'object' && typeof (a as { email?: unknown }).email === 'string'
        ? (a as { email: string }).email.trim().toLowerCase()
        : ''
      if (email && !email.endsWith('@tahi.studio')) out.add(email)
    }
    return [...out]
  } catch {
    return []
  }
}

/**
 * A discovery call the calendar sync labelled 'client' by its title usually
 * carries no org_id: the sync links a parent only when it can match a lead,
 * org or deal, and a client check-in matches none of those. The org is still
 * knowable: through the deal the call belongs to, or through the guests, who
 * are contacts at exactly one organisation. Either gives the suggester the
 * client's open tasks and gives every proposal a client to land on.
 */
async function resolveDiscoveryOrg(
  database: Drizzle,
  call: { orgId: string | null; dealId: string | null; attendees: string | null },
): Promise<{ orgId: string | null; via: 'call' | 'deal' | 'attendees' | null }> {
  if (call.orgId) return { orgId: call.orgId, via: 'call' }

  if (call.dealId) {
    const [deal] = await database
      .select({ orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(eq(schema.deals.id, call.dealId))
      .limit(1)
    if (deal?.orgId) return { orgId: deal.orgId, via: 'deal' }
  }

  const emails = attendeeEmails(call.attendees)
  if (emails.length > 0) {
    const rows = await database
      .select({ orgId: schema.contacts.orgId, email: schema.contacts.email })
      .from(schema.contacts)
      .where(inArray(sql`lower(${schema.contacts.email})`, emails))
    const orgs = new Set(rows.map(r => r.orgId).filter((v): v is string => typeof v === 'string' && v.length > 0))
    if (orgs.size === 1) return { orgId: [...orgs][0], via: 'attendees' }
  }

  return { orgId: null, via: null }
}

/**
 * The gate: a call has to belong to a client before its notes can propose
 * work.
 *
 * A discovery call qualifies on an org OR on meeting_type 'client', which is
 * how the calendar sync labels an existing-client check in that has not been
 * attached to an organisation yet. A sales call with neither is stamped and
 * left alone: there is no delivery to propose, and suggestions nobody can act
 * on are what makes an inbox stop being read.
 */
async function resolveCallGate(
  database: Drizzle,
  callKind: string | null,
  callId: string | null,
): Promise<Gate> {
  if (!callId) return { eligible: false, reason: 'unlinked' }

  if (callKind === 'scheduled') {
    const [call] = await database
      .select({ orgId: schema.scheduledCalls.orgId })
      .from(schema.scheduledCalls)
      .where(eq(schema.scheduledCalls.id, callId))
      .limit(1)
    if (!call) return { eligible: false, reason: 'call_not_found' }
    return { eligible: true, orgId: call.orgId, orgVia: call.orgId ? 'call' : null }
  }

  const [call] = await database
    .select({
      orgId: schema.discoveryCalls.orgId,
      meetingType: schema.discoveryCalls.meetingType,
      dealId: schema.discoveryCalls.dealId,
      attendees: schema.discoveryCalls.attendees,
    })
    .from(schema.discoveryCalls)
    .where(eq(schema.discoveryCalls.id, callId))
    .limit(1)

  if (!call) return { eligible: false, reason: 'call_not_found' }
  const resolved = await resolveDiscoveryOrg(database, {
    orgId: call.orgId,
    dealId: call.dealId ?? null,
    attendees: call.attendees ?? null,
  })
  if (resolved.orgId) return { eligible: true, orgId: resolved.orgId, orgVia: resolved.via }
  if (call.meetingType === 'client') return { eligible: true, orgId: null, orgVia: null }
  return { eligible: false, reason: 'no_client_org' }
}

const REPAIR_BATCH = 50

/**
 * Pending suggestions written before their call's org could be resolved (or
 * before the resolver existed) gain the org on the next pass, so the inbox
 * shows the client and an approved task lands on it. Bounded, idempotent, and
 * silent on rows the resolver still cannot place.
 */
async function repairOrglessSuggestions(database: Drizzle, nowIso: string): Promise<number> {
  const rows = await database
    .select({
      id: schema.taskSuggestions.id,
      callKind: schema.taskSuggestions.callKind,
      callId: schema.taskSuggestions.callId,
      kind: schema.taskSuggestions.kind,
      proposal: schema.taskSuggestions.proposal,
    })
    .from(schema.taskSuggestions)
    .where(and(
      eq(schema.taskSuggestions.status, 'pending'),
      isNull(schema.taskSuggestions.orgId),
      isNotNull(schema.taskSuggestions.callId),
    ))
    .limit(REPAIR_BATCH)

  let repaired = 0
  const byCall = new Map<string, string | null>()
  for (const row of rows) {
    const key = `${row.callKind ?? ''}:${row.callId ?? ''}`
    let orgId = byCall.get(key)
    if (orgId === undefined) {
      const gate = await resolveCallGate(database, row.callKind, row.callId)
      orgId = gate.eligible ? gate.orgId : null
      byCall.set(key, orgId)
    }
    if (!orgId) continue

    const updates: Record<string, unknown> = { orgId, updatedAt: nowIso }
    if (row.kind === 'create_task') {
      try {
        const proposal: unknown = JSON.parse(row.proposal)
        if (proposal && typeof proposal === 'object' && !Array.isArray(proposal)) {
          updates.proposal = JSON.stringify({ ...(proposal as Record<string, unknown>), orgId })
        }
      } catch {
        // An unreadable proposal keeps its text; the org still lands on the row.
      }
    }
    await database.update(schema.taskSuggestions).set(updates).where(eq(schema.taskSuggestions.id, row.id))
    repaired++
  }
  return repaired
}

async function stamp(database: Drizzle, transcriptId: string, at: string): Promise<void> {
  await database
    .update(schema.callTranscripts)
    .set({ suggestedAt: at })
    .where(eq(schema.callTranscripts.id, transcriptId))
}
