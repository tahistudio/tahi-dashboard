/**
 * S2 stub, S1 replaces this file.
 *
 * lib/task-suggestions.ts is slice S1's module (the dedupe key, the insert,
 * the list, decide/apply, the snooze presets and the resurface). Slice S2, the
 * suggester and its cron, only ever touches three of those functions, so this
 * file implements exactly those three against the contract's task_suggestions
 * table and nothing else. It exists so S2 compiles and tests on its own branch;
 * at merge the lead keeps S1's version, which is a superset.
 *
 * Do not add to this file. Anything else a caller needs belongs in S1's.
 */

import { eq, inArray, lte, and } from 'drizzle-orm'
import { schema } from '@/db/d1'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The five things a suggestion can propose. `note` changes no task at all. */
export type SuggestionKind =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'add_subtasks'
  | 'note'

export interface DedupeKeyInput {
  /** 'call' in this phase; 'note' | 'voice' | 'slack' later. */
  sourceKind: string
  transcriptId: string | null
  kind: SuggestionKind
  targetTaskId?: string | null
  /** The proposal JSON, as an object. The normalised part of the key is read
   *  out of it per kind, so a caller never has to derive it by hand. */
  proposal: unknown
}

export interface SuggestionInsert {
  orgId: string | null
  sourceKind: string
  transcriptId: string | null
  callKind: string | null
  callId: string | null
  kind: SuggestionKind
  targetTaskId: string | null
  proposal: unknown
  quote: string
  rationale: string | null
  confidence: number | null
  /** 'founders' | 'member' | 'contact'. The cron writes 'founders'. */
  approverType?: string
  approverId?: string | null
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** A stable string for a value whose key order must not change the hash. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
}

/**
 * The part of the key that says "this same thing, again": the create title,
 * the sorted update diff, or the head of a note.
 *
 * add_subtasks is not named in the contract's list. It is hashed as the sorted
 * JSON of its own proposal, which is the same rule the updates use and gives
 * the property that matters: proposing the same subtasks off the same
 * transcript twice is one row, not two.
 */
function normalisedTitleOrDiff(kind: SuggestionKind, proposal: unknown): string {
  const body = (proposal ?? {}) as Record<string, unknown>
  if (kind === 'create_task') {
    return collapse(typeof body.title === 'string' ? body.title : '')
  }
  if (kind === 'note') {
    return collapse(typeof body.body === 'string' ? body.body : '').slice(0, 80)
  }
  if (kind === 'update_task' || kind === 'complete_task') {
    return stableJson(body.fields ?? {})
  }
  return stableJson(body)
}

/**
 * sha-256 hex of source, kind, target and the normalised proposal.
 *
 * Web Crypto, because this runs in a Worker. Unique in the table, so a second
 * sweep over the same transcript inserts nothing new.
 */
export async function buildDedupeKey(input: DedupeKeyInput): Promise<string> {
  const parts = [
    input.sourceKind,
    input.transcriptId ?? '',
    input.kind,
    input.targetTaskId ?? '',
    normalisedTitleOrDiff(input.kind, input.proposal),
  ]
  const bytes = new TextEncoder().encode(parts.join(':'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Insert what is new, count what was already there.
 *
 * The duplicates are filtered in the query rather than leaned on the unique
 * index, because D1 gives a batch one error for the whole statement and losing
 * four good suggestions to one repeat would make the sweep useless on its
 * second pass over a re-synced transcript.
 */
export async function insertSuggestions(
  database: Drizzle,
  rows: readonly SuggestionInsert[],
): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 }

  const keyed = await Promise.all(
    rows.map(async row => ({ row, dedupeKey: await buildDedupeKey(row) })),
  )

  const existing = await database
    .select({ dedupeKey: schema.taskSuggestions.dedupeKey })
    .from(schema.taskSuggestions)
    .where(inArray(schema.taskSuggestions.dedupeKey, keyed.map(k => k.dedupeKey)))

  const seen = new Set(existing.map(e => e.dedupeKey))
  const fresh: typeof keyed = []
  let duplicates = 0
  for (const item of keyed) {
    if (seen.has(item.dedupeKey)) { duplicates++; continue }
    seen.add(item.dedupeKey)
    fresh.push(item)
  }

  if (fresh.length === 0) return { inserted: 0, duplicates }

  const stamp = now()
  await database.insert(schema.taskSuggestions).values(fresh.map(({ row, dedupeKey }) => ({
    id: crypto.randomUUID(),
    orgId: row.orgId,
    sourceKind: row.sourceKind,
    transcriptId: row.transcriptId,
    callKind: row.callKind,
    callId: row.callId,
    kind: row.kind,
    targetTaskId: row.targetTaskId,
    proposal: JSON.stringify(row.proposal ?? {}),
    quote: row.quote,
    rationale: row.rationale,
    confidence: row.confidence,
    status: 'pending',
    approverType: row.approverType ?? 'founders',
    approverId: row.approverId ?? null,
    dedupeKey,
    createdAt: stamp,
    updatedAt: stamp,
  })))

  return { inserted: fresh.length, duplicates }
}

/**
 * Snoozed rows whose time has come go back to pending. Returns how many moved.
 *
 * The ids are read first so the count is the real one: D1 does not hand back a
 * reliable changed-row count through Drizzle, and a cron summary that says
 * "resurfaced 0" when it resurfaced six is worse than no summary.
 */
export async function resurfaceSnoozed(database: Drizzle, at: string): Promise<number> {
  const due = await database
    .select({ id: schema.taskSuggestions.id })
    .from(schema.taskSuggestions)
    .where(and(
      eq(schema.taskSuggestions.status, 'snoozed'),
      lte(schema.taskSuggestions.snoozeUntil, at),
    ))

  if (due.length === 0) return 0

  await database
    .update(schema.taskSuggestions)
    .set({ status: 'pending', snoozeUntil: null, updatedAt: now() })
    .where(inArray(schema.taskSuggestions.id, due.map(d => d.id)))

  return due.length
}
