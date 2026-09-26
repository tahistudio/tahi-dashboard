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

export interface SuggestionContext {
  tasks: SuggestionContextTask[]
  requests: SuggestionContextRequest[]
  members: SuggestionContextMember[]
  contacts: SuggestionContextContact[]
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
   * The second read of each call (CN.1c). `ran` counts the transcripts read
   * twice, `proposed` the new items the second read found that the first
   * had not (before the writer's own dedupe, which may still find some of
   * them on file), `failed` the second reads that threw, whose first read was
   * written anyway. Optional because a summary written before this existed
   * is still a summary.
   */
  secondPass?: {
    enabled: boolean
    ran: number
    proposed: number
    failed: Array<{ transcriptId: string; reason: string }>
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
   * Read exactly these transcripts, if they are unread, whatever their age.
   * The rebuild uses it to re-read the calls it just un-read, straight away
   * and without the sweep window, which would otherwise leave a call older
   * than thirty days cleared and never read again. Keep it short: it goes
   * into one IN clause.
   */
  transcriptIds?: readonly string[]
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
 * LOOKED at, including the ones the gate rejected and the ones the model threw
 * on, because `suggested_at IS NULL` has to keep meaning "never looked at". A
 * failure that leaves the column null is a transcript this job re-reads, and
 * re-pays for, every thirty minutes until somebody notices the bill.
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
  const secondPass = {
    enabled: options.secondPass ?? true,
    ran: 0,
    proposed: 0,
    failed: [] as Array<{ transcriptId: string; reason: string }>,
  }
  const targeted = options.transcriptIds ? Array.from(new Set(options.transcriptIds)) : null

  const summary: SweepSummary = {
    looked: 0,
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
      isNull(schema.callTranscripts.suggestedAt),
      isNotNull(schema.callTranscripts.callId),
      // Named transcripts are read whatever their age; the window is the
      // scheduled sweep's rule for finding work, not a rule about reading it.
      targeted
        ? inArray(schema.callTranscripts.id, targeted)
        : gte(schema.callTranscripts.receivedAt, since),
    ))
    .orderBy(asc(schema.callTranscripts.receivedAt))
    .limit(options.batch ?? (targeted ? targeted.length : SWEEP_BATCH))

  summary.looked = transcripts.length

  for (const transcript of transcripts) {
    const gate = await resolveCallGate(database, transcript.callKind, transcript.callId)

    if (!gate.eligible) {
      summary.skipped.push({ transcriptId: transcript.id, reason: gate.reason })
      await stamp(database, transcript.id, nowIso)
      continue
    }

    summary.eligible++

    let base: SuggestFromTranscriptInput
    let result: SuggestResult
    try {
      base = {
        transcript: transcript.text,
        wrapUp: transcript.wrapUp,
        callTitle: transcript.title,
        callDate: transcript.receivedAt.slice(0, 10),
        context: await buildSuggestionContext(database, gate.orgId, at),
      }
      result = await suggest(secondPass.enabled ? { ...base, cacheSource: true } : base)
    } catch (err) {
      // The summary has one slot for "this transcript produced nothing and
      // why", so a failure is reported there rather than in a field the
      // contract does not have. The stamp still goes on.
      const message = err instanceof Error ? err.message : String(err)
      summary.skipped.push({ transcriptId: transcript.id, reason: `suggester_failed: ${message}` })
      await stamp(database, transcript.id, nowIso)
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
    // second read could add nothing. A failure here costs the second read
    // only: the first is already in hand and is written regardless.
    let drafts = result.suggestions
    const room = MAX_SUGGESTIONS - drafts.length
    if (secondPass.enabled && room > 0) {
      secondPass.ran++
      try {
        const again = await suggest({ ...base, cacheSource: true, alreadyProposed: drafts, maxNew: room })
        summary.costCents += await recordSpend(database, transcript, again.usage, 'second_pass')
        const merged = mergeSecondRead(drafts, again, room)
        tally(merged.dropped)
        secondPass.proposed += merged.added.length
        drafts = [...drafts, ...merged.added]
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        secondPass.failed.push({ transcriptId: transcript.id, reason: `suggester_failed: ${message}` })
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
