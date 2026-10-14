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
 *   THE ORG, for a studio note. Legal names, trading names, CRM aliases and
 *   contact names are matched against the roster. An ambiguous create waits
 *   for its sender to choose a client on Tweak before it can be approved.
 *
 *   THE CLIENT PATH, which never reaches the model. A client's DM IS the
 *   request. Running it through a suggester would hand them a paraphrase to
 *   approve, and the paraphrase is the part nobody can check. It is open
 *   only to a client the portal would let file a request (the 'requests'
 *   feature, lib/slack/entitlement.ts).
 *
 * And one thing is guaranteed here: A CARD ONLY EVER SHOWS THE SENDER'S OWN
 * ROW. A note's dedupe key carries whose it is (and for a client, their
 * whole message), and every row read back is held to noteRowBelongsTo, so
 * two people who open their DMs the same way ("Hi Liam!") each get their own
 * card, and nobody is ever shown somebody else's words.
 */

import { eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import {
  dedupeKeyForDraft,
  insertSuggestions,
  type SuggestionDraft,
  type SuggestionKind,
} from '@/lib/task-suggestions'
import {
  buildSuggestionContext,
  suggestFromTranscript,
  type SuggestFn,
} from '@/lib/task-suggester'
import { clientMayFileRequests, studioReachesOrg } from './entitlement'
import { SLACK_DENIED_REPLY, can, isStudioLevel, type SlackIdentity } from './identity'
import { SLACK_NOTE_HELP_LINE } from './intents'
import {
  enrichNoteProposal,
  MAX_CLIENT_CHOICES,
  matchOrgsFromText,
  orgAliases,
  studioDate,
  type OrgNameOption,
} from './note-quality'

export type { OrgNameOption } from './note-quality'

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
export const NOTE_REPLY_NOTHING = SLACK_NOTE_HELP_LINE
export const NOTE_REPLY_FAILED = 'I could not read that one just now. Try again in a minute.'
/** Nothing new was filed and nothing of the sender's is still open to show. */
export const NOTE_REPLY_TEAM_ON_FILE = 'That is already on file, so there is nothing new to approve.'
/** The same, for a client: only ever about their own message sent again. */
export const NOTE_REPLY_CLIENT_ON_FILE = 'You have sent that one already. If it is a new ask, say it in different words.'

export type NoteDraftReason = 'ok' | 'denied' | 'empty' | 'nothing_understood' | 'suggester_failed' | 'already_on_file'

/**
 * One filed row, in the shape the Slack card needs, with whose it is.
 *
 * The owner fields are what noteRowBelongsTo reads: a card is only ever
 * posted into the DM of the person the row belongs to.
 */
export interface NoteSuggestionRow {
  id: string
  kind: string
  proposal: unknown
  quote: string
  approverType: string
  approverId: string | null
  orgId: string | null
  orgName?: string | null
  status: string
}

/** The one status a card is posted for: a row still waiting on its sender. */
const CARD_STATUS = 'pending'

/**
 * Whether this row may be shown as a card in this sender's DM.
 *
 *   client   their own draft (approver_type 'contact', approver_id their
 *            contact id) at their own client, still the create_request their
 *            card offers, still pending
 *   studio   their own note (approver_type 'member', approver_id their team
 *            member id), still pending
 *
 * Anything else, including a row the studio has since re-pointed or decided,
 * and every row belonging to somebody else, is false. The dedupe key already
 * scopes a note to its sender; this is the fence behind it, so no key
 * collision, old row or future caller can put one person's words in another
 * person's DM.
 */
export function noteRowBelongsTo(
  identity: Pick<SlackIdentity, 'level' | 'teamMemberId' | 'contactId' | 'orgId'> | null,
  row: Pick<NoteSuggestionRow, 'kind' | 'approverType' | 'approverId' | 'orgId' | 'status'>,
): boolean {
  if (!identity || row.status !== CARD_STATUS) return false
  if (identity.level === 'client') {
    return row.approverType === 'contact'
      && !!identity.contactId && row.approverId === identity.contactId
      && !!identity.orgId && row.orgId === identity.orgId
      && row.kind === 'create_request'
  }
  if (isStudioLevel(identity.level)) {
    return row.approverType === 'member'
      && !!identity.teamMemberId && row.approverId === identity.teamMemberId
  }
  return false
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

/**
 * The client this note is about, by a unique roster name, or nothing.
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
  const matches = matchOrgsFromText(text, orgs)
  return matches.length === 1 ? matches[0].id : null
}

async function loadOrgRoster(database: Drizzle): Promise<OrgNameOption[]> {
  const rows = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name,
      customFields: schema.organisations.customFields, brands: schema.organisations.brands })
    .from(schema.organisations)
    .limit(ORG_ROSTER_LIMIT)
  const contacts = await database.select({ orgId: schema.contacts.orgId, name: schema.contacts.name })
    .from(schema.contacts).limit(1500)
  return rows.map(row => ({
    id: row.id, name: row.name,
    aliases: orgAliases(row.customFields, row.brands),
    contactNames: contacts.filter(contact => contact.orgId === row.id).map(contact => contact.name),
  }))
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
 * the card carries one. The keys are deterministic and scoped to the sender
 * (buildDedupeKey keys a note on whose it is), so reading back by key finds
 * the rows this note produced, INCLUDING one that was a duplicate of the
 * sender's own card still waiting, which is the right answer: the sender
 * asked twice and should see the card that is already open rather than
 * silence.
 *
 * Every row is then held to noteRowBelongsTo, in the order the keys came in:
 * only the sender's own rows, still pending, ever come back. A row that is
 * somebody else's, or one already decided, re-pointed or snoozed, is not
 * shown at all.
 */
async function readBack(
  database: Drizzle,
  keys: readonly string[],
  identity: SlackIdentity,
): Promise<NoteSuggestionRow[]> {
  if (keys.length === 0) return []
  const rows = await database
    .select({
      id: schema.taskSuggestions.id,
      kind: schema.taskSuggestions.kind,
      proposal: schema.taskSuggestions.proposal,
      quote: schema.taskSuggestions.quote,
      dedupeKey: schema.taskSuggestions.dedupeKey,
      approverType: schema.taskSuggestions.approverType,
      approverId: schema.taskSuggestions.approverId,
      orgId: schema.taskSuggestions.orgId,
      status: schema.taskSuggestions.status,
    })
    .from(schema.taskSuggestions)
    .where(inArray(schema.taskSuggestions.dedupeKey, [...keys]))

  const out: NoteSuggestionRow[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    for (const row of rows) {
      if (row.dedupeKey !== key || seen.has(row.id)) continue
      const candidate: NoteSuggestionRow = {
        id: row.id,
        kind: row.kind,
        proposal: parseProposal(row.proposal),
        quote: row.quote,
        approverType: row.approverType,
        approverId: row.approverId ?? null,
        orgId: row.orgId ?? null,
        status: row.status,
      }
      if (!noteRowBelongsTo(identity, candidate)) continue
      // A selected client keeps the original note key. Recheck the stored
      // client, because the sender's access may have changed since selection.
      if (isStudioLevel(identity.level) && (!identity.teamMemberId
        || !await studioReachesOrg(database, identity.teamMemberId, candidate.orgId, ['tasks', 'requests']))) continue
      candidate.orgName = await orgNameOf(database, candidate.orgId)
      seen.add(row.id)
      out.push(candidate)
    }
  }
  return out
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

  return studioNoteDraft(input, identity, identity.teamMemberId, text)
}

/**
 * Nothing new was filed and nothing of the sender's own is still open to
 * show: the note repeats a card they already decided, or (for a studio note)
 * something already waiting for the studio. One plain line instead of a
 * friendly reply with no card under it.
 */
function alreadyOnFile(
  base: Pick<NoteDraftResult, 'orgId' | 'orgName' | 'approverType' | 'approverId' | 'duplicates'>,
  reply: string,
): NoteDraftResult {
  return { ok: false, reason: 'already_on_file', reply, inserted: 0, rows: [], ...base }
}

async function studioNoteDraft(
  input: DraftFromNoteInput,
  identity: SlackIdentity,
  teamMemberId: string,
  text: string,
): Promise<NoteDraftResult> {
  const { database } = input
  const at = input.now ?? new Date()
  const suggest = input.suggest ?? suggestFromTranscript

  const roster = await loadOrgRoster(database)
  const choices = matchOrgsFromText(text, roster)
  const orgId = choices.length === 1 ? choices[0].id : null
  const orgName = orgId ? roster.find(org => org.id === orgId)?.name ?? null : null
  if (choices.length > MAX_CLIENT_CHOICES) {
    return { ok: false, reason: 'nothing_understood', reply: 'Name one client more specifically, then send the note again.',
      orgId: null, orgName: null, approverType: 'member', approverId: teamMemberId,
      inserted: 0, duplicates: 0, rows: [] }
  }

  // Rule 11, before the model reads anything. The client is picked from the
  // whole roster by name, and the suggester's context is that client's open
  // tasks and requests, so a member scoped away from a client who names it in
  // a DM would otherwise be handed a card built from that client's work. The
  // dashboard's own scoping decides, as it does for a press on the card.
  // Notes can propose both kinds of work. Do not load mixed context or file
  // cards unless the sender can use both features, including with no client.
  if (!await studioReachesOrg(database, teamMemberId, orgId, ['tasks', 'requests'])) return denied()
  // An ambiguous note must not reveal names outside this sender's access.
  for (const choice of choices.length > 1 ? choices : []) {
    if (!await studioReachesOrg(database, teamMemberId, choice.id, ['tasks', 'requests'])) return denied()
  }

  let suggestions
  try {
    const context = await buildSuggestionContext(database, orgId, at)
    const result = await suggest({
      transcript: text,
      wrapUp: null,
      callTitle: null,
      callDate: studioDate(at),
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
      approverId: teamMemberId,
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
      approverId: teamMemberId,
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
    proposal: enrichNoteProposal({ kind: suggestion.kind, proposal: suggestion.proposal,
      quote: suggestion.quote, dueDateText: kept.length === 1 ? text : suggestion.quote, at, orgId, choices }),
    quote: suggestion.quote,
    rationale: suggestion.rationale,
    confidence: suggestion.confidence,
    approverType: 'member',
    approverId: teamMemberId,
  }))

  const written = await insertSuggestions(database, drafts)
  const rows = await readBack(database, await dedupeKeysFor(drafts), identity)

  if (written.inserted === 0 && rows.length === 0) {
    return alreadyOnFile(
      { orgId, orgName, approverType: 'member', approverId: teamMemberId, duplicates: written.duplicates },
      NOTE_REPLY_TEAM_ON_FILE,
    )
  }

  return {
    ok: true,
    reason: 'ok',
    reply: NOTE_REPLY_TEAM,
    orgId,
    orgName,
    approverType: 'member',
    approverId: teamMemberId,
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

  // THE PORTAL'S GATE, before anything is written. A contact or org whose
  // Requests feature is denied cannot file in the portal, so they are not
  // offered a card here either (and their Approve is refused again at the
  // press, lib/slack/dispatch-actions.ts, in case the rule changed between).
  if (!await clientMayFileRequests(database, identity.contactId, identity.orgId)) return denied()

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
    proposal: enrichNoteProposal({ kind: 'create_request', quote: text,
      at: input.now ?? new Date(), orgId: identity.orgId, choices: [], proposal: {
      title: titleFrom(text),
      description: text,
      // Category, type and priority are left out rather than guessed. The
      // create path defaults them, and the studio can move any of the three
      // once the request exists; inventing a category from one sentence would
      // put a number on a guess.
      requesterName,
      requesterContactId: identity.contactId,
    } }),
    // The note IS the source, so the quote is the note. That keeps the same
    // invariant every other suggestion carries: the words are checkable.
    quote: text,
    rationale: 'Asked for in a Slack DM.',
    confidence: null,
    approverType: 'contact',
    approverId: identity.contactId,
  }

  // The key carries this contact, this client and their whole message
  // (buildDedupeKey), so the row read back is this draft, or this same
  // message sent before. A pending create_request of theirs is their own
  // words as they sent them: nothing edits a pending draft's proposal but an
  // attach, which also changes its kind and so is never shown. Anything else
  // (decided, re-pointed, somebody else's) is held back by readBack.
  const written = await insertSuggestions(database, [draft])
  const rows = await readBack(database, await dedupeKeysFor([draft]), identity)

  if (written.inserted === 0 && rows.length === 0) {
    return alreadyOnFile(
      {
        orgId: identity.orgId,
        orgName,
        approverType: 'contact',
        approverId: identity.contactId,
        duplicates: written.duplicates,
      },
      NOTE_REPLY_CLIENT_ON_FILE,
    )
  }

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
  return Promise.all(drafts.map(draft => dedupeKeyForDraft(draft)))
}
