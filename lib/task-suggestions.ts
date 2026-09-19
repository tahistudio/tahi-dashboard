/**
 * lib/task-suggestions.ts
 *
 * The approval gate between "a call said so" and "the work changed".
 *
 * Every source (a transcribed call now; typed notes, voice and Slack later)
 * writes `task_suggestions` rows, every approval surface reads them, and a
 * decision is recorded once wherever it was made. That is what lets the
 * dashboard and Slack agree, what makes "approve tonight" possible, and what
 * keeps the bot honest: nothing a model read out of a transcript reaches a
 * task or a request without a founder saying so.
 *
 * TASKS AND REQUESTS, not just tasks (CN.1b). The table keeps its name, but a
 * suggestion is about one of two things: a REQUEST, which is the client-facing
 * work a call with a client mostly produces, or a TASK, which is the studio's
 * own follow-up. Which family a row belongs to is its `kind`, and the two
 * pointers (targetTaskId, targetRequestId) are never both set.
 *
 * Applying goes through lib/task-writes.ts and lib/request-writes.ts, which
 * are the same code the task and request routes use, so an approved
 * suggestion and a hand-typed edit obey one set of rules rather than two that
 * drift.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { NextResponse } from 'next/server'
import { and, eq, inArray, isNull, or, desc } from 'drizzle-orm'
import { schema, type DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { normalizeCallInstant, STUDIO_TIME_ZONE } from '@/lib/call-time'
import { requireAccessToOrg } from '@/lib/require-access'
import { handoffReasonShortLabel } from '@/lib/request-handoff-copy'
import {
  createRequestRecord,
  handOffRequest,
  updateRequestRecord,
  type RequestPatchInput,
  type RequestWriteActor,
} from '@/lib/request-writes'
import { TAHI_BOT } from '@/lib/tahi-bot'
import { postRequestBotMessage, postTaskComment } from '@/lib/task-comments'
import { createTaskRecord, updateTaskRecord, type TaskPatchInput } from '@/lib/task-writes'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Ids per IN clause. D1 caps bound parameters at 100 per statement. */
const ID_CHUNK = 90

function chunk<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += ID_CHUNK) out.push(items.slice(index, index + ID_CHUNK))
  return out
}

// ── the vocabulary ───────────────────────────────────────────────────────────

/**
 * What a suggestion proposes.
 *
 * TWO FAMILIES, and the split is the Tasks vs Requests model rather than a
 * naming accident. Requests are the client-facing work; tasks run the studio.
 * A call with a client therefore mostly yields requests, updates to requests
 * and hand-offs (the client owes something on a request), while the studio's
 * own follow-ups stay tasks. One suggestion is never both.
 *
 * `note` and `request_note` change nothing: they are a line for a thread,
 * which is the honest answer when a call said something worth recording that
 * is not a change to anything.
 */
export type SuggestionKind =
  | 'create_task' | 'update_task' | 'complete_task' | 'add_subtasks' | 'note'
  | 'create_request' | 'update_request' | 'request_note' | 'hand_off_request'

export type SuggestionStatus = 'pending' | 'snoozed' | 'applied' | 'rejected' | 'expired' | 'failed'

/** The studio's own follow-ups. */
export const TASK_KINDS: readonly SuggestionKind[] = ['create_task', 'update_task', 'complete_task', 'add_subtasks', 'note']

/** The client-facing half (CN.1b). */
export const REQUEST_KINDS: readonly SuggestionKind[] = ['create_request', 'update_request', 'request_note', 'hand_off_request']

/** Every kind the suggester may propose and the gate may apply. */
export const KINDS: readonly SuggestionKind[] = [...TASK_KINDS, ...REQUEST_KINDS]

/** Every task kind but create_task names the task it is about. */
export const KINDS_NEEDING_TARGET: readonly SuggestionKind[] = ['update_task', 'complete_task', 'add_subtasks', 'note']

/** Every request kind but create_request names the request it is about. */
export const KINDS_NEEDING_REQUEST_TARGET: readonly SuggestionKind[] = ['update_request', 'request_note', 'hand_off_request']

/**
 * The fields an update_request may write.
 *
 * A whitelist rather than "whatever the model put in `fields`", because the
 * PATCH route accepts more than a call should be allowed to move: a title or
 * a description rewritten from a half-heard sentence changes what the CLIENT
 * sees on their own request, which is not a thing to do from a transcript.
 */
export const UPDATABLE_REQUEST_FIELDS = [
  'status', 'priority', 'dueDate', 'startDate', 'estimatedHours', 'category', 'scopeFlagged',
] as const

export type DecisionVia = 'dashboard' | 'slack' | 'mcp'

/**
 * Tweak in the UI is an approve carrying the edited proposal, not a fifth
 * verb: the row records what was actually applied rather than what the model
 * first wrote.
 */
export type DecisionInput =
  | { action: 'approve'; proposalOverride?: unknown }
  | { action: 'reject' }
  | { action: 'snooze'; until: string }

export interface DecisionContext {
  actorId: string
  via: DecisionVia
}

/** One stored row, every column, in the shape both surfaces read. */
export interface SuggestionRow {
  id: string
  orgId: string | null
  sourceKind: string
  transcriptId: string | null
  callKind: string | null
  callId: string | null
  kind: string
  targetTaskId: string | null
  targetRequestId: string | null
  proposal: string
  quote: string
  rationale: string | null
  confidence: number | null
  status: string
  snoozeUntil: string | null
  approverType: string
  approverId: string | null
  decidedById: string | null
  decidedVia: string | null
  decidedAt: string | null
  appliedAt: string | null
  appliedTaskId: string | null
  appliedRequestId: string | null
  applyError: string | null
  dedupeKey: string
  slackChannelId: string | null
  slackMessageTs: string | null
  createdAt: string
  updatedAt: string
}

/** A row with the names a reader needs, resolved once on the server. */
export interface DecoratedSuggestion extends Omit<SuggestionRow, 'proposal'> {
  /** The stored JSON, parsed once at the boundary so readers see the shapes in the contract. */
  proposal: unknown
  callTitle: string | null
  callScheduledAt: string | null
  orgName: string | null
  targetTaskTitle: string | null
  targetTaskStatus: string | null
  /** The target request, for the request kinds. Null when there is none. */
  targetRequestNumber: number | null
  targetRequestTitle: string | null
  targetRequestStatus: string | null
}

/** A suggestion on its way in, before it has an id or a dedupe key. */
export interface SuggestionDraft {
  orgId: string | null
  sourceKind: string
  transcriptId: string | null
  callKind: string | null
  callId: string | null
  kind: SuggestionKind
  targetTaskId: string | null
  targetRequestId?: string | null
  proposal: unknown
  quote: string
  rationale?: string | null
  confidence?: number | null
  approverType?: 'founders' | 'member' | 'contact'
  approverId?: string | null
}

export interface DecisionResult {
  suggestion: SuggestionRow
  changed: boolean
  appliedTaskId?: string | null
  appliedRequestId?: string | null
  /**
   * Why an approve came back unchanged, when the reason is something the
   * human can fix rather than a fault. The one value today is
   * 'contact_required': a hand-off the model could not resolve to a person.
   */
  error?: string
}

export interface ApplyOutcome {
  ok: boolean
  appliedTaskId: string | null
  appliedRequestId: string | null
  error: string | null
}

/** The refusal an approve gets when a hand-off names nobody the gate can use. */
export const CONTACT_REQUIRED = 'contact_required'

/** The current timestamp, in the shape every other writer in this repo stamps. */
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ── the dedupe key ───────────────────────────────────────────────────────────

export interface DedupeInput {
  sourceKind: string
  transcriptId: string | null
  kind: SuggestionKind
  targetTaskId?: string | null
  targetRequestId?: string | null
  proposal: unknown
}

/** JSON with its keys in a fixed order, so two equal objects hash the same. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * The part of the key that says WHICH change this is.
 *
 * A create is its title, lower-cased and whitespace-collapsed, because a
 * model asked twice for the same work writes "Cut the hero video" and "cut
 * the  hero video" and those are one suggestion, not two. An update is its
 * field diff with the keys sorted, because object key order is not meaning.
 * A note is the first 80 characters of its body, which is long enough to
 * separate two real notes and short enough that a reworded tail does not
 * split one.
 */
function normalisedTitleOrDiff(kind: SuggestionKind, proposal: unknown): string {
  const record = (proposal && typeof proposal === 'object' ? proposal : {}) as Record<string, unknown>
  if (kind === 'create_task' || kind === 'create_request') {
    return collapse(String(record.title ?? '')).toLowerCase()
  }
  if (kind === 'note' || kind === 'request_note') {
    return collapse(String(record.body ?? '')).toLowerCase().slice(0, 80)
  }
  if (kind === 'update_task' || kind === 'update_request') return stableJson(record.fields ?? {})
  // A hand-off is one ask per person per request: the same person asked for
  // twice off one call is one row however the reason and the note are worded
  // the second time, so only the name enters the key.
  if (kind === 'hand_off_request') return collapse(String(record.contactName ?? '')).toLowerCase()
  return stableJson(record)
}

/**
 * sha-256 hex over the source, the kind, the target and the normalised
 * change. Web Crypto, because this runs on Workers where node:crypto does
 * not. The UNIQUE index on the column is what actually enforces it; this is
 * what makes a second run over the same transcript produce the same answer to
 * compare against.
 *
 * ONE TARGET SLOT for both families, filled by whichever of the two pointers
 * a row carries. A request kind never carries a targetTaskId, so every key
 * written before CN.1b hashes to exactly what it did: adding a separate slot
 * would have changed the material for every existing task row and orphaned
 * every dedupe key already on production.
 */
export async function buildDedupeKey(input: DedupeInput): Promise<string> {
  const material = [
    input.sourceKind,
    input.transcriptId ?? '',
    input.kind,
    input.targetRequestId ?? input.targetTaskId ?? '',
    normalisedTitleOrDiff(input.kind, input.proposal),
  ].join(':')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

// ── writing ──────────────────────────────────────────────────────────────────

/**
 * Insert a batch, skipping anything already on the table and anything the
 * batch proposes twice.
 *
 * Duplicates are counted rather than reported as an error: a cron re-reading
 * a transcript it has already seen is the normal case, not a fault, and the
 * summary reads better for saying so.
 */
export async function insertSuggestions(
  drizzle: Drizzle,
  drafts: readonly SuggestionDraft[],
): Promise<{ inserted: number; duplicates: number }> {
  if (drafts.length === 0) return { inserted: 0, duplicates: 0 }

  const keyed = await Promise.all(drafts.map(async draft => ({
    draft,
    dedupeKey: await buildDedupeKey({
      sourceKind: draft.sourceKind,
      transcriptId: draft.transcriptId,
      kind: draft.kind,
      targetTaskId: draft.targetTaskId,
      targetRequestId: draft.targetRequestId ?? null,
      proposal: draft.proposal,
    }),
  })))

  const existing = new Set<string>()
  for (const batch of chunk(keyed.map(entry => entry.dedupeKey))) {
    const rows = await drizzle
      .select({ dedupeKey: schema.taskSuggestions.dedupeKey })
      .from(schema.taskSuggestions)
      .where(inArray(schema.taskSuggestions.dedupeKey, batch))
    for (const row of rows) existing.add(row.dedupeKey)
  }

  const stamp = now()
  let inserted = 0
  let duplicates = 0

  for (const entry of keyed) {
    if (existing.has(entry.dedupeKey)) {
      duplicates++
      continue
    }
    // Added to the seen set before the write, so a batch proposing the same
    // change twice inserts it once.
    existing.add(entry.dedupeKey)

    await drizzle.insert(schema.taskSuggestions).values({
      id: crypto.randomUUID(),
      orgId: entry.draft.orgId,
      sourceKind: entry.draft.sourceKind,
      transcriptId: entry.draft.transcriptId,
      callKind: entry.draft.callKind,
      callId: entry.draft.callId,
      kind: entry.draft.kind,
      targetTaskId: entry.draft.targetTaskId,
      targetRequestId: entry.draft.targetRequestId ?? null,
      proposal: JSON.stringify(entry.draft.proposal ?? null),
      quote: entry.draft.quote,
      rationale: entry.draft.rationale ?? null,
      confidence: entry.draft.confidence ?? null,
      status: 'pending',
      approverType: entry.draft.approverType ?? 'founders',
      approverId: entry.draft.approverId ?? null,
      dedupeKey: entry.dedupeKey,
      createdAt: stamp,
      updatedAt: stamp,
    })
    inserted++
  }

  return { inserted, duplicates }
}

// ── reading ──────────────────────────────────────────────────────────────────

const SUGGESTION_COLUMNS = {
  id: schema.taskSuggestions.id,
  orgId: schema.taskSuggestions.orgId,
  sourceKind: schema.taskSuggestions.sourceKind,
  transcriptId: schema.taskSuggestions.transcriptId,
  callKind: schema.taskSuggestions.callKind,
  callId: schema.taskSuggestions.callId,
  kind: schema.taskSuggestions.kind,
  targetTaskId: schema.taskSuggestions.targetTaskId,
  targetRequestId: schema.taskSuggestions.targetRequestId,
  proposal: schema.taskSuggestions.proposal,
  quote: schema.taskSuggestions.quote,
  rationale: schema.taskSuggestions.rationale,
  confidence: schema.taskSuggestions.confidence,
  status: schema.taskSuggestions.status,
  snoozeUntil: schema.taskSuggestions.snoozeUntil,
  approverType: schema.taskSuggestions.approverType,
  approverId: schema.taskSuggestions.approverId,
  decidedById: schema.taskSuggestions.decidedById,
  decidedVia: schema.taskSuggestions.decidedVia,
  decidedAt: schema.taskSuggestions.decidedAt,
  appliedAt: schema.taskSuggestions.appliedAt,
  appliedTaskId: schema.taskSuggestions.appliedTaskId,
  appliedRequestId: schema.taskSuggestions.appliedRequestId,
  applyError: schema.taskSuggestions.applyError,
  dedupeKey: schema.taskSuggestions.dedupeKey,
  slackChannelId: schema.taskSuggestions.slackChannelId,
  slackMessageTs: schema.taskSuggestions.slackMessageTs,
  createdAt: schema.taskSuggestions.createdAt,
  updatedAt: schema.taskSuggestions.updatedAt,
}

export interface ListSuggestionsOptions {
  status?: string
  callId?: string | null
  /**
   * 'all' is an unrestricted caller. A list of ids is a scoped one, and a
   * suggestion with no client is studio housekeeping that every admin sees,
   * exactly as the tasks list treats a task with no client: SQL `IN` never
   * matches NULL, so the isNull has to be spelled out or the whole
   * studio-internal half of the view vanishes for anyone scoped.
   */
  orgIds?: string[] | 'all'
  limit?: number
}

/** One suggestion, whole, or null when the id names nothing. */
export async function loadSuggestion(drizzle: Drizzle, id: string): Promise<SuggestionRow | null> {
  const [row] = await drizzle
    .select(SUGGESTION_COLUMNS)
    .from(schema.taskSuggestions)
    .where(eq(schema.taskSuggestions.id, id))
    .limit(1)
  return (row as SuggestionRow | undefined) ?? null
}

function scopeCondition(orgIds: string[] | 'all' | undefined) {
  if (orgIds === undefined || orgIds === 'all') return null
  if (orgIds.length === 0) return isNull(schema.taskSuggestions.orgId)
  return or(inArray(schema.taskSuggestions.orgId, orgIds), isNull(schema.taskSuggestions.orgId))!
}

/** Suggestions with the names a reader needs, resolved once on the server. */
export async function listSuggestions(
  drizzle: Drizzle,
  options: ListSuggestionsOptions,
): Promise<DecoratedSuggestion[]> {
  const conditions = []
  if (options.status && options.status !== 'all') {
    conditions.push(eq(schema.taskSuggestions.status, options.status))
  }
  if (options.callId) conditions.push(eq(schema.taskSuggestions.callId, options.callId))
  const scoped = scopeCondition(options.orgIds)
  if (scoped) conditions.push(scoped)

  const rows = await drizzle
    .select(SUGGESTION_COLUMNS)
    .from(schema.taskSuggestions)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.taskSuggestions.createdAt))
    .limit(options.limit ?? 100) as SuggestionRow[]

  return decorate(drizzle, rows)
}

export interface SuggestionCounts {
  pending: number
  snoozed: number
  /** Distinct calls with at least one pending suggestion. */
  calls: number
}

/**
 * The three numbers the inbox badge and the owner home card read.
 *
 * Counted in JS over the open rows rather than with three COUNT queries: the
 * open set is small by construction (a suggestion is either decided within a
 * day or it is a problem), and "how many calls" is a distinct count the other
 * two have to agree with, which is easier to keep true from one read.
 */
export async function countSuggestions(
  drizzle: Drizzle,
  options: { orgIds?: string[] | 'all' } = {},
): Promise<SuggestionCounts> {
  const conditions = [inArray(schema.taskSuggestions.status, ['pending', 'snoozed'])]
  const scoped = scopeCondition(options.orgIds)
  if (scoped) conditions.push(scoped)

  const rows = await drizzle
    .select({ status: schema.taskSuggestions.status, callId: schema.taskSuggestions.callId })
    .from(schema.taskSuggestions)
    .where(and(...conditions))

  const open = rows.filter(row => row.status === 'pending' || row.status === 'snoozed')
  const pendingRows = open.filter(row => row.status === 'pending')

  return {
    pending: pendingRows.length,
    snoozed: open.filter(row => row.status === 'snoozed').length,
    calls: new Set(pendingRows.map(row => row.callId).filter(Boolean)).size,
  }
}

/** The stored JSON as an object; unreadable text stays a string so nothing crashes on it. */
function parseProposalLoose(proposal: string): unknown {
  try {
    return JSON.parse(proposal)
  } catch {
    return proposal
  }
}

async function decorate(drizzle: Drizzle, rows: SuggestionRow[]): Promise<DecoratedSuggestion[]> {
  if (rows.length === 0) return []

  const orgIds = unique(rows.map(row => row.orgId))
  const taskIds = unique(rows.map(row => row.targetTaskId))
  const requestIds = unique(rows.map(row => row.targetRequestId))
  const discoveryIds = unique(rows.filter(row => row.callKind === 'discovery').map(row => row.callId))
  const scheduledIds = unique(rows.filter(row => row.callKind === 'scheduled').map(row => row.callId))

  const orgNames = new Map<string, string>()
  for (const batch of chunk(orgIds)) {
    const found = await drizzle
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .where(inArray(schema.organisations.id, batch))
    for (const row of found) orgNames.set(row.id, row.name)
  }

  const tasks = new Map<string, { title: string; status: string }>()
  for (const batch of chunk(taskIds)) {
    const found = await drizzle
      .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, batch))
    for (const row of found) tasks.set(row.id, { title: row.title, status: row.status })
  }

  // The target request, for the request kinds. The NUMBER comes with it
  // because that is how a request is named to a human: "#12 Homepage
  // refresh", never its uuid.
  const requests = new Map<string, { number: number | null; title: string; status: string }>()
  for (const batch of chunk(requestIds)) {
    const found = await drizzle
      .select({
        id: schema.requests.id,
        requestNumber: schema.requests.requestNumber,
        title: schema.requests.title,
        status: schema.requests.status,
      })
      .from(schema.requests)
      .where(inArray(schema.requests.id, batch))
    for (const row of found) {
      requests.set(row.id, { number: row.requestNumber ?? null, title: row.title, status: row.status })
    }
  }

  const calls = new Map<string, { title: string; scheduledAt: string }>()
  for (const batch of chunk(discoveryIds)) {
    const found = await drizzle
      .select({ id: schema.discoveryCalls.id, title: schema.discoveryCalls.title, scheduledAt: schema.discoveryCalls.scheduledAt })
      .from(schema.discoveryCalls)
      .where(inArray(schema.discoveryCalls.id, batch))
    for (const row of found) calls.set(`discovery:${row.id}`, { title: row.title, scheduledAt: row.scheduledAt })
  }
  for (const batch of chunk(scheduledIds)) {
    const found = await drizzle
      .select({ id: schema.scheduledCalls.id, title: schema.scheduledCalls.title, scheduledAt: schema.scheduledCalls.scheduledAt })
      .from(schema.scheduledCalls)
      .where(inArray(schema.scheduledCalls.id, batch))
    for (const row of found) calls.set(`scheduled:${row.id}`, { title: row.title, scheduledAt: row.scheduledAt })
  }

  return rows.map(row => {
    const call = row.callKind && row.callId ? calls.get(`${row.callKind}:${row.callId}`) ?? null : null
    const task = row.targetTaskId ? tasks.get(row.targetTaskId) ?? null : null
    const request = row.targetRequestId ? requests.get(row.targetRequestId) ?? null : null
    return {
      ...row,
      proposal: parseProposalLoose(row.proposal),
      callTitle: call?.title ?? null,
      callScheduledAt: call?.scheduledAt ?? null,
      orgName: row.orgId ? orgNames.get(row.orgId) ?? null : null,
      targetTaskTitle: task?.title ?? null,
      targetTaskStatus: task?.status ?? null,
      targetRequestNumber: request?.number ?? null,
      targetRequestTitle: request?.title ?? null,
      targetRequestStatus: request?.status ?? null,
    }
  })
}

function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

/**
 * The access rule for one suggestion, which is the rule its client already
 * has. A suggestion with no client is studio housekeeping and is open to
 * every team member on this surface, the same answer `guardTask` gives for a
 * task with no client.
 */
export async function guardSuggestion(
  drizzle: Drizzle,
  userId: string | null,
  row: SuggestionRow,
): Promise<NextResponse | null> {
  if (!row.orgId) return null
  return requireAccessToOrg(drizzle, userId, row.orgId)
}

// ── snoozing ─────────────────────────────────────────────────────────────────

/** The wall-clock parts of an instant, read in the studio's own zone. */
function studioParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(at)
  const value = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: Math.max(0, weekdays.indexOf(value('weekday'))),
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * A wall-clock time in the studio's zone, as the absolute instant it names.
 * Built through lib/call-time.ts so the NZST / NZDT transition is read from
 * the platform's own tz database rather than from a hardcoded offset.
 */
function studioInstant(year: number, month: number, day: number, hour: number): string {
  const naive = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00`
  return normalizeCallInstant(naive) ?? new Date().toISOString()
}

/** The calendar date `days` after a given one, as year / month / day. */
function addDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

export type SnoozePresetName = 'tonight' | 'this_week'

/**
 * The two snoozes the studio actually uses.
 *
 * Tonight is 7pm in Auckland today, or tomorrow once 7pm has gone: a
 * suggestion snoozed at 9pm that resurfaced two hours later would be a bell
 * rather than a snooze. This week is Friday 9am, or next Friday once this
 * Friday's has passed, which is the same rule one day at a time.
 */
export function snoozePreset(preset: SnoozePresetName, at: Date = new Date()): string {
  const parts = studioParts(at)

  if (preset === 'tonight') {
    const target = parts.hour < 19
      ? { year: parts.year, month: parts.month, day: parts.day }
      : addDays(parts.year, parts.month, parts.day, 1)
    return studioInstant(target.year, target.month, target.day, 19)
  }

  // Friday is weekday 5. A Friday before 9am still counts as this Friday;
  // from Saturday the modulo already walks forward to the next one.
  let daysAhead = (5 - parts.weekday + 7) % 7
  if (daysAhead === 0 && parts.hour >= 9) daysAhead = 7
  const target = addDays(parts.year, parts.month, parts.day, daysAhead)
  return studioInstant(target.year, target.month, target.day, 9)
}

/**
 * Snoozed rows whose time has come go back to pending.
 *
 * The comparison is made here rather than in SQL on purpose: a snooze coming
 * due is the one behaviour of this function, and a rule that lives only
 * inside a `lte` cannot be exercised. The query narrows to snoozed rows; this
 * decides which of them are due.
 */
export async function resurfaceSnoozed(drizzle: Drizzle, at: Date = new Date()): Promise<number> {
  const rows = await drizzle
    .select({ id: schema.taskSuggestions.id, snoozeUntil: schema.taskSuggestions.snoozeUntil })
    .from(schema.taskSuggestions)
    .where(eq(schema.taskSuggestions.status, 'snoozed'))

  const cutoff = at.toISOString()
  const due = rows.filter(row => row.snoozeUntil !== null && row.snoozeUntil <= cutoff).map(row => row.id)
  if (due.length === 0) return 0

  const stamp = now()
  for (const batch of chunk(due)) {
    await drizzle
      .update(schema.taskSuggestions)
      .set({ status: 'pending', snoozeUntil: null, updatedAt: stamp })
      .where(inArray(schema.taskSuggestions.id, batch))
  }

  return due.length
}

// ── applying ─────────────────────────────────────────────────────────────────

interface CallHeader {
  title: string | null
  date: string | null
}

async function loadCallHeader(drizzle: Drizzle, row: SuggestionRow): Promise<CallHeader> {
  if (!row.callId) return { title: null, date: null }

  if (row.callKind === 'discovery') {
    const [call] = await drizzle
      .select({ title: schema.discoveryCalls.title, scheduledAt: schema.discoveryCalls.scheduledAt })
      .from(schema.discoveryCalls)
      .where(eq(schema.discoveryCalls.id, row.callId))
      .limit(1)
    return { title: call?.title ?? null, date: call?.scheduledAt ?? null }
  }

  if (row.callKind === 'scheduled') {
    const [call] = await drizzle
      .select({ title: schema.scheduledCalls.title, scheduledAt: schema.scheduledCalls.scheduledAt })
      .from(schema.scheduledCalls)
      .where(eq(schema.scheduledCalls.id, row.callId))
      .limit(1)
    return { title: call?.title ?? null, date: call?.scheduledAt ?? null }
  }

  return { title: null, date: null }
}

/**
 * The line the Tahi bot leaves on the task.
 *
 * It names the call because a reader three weeks later needs to know where
 * this came from, and the quote rides alongside it (postTaskComment renders a
 * quote above the body) so the line can always be checked against what was
 * actually said.
 */
function botLine(header: CallHeader, fallbackDate: string, description: string): string {
  const source = header.title ? `the call "${header.title}"` : 'the call notes'
  const date = (header.date ?? fallbackDate).slice(0, 10)
  return `Applied from ${source} (${date}): ${description}`
}

function parseProposal(proposal: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(proposal)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** "status to in_progress, due date to 2026-10-02", for the bot line. */
function describeFields(fields: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    dueDate: 'due date',
    startDate: 'start date',
    assigneeId: 'assignee',
    estimatedHours: 'estimate',
    category: 'category',
    scopeFlagged: 'scope flag',
  }
  const parts = Object.entries(fields)
    .filter(([key]) => key in labels)
    .map(([key, value]) => `${labels[key]} to ${String(value)}`)
  return parts.length ? parts.join(', ') : 'nothing that could be read'
}

/** A trimmed string, or null. The shape most of a proposal is read in. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * The subset of a proposed field diff a call suggestion may actually write.
 *
 * Anything outside UPDATABLE_REQUEST_FIELDS is dropped rather than refused:
 * a model that also proposed a title rewrite has still said something useful
 * about the status, and the human approving it should get the useful half
 * rather than an error. What it must never do is let the title through.
 */
function requestPatchFrom(fields: unknown): RequestPatchInput {
  const record = (fields && typeof fields === 'object' ? fields : {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const key of UPDATABLE_REQUEST_FIELDS) {
    if (record[key] !== undefined) patch[key] = record[key]
  }
  return patch as RequestPatchInput
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
}

/**
 * The contact a hand-off proposal names, if the suggester could resolve one.
 *
 * Exported because `decideSuggestion` has to ask this BEFORE it applies:
 * a hand-off with nobody resolved is a suggestion the human has to finish,
 * not a write that failed.
 */
export function handOffContactId(proposal: unknown): string | null {
  const record = (proposal && typeof proposal === 'object' ? proposal : {}) as Record<string, unknown>
  return text(record.contactId)
}

/**
 * Apply one REQUEST suggestion: the request change, the bot line on that
 * request's thread, the audit entry.
 *
 * Split out of `applySuggestion` rather than folded into its chain of
 * branches because the two families share almost nothing: a different writer
 * module, a different thread, a different pointer column. The caller's
 * try/catch still wraps this, so it may throw for the same reasons.
 */
async function applyRequestSuggestion(
  drizzle: Drizzle,
  row: SuggestionRow,
  ctx: DecisionContext,
  proposal: Record<string, unknown>,
  actor: RequestWriteActor,
): Promise<ApplyOutcome> {
  const needsTarget = (KINDS_NEEDING_REQUEST_TARGET as readonly string[]).includes(row.kind)
  if (needsTarget && !row.targetRequestId) {
    return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This suggestion names no request to change' }
  }

  let requestId: string | null = row.targetRequestId
  let description = ''

  if (row.kind === 'create_request') {
    // The client is the suggestion's own org, never something read out of the
    // proposal: the sweep resolved it from the call, and a model naming a
    // different client would be filing one client's work under another.
    if (!row.orgId) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This suggestion names no client to file the request under' }
    }

    const created = await createRequestRecord(drizzle, {
      clientOrgId: row.orgId,
      title: text(proposal.title) ?? '',
      description: text(proposal.description),
      category: text(proposal.category) ?? undefined,
      type: text(proposal.type) ?? undefined,
      priority: text(proposal.priority) ?? undefined,
      dueDate: text(proposal.dueDate),
    }, actor)
    if (!created.ok) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: created.failure.error }
    }

    requestId = created.request.id
    // The requester rides in the line rather than in a column: `submitted_by`
    // is a studio identity on this path, and naming the person who asked is
    // what a reader of the thread actually wants.
    const requester = text(proposal.requesterName)
    description = requester
      ? `New request created for ${requester}: ${created.request.title}`
      : `New request created: ${created.request.title}`
  } else if (row.kind === 'update_request') {
    const fields = requestPatchFrom(proposal.fields)
    const updated = await updateRequestRecord(drizzle, row.targetRequestId!, fields, actor)
    if (!updated.ok) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: updated.failure.error }
    }
    const note = text(proposal.note)
    description = `Updated ${describeFields(fields as Record<string, unknown>)}.${note ? ` ${note}` : ''}`
  } else if (row.kind === 'request_note') {
    description = text(proposal.body) ?? ''
    if (!description) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This note has no body' }
    }
  } else if (row.kind === 'hand_off_request') {
    const contactId = handOffContactId(proposal)
    if (!contactId) {
      // decideSuggestion refuses this before it gets here; this is the same
      // answer for anything that calls applySuggestion directly.
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: CONTACT_REQUIRED }
    }

    const handedOff = await handOffRequest(drizzle, row.targetRequestId!, {
      contactId,
      reason: text(proposal.reason) ?? 'other',
      dueAt: text(proposal.dueAt),
      note: text(proposal.note),
    }, actor)
    if (!handedOff.ok) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: handedOff.failure.error }
    }

    // The studio's own words, not the client's: HANDOFF_REASON_SENTENCE is
    // written in second person ("Needs your approval") for the email the
    // contact reads, which would be nonsense on an internal thread.
    const who = handedOff.handOff.waitingOn.contactName ?? text(proposal.contactName) ?? 'the client'
    description = `Handed to ${who}, waiting on ${handoffReasonShortLabel(handedOff.handOff.waitingOn.reason)}`
  } else {
    return { ok: false, appliedTaskId: null, appliedRequestId: null, error: `Unknown suggestion kind "${row.kind}"` }
  }

  if (!requestId) {
    return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This suggestion names no request to change' }
  }

  const header = await loadCallHeader(drizzle, row)

  // One internal line on the request's own thread, as the Tahi bot, with the
  // quote above it. Never client-visible: this is the studio's record of what
  // a call changed, not a message to the client.
  await postRequestBotMessage(drizzle, requestId, {
    body: botLine(header, row.createdAt, description),
    quote: row.quote,
  })

  await logAudit(drizzle as unknown as DB, {
    action: 'task_suggestion.applied',
    userId: null,
    userType: 'system',
    entityType: 'task_suggestion',
    entityId: row.id,
    metadata: { suggestionId: row.id, via: ctx.via, decidedById: ctx.actorId, requestId },
  })

  return { ok: true, appliedTaskId: null, appliedRequestId: requestId, error: null }
}

/**
 * Apply one suggestion: the task change, the bot line, the audit entry.
 *
 * NEVER THROWS. A decision made in the dashboard (and, from Phase 2, in
 * Slack) must record what happened even when the apply fails, or the row sits
 * pending forever and the founder clicks again. Every failure comes back as
 * `{ ok: false, error }` for `decideSuggestion` to write onto the row.
 */
export async function applySuggestion(
  drizzle: Drizzle,
  row: SuggestionRow,
  ctx: DecisionContext,
): Promise<ApplyOutcome> {
  try {
    const proposal = parseProposal(row.proposal)
    const actor = { actorType: 'system' as const, actorId: ctx.actorId }

    if ((REQUEST_KINDS as readonly string[]).includes(row.kind)) {
      return applyRequestSuggestion(drizzle, row, ctx, proposal, actor)
    }

    const needsTarget = (KINDS_NEEDING_TARGET as readonly string[]).includes(row.kind)
    if (needsTarget && !row.targetTaskId) {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This suggestion names no task to change' }
    }

    let taskId: string | null = row.targetTaskId
    let description = ''

    if (row.kind === 'create_task') {
      const created = await createTaskRecord(drizzle, {
        title: typeof proposal.title === 'string' ? proposal.title : '',
        type: typeof proposal.type === 'string' ? proposal.type : undefined,
        orgId: (proposal.orgId as string | null | undefined) ?? row.orgId ?? null,
        requestId: (proposal.requestId as string | null | undefined) ?? null,
        description: (proposal.description as string | null | undefined) ?? null,
        priority: typeof proposal.priority === 'string' ? proposal.priority : undefined,
        assigneeId: (proposal.assigneeId as string | null | undefined) ?? null,
        dueDate: (proposal.dueDate as string | null | undefined) ?? null,
        estimatedHours: (proposal.estimatedHours as number | null | undefined) ?? null,
        subtasks: stringList(proposal.subtasks),
      }, actor)
      if (!created.ok) return { ok: false, appliedTaskId: null, appliedRequestId: null, error: created.failure.error }
      taskId = created.task.id
      description = `New task created: ${created.task.title}`
    } else if (row.kind === 'update_task') {
      const fields = (proposal.fields && typeof proposal.fields === 'object' ? proposal.fields : {}) as TaskPatchInput
      const updated = await updateTaskRecord(drizzle, row.targetTaskId!, fields, actor)
      if (!updated.ok) return { ok: false, appliedTaskId: null, appliedRequestId: null, error: updated.failure.error }
      const note = typeof proposal.note === 'string' && proposal.note.trim() ? ` ${proposal.note.trim()}` : ''
      description = `Updated ${describeFields(fields as Record<string, unknown>)}.${note}`
    } else if (row.kind === 'complete_task') {
      // Done is set here rather than read out of the proposal: a completion
      // suggestion means exactly one thing, and trusting the payload would
      // let a mislabelled row write any status it liked.
      const updated = await updateTaskRecord(drizzle, row.targetTaskId!, { status: 'done' }, actor)
      if (!updated.ok) return { ok: false, appliedTaskId: null, appliedRequestId: null, error: updated.failure.error }
      const note = typeof proposal.note === 'string' && proposal.note.trim() ? ` ${proposal.note.trim()}` : ''
      description = `Marked done.${note}`
    } else if (row.kind === 'add_subtasks') {
      const wanted = stringList(proposal.subtasks)
      const existing = await drizzle
        .select({ title: schema.taskSubtasks.title })
        .from(schema.taskSubtasks)
        .where(eq(schema.taskSubtasks.taskId, row.targetTaskId!))
      const seen = new Set(existing.map(item => item.title.trim().toLowerCase()))

      const added: string[] = []
      const stamp = now()
      for (const title of wanted) {
        const key = title.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        await drizzle.insert(schema.taskSubtasks).values({
          id: crypto.randomUUID(),
          taskId: row.targetTaskId!,
          title,
          completed: false,
          createdAt: stamp,
        })
        added.push(title)
      }
      description = added.length
        ? `Added ${added.length} checklist ${added.length === 1 ? 'item' : 'items'}: ${added.join(', ')}`
        : 'Every checklist item named was already on the task'
    } else if (row.kind === 'note') {
      description = typeof proposal.body === 'string' ? proposal.body : ''
      if (!description.trim()) return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This note has no body' }
    } else {
      return { ok: false, appliedTaskId: null, appliedRequestId: null, error: `Unknown suggestion kind "${row.kind}"` }
    }

    if (!taskId) return { ok: false, appliedTaskId: null, appliedRequestId: null, error: 'This suggestion names no task to change' }

    const header = await loadCallHeader(drizzle, row)

    // One comment, never two. A note's whole change IS the line, so wrapping
    // it in the same "applied from" sentence every other kind gets keeps the
    // thread readable instead of pairing each note with an echo of itself.
    // The task's request thread is mirrored into by postTaskComment, exactly
    // as it is for a human comment.
    await postTaskComment(drizzle, {
      taskId,
      author: { authorType: TAHI_BOT.authorType, authorId: null },
      body: botLine(header, row.createdAt, description),
      quote: row.quote,
      sourceRef: `suggestion:${row.id}`,
    })

    await logAudit(drizzle as unknown as DB, {
      action: 'task_suggestion.applied',
      userId: null,
      userType: 'system',
      entityType: 'task_suggestion',
      entityId: row.id,
      metadata: { suggestionId: row.id, via: ctx.via, decidedById: ctx.actorId },
    })

    return { ok: true, appliedTaskId: taskId, appliedRequestId: null, error: null }
  } catch (err) {
    return { ok: false, appliedTaskId: null, appliedRequestId: null, error: err instanceof Error ? err.message : 'Apply failed' }
  }
}

// ── deciding ─────────────────────────────────────────────────────────────────

/** Only a row still waiting can be decided. */
const OPEN_STATUSES: readonly string[] = ['pending', 'snoozed']

/**
 * Record a decision once, whoever made it and wherever.
 *
 * A row that is already applied, rejected or expired comes back unchanged
 * with `changed: false` rather than as an error: two founders clicking
 * Approve on the same Slack message is the expected case, and the second
 * click must be a no-op, not a second task and not a red toast.
 *
 * Returns null when the id names nothing, which the routes answer as a 404.
 */
export async function decideSuggestion(
  drizzle: Drizzle,
  id: string,
  decision: DecisionInput,
  ctx: DecisionContext,
): Promise<DecisionResult | null> {
  const row = await loadSuggestion(drizzle, id)
  if (!row) return null

  if (!OPEN_STATUSES.includes(row.status)) {
    return {
      suggestion: row,
      changed: false,
      appliedTaskId: row.appliedTaskId,
      appliedRequestId: row.appliedRequestId,
    }
  }

  // A hand-off the suggester could not resolve to a person is refused BEFORE
  // anything is written: the model is allowed to propose "waiting on somebody
  // at the client" off a call that never said who, and the honest answer is
  // "pick them on Tweak", not a failed row that reads as the gate's fault.
  // The override is what Tweak sends, so it is what gets checked.
  if (decision.action === 'approve' && row.kind === 'hand_off_request') {
    const effective = decision.proposalOverride !== undefined
      ? decision.proposalOverride
      : parseProposal(row.proposal)
    if (!handOffContactId(effective)) {
      return { suggestion: row, changed: false, error: CONTACT_REQUIRED, appliedTaskId: null, appliedRequestId: null }
    }
  }

  const stamp = now()
  const updates: Record<string, unknown> = {
    decidedById: ctx.actorId,
    decidedVia: ctx.via,
    updatedAt: stamp,
  }
  let appliedTaskId: string | null = null
  let appliedRequestId: string | null = null

  if (decision.action === 'snooze') {
    // No decidedAt: a snooze is a deferral, not the decision, and the row
    // comes back pending when its time arrives.
    updates.status = 'snoozed'
    updates.snoozeUntil = decision.until
  } else if (decision.action === 'reject') {
    updates.status = 'rejected'
    updates.decidedAt = stamp
  } else {
    const proposal = decision.proposalOverride !== undefined
      ? JSON.stringify(decision.proposalOverride)
      : row.proposal
    updates.proposal = proposal
    updates.decidedAt = stamp

    const outcome = await applySuggestion(drizzle, { ...row, proposal }, ctx)
    if (outcome.ok) {
      updates.status = 'applied'
      updates.appliedAt = stamp
      updates.appliedTaskId = outcome.appliedTaskId
      updates.appliedRequestId = outcome.appliedRequestId
      updates.applyError = null
      appliedTaskId = outcome.appliedTaskId
      appliedRequestId = outcome.appliedRequestId
    } else {
      // Failed, not pending: the founder decided, the write did not land, and
      // the reason belongs on the row where it can be read.
      updates.status = 'failed'
      updates.applyError = outcome.error
    }
  }

  await drizzle
    .update(schema.taskSuggestions)
    .set(updates)
    .where(eq(schema.taskSuggestions.id, id))

  return {
    suggestion: { ...row, ...updates } as SuggestionRow,
    changed: true,
    appliedTaskId,
    appliedRequestId,
  }
}
