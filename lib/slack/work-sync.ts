/**
 * lib/slack/work-sync.ts
 *
 * Dashboard changes, told to the Slack thread they came from (CN.3 section 1).
 *
 * A task or a request that exists because somebody approved a suggestion card
 * in Slack has a thread: the card's own message, in each DM that holds a copy
 * (slack_suggestion_messages). When a studio person or a client later moves
 * that item on the dashboard, the thread gets ONE short line saying what
 * changed, so the person who approved it does not have to go looking.
 *
 * What a line is and is not. State, never conversation: status, assignee, due
 * date, priority, a rename, a task turned into a request, a hand-off (and the
 * studio taking it back) and a deletion. Never a quote, a description, a
 * message body or a transcript line. Names, labels, a date, the new title
 * when it was renamed, and the link. Not structure either: sub-requests and
 * nesting are to a request what subtasks and positions are to a task.
 *
 * Who hears it (section 2). Every stored DM must still identify its recipient,
 * who needs an active role, the work's feature and its current client scope.
 * A founders copy additionally needs a current super_admin role; a member
 * copy must belong to that note's sender. A client card hears nothing in CN.3:
 * it is never on the copies table (the client copy policy, lib/slack/mirror.ts), and the thread
 * query reads founders and member cards only. Nobody is told about their own
 * change, so the actor's own DM is skipped.
 *
 * How often (section 3). Only real changes; a claim row before every post so
 * two requests racing on the same change post once; the same person changing
 * the same item again within ten minutes rewrites the earlier line instead of
 * adding another; at most twelve lines per thread per rolling day, the last
 * of which says the dashboard has the rest; at most twenty posts per batch.
 *
 * SLACK NOT CONFIGURED IS THE NORMAL CASE (section 4). Production has no
 * SLACK_BOT_TOKEN yet. workSyncArmed() is the only thing a writer asks before
 * it spends a read on the before-state, and every entry point here returns
 * before touching the database while it is false.
 *
 * Nothing here is allowed to fail the thing that called it. Every Slack call
 * and every read is wrapped; the result says what happened, it never throws.
 *
 * slack_work_posts belongs to migration 0111 (slice N), and is read and
 * written through raw SQL, the
 * way lib/slack/mirror.ts handles its own table. A missing table reads as
 * "cannot claim", which posts nothing. Entitlements share the dashboard's
 * permission resolver and organisation scope rules.
 *
 * KEEP THE STATIC IMPORTS LIGHT. Every task and request writer imports this
 * file, and so does every route test behind them, many of which stand in a
 * partial @/db/d1. lib/slack/mirror.ts reaches lib/slack/identity.ts, which
 * reads schema.slackIdentities at load time, so mirror (for studioClock) is
 * loaded inside the engine, after the token check, and never on import.
 */

import { sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { publicUrl } from '@/lib/app-url'
import { REQUEST_STATUS_LABELS, TASK_STATUS_LABELS } from '@/lib/status-config'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import {
  postMessage as slackPostMessage,
  slackBotToken,
  updateMessage as slackUpdateMessage,
  type PostMessageInput,
  type SlackMessageRef,
  type UpdateMessageInput,
} from '@/lib/slack/api'
import { escapeSlackText } from '@/lib/slack/blocks'
import { deferSlackWork } from '@/lib/slack/defer'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── The shapes callers hand in ──────────────────────────────────────────────

export type WorkEntityType = 'task' | 'request'

/** 'promoted' is a task turned into a client request; its `to` is the
 *  request's "#232", or null when the number could not be read. */
export type WorkField = 'status' | 'assignee' | 'dueDate' | 'priority' | 'title' | 'promoted' | 'waitingOn' | 'deleted'

export interface WorkFieldChange {
  field: WorkField
  /** Undefined when the caller did not read it. */
  from?: string | null
  /** Assignee: a team member id. waitingOn: the contact's name. */
  to: string | null
  /** A caller-written verb phrase that replaces the default ("approved the delivery"). */
  phrase?: string
}

export type WorkActor =
  | { type: 'studio'; clerkUserId: string | null }
  | { type: 'client'; contactId: string | null; clerkUserId: string | null; actingAsTeamMemberId?: string | null }
  | { type: 'system' }

export interface WorkChange {
  entityType: WorkEntityType
  entityId: string
  actor: WorkActor
  changes: WorkFieldChange[]
  /** When it happened. Defaults to the moment the batch is synced. */
  at?: string
}

export interface WorkSyncResult {
  posted: number
  rewritten: number
  skipped: number
  reason?: 'slack_not_configured' | 'disabled' | 'nothing_to_sync'
}

/** Injected by tests, so nothing reaches Slack and the clock holds still. */
export interface WorkSyncDeps {
  postMessage?: (input: PostMessageInput) => Promise<SlackMessageRef>
  updateMessage?: (input: UpdateMessageInput) => Promise<unknown>
  now?: Date
  resolveAccessScoping?: (drizzle: Drizzle, clerkUserId: string | null) => Promise<string[] | null>
}

/** A thread whose suggestion was applied longer ago than this is left alone. */
export const THREAD_HORIZON_DAYS = 120
/** The same person on the same item within this window rewrites their last line. */
export const COALESCE_WINDOW_MS = 600_000
/** Lines per thread in any rolling 24 hours, the cap line included. */
export const THREAD_DAILY_CAP = 12
/** New lines one batch (a bulk edit) may post. */
export const BATCH_POST_CAP = 20

/** The settings key that turns every line off. Absent means on. */
export const WORK_SYNC_SETTING_KEY = 'slack.workSync.enabled'

const DAY_MS = 24 * 60 * 60 * 1000

/** D1 binds at most 100 parameters per statement, so IN lists are sliced. */
const ID_CHUNK = 90

/** The order fields read in a line, and the order a change list is stored in. */
const FIELD_ORDER: readonly WorkField[] = ['status', 'assignee', 'dueDate', 'priority', 'title', 'promoted', 'waitingOn', 'deleted']

const TITLE_LIMIT = 80

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Whether a line could be sent at all. The only question a writer asks before
 * it spends a read on the before-state, so a studio with no Slack app does
 * exactly the work it did before CN.3.
 */
export function workSyncArmed(): boolean {
  return slackBotToken() !== null
}

// ── Diffing ─────────────────────────────────────────────────────────────────

/** '' and null both mean "nothing", which is how the bulk bar clears a date. */
function normalise(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  return value === '' ? null : value
}

/**
 * The fields that actually moved. Only keys present in `after` are
 * considered; a key missing from `before` comes back with `from` undefined,
 * which means "not read" rather than "was empty". A double-clicked PATCH
 * writes the same value twice and the second diff is empty.
 */
export function diffWorkFields(
  before: Partial<Record<WorkField, string | null>>,
  after: Partial<Record<WorkField, string | null>>,
): WorkFieldChange[] {
  const out: WorkFieldChange[] = []
  for (const field of FIELD_ORDER) {
    const to = normalise(after[field])
    if (to === undefined) continue
    const from = normalise(before[field])
    if (from === undefined) {
      out.push({ field, to })
      continue
    }
    if (from === to) continue
    out.push({ field, from, to })
  }
  return out
}

/** A change that says nothing: its before is known and equals its after. */
function isNoOp(change: WorkFieldChange): boolean {
  return change.from !== undefined && change.from === change.to
}

function sortChanges(changes: readonly WorkFieldChange[]): WorkFieldChange[] {
  return [...changes].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field))
}

/** The changes worth a line: no system writes, no fields that did not move. */
function meaningfulChanges(changes: readonly WorkChange[]): WorkChange[] {
  const out: WorkChange[] = []
  for (const change of changes) {
    if (change.actor.type === 'system') continue
    const fields = change.changes.filter(field => !isNoOp(field))
    if (fields.length === 0) continue
    out.push({ ...change, changes: fields })
  }
  return out
}

// ── The line ────────────────────────────────────────────────────────────────

export interface WorkLineInput {
  entityType: WorkEntityType
  /** Who, already resolved: "Staci", "Claude", "Tim at Verandela", "Liam as Tim", "Someone". */
  actor: string
  /** The actor's own team member id, so taking a task yourself reads "took it on". */
  actorTeamMemberId?: string | null
  changes: readonly WorkFieldChange[]
  /** First names by team member (or contact) id, for "assigned it to Liam". */
  names?: Readonly<Record<string, string>>
  /** When it happened on the studio clock, "14:02" (mirror's studioClock of
   *  the change's timestamp). Null leaves the time out. */
  time: string | null
  /** The item on the dashboard. Null for a task that no longer exists. */
  link?: { url: string; label: string } | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Fri 2 Oct" from a stored due date. The value is a calendar date, not an
 * instant, so it is read from its own digits and never passed through a time
 * zone: a due date of the 2nd is the 2nd in Auckland and in London alike.
 */
function formatDueDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return value
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${WEEKDAYS[weekday]} ${day} ${MONTHS[month - 1]}`
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit).trimEnd()}...` : trimmed
}

function statusPhrase(entityType: WorkEntityType, change: WorkFieldChange): string {
  const to = change.to ?? ''
  if (entityType === 'task') {
    if (to === 'done') return 'marked it done'
    const label = TASK_STATUS_LABELS[to] ?? to
    if (change.from === 'done') return `reopened it as ${label}`
    return `moved it to ${label}`
  }
  if (to === 'delivered') return 'marked it delivered'
  if (to === 'archived') return 'archived it'
  if (to === 'cancelled') return 'cancelled it'
  return `moved it to ${REQUEST_STATUS_LABELS[to] ?? to}`
}

function phraseFor(input: WorkLineInput, change: WorkFieldChange): string {
  if (change.phrase && change.phrase.trim()) return change.phrase.trim()
  switch (change.field) {
    case 'status':
      return statusPhrase(input.entityType, change)
    case 'assignee': {
      if (!change.to) return 'unassigned it'
      if (input.actorTeamMemberId && change.to === input.actorTeamMemberId) return 'took it on'
      const name = input.names?.[change.to]
      return name ? `assigned it to ${name}` : 'reassigned it'
    }
    case 'dueDate':
      return change.to ? `set the due date to ${formatDueDay(change.to)}` : 'cleared the due date'
    case 'priority':
      return change.to ? `set the priority to ${change.to}` : 'cleared the priority'
    case 'title':
      return change.to ? `renamed it to "${clip(change.to, TITLE_LIMIT)}"` : 'renamed it'
    case 'promoted':
      return change.to ? `turned it into request ${change.to}` : 'turned it into a client request'
    case 'waitingOn':
      return change.to ? `handed it to ${change.to}` : 'cleared the hand-off'
    case 'deleted':
      return 'deleted it'
  }
}

/** "A", "A and B", "A, B and C". */
function joinPhrases(parts: readonly string[]): string {
  if (parts.length === 0) return 'changed it'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * One line, Slack mrkdwn:
 *
 *   Staci marked it done and set the due date to Fri 2 Oct · 14:02 · <url|Open task>
 *
 * Everything but the link is escaped, because names and titles are typed by
 * people and a stray < would otherwise open a Slack link or a mention.
 */
export function renderWorkLine(input: WorkLineInput): string {
  const phrases = sortChanges(input.changes).map(change => phraseFor(input, change))
  const parts = [escapeSlackText(`${input.actor} ${joinPhrases(phrases)}`)]
  if (input.time) parts.push(input.time)
  if (input.link) parts.push(`<${input.link.url}|${input.link.label}>`)
  return parts.join(' · ')
}

/** The twelfth line of a day, after which the thread goes quiet. */
function capLine(link: { url: string; label: string } | null): string {
  return link
    ? `More changes since then. The dashboard has the rest: <${link.url}|${link.label}>`
    : 'More changes since then. The dashboard has the rest.'
}

// ── Reading what a line needs ───────────────────────────────────────────────

function chunk<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK))
  return out
}

/** An IN list of bound parameters. Never called with an empty list. */
function inList(ids: readonly string[]) {
  return sql`(${sql.join(ids.map(id => sql`${id}`), sql`, `)})`
}

function unique(values: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const value of values) if (value) out.add(value)
  return Array.from(out)
}

function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0] ?? trimmed
}

/** Slack timestamps compared as numbers without trusting a float with them. */
function compareSlackTs(a: string, b: string): number {
  const [aSec = '0', aFrac = ''] = a.split('.')
  const [bSec = '0', bFrac = ''] = b.split('.')
  const bySeconds = Number(aSec) - Number(bSec)
  if (bySeconds !== 0) return bySeconds
  return Number(aFrac.padEnd(6, '0')) - Number(bFrac.padEnd(6, '0'))
}

/** The stamp shape task_suggestions.applied_at is written in. */
function isoSeconds(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface Thread {
  suggestionId: string
  approverType: string
  approverId: string | null
  orgId: string | null
  channelId: string
  threadTs: string
}

interface ThreadRow {
  suggestion_id: string
  entity_id: string
  approver_type: string | null
  approver_id: string | null
  org_id: string | null
  channel_id: string
  ts: string
}

/**
 * The threads for a batch of items of one kind, keyed by item. Per item and
 * channel, one thread: the card with the highest ts, which is the most
 * recently posted copy of the most recently applied suggestion there.
 *
 * Only founders and member cards are read at all. A client's card is never on
 * the copies table (the client copy policy, lib/slack/mirror.ts), and the
 * query says so too, so a client's DM cannot become a thread here even if a
 * copy were somehow on file; the audience check below is the third fence.
 */
async function findThreads(
  drizzle: Drizzle,
  entityType: WorkEntityType,
  ids: readonly string[],
  horizon: string,
): Promise<Map<string, Thread[]>> {
  const byItemChannel = new Map<string, Map<string, Thread>>()
  for (const part of chunk(ids)) {
    const rows = entityType === 'task'
      ? await drizzle.all<ThreadRow>(sql`
          SELECT s.id AS suggestion_id, s.applied_task_id AS entity_id, s.approver_type AS approver_type,
                 s.approver_id AS approver_id, s.org_id AS org_id, m.channel_id AS channel_id, m.ts AS ts
          FROM task_suggestions s
          INNER JOIN slack_suggestion_messages m ON m.suggestion_id = s.id
          WHERE s.status = 'applied'
            AND s.approver_type IN ('founders', 'member')
            AND s.applied_task_id IN ${inList(part)}
            AND s.applied_at >= ${horizon}
        `)
      : await drizzle.all<ThreadRow>(sql`
          SELECT s.id AS suggestion_id, s.applied_request_id AS entity_id, s.approver_type AS approver_type,
                 s.approver_id AS approver_id, s.org_id AS org_id, m.channel_id AS channel_id, m.ts AS ts
          FROM task_suggestions s
          INNER JOIN slack_suggestion_messages m ON m.suggestion_id = s.id
          WHERE s.status = 'applied'
            AND s.approver_type IN ('founders', 'member')
            AND s.applied_request_id IN ${inList(part)}
            AND s.applied_at >= ${horizon}
        `)
    for (const row of rows ?? []) {
      if (!row.entity_id || !row.channel_id || !row.ts) continue
      const channels = byItemChannel.get(row.entity_id) ?? new Map<string, Thread>()
      const held = channels.get(row.channel_id)
      if (!held || compareSlackTs(row.ts, held.threadTs) > 0) {
        channels.set(row.channel_id, {
          suggestionId: row.suggestion_id,
          approverType: row.approver_type ?? '',
          approverId: row.approver_id ?? null,
          orgId: row.org_id ?? null,
          channelId: row.channel_id,
          threadTs: row.ts,
        })
      }
      byItemChannel.set(row.entity_id, channels)
    }
  }
  const out = new Map<string, Thread[]>()
  for (const [itemId, channels] of byItemChannel) out.set(itemId, Array.from(channels.values()))
  return out
}

interface Item {
  orgId: string | null
  requestNumber: number | null
}

interface MemberRow { id: string; name: string | null; clerk_user_id: string | null }
interface ContactRow { id: string; name: string | null; org_id: string | null; clerk_user_id: string | null; org_name: string | null }
interface IdentityRow { team_member_id: string | null; level: string | null; dm_channel_id: string | null }

async function loadItems(drizzle: Drizzle, entityType: WorkEntityType, ids: readonly string[]): Promise<Map<string, Item>> {
  const out = new Map<string, Item>()
  for (const part of chunk(ids)) {
    if (entityType === 'task') {
      const rows = await drizzle.all<{ id: string; org_id: string | null }>(sql`
        SELECT id, org_id FROM tasks WHERE id IN ${inList(part)}
      `)
      for (const row of rows ?? []) out.set(row.id, { orgId: row.org_id ?? null, requestNumber: null })
    } else {
      const rows = await drizzle.all<{ id: string; org_id: string | null; request_number: number | null }>(sql`
        SELECT id, org_id, request_number FROM requests WHERE id IN ${inList(part)}
      `)
      for (const row of rows ?? []) {
        out.set(row.id, {
          orgId: row.org_id ?? null,
          requestNumber: typeof row.request_number === 'number' ? row.request_number : null,
        })
      }
    }
  }
  return out
}

async function loadMembers(
  drizzle: Drizzle,
  ids: readonly string[],
  clerkUserIds: readonly string[],
): Promise<MemberRow[]> {
  const out: MemberRow[] = []
  for (const part of chunk(ids)) {
    out.push(...(await drizzle.all<MemberRow>(sql`
      SELECT id, name, clerk_user_id FROM team_members WHERE id IN ${inList(part)}
    `) ?? []))
  }
  for (const part of chunk(clerkUserIds)) {
    out.push(...(await drizzle.all<MemberRow>(sql`
      SELECT id, name, clerk_user_id FROM team_members WHERE clerk_user_id IN ${inList(part)}
    `) ?? []))
  }
  return out
}

async function loadContacts(
  drizzle: Drizzle,
  ids: readonly string[],
  clerkUserIds: readonly string[],
): Promise<ContactRow[]> {
  const out: ContactRow[] = []
  for (const part of chunk(ids)) {
    out.push(...(await drizzle.all<ContactRow>(sql`
      SELECT c.id AS id, c.name AS name, c.org_id AS org_id, c.clerk_user_id AS clerk_user_id, o.name AS org_name
      FROM contacts c LEFT JOIN organisations o ON o.id = c.org_id
      WHERE c.id IN ${inList(part)}
    `) ?? []))
  }
  for (const part of chunk(clerkUserIds)) {
    out.push(...(await drizzle.all<ContactRow>(sql`
      SELECT c.id AS id, c.name AS name, c.org_id AS org_id, c.clerk_user_id AS clerk_user_id, o.name AS org_name
      FROM contacts c LEFT JOIN organisations o ON o.id = c.org_id
      WHERE c.clerk_user_id IN ${inList(part)}
    `) ?? []))
  }
  return out
}

async function loadIdentities(drizzle: Drizzle, teamMemberIds: readonly string[]): Promise<IdentityRow[]> {
  const out: IdentityRow[] = []
  for (const part of chunk(teamMemberIds)) {
    out.push(...(await drizzle.all<IdentityRow>(sql`
      SELECT team_member_id, level, dm_channel_id FROM slack_identities WHERE team_member_id IN ${inList(part)}
    `) ?? []))
  }
  return out
}

async function loadRecipients(drizzle: Drizzle, channelId: string): Promise<IdentityRow[]> {
  return await drizzle.all<IdentityRow>(sql`
    SELECT team_member_id, level, dm_channel_id FROM slack_identities WHERE dm_channel_id = ${channelId}
  `) ?? []
}

/** The kill switch, read once per batch. 'false' (plain or JSON) turns lines off. */
async function killSwitchOn(drizzle: Drizzle): Promise<boolean> {
  const rows = await drizzle.all<{ value: string | null }>(sql`
    SELECT value FROM settings WHERE key = ${WORK_SYNC_SETTING_KEY} LIMIT 1
  `)
  const value = rows?.[0]?.value?.trim().toLowerCase() ?? null
  return value === 'false' || value === '"false"'
}

// ── Who did it ──────────────────────────────────────────────────────────────

interface ResolvedActor {
  label: string
  /** 'tm:<id>' | 'service' | 'contact:<id>' | 'acting:<tmId>:<contactId>' |
   *  'unknown', the coalescing key. */
  key: string
  /** For "took it on". */
  teamMemberId: string | null
  /** DMs that belong to whoever made the change, which never hear about it. */
  ownChannels: ReadonlySet<string>
}

interface Lookups {
  membersById: Map<string, MemberRow>
  membersByClerk: Map<string, MemberRow>
  contactsById: Map<string, ContactRow>
  contactsByClerk: Map<string, ContactRow[]>
  identitiesByMember: Map<string, IdentityRow[]>
}

function ownChannelsOf(lookups: Lookups, teamMemberId: string | null): Set<string> {
  const out = new Set<string>()
  if (!teamMemberId) return out
  for (const identity of lookups.identitiesByMember.get(teamMemberId) ?? []) {
    if (identity.dm_channel_id) out.add(identity.dm_channel_id)
  }
  return out
}

function resolveActor(actor: WorkActor, item: Item | null, lookups: Lookups): ResolvedActor {
  if (actor.type === 'studio') {
    if (actor.clerkUserId === SERVICE_USER_ID) {
      return { label: 'Claude', key: 'service', teamMemberId: null, ownChannels: new Set() }
    }
    const member = actor.clerkUserId ? lookups.membersByClerk.get(actor.clerkUserId) : undefined
    if (!member) return { label: 'Someone', key: 'unknown', teamMemberId: null, ownChannels: new Set() }
    return {
      label: firstName(member.name) ?? 'Someone',
      key: `tm:${member.id}`,
      teamMemberId: member.id,
      ownChannels: ownChannelsOf(lookups, member.id),
    }
  }

  if (actor.type === 'client') {
    const acting = actor.actingAsTeamMemberId ?? null
    let contact = actor.contactId ? lookups.contactsById.get(actor.contactId) : undefined
    // A client approving in the portal is not looked up by the route, so the
    // Clerk login finds them here, preferring their seat at the item's client.
    if (!contact && !actor.contactId && !acting && actor.clerkUserId) {
      const seats = lookups.contactsByClerk.get(actor.clerkUserId) ?? []
      contact = seats.find(seat => item?.orgId && seat.org_id === item.orgId) ?? seats[0]
    }
    const contactFirst = firstName(contact?.name)
    const contactKey = contact?.id ?? actor.contactId ?? null
    const key = contactKey ? `contact:${contactKey}` : 'unknown'

    if (acting) {
      // The studio standing in the client's seat: "Liam as Tim". It was
      // Liam's change, so Liam's own DM does not hear about it either. Keyed
      // apart from the real client, so "Liam as Tim" and Tim himself acting
      // on the same item inside ten minutes stay two lines under two names.
      const admin = firstName(lookups.membersById.get(acting)?.name) ?? 'Someone'
      return {
        label: `${admin} as ${contactFirst ?? 'the client'}`,
        key: contactKey ? `acting:${acting}:${contactKey}` : `acting:${acting}`,
        teamMemberId: null,
        ownChannels: ownChannelsOf(lookups, acting),
      }
    }
    if (!contactFirst) return { label: 'Someone', key, teamMemberId: null, ownChannels: new Set() }
    const orgName = contact?.org_name?.trim()
    return {
      label: orgName ? `${contactFirst} at ${orgName}` : contactFirst,
      key,
      teamMemberId: null,
      ownChannels: new Set(),
    }
  }

  return { label: 'Someone', key: 'unknown', teamMemberId: null, ownChannels: new Set() }
}

// ── Posting ─────────────────────────────────────────────────────────────────

/** One stored or incoming change list, in the canonical shape: field order,
 *  fixed key order, undefined keys dropped. Doubles as the dedupe input. */
function canonicalChanges(changes: readonly WorkFieldChange[]): string {
  return JSON.stringify(sortChanges(changes).map(change => ({
    field: change.field,
    from: change.from,
    to: change.to,
    phrase: change.phrase,
  })))
}

function parseStoredChanges(raw: string | null): WorkFieldChange[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: WorkFieldChange[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const field = record.field
      if (typeof field !== 'string' || !(FIELD_ORDER as readonly string[]).includes(field)) continue
      const to = typeof record.to === 'string' ? record.to : null
      const change: WorkFieldChange = { field: field as WorkField, to }
      if (typeof record.from === 'string' || record.from === null) change.from = record.from as string | null
      if (typeof record.phrase === 'string') change.phrase = record.phrase
      out.push(change)
    }
    return out
  } catch {
    return []
  }
}

/** Latest to and phrase per field, earliest from. */
function mergeChanges(earlier: readonly WorkFieldChange[], later: readonly WorkFieldChange[]): WorkFieldChange[] {
  const byField = new Map<WorkField, WorkFieldChange>()
  for (const change of earlier) byField.set(change.field, { ...change })
  for (const change of later) {
    const held = byField.get(change.field)
    if (!held) {
      byField.set(change.field, { ...change })
      continue
    }
    const merged: WorkFieldChange = { field: change.field, to: change.to }
    const from = held.from !== undefined ? held.from : change.from
    if (from !== undefined) merged.from = from
    if (change.phrase !== undefined) merged.phrase = change.phrase
    byField.set(change.field, merged)
  }
  return sortChanges(Array.from(byField.values()))
}

/** What a merged line shows: the fields that ended somewhere new, or, when a
 *  quick there-and-back left nothing, the state it ended in. */
function visibleChanges(changes: readonly WorkFieldChange[]): WorkFieldChange[] {
  const moved = changes.filter(change => !isNoOp(change))
  return moved.length > 0 ? moved : [...changes]
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

interface PostRow { id: string; ts: string | null; changes: string | null }

type PostOutcome = 'posted' | 'rewritten' | 'skipped'

interface ThreadJob {
  thread: Thread
  change: WorkChange
  actor: ResolvedActor
  link: { url: string; label: string } | null
  names: Readonly<Record<string, string>>
}

interface EngineClock {
  now: Date
  /** mirror's studioClock, loaded once per batch. */
  studioTime: (iso: string | null) => string | null
  post: NonNullable<WorkSyncDeps['postMessage']>
  update: NonNullable<WorkSyncDeps['updateMessage']>
}

async function postToThread(drizzle: Drizzle, job: ThreadJob, clock: EngineClock): Promise<PostOutcome> {
  const { thread, change, actor } = job
  const nowIso = clock.now.toISOString()
  const time = clock.studioTime(change.at ?? nowIso)
  const line = (changes: readonly WorkFieldChange[]) => renderWorkLine({
    entityType: change.entityType,
    actor: actor.label,
    actorTeamMemberId: actor.teamMemberId,
    changes,
    names: job.names,
    time,
    link: job.link,
  })

  // a. Coalesce: the same person on the same item in the same thread within
  //    ten minutes rewrites their last line rather than adding another.
  let prior: PostRow | undefined
  try {
    const windowStart = new Date(clock.now.getTime() - COALESCE_WINDOW_MS).toISOString()
    const rows = await drizzle.all<PostRow>(sql`
      SELECT id, ts, changes FROM slack_work_posts
      WHERE channel_id = ${thread.channelId}
        AND thread_ts = ${thread.threadTs}
        AND entity_type = ${change.entityType}
        AND entity_id = ${change.entityId}
        AND actor_key = ${actor.key}
        AND ts IS NOT NULL
        AND updated_at >= ${windowStart}
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    prior = rows?.[0]
  } catch {
    return 'skipped'
  }

  if (prior?.ts) {
    const merged = mergeChanges(parseStoredChanges(prior.changes), change.changes)
    try {
      await clock.update({ channel: thread.channelId, ts: prior.ts, text: line(visibleChanges(merged)) })
      try {
        await drizzle.run(sql`
          UPDATE slack_work_posts SET changes = ${canonicalChanges(merged)}, updated_at = ${nowIso}
          WHERE id = ${prior.id}
        `)
      } catch {
        // The line on screen is already right; a stale row only means the
        // next edit merges onto a slightly older list.
      }
      return 'rewritten'
    } catch {
      // The earlier line cannot be edited (deleted in Slack, most likely). A
      // fresh line below is the fallback.
    }
  }

  // b. The per-thread cap, over a rolling day.
  let recent: number
  try {
    const dayStart = new Date(clock.now.getTime() - DAY_MS).toISOString()
    const rows = await drizzle.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM slack_work_posts
      WHERE channel_id = ${thread.channelId} AND thread_ts = ${thread.threadTs} AND posted_at >= ${dayStart}
    `)
    recent = Number(rows?.[0]?.n ?? 0)
  } catch {
    return 'skipped'
  }
  if (recent >= THREAD_DAILY_CAP) return 'skipped'
  const capping = recent === THREAD_DAILY_CAP - 1
  const actorKey = capping ? 'cap' : actor.key
  const text = capping ? capLine(job.link) : line(change.changes)
  const changesJson = canonicalChanges(change.changes)

  // c. Claim, confirm the claim is ours, then post.
  const id = crypto.randomUUID()
  try {
    const dedupeKey = await sha256Hex([
      thread.channelId,
      thread.threadTs,
      `${change.entityType}:${change.entityId}`,
      actorKey,
      changesJson,
      nowIso.slice(0, 16),
    ].join('|'))
    await drizzle.run(sql`
      INSERT OR IGNORE INTO slack_work_posts (
        id, dedupe_key, entity_type, entity_id, suggestion_id, channel_id, thread_ts,
        ts, actor_key, changes, posted_at, updated_at
      ) VALUES (
        ${id}, ${dedupeKey}, ${change.entityType}, ${change.entityId}, ${thread.suggestionId},
        ${thread.channelId}, ${thread.threadTs}, NULL, ${actorKey}, ${changesJson}, ${nowIso}, ${nowIso}
      )
    `)
    const claimed = await drizzle.all<{ id: string }>(sql`
      SELECT id FROM slack_work_posts WHERE dedupe_key = ${dedupeKey} LIMIT 1
    `)
    if (claimed?.[0]?.id !== id) return 'skipped'
  } catch {
    return 'skipped'
  }

  let ref: SlackMessageRef
  try {
    ref = await clock.post({ channel: thread.channelId, threadTs: thread.threadTs, text })
  } catch {
    try {
      await drizzle.run(sql`DELETE FROM slack_work_posts WHERE id = ${id}`)
    } catch {
      // A claim that outlives a failed post blocks only this exact change in
      // this exact minute, which is the retry it would have been anyway.
    }
    return 'skipped'
  }

  try {
    await drizzle.run(sql`
      UPDATE slack_work_posts SET ts = ${ref.ts || null}, updated_at = ${nowIso} WHERE id = ${id}
    `)
  } catch {
    // Posted either way. Without the ts the next quick edit posts a fresh
    // line instead of rewriting this one.
  }
  return 'posted'
}

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * Post the lines for a batch of changes. Never throws: whatever went out
 * before a failure is what the result reports.
 *
 * `skipped` counts the work that did not become a line: a dropped change, a
 * change with no thread, a thread that may not hear it, a thread at its cap,
 * a lost claim, a failed post, and everything past the batch cap.
 */
export async function syncWorkChanges(
  drizzle: Drizzle,
  changes: readonly WorkChange[],
  deps: WorkSyncDeps = {},
): Promise<WorkSyncResult> {
  if (!workSyncArmed()) {
    return { posted: 0, rewritten: 0, skipped: changes.length, reason: 'slack_not_configured' }
  }

  const result: WorkSyncResult = { posted: 0, rewritten: 0, skipped: 0 }
  try {
    const live = meaningfulChanges(changes)
    if (live.length === 0) return { ...result, skipped: changes.length, reason: 'nothing_to_sync' }
    result.skipped += changes.length - live.length

    if (await killSwitchOn(drizzle)) return { ...result, skipped: changes.length, reason: 'disabled' }

    const now = deps.now ?? new Date()
    const horizon = isoSeconds(new Date(now.getTime() - THREAD_HORIZON_DAYS * DAY_MS))

    const threadsByType: Record<WorkEntityType, Map<string, Thread[]>> = {
      task: await findThreadsFor(drizzle, live, 'task', horizon),
      request: await findThreadsFor(drizzle, live, 'request', horizon),
    }
    const threaded = live.filter(change => (threadsByType[change.entityType].get(change.entityId) ?? []).length > 0)
    result.skipped += live.length - threaded.length
    if (threaded.length === 0) return result

    // Everything the lines and the audience check need, read once per batch.
    const items: Record<WorkEntityType, Map<string, Item>> = {
      task: await loadItems(drizzle, 'task', unique(threaded.filter(c => c.entityType === 'task').map(c => c.entityId))),
      request: await loadItems(drizzle, 'request', unique(threaded.filter(c => c.entityType === 'request').map(c => c.entityId))),
    }

    const allThreads = threaded.flatMap(change => threadsByType[change.entityType].get(change.entityId) ?? [])
    const memberApprovers = unique(allThreads.filter(t => t.approverType === 'member').map(t => t.approverId))
    const assigneeIds = unique(threaded.flatMap(c => c.changes.filter(f => f.field === 'assignee').map(f => f.to)))
    const actingIds = unique(threaded.map(c => (c.actor.type === 'client' ? c.actor.actingAsTeamMemberId : null)))
    const studioClerkIds = unique(threaded.map(c => (
      c.actor.type === 'studio' && c.actor.clerkUserId !== SERVICE_USER_ID ? c.actor.clerkUserId : null
    )))

    const members = await loadMembers(drizzle, unique([...memberApprovers, ...assigneeIds, ...actingIds]), studioClerkIds)
    const membersById = new Map<string, MemberRow>()
    const membersByClerk = new Map<string, MemberRow>()
    for (const member of members) {
      membersById.set(member.id, member)
      if (member.clerk_user_id) membersByClerk.set(member.clerk_user_id, member)
    }

    const clientContactIds = unique(threaded.map(c => (c.actor.type === 'client' ? c.actor.contactId : null)))
    const clientClerkIds = unique(threaded.map(c => (
      c.actor.type === 'client' && !c.actor.contactId && !c.actor.actingAsTeamMemberId ? c.actor.clerkUserId : null
    )))
    const contactAssignees = assigneeIds.filter(id => !membersById.has(id))
    const contacts = await loadContacts(drizzle, unique([...clientContactIds, ...contactAssignees]), clientClerkIds)
    const contactsById = new Map<string, ContactRow>()
    const contactsByClerk = new Map<string, ContactRow[]>()
    for (const contact of contacts) {
      contactsById.set(contact.id, contact)
      if (contact.clerk_user_id) {
        const seats = contactsByClerk.get(contact.clerk_user_id) ?? []
        if (!seats.some(seat => seat.id === contact.id)) seats.push(contact)
        contactsByClerk.set(contact.clerk_user_id, seats)
      }
    }

    const actorMemberIds = unique([
      ...threaded.map(c => (c.actor.type === 'studio' && c.actor.clerkUserId ? membersByClerk.get(c.actor.clerkUserId)?.id : null)),
      ...actingIds,
    ])
    const identities = await loadIdentities(drizzle, unique([...actorMemberIds, ...memberApprovers]))
    const identitiesByMember = new Map<string, IdentityRow[]>()
    for (const identity of identities) {
      if (!identity.team_member_id) continue
      const list = identitiesByMember.get(identity.team_member_id) ?? []
      list.push(identity)
      identitiesByMember.set(identity.team_member_id, list)
    }

    const lookups: Lookups = { membersById, membersByClerk, contactsById, contactsByClerk, identitiesByMember }

    const names: Record<string, string> = {}
    for (const id of assigneeIds) {
      const name = firstName(membersById.get(id)?.name) ?? firstName(contactsById.get(id)?.name)
      if (name) names[id] = name
    }

    // Loaded only after the token check, preserving the no-Slack import and
    // database fast path used by every writer.
    const { studioReachesOrg } = await import('@/lib/slack/entitlement')
    const mayHear = async (thread: Thread, item: Item | null, entityType: WorkEntityType, deleted: boolean): Promise<boolean> => {
      try {
        const recipients = await loadRecipients(drizzle, thread.channelId)
        if (recipients.length !== 1) return false
        const recipient = recipients[0]
        if (!recipient.team_member_id) return false
        if (thread.approverType === 'founders') {
          if (recipient.level !== 'founder' || (!item && !deleted)) return false
        } else if (thread.approverType === 'member') {
          if (!item || recipient.team_member_id !== thread.approverId
            || (recipient.level !== 'member' && recipient.level !== 'founder')) return false
        } else return false
        return await studioReachesOrg(drizzle, recipient.team_member_id, item ? item.orgId : thread.orgId,
          [entityType === 'task' ? 'tasks' : 'requests'], {
            founderOnly: thread.approverType === 'founders' || recipient.level === 'founder',
            scopeOf: deps.resolveAccessScoping ?? resolveAccessScoping,
          })
      } catch {
        return false
      }
    }

    const { studioClock } = await import('@/lib/slack/mirror')
    const clock: EngineClock = {
      now,
      studioTime: studioClock,
      post: deps.postMessage ?? slackPostMessage,
      update: deps.updateMessage ?? slackUpdateMessage,
    }

    for (const change of threaded) {
      const item = items[change.entityType].get(change.entityId) ?? null
      const actor = resolveActor(change.actor, item, lookups)
      const deleted = change.changes.some(field => field.field === 'deleted')
      const link = linkFor(change.entityType, change.entityId, item, deleted)

      for (const thread of threadsByType[change.entityType].get(change.entityId) ?? []) {
        if (result.posted >= BATCH_POST_CAP) {
          result.skipped++
          continue
        }
        if (actor.ownChannels.has(thread.channelId) || !await mayHear(thread, item, change.entityType, deleted)) {
          result.skipped++
          continue
        }
        const outcome = await postToThread(drizzle, { thread, change, actor, link, names }, clock)
        if (outcome === 'posted') result.posted++
        else if (outcome === 'rewritten') result.rewritten++
        else result.skipped++
      }
    }

    return result
  } catch {
    return result
  }
}

async function findThreadsFor(
  drizzle: Drizzle,
  changes: readonly WorkChange[],
  entityType: WorkEntityType,
  horizon: string,
): Promise<Map<string, Thread[]>> {
  const ids = unique(changes.filter(change => change.entityType === entityType).map(change => change.entityId))
  if (ids.length === 0) return new Map()
  return findThreads(drizzle, entityType, ids, horizon)
}

function linkFor(
  entityType: WorkEntityType,
  entityId: string,
  item: Item | null,
  deleted: boolean,
): { url: string; label: string } | null {
  if (entityType === 'task') {
    return deleted ? null : { url: publicUrl(`/tasks/${entityId}`), label: 'Open task' }
  }
  const number = item?.requestNumber
  return {
    url: publicUrl(`/requests/${entityId}`),
    label: typeof number === 'number' ? `Open #${number}` : 'Open request',
  }
}

/**
 * What a writer calls after a successful change: returns at once while Slack
 * is not configured or there is nothing worth a line, otherwise hands the
 * batch to the background so the dashboard's answer never waits on Slack.
 * Never throws.
 */
export async function queueWorkSync(drizzle: Drizzle, changes: readonly WorkChange[]): Promise<void> {
  try {
    if (!workSyncArmed() || changes.length === 0) return
    const batch = meaningfulChanges(changes)
    if (batch.length === 0) return
    await deferSlackWork(() => syncWorkChanges(drizzle, batch).then(() => undefined))
  } catch {
    // A line that never goes out is a Slack problem, never the writer's.
  }
}
