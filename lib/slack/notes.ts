/**
 * lib/slack/notes.ts
 *
 * A sentence typed into a DM becomes a row somebody can approve (CN.2
 * section 4).
 *
 * This is the same gate the call sweep uses, entered from a different door.
 * Nothing here writes a task or a request: it writes `task_suggestions` rows
 * through `insertSuggestions` and the human who wrote the note presses the
 * button. That is the whole design, and it is why a bot in a DM is safe to
 * give to a client.
 *
 * Three things are decided here and nowhere else.
 *
 *   THE APPROVER. A call belongs to the founders, so its rows are
 *   `approver_type 'founders'`. A note belongs to whoever wrote it, so its
 *   rows are `'member'` with that person's team member id, or `'contact'`
 *   with the client contact's. Filing somebody's half-formed thought into
 *   Liam's inbox would make the inbox unreadable within a week, which is the
 *   one failure the whole feature exists to avoid.
 *
 *   THE ORG, for a studio note. It is read out of the text by exact name from
 *   the roster, or it is null and the row is studio housekeeping. There is no
 *   middle setting: a suggestion filed under the wrong client is worse than
 *   one filed under none, because the wrong one looks right.
 *
 *   THE CLIENT PATH, which never reaches the model. A client's DM IS the
 *   request. Running it through a suggester would hand them a paraphrase to
 *   approve, and the paraphrase is the part nobody can check.
 */

import { eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import {
  buildDedupeKey,
  insertSuggestions,
  type SuggestionDraft,
  type SuggestionKind,
} from '@/lib/task-suggestions'
import {
  buildSuggestionContext,
  suggestFromTranscript,
  type SuggestFn,
} from '@/lib/task-suggester'
import { SLACK_DENIED_REPLY, can, isStudioLevel, type SlackIdentity } from './identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Three, from the contract.
 *
 * A DM is a conversation, not an inbox: an answer that arrives as nine cards
 * gets scrolled past, and the tenth good suggestion is worth less than the
 * first three being read.
 */
export const MAX_NOTE_SUGGESTIONS = 3

/** How many clients the roster read will consider. Comfortably past the real count. */
export const ORG_ROSTER_LIMIT = 300

/** Long enough to be a title, short enough to fit a Slack line. */
const MAX_CLIENT_TITLE = 120

export const NOTE_REPLY_TEAM = 'Here is what I understood.'
export const NOTE_REPLY_CLIENT = 'Is this the request?'
export const NOTE_REPLY_NOTHING = 'I could not find anything to file from that. Say it as one clear ask and I will try again.'
export const NOTE_REPLY_FAILED = 'I could not read that one just now. Try again in a minute.'

export type NoteDraftReason = 'ok' | 'denied' | 'empty' | 'nothing_understood' | 'suggester_failed'

/** One filed row, in the shape the Slack card needs. */
export interface NoteSuggestionRow {
  id: string
  kind: string
  proposal: unknown
  quote: string
}

export interface NoteDraftResult {
  ok: boolean
  reason: NoteDraftReason
  /** What the bot says back. Empty string means say nothing at all. */
  reply: string
  orgId: string | null
  orgName: string | null
  approverType: 'member' | 'contact' | null
  approverId: string | null
  inserted: number
  duplicates: number
  rows: NoteSuggestionRow[]
}

export interface DraftFromNoteInput {
  database: Drizzle
  text: string
  identity: SlackIdentity | null
  /** The client contact's name, when the caller already knows it. Looked up otherwise. */
  contactName?: string | null
  /** Injected in tests. Production always uses the real model call. */
  suggest?: SuggestFn
  now?: Date
}

/** A client on the roster, as the name matcher reads one. */
export interface OrgNameOption {
  id: string
  name: string
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The client this note is about, by exact name, or nothing.
 *
 * The match is on a word boundary so "Kiwi Labs" does not fire on
 * "kiwilabsomething", and it is case blind because nobody capitalises a
 * client correctly while dictating into a phone.
 *
 * When two DIFFERENT clients are named the answer is null, because a note
 * that mentions two clients has not told us which one it is for. When two
 * roster entries match the same words because one name contains the other
 * ("Giant" inside "Giant Group") the longer one wins, which is not a guess:
 * the longer name is the one the text actually spells out.
 */
export function resolveOrgFromText(text: string, orgs: readonly OrgNameOption[]): string | null {
  const haystack = text.toLowerCase()

  const matches = orgs.filter(org => {
    const name = org.name.trim().toLowerCase()
    if (name.length < 2) return false
    return new RegExp(`(^|[^a-z0-9])${escapeForRegExp(name)}([^a-z0-9]|$)`, 'i').test(haystack)
  })

  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].id

  const longest = matches.reduce((best, org) => (org.name.trim().length > best.name.trim().length ? org : best), matches[0])
  const ties = matches.filter(org => org.name.trim().length === longest.name.trim().length)
  if (ties.length > 1) return null

  // One name containing another is one mention spelled out; two unrelated
  // names are two clients and no answer.
  const longestName = longest.name.trim().toLowerCase()
  const nested = matches.every(org => longestName.includes(org.name.trim().toLowerCase()))
  return nested ? longest.id : null
}

async function loadOrgRoster(database: Drizzle): Promise<OrgNameOption[]> {
  const rows = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
    .limit(ORG_ROSTER_LIMIT)
  return rows.map(row => ({ id: row.id, name: row.name }))
}

async function orgNameOf(database: Drizzle, orgId: string | null): Promise<string | null> {
  if (!orgId) return null
  const rows = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  return rows[0]?.name ?? null
}

async function contactNameOf(database: Drizzle, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const rows = await database
    .select({ name: schema.contacts.name })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, contactId))
    .limit(1)
  return rows[0]?.name ?? null
}

/**
 * The rows that were just filed, read back by their dedupe keys.
 *
 * `insertSuggestions` answers with counts rather than ids, because the sweep
 * that wrote it only ever needed counts. A DM needs the ids: every button on
 * the card carries one. The keys are deterministic, so reading back by key
 * finds exactly the rows this note produced, INCLUDING the ones that were
 * duplicates of something already waiting, which is the right answer: the
 * sender asked twice and should see the card that is already open rather
 * than silence.
 */
async function readBack(database: Drizzle, keys: readonly string[]): Promise<NoteSuggestionRow[]> {
  if (keys.length === 0) return []
  const rows = await database
    .select({
      id: schema.taskSuggestions.id,
      kind: schema.taskSuggestions.kind,
      proposal: schema.taskSuggestions.proposal,
      quote: schema.taskSuggestions.quote,
      dedupeKey: schema.taskSuggestions.dedupeKey,
    })
    .from(schema.taskSuggestions)
    .where(inArray(schema.taskSuggestions.dedupeKey, [...keys]))

  const wanted = new Set(keys)
  return rows
    .filter(row => !row.dedupeKey || wanted.has(row.dedupeKey))
    .map(row => ({
      id: row.id,
      kind: row.kind,
      proposal: parseProposal(row.proposal),
      quote: row.quote,
    }))
}

function parseProposal(raw: string | null): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

/** The first sentence, as a title. A note is usually one, and a title is always one. */
function titleFrom(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  const firstSentence = collapsed.split(/(?<=[.!?])\s/)[0] ?? collapsed
  const candidate = firstSentence.length >= 4 ? firstSentence : collapsed
  return candidate.length > MAX_CLIENT_TITLE
    ? `${candidate.slice(0, MAX_CLIENT_TITLE - 3).trimEnd()}...`
    : candidate
}

function denied(): NoteDraftResult {
  return {
    ok: false,
    reason: 'denied',
    reply: SLACK_DENIED_REPLY,
    orgId: null,
    orgName: null,
    approverType: null,
    approverId: null,
    inserted: 0,
    duplicates: 0,
    rows: [],
  }
}

/**
 * The note path, both halves of it.
 *
 * Studio people get the suggester: they say a sentence, it proposes up to
 * three pieces of work against what their clients already have open, and they
 * approve their own. Clients get one request draft made of their own words.
 * Everybody else gets one sentence and nothing is written.
 */
export async function draftFromNote(input: DraftFromNoteInput): Promise<NoteDraftResult> {
  const identity = input.identity
  const text = input.text.trim()

  if (!text) {
    return {
      ok: false,
      reason: 'empty',
      reply: '',
      orgId: null,
      orgName: null,
      approverType: null,
      approverId: null,
      inserted: 0,
      duplicates: 0,
      rows: [],
    }
  }

  if (!identity) return denied()

  if (identity.level === 'client') return clientRequestDraft(input, identity, text)
  if (!isStudioLevel(identity.level) || !can(identity, 'create_task')) return denied()
  if (!identity.teamMemberId) return denied()

  return studioNoteDraft(input, identity, text)
}

async function studioNoteDraft(
  input: DraftFromNoteInput,
  identity: SlackIdentity,
  text: string,
): Promise<NoteDraftResult> {
  const { database } = input
  const at = input.now ?? new Date()
  const suggest = input.suggest ?? suggestFromTranscript

  const roster = await loadOrgRoster(database)
  const orgId = resolveOrgFromText(text, roster)
  const orgName = orgId ? roster.find(org => org.id === orgId)?.name ?? null : null

  let suggestions
  try {
    const context = await buildSuggestionContext(database, orgId, at)
    const result = await suggest({
      transcript: text,
      wrapUp: null,
      callTitle: null,
      callDate: at.toISOString().slice(0, 10),
      context,
    })
    suggestions = result.suggestions
  } catch {
    return {
      ok: false,
      reason: 'suggester_failed',
      reply: NOTE_REPLY_FAILED,
      orgId,
      orgName,
      approverType: 'member',
      approverId: identity.teamMemberId,
      inserted: 0,
      duplicates: 0,
      rows: [],
    }
  }

  // The ceiling is applied AFTER validation, so the three that survive are
  // the three the model was able to quote rather than the first three it
  // happened to write.
  const kept = suggestions.slice(0, MAX_NOTE_SUGGESTIONS)

  if (kept.length === 0) {
    return {
      ok: false,
      reason: 'nothing_understood',
      reply: NOTE_REPLY_NOTHING,
      orgId,
      orgName,
      approverType: 'member',
      approverId: identity.teamMemberId,
      inserted: 0,
      duplicates: 0,
      rows: [],
    }
  }

  const drafts: SuggestionDraft[] = kept.map(suggestion => ({
    orgId,
    sourceKind: 'note',
    transcriptId: null,
    callKind: null,
    callId: null,
    kind: suggestion.kind,
    targetTaskId: suggestion.targetTaskId,
    targetRequestId: suggestion.targetRequestId,
    proposal: suggestion.proposal,
    quote: suggestion.quote,
    rationale: suggestion.rationale,
    confidence: suggestion.confidence,
    approverType: 'member',
    approverId: identity.teamMemberId,
  }))

  const written = await insertSuggestions(database, drafts)
  const rows = await readBack(database, await dedupeKeysFor(drafts))

  return {
    ok: true,
    reason: 'ok',
    reply: NOTE_REPLY_TEAM,
    orgId,
    orgName,
    approverType: 'member',
    approverId: identity.teamMemberId,
    inserted: written.inserted,
    duplicates: written.duplicates,
    rows,
  }
}

async function clientRequestDraft(
  input: DraftFromNoteInput,
  identity: SlackIdentity,
  text: string,
): Promise<NoteDraftResult> {
  const { database } = input

  // THE ORG IS THEIRS, always. A client naming another client in their own
  // message changes nothing: the roster is never consulted on this path, so
  // there is no code here that could file their words under somebody else.
  if (!can(identity, 'create_request_own_org') || !identity.orgId || !identity.contactId) return denied()

  const requesterName = input.contactName ?? (await contactNameOf(database, identity.contactId))
  const orgName = await orgNameOf(database, identity.orgId)

  const draft: SuggestionDraft = {
    orgId: identity.orgId,
    sourceKind: 'note',
    transcriptId: null,
    callKind: null,
    callId: null,
    kind: 'create_request' as SuggestionKind,
    targetTaskId: null,
    targetRequestId: null,
    proposal: {
      title: titleFrom(text),
      description: text,
      // Category, type and priority are left out rather than guessed. The
      // create path defaults them, and the studio can move any of the three
      // once the request exists; inventing a category from one sentence would
      // put a number on a guess.
      requesterName,
      requesterContactId: identity.contactId,
    },
    // The note IS the source, so the quote is the note. That keeps the same
    // invariant every other suggestion carries: the words are checkable.
    quote: text,
    rationale: 'Asked for in a Slack DM.',
    confidence: null,
    approverType: 'contact',
    approverId: identity.contactId,
  }

  const written = await insertSuggestions(database, [draft])
  const rows = await readBack(database, await dedupeKeysFor([draft]))

  return {
    ok: true,
    reason: 'ok',
    reply: NOTE_REPLY_CLIENT,
    orgId: identity.orgId,
    orgName,
    approverType: 'contact',
    approverId: identity.contactId,
    inserted: written.inserted,
    duplicates: written.duplicates,
    rows,
  }
}

async function dedupeKeysFor(drafts: readonly SuggestionDraft[]): Promise<string[]> {
  return Promise.all(drafts.map(draft => buildDedupeKey({
    sourceKind: draft.sourceKind,
    transcriptId: draft.transcriptId,
    kind: draft.kind,
    targetTaskId: draft.targetTaskId,
    targetRequestId: draft.targetRequestId ?? null,
    proposal: draft.proposal,
  })))
}
