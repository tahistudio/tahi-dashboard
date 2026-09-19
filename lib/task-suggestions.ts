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
import { and, eq, gte, inArray, isNull, ne, notInArray, or, desc, sql, type SQL } from 'drizzle-orm'
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
import { SIMILAR_BLOCK, SIMILAR_WARN, findSimilar } from '@/lib/text-similarity'
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
/** What an attach points a create suggestion at (CN.1d section 3). */
export interface AttachTarget {
  kind: 'request' | 'task'
  id: string
}

export type DecisionInput =
  | { action: 'approve'; proposalOverride?: unknown; force?: boolean }
  | { action: 'reject' }
  | { action: 'snooze'; until: string }
  | { action: 'attach'; target: AttachTarget }

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

/**
 * Something that already exists and looks like what a create row proposes
 * (CN.1d section 2). Computed on read from live rows, never stored, so the
 * warning can never be stale and no rebuild is needed to refresh it.
 */
export interface SimilarMatch {
  kind: 'request' | 'task' | 'suggestion'
  id: string
  /** The request number, for the one kind a human names by number. */
  number: number | null
  title: string
  status: string
  /** 0 to 1, from lib/text-similarity.ts. */
  score: number
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
  /**
   * What this row would duplicate, best first, at most three, only at or
   * above SIMILAR_WARN. Always an array: empty on every kind but an open
   * create_request or create_task.
   */
  similar: SimilarMatch[]
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
   * human can fix rather than a fault. 'contact_required' is a hand-off the
   * model could not resolve to a person; 'possible_duplicate' is a create
   * that already exists (CN.1d); the two attach refusals name a target the
   * gate will not convert a row onto.
   */
  error?: string
  /** What the refused create would have duplicated, best first. */
  similar?: SimilarMatch[]
}

export interface ApplyOutcome {
  ok: boolean
  appliedTaskId: string | null
  appliedRequestId: string | null
  error: string | null
}

/** The refusal an approve gets when a hand-off names nobody the gate can use. */
export const CONTACT_REQUIRED = 'contact_required'

/** The refusal an approve gets when the client already has this work (CN.1d). */
export const POSSIBLE_DUPLICATE = 'possible_duplicate'

/** An attach on a row that does not create anything, so has nothing to move. */
export const ATTACH_NOT_ALLOWED = 'attach_not_allowed'

/** An attach onto a request or task that does not exist, or is another client's. */
export const ATTACH_TARGET_INVALID = 'attach_target_invalid'

/** The two kinds that bring something new into existence, and so can duplicate. */
export const CREATE_KINDS: readonly SuggestionKind[] = ['create_request', 'create_task']

/** How far back a delivered request is still worth warning about. */
const SIMILAR_REQUEST_DAYS = 90

/** How far back a finished task is still worth warning about. */
const SIMILAR_TASK_DAYS = 30

/** Rows read per source when looking for a twin. The inbox is small; this is a ceiling, not a target. */
const SIMILAR_SCAN_LIMIT = 200

/** How many matches a reader is shown. findSimilar caps at five; three is a line, not a list. */
export const MAX_SIMILAR_SHOWN = 3

/** The current timestamp, in the shape every other writer in this repo stamps. */
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ── the duplicate guard (CN.1d) ──────────────────────────────────────────────
//
// The suggester is TOLD to prefer an update over a create, and mostly obeys.
// Mostly is not a guard. Two calls a month apart about the same footer tag
// produce two create_request rows that share no transcript, no dedupe key and
// no exact title, so the dedupe key cannot see it and neither could a human
// reading one call's inbox. What follows is the machinery for seeing it: a
// set of live candidates per client, and a score against each one.

/** A candidate before it has been scored against anything. */
type SimilarCandidate = Omit<SimilarMatch, 'score'>

/** Null is the studio itself, which has tasks and suggestions but no requests. */
function orgKeyOf(orgId: string | null): string {
  return orgId ?? ''
}

function isoDaysBefore(at: Date, days: number): string {
  return new Date(at.getTime() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The title a create proposal is judged on, from a parsed proposal. */
function proposalTitleOf(proposal: unknown): string {
  const record = (proposal && typeof proposal === 'object' ? proposal : {}) as Record<string, unknown>
  return typeof record.title === 'string' ? record.title : ''
}

function isCreateKind(kind: string): boolean {
  return (CREATE_KINDS as readonly string[]).includes(kind)
}

/**
 * Everything one client already has that a new create could duplicate,
 * grouped by client.
 *
 * THREE SOURCES, because a duplicate hides in three places. The client's own
 * requests, open or lately delivered, are the obvious one. Their tasks catch
 * the studio's own follow-up proposed twice. Other PENDING create suggestions
 * catch the case no stored row can: two calls swept in the same hour, neither
 * decided yet, each proposing the same thing.
 *
 * The windows are deliberately generous on the closed rows. A request
 * delivered six weeks ago is exactly the thing a client re-mentions, and
 * proposing it again as new work is how a studio bills twice for one job.
 */
async function loadSimilarCandidates(
  drizzle: Drizzle,
  orgIds: ReadonlyArray<string | null>,
  at: Date,
): Promise<Map<string, SimilarCandidate[]>> {
  const grouped = new Map<string, SimilarCandidate[]>()
  const add = (orgId: string | null, candidate: SimilarCandidate): void => {
    const key = orgKeyOf(orgId)
    const list = grouped.get(key)
    if (list) list.push(candidate)
    else grouped.set(key, [candidate])
  }

  const realOrgIds = unique(orgIds.map(id => id ?? null))
  const hasStudio = orgIds.some(id => id === null)

  // Requests: open, or delivered inside the window. Archived, cancelled and
  // draft rows are not work anybody is waiting on, so they never warn.
  const requestSince = isoDaysBefore(at, SIMILAR_REQUEST_DAYS)
  for (const batch of chunk(realOrgIds)) {
    const rows = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        requestNumber: schema.requests.requestNumber,
        title: schema.requests.title,
        status: schema.requests.status,
      })
      .from(schema.requests)
      .where(and(
        inArray(schema.requests.orgId, batch),
        notInArray(schema.requests.status, ['archived', 'cancelled', 'draft']),
        or(
          ne(schema.requests.status, 'delivered'),
          gte(sql`coalesce(${schema.requests.deliveredAt}, ${schema.requests.updatedAt})`, requestSince),
        ),
      ))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(SIMILAR_SCAN_LIMIT)

    for (const row of rows) {
      if (!row.title) continue
      add(row.orgId, { kind: 'request', id: row.id, number: row.requestNumber ?? null, title: row.title, status: row.status })
    }
  }

  // Tasks: not done, or done inside the window. A studio row (no client) is
  // matched against the studio's own tasks, the same answer guardTask gives.
  const taskSince = isoDaysBefore(at, SIMILAR_TASK_DAYS)
  const taskLive = or(
    ne(schema.tasks.status, 'done'),
    gte(sql`coalesce(${schema.tasks.completedAt}, ${schema.tasks.updatedAt})`, taskSince),
  )
  const taskBatches: Array<string[] | null> = realOrgIds.length > 0 ? chunk(realOrgIds) : []
  if (hasStudio) taskBatches.push(null)

  for (const batch of taskBatches) {
    const scope = batch === null ? isNull(schema.tasks.orgId) : inArray(schema.tasks.orgId, batch)
    const rows = await drizzle
      .select({
        id: schema.tasks.id,
        orgId: schema.tasks.orgId,
        title: schema.tasks.title,
        status: schema.tasks.status,
      })
      .from(schema.tasks)
      .where(and(scope, taskLive))
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(SIMILAR_SCAN_LIMIT)

    for (const row of rows) {
      if (!row.title) continue
      add(row.orgId ?? null, { kind: 'task', id: row.id, number: null, title: row.title, status: row.status })
    }
  }

  // Other pending create suggestions, which is the source no stored row can
  // stand in for: a second call proposing the same thing before the first has
  // been decided.
  for (const batch of taskBatches) {
    const scope = batch === null
      ? isNull(schema.taskSuggestions.orgId)
      : inArray(schema.taskSuggestions.orgId, batch)
    const rows = await drizzle
      .select({
        id: schema.taskSuggestions.id,
        orgId: schema.taskSuggestions.orgId,
        status: schema.taskSuggestions.status,
        proposal: schema.taskSuggestions.proposal,
      })
      .from(schema.taskSuggestions)
      .where(and(
        scope,
        eq(schema.taskSuggestions.status, 'pending'),
        inArray(schema.taskSuggestions.kind, [...CREATE_KINDS]),
      ))
      .orderBy(desc(schema.taskSuggestions.createdAt))
      .limit(SIMILAR_SCAN_LIMIT)

    for (const row of rows) {
      const title = proposalTitleOf(parseProposalLoose(row.proposal ?? ''))
      if (!title) continue
      add(row.orgId ?? null, { kind: 'suggestion', id: row.id, number: null, title, status: row.status })
    }
  }

  return grouped
}

/** The matches for one title, itself excluded, best first, capped for a reader. */
function matchesFor(
  title: string,
  candidates: readonly SimilarCandidate[] | undefined,
  excludeId: string,
): SimilarMatch[] {
  if (!title.trim() || !candidates || candidates.length === 0) return []
  return findSimilar(title, candidates.filter(candidate => candidate.id !== excludeId), SIMILAR_WARN)
    .slice(0, MAX_SIMILAR_SHOWN)
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
/**
 * The pending create suggestions that could be the twin of a batch of drafts:
 * the same clients, plus the studio itself when the batch has a client-less
 * draft. Null when there is nothing to scope to.
 */
function pendingCreateScope(orgIds: ReadonlyArray<string | null>): SQL | null {
  const scopes: SQL[] = []
  const named = unique(orgIds.map(id => id ?? null))
  if (named.length > 0) scopes.push(inArray(schema.taskSuggestions.orgId, named))
  if (orgIds.some(id => id === null)) scopes.push(isNull(schema.taskSuggestions.orgId))
  if (scopes.length === 0) return null

  return and(
    scopes.length === 1 ? scopes[0] : or(...scopes)!,
    eq(schema.taskSuggestions.status, 'pending'),
    inArray(schema.taskSuggestions.kind, [...CREATE_KINDS]),
  )!
}

export async function insertSuggestions(
  drizzle: Drizzle,
  drafts: readonly SuggestionDraft[],
): Promise<{ inserted: number; duplicates: number; similarDropped: number }> {
  if (drafts.length === 0) return { inserted: 0, duplicates: 0, similarDropped: 0 }

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

  // ONE READ FOR BOTH GUARDS. The dedupe keys already on the table and the
  // pending create rows this batch might repeat come back from the same
  // statement: they are the same table, and a second round trip per sweep
  // buys nothing. Rows arrive tagged by which half matched them.
  const wantedKeys = new Set(keyed.map(entry => entry.dedupeKey))
  const pendingScope = keyed.some(entry => isCreateKind(entry.draft.kind))
    ? pendingCreateScope(keyed.map(entry => entry.draft.orgId))
    : null

  const existing = new Set<string>()
  const pending: SimilarCandidate[] = []
  const pendingOrg = new Map<string, string>()
  for (const batch of chunk(keyed.map(entry => entry.dedupeKey))) {
    const keyMatch = inArray(schema.taskSuggestions.dedupeKey, batch)
    const rows = await drizzle
      .select({
        id: schema.taskSuggestions.id,
        orgId: schema.taskSuggestions.orgId,
        kind: schema.taskSuggestions.kind,
        status: schema.taskSuggestions.status,
        proposal: schema.taskSuggestions.proposal,
        dedupeKey: schema.taskSuggestions.dedupeKey,
      })
      .from(schema.taskSuggestions)
      .where(pendingScope ? or(keyMatch, pendingScope) : keyMatch)

    for (const row of rows) {
      if (row.dedupeKey && wantedKeys.has(row.dedupeKey)) existing.add(row.dedupeKey)
      if (row.status !== 'pending' || !isCreateKind(row.kind ?? '') || pendingOrg.has(row.id)) continue
      const title = proposalTitleOf(parseProposalLoose(row.proposal ?? ''))
      if (!title) continue
      pendingOrg.set(row.id, orgKeyOf(row.orgId ?? null))
      pending.push({ kind: 'suggestion', id: row.id, number: null, title, status: row.status })
    }
  }

  const stamp = now()
  let inserted = 0
  let duplicates = 0
  let similarDropped = 0

  for (const entry of keyed) {
    if (existing.has(entry.dedupeKey)) {
      duplicates++
      continue
    }

    // A create that repeats something already waiting for the same client is
    // dropped here rather than filed: two rows proposing one thing make the
    // inbox longer and the decision no easier. A match against an existing
    // REQUEST or TASK is deliberately NOT dropped: the human may still want
    // it, and the read-time warning will say so.
    if (isCreateKind(entry.draft.kind)) {
      const key = orgKeyOf(entry.draft.orgId)
      const mine = pending.filter(candidate => pendingOrg.get(candidate.id) === key)
      const title = proposalTitleOf(entry.draft.proposal)
      const twin = title.trim() ? findSimilar(title, mine, SIMILAR_BLOCK)[0] : undefined
      if (twin) {
        similarDropped++
        continue
      }
      if (title.trim()) {
        // Added before the write, so a batch proposing one thing twice in two
        // wordings inserts it once.
        pendingOrg.set(`draft:${entry.dedupeKey}`, key)
        pending.push({ kind: 'suggestion', id: `draft:${entry.dedupeKey}`, number: null, title, status: 'pending' })
      }
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

  return { inserted, duplicates, similarDropped }
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

async function decorate(drizzle: Drizzle, rows: SuggestionRow[], at: Date = new Date()): Promise<DecoratedSuggestion[]> {
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

  // The duplicate warning (CN.1d section 2), for the open create rows only:
  // a kind that names what it changes cannot duplicate anything, and a
  // decided row is history. One candidate read per client, shared by every
  // row of that client in this page.
  const guarded = rows.filter(row => OPEN_STATUSES.includes(row.status) && isCreateKind(row.kind))
  const candidates = guarded.length > 0
    ? await loadSimilarCandidates(drizzle, guarded.map(row => row.orgId), at)
    : new Map<string, SimilarCandidate[]>()
  const guardedIds = new Set(guarded.map(row => row.id))

  return rows.map(row => {
    const call = row.callKind && row.callId ? calls.get(`${row.callKind}:${row.callId}`) ?? null : null
    const task = row.targetTaskId ? tasks.get(row.targetTaskId) ?? null : null
    const request = row.targetRequestId ? requests.get(row.targetRequestId) ?? null : null
    const proposal = parseProposalLoose(row.proposal)
    return {
      ...row,
      similar: guardedIds.has(row.id)
        ? matchesFor(proposalTitleOf(proposal), candidates.get(orgKeyOf(row.orgId)), row.id)
        : [],
      proposal,
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
 * "Use #226 instead": a create suggestion, re-pointed at work that already
 * exists (CN.1d section 3).
 *
 * The row is not decided and nothing is written to the request or the task.
 * What changes is what the row PROPOSES: a create becomes a note on the thing
 * the human picked, carrying the same words, the same quote, the same
 * rationale and the same confidence, still pending. The human then approves
 * it like any other note, and the note lands through exactly the code every
 * other approve goes through.
 *
 * THE TARGET DECIDES THE KIND, not the source. A create_request the human
 * recognised as a studio task attaches as a task note, and a create_task they
 * recognised as client work attaches as a request note, because what the
 * reader wanted was "this belongs over there" and over there is where the
 * thread lives.
 *
 * The dedupe key is deliberately left as it was. It is the identity of the
 * proposal the model made, and keeping it is what stops the next sweep over
 * the same transcript from re-proposing the create this attach just retired.
 */
async function attachSuggestion(
  drizzle: Drizzle,
  row: SuggestionRow,
  target: AttachTarget,
): Promise<DecisionResult> {
  const refuse = (error: string): DecisionResult => (
    { suggestion: row, changed: false, error, appliedTaskId: null, appliedRequestId: null }
  )

  if (!isCreateKind(row.kind)) return refuse(ATTACH_NOT_ALLOWED)

  const proposal = parseProposal(row.proposal)
  const body = [text(proposal.title), text(proposal.description)].filter(Boolean).join('\n\n')
  if (!body) return refuse(ATTACH_NOT_ALLOWED)

  const updates: Record<string, unknown> = {
    proposal: JSON.stringify({ body }),
    updatedAt: now(),
  }

  if (target.kind === 'request') {
    const [request] = await drizzle
      .select({ id: schema.requests.id, orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, target.id))
      .limit(1)
    // A request always belongs to a client, so a studio row (no client) can
    // never attach to one, and one client's suggestion can never land on
    // another client's thread.
    if (!request || (request.orgId ?? null) !== row.orgId) return refuse(ATTACH_TARGET_INVALID)
    updates.kind = 'request_note'
    updates.targetRequestId = request.id
    updates.targetTaskId = null
  } else {
    const [task] = await drizzle
      .select({ id: schema.tasks.id, orgId: schema.tasks.orgId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, target.id))
      .limit(1)
    if (!task || (task.orgId ?? null) !== row.orgId) return refuse(ATTACH_TARGET_INVALID)
    updates.kind = 'note'
    updates.targetTaskId = task.id
    updates.targetRequestId = null
  }

  await drizzle
    .update(schema.taskSuggestions)
    .set(updates)
    .where(eq(schema.taskSuggestions.id, row.id))

  return {
    suggestion: { ...row, ...updates } as SuggestionRow,
    changed: true,
    appliedTaskId: null,
    appliedRequestId: null,
  }
}

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

  // Attaching is not deciding: it rewrites what the row proposes onto
  // something that already exists and leaves it pending, so the human still
  // presses the button. It therefore returns before any decision is stamped.
  if (decision.action === 'attach') {
    return attachSuggestion(drizzle, row, decision.target)
  }

  // A create that the client demonstrably already has is refused BEFORE
  // anything is written (CN.1d section 3). Re-run against LIVE rows rather
  // than trusting the warning computed when the inbox was read: the human may
  // have created it by hand ten seconds ago. `force` is the human saying they
  // looked and want it anyway, which is a thing they are allowed to want.
  if (decision.action === 'approve' && isCreateKind(row.kind) && decision.force !== true) {
    const effective = decision.proposalOverride !== undefined
      ? decision.proposalOverride
      : parseProposal(row.proposal)
    const title = proposalTitleOf(effective)
    if (title.trim()) {
      const candidates = await loadSimilarCandidates(drizzle, [row.orgId], new Date())
      const similar = matchesFor(title, candidates.get(orgKeyOf(row.orgId)), row.id)
      if (similar.length > 0 && similar[0].score >= SIMILAR_BLOCK) {
        return { suggestion: row, changed: false, error: POSSIBLE_DUPLICATE, similar, appliedTaskId: null, appliedRequestId: null }
      }
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
