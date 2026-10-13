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
import { summariseProposal } from '@/lib/suggestion-summary'
import { slackBotToken } from '@/lib/slack/api'
import { postSuggestionsForCall } from '@/lib/slack/mirror'
import { insertSuggestions, isRepeatOf, listSuggestions, resurfaceSnoozed, type SuggestionKind } from '@/lib/task-suggestions'
import { HANDOFF_REASONS } from '@/lib/request-handoff-copy'
import { REQUEST_CATEGORIES, REQUEST_PRIORITIES, REQUEST_TYPES } from '@/lib/request-vocabulary'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Caps and windows ─────────────────────────────────────────────────────────

/** Open work plus anything finished recently, so a completion can still be
 *  proposed for a task that was closed between the call and the sweep. */
export const CONTEXT_TASK_LIMIT = 80
export const CONTEXT_REQUEST_LIMIT = 40
export const CONTEXT_MEMBER_LIMIT = 40

/** The client's people, so a hand-off can name one of them instead of a
 *  string the reviewer then has to look up. */
export const CONTEXT_CONTACT_LIMIT = 40

/** More than this and the reviewer stops reading, which is the one failure
 *  this whole feature exists to avoid. */
export const MAX_SUGGESTIONS = 12

/** How far back the sweep will look for a transcript nobody has read yet.
 *  Older than this and the call has moved on without us. */
export const SWEEP_WINDOW_DAYS = 30

/** Transcripts per run. The cron fires every thirty minutes, so a backlog
 *  drains in hours, and one bad batch costs five calls rather than fifty. */
export const SWEEP_BATCH = 5

/** The ceiling on `?limit=`. A cutover pass over every call in the backlog is
 *  a reasonable thing to ask for; an unbounded sweep is an unbounded bill. */
export const MAX_SWEEP_BATCH = 20

/**
 * How long one sweep may keep starting reads, in milliseconds.
 *
 * workers/cron-trigger gives up on its POST after 120 seconds
 * (FETCH_TIMEOUT_MS), and a Worker whose caller has gone can be cancelled
 * part way through, which loses the cron_runs row and whatever the
 * transcript in hand had not yet written. Production reads take 20 to 27
 * seconds each and a call is read twice, so a batch of five is four minutes
 * of model time: the batch is the most a run may take on, and this is the
 * most it may spend. A read is only started when it is expected to finish
 * inside this budget, which leaves the last 45 seconds for a read slower
 * than expected, the snooze and org repairs, Slack and the run log.
 */
export const SWEEP_BUDGET_MS = 75_000

/** What one read is taken to cost before this run has timed one: a little
 *  over the slowest production read. The sweep uses the larger of this and
 *  the slowest read it has actually seen. */
export const READ_ESTIMATE_MS = 30_000

export const MODEL_READ_TIMEOUT_MS = 30_000
const MAX_DEFERRED_FAILURES = 5
const WRITE_RESERVE_MS = 5_000

export class SuggesterTimeoutError extends Error {
  constructor(readonly timeoutMs = MODEL_READ_TIMEOUT_MS) {
    super('Model read timed out. The transcript remains available for retry.')
    this.name = 'SuggesterTimeoutError'
  }
}

function modelErrorStatus(error: unknown): number {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : NaN
  if (Number.isFinite(status) && status > 0) return status
  const matched = error instanceof Error ? /^(?:error[:\s]*)?(429|5\d{2})\b/i.exec(error.message) : null
  return matched ? Number(matched[1]) : NaN
}

function transientModelError(error: unknown): boolean {
  const status = modelErrorStatus(error)
  if (status === 429 || (status >= 500 && status <= 599)) return true
  return !Number.isFinite(status) && error instanceof Error
    && (/APIConnection(?:Timeout)?Error/i.test(error.name)
      || /connection error|connection (?:reset|refused|closed)|network error|fetch failed|failed to fetch|socket hang up|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(error.message))
}

function modelReadTimedOut(error: unknown): boolean {
  return error instanceof SuggesterTimeoutError || error instanceof Error
    && (/TimeoutError|AbortError/i.test(error.name) || /timeout|timed out|aborted/i.test(error.message))
}

async function boundedRead<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SuggesterTimeoutError(timeoutMs))
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A transcript left for the scheduled sweep has to still be inside the
 * sweep's window when its turn comes, and a queue of deferred calls drains
 * at about one call per run. So a caller deferring work (the rebuild) only
 * leaves a transcript for the sweep when it is at least this many days
 * inside the window; anything older is read now or not at all.
 */
export const DEFER_MARGIN_DAYS = 3

/**
 * Whether a transcript received at `receivedAt` can safely be left for the
 * scheduled sweep to read, as of `at`. Lives here, beside the window it is
 * measured against, because a route.ts may only export HTTP handlers.
 */
export function sweepWillReach(receivedAt: string, at: Date): boolean {
  return receivedAt >= daysBefore(at, SWEEP_WINDOW_DAYS - DEFER_MARGIN_DAYS)
}

/**
 * `?limit=` as the cron route reads it: the cron's own default when the query
 * says nothing or says nonsense, clamped to one transcript at the bottom and
 * twenty at the top. Lives here rather than in the route because a route.ts
 * may only export HTTP handlers.
 */
export function parseSweepLimit(raw: string | null): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10)
  if (!Number.isFinite(parsed)) return SWEEP_BATCH
  return Math.min(MAX_SWEEP_BATCH, Math.max(1, parsed))
}

/**
 * Rejections as negative examples (CN.3 section 7). At most eight shown, from
 * the last 120 days, from a scan of thirty, in a block of at most 2,000
 * characters: about 500 input tokens on the first read of a call and a tenth
 * of that on the second, which reads it from the cache.
 */
export const REJECTED_EXAMPLE_LIMIT = 8
export const REJECTED_WINDOW_DAYS = 120
export const REJECTED_BLOCK_MAX_CHARS = 2000
export const REJECTED_SCAN_LIMIT = 30

/** The per-field clips, so one long quote cannot crowd out the other seven examples. */
const REJECTED_SUMMARY_CHARS = 140
const REJECTED_QUOTE_CHARS = 160
const REJECTED_REASON_CHARS = 120
/** A reject reason saying the call was filed under the wrong client (the
 *  inbox chip reads "Wrong client"). Such a row is never shown as an example. */
const WRONG_CLIENT_REASON = /\bwrong\s+client\b/i

const REJECTED_HEADER = 'REJECTED BEFORE (a person turned these down for this client; never propose them again):'

const TASK_ACTIVITY_DAYS = 60
const TASK_DONE_DAYS = 14
/** How long a delivered request stays in the context, marked delivered, so a
 *  re-mention of finished work is proposed as a note rather than as new work
 *  (CN.1d section 2). */
const REQUEST_DELIVERED_DAYS = 90
const MAX_OUTPUT_TOKENS = 3000
const MAX_TRANSCRIPT_CHARS = 60_000

/** The words that let a completion through. A call that says "I will finish
 *  it tonight" is a promise, not a completion, and the target task stays open
 *  until someone says otherwise. */
export const COMPLETION_WORDS = ['done', 'finished', 'completed', 'complete', 'shipped', 'live', 'sent', 'delivered'] as const

const KINDS: readonly SuggestionKind[] = [
  'create_task',
  'update_task',
  'complete_task',
  'add_subtasks',
  'note',
  'create_request',
  'update_request',
  'request_note',
  'hand_off_request',
]

/** The kinds that name a task from the TASKS list. */
const KINDS_NEEDING_TASK: readonly SuggestionKind[] = ['update_task', 'complete_task', 'add_subtasks', 'note']

/** The kinds that name a request from the REQUESTS list. */
const KINDS_NEEDING_REQUEST: readonly SuggestionKind[] = ['update_request', 'request_note', 'hand_off_request']

/** The fields an update_request may carry, the same set PATCH
 *  /api/admin/requests/[id] accepts from this contract's section 2. The
 *  values themselves are validated on apply, against the route's own rules. */
const REQUEST_UPDATE_FIELDS = ['status', 'priority', 'dueDate', 'startDate', 'estimatedHours', 'category', 'scopeFlagged'] as const

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
  /** True when the request is already parked with a client contact. A second
   *  hand-off on the same request is nearly always the model repeating one
   *  that is already live. */
  waitingOn: boolean
  /** True for work already delivered inside the window (CN.1d section 2). The
   *  model is shown these so a client re-mentioning finished work produces a
   *  note on it, not a second request for it. */
  delivered: boolean
  /** The request's current owner, if it has one (CN.2 contract section 5).
   *  Shown to the model so "owns this client's work" is a fact read off the
   *  roster, never a guess. */
  currentAssigneeId: string | null
  currentAssigneeName: string | null
}

export interface SuggestionContextMember {
  id: string
  name: string
}

/** A person at the client. Emails are here because a transcript names people
 *  both ways and an exact match on either is still an exact match. */
export interface SuggestionContextContact {
  id: string
  name: string
  email: string
}

/**
 * Something a person already turned down for this client (CN.3 section 7),
 * as the model is shown it: when, what kind, the one-line summary the inbox
 * showed, the words it rested on and, when they said, why. No description,
 * rationale or confidence: the point is "not this again", not a second
 * chance to argue for it.
 */
export interface RejectedExample {
  kind: string
  summary: string
  quote: string
  reason: string | null
  /** YYYY-MM-DD, the date part of decided_at. */
  decidedOn: string
}

export interface SuggestionContext {
  tasks: SuggestionContextTask[]
  requests: SuggestionContextRequest[]
  members: SuggestionContextMember[]
  contacts: SuggestionContextContact[]
  /**
   * The REJECTED BEFORE block's rows. Only the sweep (and the rebuild, which
   * runs through it) sets this; a Slack note is one person's direct ask
   * rather than a call read for everything said, so lib/slack/notes.ts never
   * does.
   */
  rejected?: RejectedExample[]
}

export interface SuggestionDraft {
  kind: SuggestionKind
  targetTaskId: string | null
  /** Set for the three kinds that change an existing request. */
  targetRequestId: string | null
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
  /** Per-read deadline, clamped by the sweep's remaining budget. */
  timeoutMs?: number
  signal?: AbortSignal
  transcript: string
  wrapUp: string | null
  callTitle: string | null
  callDate: string | null
  context: SuggestionContext
  /**
   * Set on the second read of a call (CN.1c): what the first read proposed,
   * shown to the model with the question "anything missed?". An empty array
   * is a real answer here (the first read found nothing) and still makes
   * this a second read; only `undefined` makes it a first one.
   */
  alreadyProposed?: readonly SuggestionDraft[]
  /** How many new items the second read may add, said in its prompt. */
  maxNew?: number
  /**
   * Mark the context and transcript as a cache breakpoint, because a second
   * read of the same notes follows within the cache window. Off by default:
   * a cache write costs a quarter more than plain input, which only pays
   * for itself when something reads it back.
   */
  cacheSource?: boolean
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

export function suggestionContextWindows(at: Date): { updatedSince: string; doneSince: string; deliveredSince: string } {
  return {
    updatedSince: daysBefore(at, TASK_ACTIVITY_DAYS),
    doneSince: daysBefore(at, TASK_DONE_DAYS),
    deliveredSince: daysBefore(at, REQUEST_DELIVERED_DAYS),
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
  const { updatedSince, doneSince, deliveredSince } = suggestionContextWindows(at)

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

  if (!orgId) return { tasks, requests: [], members, contacts: [] }

  // Open work, plus anything DELIVERED inside the window. The delivered half
  // is what stops the commonest duplicate there is: a client mentioning the
  // thing the studio finished six weeks ago, and the model, seeing nothing
  // like it in the list, proposing it again as new work (CN.1d section 2).
  const requestRows = await database
    .select({
      id: schema.requests.id,
      requestNumber: schema.requests.requestNumber,
      title: schema.requests.title,
      status: schema.requests.status,
      waitingOnContactId: schema.requests.waitingOnContactId,
      assigneeId: schema.requests.assigneeId,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, orgId),
      ne(schema.requests.status, 'archived'),
      ne(schema.requests.status, 'draft'),
      or(
        ne(schema.requests.status, 'delivered'),
        gte(sql`coalesce(${schema.requests.deliveredAt}, ${schema.requests.updatedAt})`, deliveredSince),
      ),
    ))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(CONTEXT_REQUEST_LIMIT)

  const requests: SuggestionContextRequest[] = requestRows.map(r => ({
    id: r.id,
    number: r.requestNumber ?? null,
    title: r.title,
    status: r.status,
    waitingOn: Boolean(r.waitingOnContactId),
    delivered: r.status === 'delivered',
    currentAssigneeId: r.assigneeId ?? null,
    currentAssigneeName: r.assigneeId ? memberName.get(r.assigneeId) ?? null : null,
  }))

  const contactRows = await database
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
    .orderBy(asc(schema.contacts.name))
    .limit(CONTEXT_CONTACT_LIMIT)

  const contacts: SuggestionContextContact[] = contactRows.map(c => ({
    id: c.id,
    name: c.name,
    email: c.email,
  }))

  return { tasks, requests, members, contacts }
}

// ── Rejections as negative examples (CN.3 section 7) ─────────────────────────
//
// A person pressing Reject is the clearest signal the studio ever gives the
// suggester, and until now it was thrown away: the next call with the same
// client proposed the same footer tag again, and somebody rejected it again.
// So the sweep shows the model what was turned down for THIS client lately,
// with the reason when there is one, and rule 8 of the system prompt says
// what to do with it.
//
// SAME CLIENT ONLY, and that is a privacy rule before it is a relevance one.
// A title or a quote from one client's call in another client's prompt could
// come back as a proposal filed on the wrong client, and a request title is
// client visible once approved. So the org is filtered in SQL and then again
// here, in a pure function the tests hand another client's rows to.
//
// NO CLIENT, NO EXAMPLES. A call suggestion with no org is not studio
// housekeeping: scheduled calls always carry an org and Slack notes are never
// 'founders' rows, so a null org on a founders row means some client's
// discovery call whose client could not be worked out, and the repair pass
// only mends pending rows. Two such calls from two different clients would
// share the null, so matching null to null would show one client's title and
// quote in the other's prompt. A call with no org is read with no block.

/** One task_suggestions row as the rejected-examples reader selects it. */
export interface RejectedSuggestionRow {
  kind: string
  proposal: string
  quote: string
  status: string
  approverType: string
  orgId: string | null
  decidedAt: string | null
  rejectReason: string | null
}

/** A line of prose cut so the result, ellipsis included, is at most `max` characters. */
function clipWithin(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : clip(flat, max - 3)
}

function parseProposalLoose(proposal: string): unknown {
  try {
    return JSON.parse(proposal)
  } catch {
    return proposal
  }
}

/**
 * The rows the model may be shown, newest first, as examples.
 *
 * Re-applies every rule the SQL already applied, because this is the function
 * the privacy tests hit and a query is easy to loosen by accident:
 *
 *   * 'rejected' only. 'expired' is a rebuild tidying up, not a person
 *     saying no, and teaching the model from it would teach it to stop
 *     proposing things nobody ever looked at.
 *   * approver_type 'founders' only, which is the call suggestions. A
 *     member's rejected note is a private change of mind about their own
 *     ask, not a verdict on what the client wants.
 *   * decided inside REJECTED_WINDOW_DAYS of `at`. Older than that and the
 *     client may well want it now.
 *   * the same client: the row's org equals `orgId`. Never another client's
 *     row, and nothing at all when `orgId` is empty, since a null org is an
 *     unidentified client rather than the studio (see above).
 *   * not rejected as the wrong client. That reason says the call was filed
 *     under this client by mistake, so the row is another client's words
 *     (their title, their quote) and not a verdict on what this client
 *     wants; shown here it would put one client's work in another's prompt
 *     for the whole window.
 *
 * Then one example per folded summary, so the same item rejected off three
 * calls is one line rather than three, and at most REJECTED_EXAMPLE_LIMIT.
 */
export function selectRejectedExamples(
  rows: readonly RejectedSuggestionRow[],
  orgId: string | null,
  at: Date,
): RejectedExample[] {
  const scope = orgId || null
  if (!scope) return []
  const since = at.getTime() - REJECTED_WINDOW_DAYS * 86_400_000

  const eligible = rows
    .filter(row => row.status === 'rejected'
      && row.approverType === 'founders'
      && row.orgId === scope
      && !WRONG_CLIENT_REASON.test(asString(row.rejectReason) ?? ''))
    .map(row => ({ row, time: row.decidedAt ? Date.parse(row.decidedAt) : Number.NaN }))
    .filter(entry => Number.isFinite(entry.time) && entry.time >= since)
    .sort((a, b) => b.time - a.time)

  const seen = new Set<string>()
  const examples: RejectedExample[] = []
  for (const { row } of eligible) {
    if (examples.length >= REJECTED_EXAMPLE_LIMIT) break
    const summary = clipWithin(summariseProposal(row.kind, parseProposalLoose(row.proposal)), REJECTED_SUMMARY_CHARS)
    const key = fold(summary)
    if (seen.has(key)) continue
    seen.add(key)
    const reason = asString(row.rejectReason)
    examples.push({
      kind: row.kind,
      summary,
      quote: clipWithin(row.quote ?? '', REJECTED_QUOTE_CHARS),
      reason: reason ? clipWithin(reason, REJECTED_REASON_CHARS) : null,
      decidedOn: (row.decidedAt ?? '').slice(0, 10),
    })
  }
  return examples
}

/**
 * What this client had rejected lately, ready for the REJECTED BEFORE block.
 *
 * Filtered in SQL (status, approver, org, window, newest first, a scan of
 * REJECTED_SCAN_LIMIT) and then handed to selectRejectedExamples, which
 * applies every rule again. Never throws: a sweep that cannot read its
 * rejections reads the call without them, exactly as it did before CN.3,
 * rather than failing a call over a hint. That includes the window before
 * migration 0111 is applied, when reject_reason does not exist yet. A call
 * with no org reads nothing at all, not the null-org rows (see above).
 */
export async function loadRejectedExamples(
  database: Drizzle,
  orgId: string | null,
  at: Date,
): Promise<RejectedExample[]> {
  const scope = orgId || null
  if (!scope) return []
  try {
    const rows = await database
      .select({
        kind: schema.taskSuggestions.kind,
        proposal: schema.taskSuggestions.proposal,
        quote: schema.taskSuggestions.quote,
        status: schema.taskSuggestions.status,
        approverType: schema.taskSuggestions.approverType,
        orgId: schema.taskSuggestions.orgId,
        decidedAt: schema.taskSuggestions.decidedAt,
        rejectReason: schema.taskSuggestions.rejectReason,
      })
      .from(schema.taskSuggestions)
      .where(and(
        eq(schema.taskSuggestions.status, 'rejected'),
        eq(schema.taskSuggestions.approverType, 'founders'),
        eq(schema.taskSuggestions.orgId, scope),
        gte(schema.taskSuggestions.decidedAt, daysBefore(at, REJECTED_WINDOW_DAYS)),
      ))
      .orderBy(desc(schema.taskSuggestions.decidedAt))
      .limit(REJECTED_SCAN_LIMIT)
    return selectRejectedExamples(Array.isArray(rows) ? rows : [], scope, at)
  } catch {
    return []
  }
}

/**
 * The REJECTED BEFORE block, or '' when there is nothing to show.
 *
 * Newest first, one line per example. When the block would run past
 * REJECTED_BLOCK_MAX_CHARS the OLDEST lines go first, since the most recent
 * no is the one most likely to be asked again; if not even one line fits the
 * answer is '' rather than a header over nothing. Deterministic for a given
 * list, which matters: the block sits inside the cached notes and the second
 * read has to send it byte for byte.
 */
export function formatRejectedBlock(examples: readonly RejectedExample[]): string {
  if (examples.length === 0) return ''
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim()
  const lines = examples
    .map((example, index) => ({ example, index }))
    .sort((a, b) => b.example.decidedOn.localeCompare(a.example.decidedOn) || a.index - b.index)
    .map(({ example }) => {
      const reason = example.reason ? flat(example.reason) : ''
      return `- ${flat(example.decidedOn)} | ${flat(example.kind)} | ${flat(example.summary)} | quote "${flat(example.quote)}"${reason ? ` | reason: ${reason}` : ''}`
    })

  const block = (): string => [REJECTED_HEADER, ...lines].join('\n')
  while (lines.length > 0 && block().length > REJECTED_BLOCK_MAX_CHARS) lines.pop()
  return lines.length > 0 ? block() : ''
}

/**
 * A name or an email to one of this client's people, or nothing.
 *
 * Exact match only, case folded, on either column. No prefix pass, unlike
 * `resolveByName` for the studio roster: a transcript says "Ella" for a
 * contact list that may hold two Ellas, and a hand-off filed against the wrong
 * person emails the wrong client. An unresolved name still reaches the inbox
 * with the words the call used; the reviewer picks the person.
 */
export function resolveContact(
  name: string | null,
  contacts: readonly SuggestionContextContact[],
): string | null {
  const needle = (name ?? '').trim().toLowerCase()
  if (!needle) return null
  const matches = contacts.filter(c =>
    c.name.trim().toLowerCase() === needle || c.email.trim().toLowerCase() === needle)
  return matches.length === 1 ? matches[0].id : null
}

/**
 * The owner suggestion a create_task, create_request or update_request
 * proposal may carry (CN.2 contract section 5): a NAME the model read off
 * the call, resolved to an id only when it matches exactly one person on
 * the studio roster, plus the one sentence explaining it. Mutates the
 * proposal in place, the same way the rest of `validateSuggestionItems`
 * does, so every kind that calls it reads the same three keys back:
 * `suggestedAssigneeName`, `suggestedAssigneeId`, `assigneeReason`.
 */
function resolveAssigneeSuggestion(
  proposal: Record<string, unknown>,
  members: readonly SuggestionContextMember[],
): void {
  const suggestedAssigneeName = asString(proposal.suggestedAssigneeName)
  proposal.suggestedAssigneeName = suggestedAssigneeName
  proposal.suggestedAssigneeId = resolveByName(suggestedAssigneeName, members)
  proposal.assigneeReason = asString(proposal.assigneeReason)
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
  const knownRequests = new Set(opts.context.requests.map(r => r.id))
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
    if (KINDS_NEEDING_TASK.includes(kind)) {
      if (!targetTaskId) {
        dropped.push({ reason: 'missing_target_task', raw })
        continue
      }
      if (!knownTasks.has(targetTaskId)) {
        dropped.push({ reason: 'unknown_target_task', raw })
        continue
      }
    }

    const targetRequestId = asString(item.targetRequestId)
    if (KINDS_NEEDING_REQUEST.includes(kind)) {
      if (!targetRequestId) {
        dropped.push({ reason: 'missing_target_request', raw })
        continue
      }
      if (!knownRequests.has(targetRequestId)) {
        dropped.push({ reason: 'unknown_target_request', raw })
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
      resolveAssigneeSuggestion(proposal, opts.context.members)
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

    if ((kind === 'note' || kind === 'request_note') && !asString(proposal.body)) {
      dropped.push({ reason: 'empty_note', raw })
      continue
    }

    if (kind === 'create_request') {
      const title = asString(proposal.title)
      if (!title || title.length < 4) {
        dropped.push({ reason: 'title_too_short', raw })
        continue
      }
      proposal.title = title

      // The three vocabularies, checked rather than trusted. A value the
      // dialog would not offer is a value the route would reject on apply,
      // and a suggestion that cannot be approved is noise in the inbox.
      const category = asString(proposal.category)
      if (!category || !REQUEST_CATEGORIES.includes(category)) {
        dropped.push({ reason: 'invalid_request_category', raw })
        continue
      }
      const type = asString(proposal.type)
      if (!type || !REQUEST_TYPES.includes(type)) {
        dropped.push({ reason: 'invalid_request_type', raw })
        continue
      }
      const priority = asString(proposal.priority)
      if (!priority || !REQUEST_PRIORITIES.includes(priority)) {
        dropped.push({ reason: 'invalid_request_priority', raw })
        continue
      }
      proposal.category = category
      proposal.type = type
      proposal.priority = priority

      // Who asked for it. A name that matches exactly one person at this
      // client becomes an id; anything else stays a name for the reviewer.
      const requesterName = asString(proposal.requesterName)
      proposal.requesterName = requesterName
      proposal.requesterContactId = resolveContact(requesterName, opts.context.contacts)
      resolveAssigneeSuggestion(proposal, opts.context.members)
    }

    if (kind === 'update_request') {
      const fieldsRaw = proposal.fields
      const fields = fieldsRaw && typeof fieldsRaw === 'object' && !Array.isArray(fieldsRaw)
        ? Object.fromEntries(Object.entries(fieldsRaw as Record<string, unknown>)
          .filter(([key, value]) => (REQUEST_UPDATE_FIELDS as readonly string[]).includes(key) && value !== null && value !== undefined))
        : {}
      if (Object.keys(fields).length === 0) {
        // An update that changes nothing is a note wearing a different hat,
        // and it would dedupe against every other empty update on the request.
        dropped.push({ reason: 'no_request_fields', raw })
        continue
      }
      proposal.fields = fields
      resolveAssigneeSuggestion(proposal, opts.context.members)
    }

    if (kind === 'hand_off_request') {
      const contactName = asString(proposal.contactName)
      if (!contactName) {
        dropped.push({ reason: 'missing_contact_name', raw })
        continue
      }
      const reason = asString(proposal.reason)
      if (!reason || !(HANDOFF_REASONS as readonly string[]).includes(reason)) {
        dropped.push({ reason: 'invalid_handoff_reason', raw })
        continue
      }
      proposal.contactName = contactName
      proposal.reason = reason
      // An unresolved person is still a real hand-off. It reaches the inbox
      // and the reviewer picks the contact before Approve lights up.
      proposal.contactId = resolveContact(contactName, opts.context.contacts)
    }

    suggestions.push({
      kind,
      targetTaskId: KINDS_NEEDING_TASK.includes(kind) ? targetTaskId : null,
      targetRequestId: KINDS_NEEDING_REQUEST.includes(kind) ? targetRequestId : null,
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

/** A vocabulary as the prompt prints it: quoted, pipe separated, read from
 *  the module that the routes and the dialog read. Printed rather than typed
 *  out so a value added there cannot go missing here. */
function vocabulary(values: readonly string[]): string {
  return values.map(value => `"${value}"`).join(' | ')
}

/**
 * The system prompt, built once from the live vocabularies.
 *
 * The rule that matters most in this phase is the second one: client-facing
 * work is a REQUEST, the studio's own work is a TASK, and one thing said on a
 * call is never both. A client deliverable filed as an internal task is
 * invisible to the client who asked for it, which is exactly the failure the
 * portal exists to prevent.
 */
export const SUGGESTER_SYSTEM_PROMPT = `You read the notes from one call and propose changes to the studio's work. You never make a change yourself. A person reads every item you write and presses a button, so your job is to be checkable, not to be comprehensive.

Rules, in order of importance:
1. Only what was said on this call. If it was not said, it does not exist.
2. Requests are client-facing work. Tasks run the studio. The test is what the client will see.
   - If the studio will build, change, fix, style, add, remove, write, design, set up or research anything on the client's website, brand, content, integrations or tooling, it is a request, even when Liam or Staci is the one doing it: create_request, or update_request when a request from the REQUESTS list already covers it. "Add the LinkedIn tag to the footer", "fix the calculator", "finish the styling", "remove the redirect", "build a unit toggle" are all requests.
   - Something the client owes on an existing request (an approval, content, access, a decision, a file) is hand_off_request, naming the person.
   - A task is only for things the client never sees: scheduling a call, messaging someone, internal research about the studio itself, admin, hiring, the studio's own tools. When in doubt it is a request.
   - One thing said on the call produces one item. Never both a task and a request for the same thing.
3. Every item carries a quote: the exact words from the transcript or the wrap up, copied character for character. An item without a usable quote is thrown away before anyone sees it.
4. An update, a completion, a subtask list or a task note must name a task from the TASKS list you were given, by its id. An update_request, a request_note or a hand_off_request must name a request from the REQUESTS list, by its id. Never compose an id.
5. Propose a completion only when the call says the thing is done. "I will finish it tonight" is a promise, not a completion.
6. Never invent an owner, a date or an estimate. If a person was named, put the NAME in suggestedAssigneeName, requesterName or contactName and leave the id out. If no date was said, leave the date out.
   - suggestedAssigneeName is who will do the work, on a create_task, a create_request or an update_request: the person who said on the call they would do it, with assigneeReason quoting what they said in one sentence ("said she would send the headers"). When nobody named an owner but the REQUESTS list already shows one for the request being updated, repeat that name with assigneeReason "owns this client's work". Leave both null when neither is true.
7. At most 12 items. Fewer good ones beat more.
8. REJECTED BEFORE, when present, lists items a person already turned down for this client. Do not propose any of them again, reworded or not, and be slow to propose anything of the same shape. Only when this call clearly asks for the same thing again, in its own words, propose it and say so in the rationale.

Write in the studio's voice: plain sentences, no dashes of any kind, no exclamation marks, no filler.

Task kinds and their proposal shapes:
- create_task: { "title": string, "description": string, "type": "client_task" | "internal_client_task" | "tahi_internal", "orgId": string | null, "requestId": string | null, "suggestedAssigneeName": string | null, "assigneeReason": string | null, "dueDate": "YYYY-MM-DD" | null, "estimatedHours": number | null, "priority": "standard" | "high" | "urgent", "subtasks": string[] }
- update_task: { "fields": { "title"?, "description"?, "status"?, "priority"?, "dueDate"?, "estimatedHours"? }, "note"?: string }
- complete_task: { "note"?: string }
- add_subtasks: { "subtasks": string[] }
- note: { "body": string }

Request kinds and their proposal shapes:
- create_request: { "title": string, "description": string, "category": ${vocabulary(REQUEST_CATEGORIES)}, "type": ${vocabulary(REQUEST_TYPES)}, "priority": ${vocabulary(REQUEST_PRIORITIES)}, "dueDate": "YYYY-MM-DD" | null, "requesterName": string | null, "suggestedAssigneeName": string | null, "assigneeReason": string | null }
- update_request: { "fields": { ${REQUEST_UPDATE_FIELDS.map(field => `"${field}"?`).join(', ')} }, "note"?: string, "suggestedAssigneeName": string | null, "assigneeReason": string | null }
- request_note: { "body": string }
- hand_off_request: { "contactName": string, "reason": ${vocabulary(HANDOFF_REASONS)}, "dueAt": "YYYY-MM-DD" | null, "note"?: string }

The client is already known, so never put an org on a request. "category", "type" and "priority" on a create_request must be one of the values listed above and nothing else. Pick the contactName for a hand off from the CONTACTS list when the call names somebody on it.

Answer with a short sentence saying what the call was about, then one block exactly like this at the end:

<suggestions>[{"kind":"create_request","proposal":{...},"quote":"...","rationale":"one sentence","confidence":0.8}]</suggestions>

Use "targetTaskId" alongside "kind" for update_task, complete_task, add_subtasks and note. Use "targetRequestId" for update_request, request_note and hand_off_request. If nothing actionable was said, write the sentence and an empty array.`

/**
 * The notes block: the call, what the client has on file, the people, what
 * was turned down before, then the wrap up and the transcript.
 *
 * REJECTED BEFORE sits after CONTACTS and before WRAP UP so it is inside the
 * notes, which are the cached block when a second read follows: the second
 * read sends this exact text again and pays the cache price for it. Exported
 * so a test can hold the two reads' notes side by side.
 */
export function buildUserMessage(input: SuggestFromTranscriptInput): string {
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
    parts.push(['REQUESTS (the only request ids you may name):', ...input.context.requests.map(r =>
      `- ${r.id} | #${r.number ?? '?'} ${r.title} | status ${r.status}${r.delivered ? ' | DELIVERED, this work is finished' : ''}${r.waitingOn ? ' | already waiting on the client' : ''}${r.currentAssigneeName ? ` | owned by ${r.currentAssigneeName}` : ''}`,
    )].join('\n'))
  } else {
    parts.push('REQUESTS: none open for this client.')
  }

  if (input.context.members.length > 0) {
    parts.push(`PEOPLE (names only): ${input.context.members.map(m => m.name).join(', ')}`)
  }

  if (input.context.contacts.length > 0) {
    parts.push(['CONTACTS (the client\'s people, for a hand off):', ...input.context.contacts.map(c =>
      `- ${c.name} | ${c.email}`,
    )].join('\n'))
  }

  const rejected = formatRejectedBlock(input.context.rejected ?? [])
  if (rejected) parts.push(rejected)

  if (input.wrapUp) {
    parts.push(`WRAP UP:\n${input.wrapUp.slice(0, MAX_TRANSCRIPT_CHARS)}`)
  }

  parts.push(`TRANSCRIPT:\n${input.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`)
  return parts.join('\n\n')
}

/** A line of prose cut to a length a list can carry, on a word where it can be. */
function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}...`
}

/**
 * One item of the first read, as the second read is shown it: the kind, the
 * target it names, what it changes and the words it rests on. The quote is
 * the part that matters most, because "is this already covered" is a
 * question about which sentence of the call an item came from.
 */
function describeDraft(item: SuggestionDraft): string {
  const proposal = item.proposal
  const target = item.targetRequestId ?? item.targetTaskId
  let what: string
  switch (item.kind) {
    case 'create_task':
    case 'create_request':
      what = `"${clip(asString(proposal.title) ?? '', 160)}"`
      break
    case 'update_task':
    case 'update_request': {
      const fields = proposal.fields && typeof proposal.fields === 'object' && !Array.isArray(proposal.fields)
        ? Object.keys(proposal.fields as Record<string, unknown>)
        : []
      what = `changes ${fields.join(', ') || 'nothing'}`
      break
    }
    case 'complete_task':
      what = 'marks it done'
      break
    case 'add_subtasks':
      what = `adds ${Array.isArray(proposal.subtasks) ? proposal.subtasks.map(String).join('; ') : 'subtasks'}`
      break
    case 'hand_off_request':
      what = `waiting on ${asString(proposal.contactName) ?? 'someone'} (${asString(proposal.reason) ?? 'other'})`
      break
    default:
      what = `"${clip(asString(proposal.body) ?? '', 160)}"`
  }
  return `${item.kind}${target ? ` on ${target}` : ''} | ${what} | quote "${clip(item.quote, 240)}"`
}

/**
 * The second read's question, appended after the notes (CN.1c).
 *
 * Sonnet 5 will not take a temperature, so one read of a call is one sample,
 * and a sample can miss things: two reads of the same three Elevate calls
 * gave five items and then none. The cheapest cure is a second look at the
 * same notes with the first look beside it. Shown the list, the model is
 * asked only for what the list lacks; the rules, the output format and the
 * validation are the ones every read gets, so a second read cannot say
 * anything a first read was not allowed to.
 *
 * An empty first read is shown as empty rather than skipped. That is the
 * case the second read helps most: a first sample that happened to find
 * nothing gets a second, independent one.
 */
export function buildSecondReadMessage(alreadyProposed: readonly SuggestionDraft[], maxNew: number): string {
  const listed = alreadyProposed.length > 0
    ? [
      'ALREADY PROPOSED FROM THIS CALL (an earlier read of these same notes; every item below is already waiting for a person to decide):',
      ...alreadyProposed.map((item, index) => `${index + 1}. ${describeDraft(item)}`),
    ].join('\n')
    : 'ALREADY PROPOSED FROM THIS CALL: nothing. An earlier read of these same notes proposed no items.'

  const room = Math.max(0, maxNew)
  return [
    listed,
    'This is a second read of the same call. Read the notes again and propose only what the earlier read missed: something actionable that was said on the call and that no item above already covers. Never repeat, reword, merge or split an item above. Every rule still applies, the verbatim quote most of all.',
    `At most ${room} new ${room === 1 ? 'item' : 'items'}. If nothing was missed, write the sentence and an empty array.`,
  ].join('\n\n')
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

/** A user content block, in the shape the SDK takes. */
interface UserTextBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

/**
 * Sonnet, once, over one call.
 *
 * The system prompt is a cached block: it is long, it never changes, and the
 * sweep sends it five times an hour. The notes (the context and the
 * transcript) are cached only when a second read of the same call follows
 * (`cacheSource`, and always on the second read itself): then the second
 * read pays a tenth of the input price for them instead of all of it, and
 * only its own short question and its answer at the full rate. The block is
 * byte for byte the same text on both reads, which is what the prefix match
 * needs.
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
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: input.timeoutMs ?? MODEL_READ_TIMEOUT_MS,
    maxRetries: 0,
  })

  const notes = buildUserMessage(input)
  const secondRead = input.alreadyProposed !== undefined
  const content: string | UserTextBlock[] = secondRead || input.cacheSource
    ? [
      { type: 'text', text: notes, cache_control: { type: 'ephemeral' } },
      ...(secondRead
        ? [{ type: 'text' as const, text: buildSecondReadMessage(input.alreadyProposed ?? [], input.maxNew ?? MAX_SUGGESTIONS) }]
        : []),
    ]
    : notes

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: SUGGESTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  }, { signal: input.signal }) as unknown as AnthropicResponse

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
  /** Transcripts this run examined, including reads deferred after a timeout. */
  looked: number
  /**
   * Transcripts the run found but did not start, because starting one more
   * would have risked the time budget (SWEEP_BUDGET_MS). They are left
   * unread and unstamped, so the next run picks them up, oldest first.
   * `deferredIds` names them, in the order they were found. Optional because
   * a summary written before the budget existed is still a summary.
   */
  deferred?: number
  deferredIds?: string[]
  eligible: number
  skipped: Array<{ transcriptId: string; reason: string }>
  inserted: number
  duplicates: number
  dropped: number
  resurfaced: number
  costCents: number
  /**
   * Suggestion messages posted to founder DMs this run, counted across both
   * founders (CN.2 contract section 3). Optional because Slack is a side
   * channel: a run with the app uninstalled reports nothing rather than a
   * zero that reads like a failure, and a summary written before this
   * existed is still a summary.
   */
  slackDelivered?: number
  /** Pending rows that had no org and gained one through the deal or attendee lookup. */
  repaired: number
  /** Why items the model proposed were dropped, counted by reason, so a rule change can be judged from the run log. */
  dropReasons: Record<string, number>
  /**
   * The second read of each call (CN.1c). With it enabled, every call whose
   * first read came back lands in exactly one of three places: `ran` counts
   * the second reads that came back too, `failed` names the ones that threw
   * (the first read was written anyway), and `skipped` names the ones never
   * started, either because the first read already filled the ceiling
   * ('full') or because a second read would have risked the time budget
   * ('out_of_time'; the first read is written and the call is stamped, since
   * it was read). `proposed` counts the new items the second reads found
   * that the first had not, before the writer's own dedupe, which may still
   * find some of them on file. Optional because a summary written before
   * this existed is still a summary.
   */
  secondPass?: {
    enabled: boolean
    ran: number
    proposed: number
    failed: Array<{ transcriptId: string; reason: string }>
    skipped?: Array<{ transcriptId: string; reason: 'full' | 'out_of_time' }>
  }
}

export interface SweepOptions {
  now?: Date
  batch?: number
  windowDays?: number
  /** Injected in tests. Production always uses the real model call. */
  suggest?: SuggestFn
  /**
   * Read every call twice, the second time with the first read shown and the
   * question "anything missed?" (CN.1c). On unless a caller says otherwise:
   * the cron switches it off with `?second_pass=0`, the rebuild with
   * `secondPass: false`.
   */
  secondPass?: boolean
  /**
   * Read exactly these transcripts, whatever their age and whether or not
   * they carry a read mark. The rebuild uses it to re-read calls straight
   * away, without the sweep window (a call older than thirty days would
   * otherwise never be read again) and without having to clear the mark
   * first on a call the budget may not reach. A transcript with no linked
   * call is still never read. Keep it short: it goes into one IN clause.
   */
  transcriptIds?: readonly string[]
  /**
   * The time budget, in milliseconds from `startedAt`. Defaults to
   * SWEEP_BUDGET_MS. A transcript is started only when its reads are
   * expected to finish inside it. The first model read may use the remaining
   * read budget, but never starts after the write reserve has been reached.
   */
  budgetMs?: number
  /** When the budget started counting, by `clock`. Defaults to the moment the sweep began; a route that did work first passes its own start. */
  startedAt?: number
  /** Milliseconds now. Defaults to Date.now; injected in tests. */
  clock?: () => number
  /**
   * Called once per transcript, after the budget has admitted it and the
   * gate has passed it, immediately before its first read. The rebuild uses
   * it to expire (with `replace`) or count what the transcript already has
   * on file at the last moment, so a transcript the budget never reaches is
   * left exactly as it was. A throw stops the sweep.
   */
  beforeRead?: (transcriptId: string) => Promise<void>
}

/** The words `?second_pass=` takes to mean off. Anything else, or nothing, is on. */
const SECOND_PASS_OFF = new Set(['0', 'false', 'off', 'no'])

/**
 * `?second_pass=` as the cron route reads it. On by default, and on for
 * anything it does not recognise, because the question it answers ("should
 * this read be allowed to miss things?") has one safe default. Lives here
 * rather than in the route because a route.ts may only export HTTP handlers.
 */
export function parseSecondPass(raw: string | null): boolean {
  return !SECOND_PASS_OFF.has((raw ?? '').trim().toLowerCase())
}

/**
 * The second read's answer, merged into the first (CN.1c).
 *
 * The model was told not to repeat the list, and mostly does not. Mostly is
 * not a guard, so anything that repeats an item of the first read, or an
 * earlier item of this one, is dropped here under `second_read_repeat`,
 * using the same rule the writer uses against rows on file. What is left is
 * capped at `room`, so the two reads together stay inside the twelve item
 * ceiling one read has. Pure, so the merge is tested without a model.
 */
export function mergeSecondRead(
  first: readonly SuggestionDraft[],
  second: Pick<SuggestResult, 'suggestions' | 'dropped'>,
  room: number,
): { added: SuggestionDraft[]; dropped: DroppedSuggestion[] } {
  const added: SuggestionDraft[] = []
  const dropped: DroppedSuggestion[] = [...second.dropped]
  for (const item of second.suggestions) {
    if (first.some(earlier => isRepeatOf(item, earlier)) || added.some(earlier => isRepeatOf(item, earlier))) {
      dropped.push({ reason: 'second_read_repeat', raw: item })
      continue
    }
    if (added.length >= room) {
      dropped.push({ reason: 'over_limit', raw: item })
      continue
    }
    added.push(item)
  }
  return { added, dropped }
}

/**
 * One pass: read the oldest unread transcripts, gate them, suggest, stamp.
 *
 * The stamp is the load bearing part. It goes on every transcript the sweep
 * LOOKED at, including gate rejections and permanent model failures. Transient
 * failures stay unread until a later run succeeds or five counted failures
 * exhaust that transcript's durable retry allowance in the settings table.
 * Rate limits never count. Connection and server errors count only when
 * another model read succeeded in the same run, rather than during outages.
 *
 * The converse holds as strictly: a transcript the sweep did NOT take on is
 * never stamped. The run has a time budget (SWEEP_BUDGET_MS) because its
 * caller hangs up at 120 seconds, and a transcript is only started when its
 * reads are expected to fit, judged on the slowest read seen so far. What
 * does not fit is left unread and unstamped for the next run and counted in
 * `deferred`. A second read that would not fit is skipped rather than
 * started; the first read is written and the call is stamped, because it
 * was read.
 *
 * Each eligible call is read twice by default (CN.1c, `mergeSecondRead`),
 * and whatever the two reads propose is ADDED to what the transcript already
 * has on file. A transcript read again after a rebuild therefore keeps every
 * row an earlier read left, decided or not; the writer files only what is
 * new (lib/task-suggestions.ts `insertSuggestions`, `isRepeatOf`).
 */
export async function runSuggestionSweep(
  database: Drizzle,
  options: SweepOptions = {},
): Promise<SweepSummary> {
  const at = options.now ?? new Date()
  const nowIso = iso(at)
  const suggest = options.suggest ?? suggestFromTranscript
  const since = daysBefore(at, options.windowDays ?? SWEEP_WINDOW_DAYS)
  const clock = options.clock ?? Date.now
  const startedAt = options.startedAt ?? clock()
  const budgetMs = options.budgetMs ?? SWEEP_BUDGET_MS
  const secondPass = {
    enabled: options.secondPass ?? true,
    ran: 0,
    proposed: 0,
    failed: [] as Array<{ transcriptId: string; reason: string }>,
    skipped: [] as Array<{ transcriptId: string; reason: 'full' | 'out_of_time' }>,
  }
  const targeted = options.transcriptIds ? Array.from(new Set(options.transcriptIds)) : null

  // The slowest read this run has timed, never below the prior. Every read,
  // failed or not, feeds it: a read that took ninety seconds to throw is the
  // best evidence there is that the next one may too.
  let slowestRead = READ_ESTIMATE_MS
  const timed = async <T>(read: () => Promise<T>): Promise<T> => {
    const began = clock()
    try {
      return await read()
    } finally {
      slowestRead = Math.max(slowestRead, clock() - began)
    }
  }
  const readsPerCall = secondPass.enabled ? 2 : 1
  const fits = (reads: number): boolean => clock() - startedAt + reads * slowestRead <= budgetMs
  const readTimeout = (): number => Math.min(MODEL_READ_TIMEOUT_MS, budgetMs - (clock() - startedAt) - WRITE_RESERVE_MS)
  let modelReadSucceeded = false
  const read = (input: SuggestFromTranscriptInput): Promise<SuggestResult> => {
    const timeoutMs = readTimeout()
    if (timeoutMs <= 0) throw new SuggesterTimeoutError(timeoutMs)
    return timed(async () => {
      const began = clock()
      try {
        const result = await boundedRead(signal => suggest({ ...input, signal, timeoutMs }), timeoutMs)
        modelReadSucceeded = true
        return result
      } catch (error) {
        // An SDK timeout that reaches a shortened deadline is budget-limited
        // too. An earlier connection failure still belongs to the transcript.
        if (!(error instanceof SuggesterTimeoutError) && timeoutMs < MODEL_READ_TIMEOUT_MS
          && clock() - began >= timeoutMs && !Number.isFinite(modelErrorStatus(error)) && modelReadTimedOut(error)) {
          throw new SuggesterTimeoutError(timeoutMs)
        }
        throw error
      }
    })
  }
  let started = 0

  const summary: SweepSummary = {
    looked: 0,
    deferred: 0,
    deferredIds: [],
    eligible: 0,
    skipped: [],
    inserted: 0,
    duplicates: 0,
    dropped: 0,
    resurfaced: 0,
    costCents: 0,
    slackDelivered: 0,
    repaired: 0,
    dropReasons: {},
    secondPass,
  }

  const defer = (ids: string[]): void => {
    summary.deferredIds = [...new Set([...(summary.deferredIds ?? []), ...ids])]
    summary.deferred = summary.deferredIds.length
  }

  const providerFailures: Array<{ transcriptId: string; message: string }> = []
  const deferredFailure = async (transcriptId: string, message: string, stampOnExhaustion = true): Promise<boolean> => {
    const failures = await incrementDeferredFailures(database, transcriptId, nowIso)
    if (failures < MAX_DEFERRED_FAILURES) return false
    const skipped = {
      transcriptId,
      reason: `suggester_retry_limit: skipped after ${failures} deferred failures. Last failure: ${message}`,
    }
    const existing = summary.skipped.findIndex(item => item.transcriptId === transcriptId)
    if (existing >= 0) summary.skipped[existing] = skipped
    else summary.skipped.push(skipped)
    if (stampOnExhaustion) {
      await stamp(database, transcriptId, nowIso)
      await clearDeferredFailures(database, transcriptId)
    }
    return true
  }

  if (targeted && targeted.length === 0) {
    // Asked for nothing by name: not a licence to read the oldest five.
    return summary
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
      isNotNull(schema.callTranscripts.callId),
      // Named transcripts are read whatever their age and whatever their
      // mark; the window and the mark are the scheduled sweep's rules for
      // finding work, not rules about reading it.
      targeted
        ? inArray(schema.callTranscripts.id, targeted)
        : and(isNull(schema.callTranscripts.suggestedAt), gte(schema.callTranscripts.receivedAt, since)),
    ))
    .orderBy(asc(schema.callTranscripts.receivedAt))
    .limit(options.batch ?? (targeted ? targeted.length : SWEEP_BATCH))

  for (const [index, transcript] of transcripts.entries()) {
    // The budget, checked before anything is written for this transcript.
    // Everything from here on is left exactly as it was found: unread,
    // unstamped, and first in line for the next run, which also reads
    // oldest first.
    if (readTimeout() <= 0 || (started > 0 && !fits(readsPerCall))) {
      defer(transcripts.slice(index).map(t => t.id))
      break
    }

    summary.looked++
    const gate = await resolveCallGate(database, transcript.callKind, transcript.callId)

    if (!gate.eligible) {
      summary.skipped.push({ transcriptId: transcript.id, reason: gate.reason })
      await stamp(database, transcript.id, nowIso)
      await clearDeferredFailures(database, transcript.id)
      continue
    }

    summary.eligible++
    started++
    if (options.beforeRead) await options.beforeRead(transcript.id)

    let base: SuggestFromTranscriptInput
    let result: SuggestResult
    try {
      base = {
        transcript: transcript.text,
        wrapUp: transcript.wrapUp,
        callTitle: transcript.title,
        callDate: transcript.receivedAt.slice(0, 10),
        // What this client turned down lately rides in the same context, so
        // both reads of the call see it and the second reads it from the
        // cache (CN.3 section 7). The loader never throws.
        context: {
          ...(await buildSuggestionContext(database, gate.orgId, at)),
          rejected: await loadRejectedExamples(database, gate.orgId, at),
        },
      }
      const first = base
      result = await read(secondPass.enabled ? { ...first, cacheSource: true } : first)
    } catch (err) {
      // The summary has one slot for "this transcript produced nothing and
      // why", so a failure is reported there rather than in a field the
      // contract does not have. Transient failures remain unread for retry.
      const message = err instanceof Error ? err.message : String(err)
      summary.skipped.push({ transcriptId: transcript.id, reason: `suggester_failed: ${message}` })
      if (err instanceof SuggesterTimeoutError && err.timeoutMs < MODEL_READ_TIMEOUT_MS) {
        // The sweep ran out of usable time. This is not a transcript failure.
        defer(transcripts.slice(index).map(t => t.id))
        break
      }
      if (transientModelError(err) || modelReadTimedOut(err)) {
        if ([429, 529].includes(modelErrorStatus(err))) {
          defer(transcripts.slice(index).map(t => t.id))
          break
        }
        // A later transcript may be the first successful read in this run.
        // Wait for it before distinguishing an isolated failure from an outage.
        if (transientModelError(err)) {
          providerFailures.push({ transcriptId: transcript.id, message })
          defer([transcript.id])
          continue
        }
        const exhausted = await deferredFailure(transcript.id, message)
        if (!exhausted) defer([transcript.id])
        continue
      }
      await stamp(database, transcript.id, nowIso)
      await clearDeferredFailures(database, transcript.id)
      continue
    }

    const tally = (dropped: readonly DroppedSuggestion[]): void => {
      summary.dropped += dropped.length
      for (const d of dropped) summary.dropReasons[d.reason] = (summary.dropReasons[d.reason] ?? 0) + 1
    }

    tally(result.dropped)
    summary.costCents += await recordSpend(database, transcript, result.usage, 'suggest')

    // The second read (CN.1c): the same notes, the first read beside them,
    // and one question, "anything missed?". Its new items join the first
    // read's before the writer sees either, so both go through exactly one
    // dedupe. Skipped when the first read already filled the ceiling, since a
    // second read could add nothing, and when it would risk the budget.
    // Permanent failures and sweep-budget deadlines keep the first read.
    // Transient provider failures and full read deadlines leave it unread.
    let drafts = result.suggestions
    const room = MAX_SUGGESTIONS - drafts.length
    if (secondPass.enabled) {
      if (room <= 0) {
        secondPass.skipped.push({ transcriptId: transcript.id, reason: 'full' })
      } else if (!fits(1)) {
        secondPass.skipped.push({ transcriptId: transcript.id, reason: 'out_of_time' })
      } else {
        try {
          const firstDrafts = drafts
          const again = await read({ ...base, cacheSource: true, alreadyProposed: firstDrafts, maxNew: room })
          summary.costCents += await recordSpend(database, transcript, again.usage, 'second_pass')
          const merged = mergeSecondRead(drafts, again, room)
          tally(merged.dropped)
          secondPass.proposed += merged.added.length
          drafts = [...drafts, ...merged.added]
          // Counted last, so a second read whose answer never made it into
          // the drafts is a failure and not both.
          secondPass.ran++
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          secondPass.failed.push({ transcriptId: transcript.id, reason: `suggester_failed: ${message}` })
          const budgetDeadline = err instanceof SuggesterTimeoutError && err.timeoutMs < MODEL_READ_TIMEOUT_MS
          if (!budgetDeadline && (transientModelError(err) || modelReadTimedOut(err))) {
            if ([429, 529].includes(modelErrorStatus(err))) {
              defer(transcripts.slice(index).map(t => t.id))
              break
            }
            // The first read succeeded, so this is an isolated failure. At
            // the cap, keep its drafts and stamp only after they are written.
            const exhausted = await deferredFailure(transcript.id, message, false)
            if (!exhausted) {
              defer([transcript.id])
              continue
            }
          }
        }
      }
    }

    const written = await insertSuggestions(database, drafts.map(s => ({
      orgId: gate.orgId,
      sourceKind: 'call',
      transcriptId: transcript.id,
      callKind: transcript.callKind,
      callId: transcript.callId,
      kind: s.kind,
      targetTaskId: s.targetTaskId,
      targetRequestId: s.targetRequestId,
      proposal: s.proposal,
      quote: s.quote,
      rationale: s.rationale,
      confidence: s.confidence,
      approverType: 'founders',
    })))

    summary.inserted += written.inserted
    summary.duplicates += written.duplicates

    // The founders' DMs (CN.2 contract section 3). A pending suggestion
    // nobody sees is a suggestion nobody decides, so the same pass that wrote
    // them posts them. Only when something new landed, only the rows still
    // pending for THIS call, and never in a way that can fail the sweep: the
    // suggestions exist in the dashboard by now whatever Slack does.
    if (written.inserted > 0) {
      summary.slackDelivered = (summary.slackDelivered ?? 0) + await deliverToSlack(database, transcript.callId)
    }

    // A create the writer dropped because the same client already has one
    // waiting (CN.1d section 4). Counted beside the model's own drops so a
    // run log reads as one number for "proposed but not kept", with the
    // reason beside it.
    if (written.similarDropped > 0) {
      summary.dropped += written.similarDropped
      summary.dropReasons.similar_pending = (summary.dropReasons.similar_pending ?? 0) + written.similarDropped
    }

    await stamp(database, transcript.id, nowIso)
    await clearDeferredFailures(database, transcript.id)
  }

  if (modelReadSucceeded) {
    for (const failure of providerFailures) {
      if (await deferredFailure(failure.transcriptId, failure.message)) {
        summary.deferredIds = summary.deferredIds?.filter(id => id !== failure.transcriptId)
        summary.deferred = summary.deferredIds?.length ?? 0
      }
    }
  }

  summary.resurfaced = await resurfaceSnoozed(database, new Date(nowIso))
  summary.repaired = await repairOrglessSuggestions(database, nowIso)

  return summary
}

/**
 * Post one call's waiting suggestions to the founders' DMs.
 *
 * The token check comes FIRST and reads nothing when it fails, which is what
 * lets a studio with no Slack app run the sweep exactly as it ran before.
 * postSuggestionsForCall skips any row it has already posted, so handing it
 * every pending row for the call is safe on the second, third and fiftieth
 * run over the same call.
 */
async function deliverToSlack(database: Drizzle, callId: string | null): Promise<number> {
  if (!callId || !slackBotToken()) return 0
  try {
    const rows = await listSuggestions(database, { status: 'pending', callId, orgIds: 'all', limit: 50 })
    if (rows.length === 0) return 0
    const result = await postSuggestionsForCall(database, { rows })
    return result.posted
  } catch {
    // Slack is never the reason a sweep reports a failure. The rows are
    // written; the inbox has them; a founder can still decide in the
    // dashboard.
    return 0
  }
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

/**
 * One read's spend, logged against the transcript, in cents. Each read is its
 * own row with its own stage ('suggest' for the first, 'second_pass' for the
 * second), so "what did the second read cost" is one query on ai_cost_log.
 * A read that reached no model (the non-production fallback) logs nothing.
 */
async function recordSpend(
  database: Drizzle,
  transcript: { id: string; title: string | null },
  usage: SuggesterUsage,
  stage: 'suggest' | 'second_pass',
): Promise<number> {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return 0
  // The same cast /clients/[id]/health-summary uses: recordCost is typed
  // against the schema-aware handle from lib/db, and withCronRun hands a
  // bare D1 one. Same object, narrower type.
  return recordCost(database as unknown as Parameters<typeof recordCost>[0], {
    scope: 'call_suggestions',
    scopeId: transcript.id,
    stage,
    provider: 'anthropic',
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    note: transcript.title ?? undefined,
  })
}

async function stamp(database: Drizzle, transcriptId: string, at: string): Promise<void> {
  await database
    .update(schema.callTranscripts)
    .set({ suggestedAt: at })
    .where(eq(schema.callTranscripts.id, transcriptId))
}

async function incrementDeferredFailures(database: Drizzle, transcriptId: string, at: string): Promise<number> {
  const [counter] = await database
    .insert(schema.settings)
    .values({ key: `suggester.failures.${transcriptId}`, value: '1', updatedAt: at })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        value: sql`CAST(MAX(CAST(COALESCE(${schema.settings.value}, '0') AS INTEGER), 0) + 1 AS TEXT)`,
        updatedAt: at,
      },
    })
    .returning({ value: schema.settings.value })
  const failures = Number(counter?.value)
  if (!Number.isInteger(failures) || failures < 1) throw new Error('Transcript failure counter did not increment')
  return failures
}

async function clearDeferredFailures(database: Drizzle, transcriptId: string): Promise<void> {
  await database.delete(schema.settings).where(eq(schema.settings.key, `suggester.failures.${transcriptId}`))
}
