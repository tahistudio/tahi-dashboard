/**
 * lib/slack/digest.ts
 *
 * The Monday digest: one Slack DM a week that says what is still waiting in
 * the suggestions inbox (CN.3 contract section 5).
 *
 * Two kinds of message, and nobody else gets either:
 *
 *   studio    each founder (a slack_identities row at level founder whose
 *             team member still holds an active super_admin role): how many
 *             call suggestions are waiting and for which clients, the five
 *             that have waited longest, and a few lines of context (snoozed,
 *             client drafts, approvals that did not apply, last week's
 *             decisions, the founder's own notes).
 *   personal  anybody else on the roster whose own notes have waited a day or
 *             more: those notes, and only those the member can still reach
 *             under lib/access-scoping.ts. Never a count of anybody else's.
 *
 * Clients and strangers get nothing: no Slack message reaches a client that
 * the client did not trigger. There are no approve buttons: the cards already
 * exist in the same DM, and one approval surface per suggestion is enough.
 * One button opens the inbox. There is never a quote: the quote column is not
 * even read.
 *
 * WHEN. Monday 08:00 to 09:59 in Auckland, once per NZ ISO week per Slack
 * user. Cloudflare crons are UTC, so the job rides two Sunday slots
 * (workers/cron-trigger/src/schedule.ts): 19:30 UTC is 08:30 in NZDT and 07:30
 * in NZST, 20:00 UTC is 09:00 in NZDT and 08:00 in NZST. Whichever lands in
 * the window first sends; the other finds the week's claim and sends nothing.
 *
 * ONCE. A claim row in slack_digests (unique on week and Slack user) is
 * written BEFORE the post and confirmed by reading it back. A failed post
 * deletes its claim, so the second Sunday slot retries. force skips the
 * window, never the claim. slack_digests belongs to migration 0111 (slice N)
 * and is not in db/schema.ts here, so it is read and written with raw SQL, as
 * lib/slack/mirror.ts does for the copies table; any error on it reads as "the
 * claim cannot be made", and an unclaimed digest is not sent.
 *
 * SLACK NOT SET UP is the normal case on production today. Without a bot
 * token the run returns before it touches the database. A dry run is the one
 * exception, and it only reads: it builds every message it would send, posts
 * nothing, writes nothing, and opens no DM, which is how the digest is checked
 * before Slack exists.
 */

import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { publicUrl } from '@/lib/app-url'
import { STUDIO_TIME_ZONE } from '@/lib/call-time'
import {
  openDm as slackOpenDm,
  postMessage as slackPostMessage,
  slackBotToken,
  type PostMessageInput,
  type SlackMessageRef,
} from '@/lib/slack/api'
import {
  DIGEST_ACTION_PREFIX,
  escapeSlackText,
  slackLink,
  suggestionTweakUrl,
  type SlackBlock,
  type SlackMessagePayload,
  type SlackTextObject,
} from '@/lib/slack/blocks'
import { studioWhen } from '@/lib/slack/mirror'
import { suggestionKindLabel, summariseProposal } from '@/lib/suggestion-summary'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── The knobs ───────────────────────────────────────────────────────────────

/** Monday, as Date#getDay counts it. Moving the digest to another day is this
 *  constant, the window below, and a cron slot. */
export const DIGEST_WEEKDAY = 1
/** Inclusive, NZ local hour. */
export const DIGEST_WINDOW_START_HOUR = 8
/** Exclusive, NZ local hour. */
export const DIGEST_WINDOW_END_HOUR = 10
/** Lines of "waiting longest", and of the reader's own notes. */
export const DIGEST_ITEM_LIMIT = 5
/** A member's note has to have waited this long before it is worth a DM. */
export const DIGEST_MEMBER_MIN_AGE_HOURS = 24
/** settings key; the value 'false' switches the digest off. Absent is on. */
export const DIGEST_ENABLED_SETTING = 'slack.digest.enabled'
/** From this age a client's line says how old its oldest suggestion is:
 *  a weekly message flags what has sat for a week or more. */
export const DIGEST_STALE_DAYS = 7
/** How far back a failed approval is still news. */
export const DIGEST_FAILED_WINDOW_DAYS = 14
/** "Last week", counted back from the run. */
export const DIGEST_LAST_WEEK_DAYS = 7
/** The one button, a url into the inbox. Claimed in lib/slack/dispatch-actions.ts. */
export const DIGEST_OPEN_INBOX_ACTION_ID = `${DIGEST_ACTION_PREFIX}:open_inbox`

/** Clients named on the "by client" line before the rest are counted. */
const CLIENT_LINE_LIMIT = 8
/** A summary longer than this is clipped: the digest is a list, not a card. */
const SUMMARY_MAX_CHARS = 100

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// ── When ────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The ISO week of a calendar date: the week belongs to the year its
 *  Thursday falls in, and week 1 is the one holding 4 January. */
function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3)
  const isoYear = date.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${isoYear}-W${pad(week)}`
}

/**
 * Where an instant falls for the digest: whether it is inside the Monday
 * morning window in Auckland, which NZ ISO week it belongs to, and the NZ
 * calendar date. Read through Intl with the studio's zone, so daylight saving
 * comes from the platform's tz database rather than from a hardcoded offset.
 */
export function nzDigestSlot(at: Date): { inWindow: boolean; weekKey: string; localDate: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(at)
  const value = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))
  const hour = Number(value('hour'))
  const weekday = WEEKDAYS.indexOf(value('weekday'))
  const inWindow = weekday === DIGEST_WEEKDAY
    && hour >= DIGEST_WINDOW_START_HOUR
    && hour < DIGEST_WINDOW_END_HOUR
  return { inWindow, weekKey: isoWeekKey(year, month, day), localDate: `${year}-${pad(month)}-${pad(day)}` }
}

/** "1", "true", "yes" or "on" from a query string. Anything else is off. */
export function parseDigestFlag(value: string | null): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

// ── What is read ────────────────────────────────────────────────────────────

/** One suggestion row as the digest reads it. No quote, by construction. */
export interface DigestSuggestion {
  id: string
  orgId: string | null
  orgName: string | null
  kind: string
  proposal: string
  status: string
  snoozeUntil: string | null
  approverType: string
  approverId: string | null
  decidedAt: string | null
  updatedAt: string
  createdAt: string
}

/** One person the digest might be for. */
export interface DigestIdentity {
  id: string
  slackUserId: string
  level: 'founder' | 'member'
  teamMemberId: string | null
  dmChannelId: string | null
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * The open rows, and the decided ones recent enough to count.
 *
 * The query narrows; the classifiers below decide, in JS, on the same rule
 * lib/task-suggestions.ts resurfaceSnoozed follows: what goes in which line
 * is the behaviour of this module, and a rule that lives only inside a WHERE
 * cannot be exercised.
 */
async function loadDigestSuggestions(database: Drizzle, at: Date): Promise<DigestSuggestion[]> {
  const since = new Date(at.getTime() - DIGEST_FAILED_WINDOW_DAYS * DAY_MS).toISOString()
  const rows = await database
    .select({
      id: schema.taskSuggestions.id,
      orgId: schema.taskSuggestions.orgId,
      orgName: schema.organisations.name,
      kind: schema.taskSuggestions.kind,
      proposal: schema.taskSuggestions.proposal,
      status: schema.taskSuggestions.status,
      snoozeUntil: schema.taskSuggestions.snoozeUntil,
      approverType: schema.taskSuggestions.approverType,
      approverId: schema.taskSuggestions.approverId,
      decidedAt: schema.taskSuggestions.decidedAt,
      updatedAt: schema.taskSuggestions.updatedAt,
      createdAt: schema.taskSuggestions.createdAt,
    })
    .from(schema.taskSuggestions)
    .leftJoin(schema.organisations, eq(schema.organisations.id, schema.taskSuggestions.orgId))
    .where(or(
      inArray(schema.taskSuggestions.status, ['pending', 'snoozed']),
      and(
        inArray(schema.taskSuggestions.status, ['applied', 'rejected', 'failed']),
        gte(schema.taskSuggestions.updatedAt, since),
      ),
    ))
  return (rows ?? []) as DigestSuggestion[]
}

/** Every roster identity: founders and members. Clients and strangers are
 *  left out of the read, and out again below in case a row says otherwise. */
async function loadDigestIdentities(database: Drizzle): Promise<DigestIdentity[]> {
  const rows = await database
    .select({
      id: schema.slackIdentities.id,
      slackUserId: schema.slackIdentities.slackUserId,
      level: schema.slackIdentities.level,
      teamMemberId: schema.slackIdentities.teamMemberId,
      dmChannelId: schema.slackIdentities.dmChannelId,
    })
    .from(schema.slackIdentities)
    .where(inArray(schema.slackIdentities.level, ['founder', 'member']))
  const identities: DigestIdentity[] = []
  for (const row of rows ?? []) {
    if (row.level !== 'founder' && row.level !== 'member') continue
    if (!row.slackUserId) continue
    identities.push({
      id: row.id,
      slackUserId: row.slackUserId,
      level: row.level,
      teamMemberId: row.teamMemberId ?? null,
      dmChannelId: row.dmChannelId ?? null,
    })
  }
  return identities
}

/**
 * The team members who hold an ACTIVE super_admin role right now.
 *
 * The identity cache re-resolves a level after seven days, so a founder whose
 * role was revoked yesterday still reads 'founder' there. The studio digest
 * names every client's queue, so it is checked against the roles table on
 * every run, the same rule lib/slack/identity.ts mapEmail applies.
 */
async function loadActiveFounderIds(database: Drizzle): Promise<Set<string>> {
  const rows = await database
    .select({
      teamMemberId: schema.teamMemberRoles.teamMemberId,
      name: schema.roles.name,
      endedAt: schema.teamMemberRoles.endedAt,
    })
    .from(schema.teamMemberRoles)
    .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
    .where(and(eq(schema.roles.name, 'super_admin'), isNull(schema.teamMemberRoles.endedAt)))
  const ids = new Set<string>()
  for (const row of rows ?? []) {
    if (row.name === 'super_admin' && !row.endedAt && row.teamMemberId) ids.add(row.teamMemberId)
  }
  return ids
}

/** Team member id to Clerk user id, which is what access scoping keys on. */
async function loadClerkUserIds(database: Drizzle, teamMemberIds: readonly string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (teamMemberIds.length === 0) return map
  const rows = await database
    .select({ id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.id, [...teamMemberIds]))
  for (const row of rows ?? []) map.set(row.id, row.clerkUserId ?? null)
  return map
}

/** The kill switch. 'false', plain or JSON-quoted, turns it off: the same
 *  rule work-sync's switch reads, so one value means one thing for both. A
 *  read that fails reads as absent, which is on. */
async function digestDisabled(database: Drizzle): Promise<boolean> {
  try {
    const rows = await database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, DIGEST_ENABLED_SETTING))
      .limit(1)
    const row = (rows ?? []).find(candidate => candidate.key === DIGEST_ENABLED_SETTING)
    const value = row?.value?.trim().toLowerCase() ?? null
    return value === 'false' || value === '"false"'
  } catch {
    return false
  }
}

/**
 * Whether a member's access rule still reaches a note's client. A note with
 * no client is studio housekeeping and needs SOME access (the
 * requireAccessToOrgOrPreClient rule); null scope is unrestricted.
 */
function reaches(scope: string[] | null, orgId: string | null): boolean {
  if (scope === null) return true
  if (orgId === null) return scope.length > 0
  return scope.includes(orgId)
}

// ── What is said ────────────────────────────────────────────────────────────

export type DigestAudience = 'studio' | 'personal'

/** The numbers behind one message, stored on its claim row. */
export interface DigestCounts {
  audience: DigestAudience
  waiting: number
  snoozed: number
  clientDrafts: number
  failed: number
  approvedLastWeek: number
  rejectedLastWeek: number
  ownNotes: number
}

export interface DigestContent {
  audience: DigestAudience
  payload: SlackMessagePayload
  counts: DigestCounts
}

function mrkdwn(text: string): SlackTextObject {
  return { type: 'mrkdwn', text }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function ageDays(row: Pick<DigestSuggestion, 'createdAt'>, at: Date): number {
  const created = timeOf(row.createdAt)
  if (created === null) return 0
  return Math.max(0, Math.floor((at.getTime() - created) / DAY_MS))
}

function ageLabel(days: number): string {
  if (days <= 0) return 'today'
  return plural(days, 'day', 'days')
}

function clientLabel(row: Pick<DigestSuggestion, 'orgId' | 'orgName'>): string {
  if (!row.orgId) return 'Studio'
  return row.orgName?.trim() || 'Unnamed client'
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SUMMARY_MAX_CHARS ? `${flat.slice(0, SUMMARY_MAX_CHARS).trimEnd()}...` : flat
}

function oldestFirst(a: DigestSuggestion, b: DigestSuggestion): number {
  const byTime = (timeOf(a.createdAt) ?? 0) - (timeOf(b.createdAt) ?? 0)
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
}

/** "• New request: Footer LinkedIn tag · Verandela · 12 days · Review". */
function itemLine(row: DigestSuggestion, at: Date): string {
  const kind = escapeSlackText(suggestionKindLabel(row.kind))
  const summary = escapeSlackText(clip(summariseProposal(row.kind, row.proposal)))
  return `• ${kind}: ${summary} · ${escapeSlackText(clientLabel(row))} · ${ageLabel(ageDays(row, at))} · ${slackLink(suggestionTweakUrl(row.id), 'Review')}`
}

/** "Verandela 8 (oldest 12 days) · Elevate 4 · Studio 2". */
function byClientLine(waiting: readonly DigestSuggestion[], at: Date): string {
  const groups = new Map<string, { label: string; count: number; oldest: number }>()
  for (const row of waiting) {
    const key = row.orgId ?? ''
    const age = ageDays(row, at)
    const group = groups.get(key)
    if (group) {
      group.count++
      group.oldest = Math.max(group.oldest, age)
    } else {
      groups.set(key, { label: clientLabel(row), count: 1, oldest: age })
    }
  }
  const sorted = [...groups.values()].sort((a, b) =>
    b.count - a.count || b.oldest - a.oldest || a.label.localeCompare(b.label))
  const shown = sorted.slice(0, CLIENT_LINE_LIMIT).map(group => {
    const oldest = group.oldest >= DIGEST_STALE_DAYS ? ` (oldest ${ageLabel(group.oldest)})` : ''
    return `${escapeSlackText(group.label)} ${group.count}${oldest}`
  })
  const rest = sorted.length - CLIENT_LINE_LIMIT
  if (rest > 0) shown.push(plural(rest, 'more client', 'more clients'))
  return shown.join(' · ')
}

/** "Your notes waiting: 2", then up to five of them, oldest first. */
function ownNotesSection(notes: readonly DigestSuggestion[], at: Date): string {
  const sorted = [...notes].sort(oldestFirst)
  const lines = [`Your notes waiting: ${notes.length}`]
  for (const note of sorted.slice(0, DIGEST_ITEM_LIMIT)) lines.push(itemLine(note, at))
  const rest = notes.length - DIGEST_ITEM_LIMIT
  if (rest > 0) lines.push(`and ${rest} more`)
  return lines.join('\n')
}

function openInboxBlock(): SlackBlock {
  return {
    type: 'actions',
    elements: [{
      type: 'button',
      text: { type: 'plain_text', text: 'Open the inbox', emoji: true },
      action_id: DIGEST_OPEN_INBOX_ACTION_ID,
      url: publicUrl('/tasks?view=suggestions'),
    }],
  }
}

/** A founder's own notes: the rows filed from their DMs, still pending. */
function founderOwnNotes(rows: readonly DigestSuggestion[], teamMemberId: string | null): DigestSuggestion[] {
  if (!teamMemberId) return []
  return rows.filter(row => row.approverType === 'member' && row.approverId === teamMemberId && row.status === 'pending')
}

/** A member's own notes that have waited long enough to be worth a DM. */
function agedOwnNotes(rows: readonly DigestSuggestion[], teamMemberId: string | null, at: Date): DigestSuggestion[] {
  const cutoff = at.getTime() - DIGEST_MEMBER_MIN_AGE_HOURS * HOUR_MS
  return founderOwnNotes(rows, teamMemberId).filter(row => {
    const created = timeOf(row.createdAt)
    return created !== null && created <= cutoff
  })
}

/**
 * The studio digest, for one founder, or null when there is nothing to say.
 *
 * Silence when nothing is waiting, none of the founder's own notes are
 * waiting and nothing failed: a digest of zeros teaches people to ignore it.
 * Snoozed rows, client drafts and last week's numbers are context, never the
 * reason a message is sent.
 */
export function buildStudioDigest(
  rows: readonly DigestSuggestion[],
  ownNotes: readonly DigestSuggestion[],
  at: Date,
): DigestContent | null {
  const now = at.getTime()
  const founders = rows.filter(row => row.approverType === 'founders')
  const waiting = founders.filter(row => row.status === 'pending').sort(oldestFirst)
  const snoozed = founders.filter(row => row.status === 'snoozed')
  const clientDrafts = rows.filter(row => row.approverType === 'contact' && row.status === 'pending')
  const failedSince = now - DIGEST_FAILED_WINDOW_DAYS * DAY_MS
  const failed = rows.filter(row => row.status === 'failed' && (timeOf(row.updatedAt) ?? 0) >= failedSince)
  const weekAgo = now - DIGEST_LAST_WEEK_DAYS * DAY_MS
  const decidedLastWeek = (status: string) => founders.filter(row => {
    if (row.status !== status) return false
    const decided = timeOf(row.decidedAt)
    return decided !== null && decided >= weekAgo && decided <= now
  }).length
  const approvedLastWeek = decidedLastWeek('applied')
  const rejectedLastWeek = decidedLastWeek('rejected')

  if (waiting.length === 0 && ownNotes.length === 0 && failed.length === 0) return null

  const counted = waiting.length > 0 ? plural(waiting.length, 'suggestion waiting', 'suggestions waiting') : null
  const blocks: SlackBlock[] = [{
    type: 'section',
    text: mrkdwn(`*Monday digest* · ${counted ?? 'No call suggestions waiting'}`),
  }]

  if (waiting.length > 0) {
    blocks.push({ type: 'section', text: mrkdwn(byClientLine(waiting, at)) })
    blocks.push({
      type: 'section',
      text: mrkdwn(waiting.slice(0, DIGEST_ITEM_LIMIT).map(row => itemLine(row, at)).join('\n')),
    })
  }

  const context: string[] = []
  if (snoozed.length > 0) {
    // Only a time still ahead: a snooze that has ended but that the sweep has
    // not brought back yet would otherwise name a time already gone.
    const next = snoozed
      .map(row => row.snoozeUntil)
      .filter((iso): iso is string => (timeOf(iso) ?? -Infinity) > now)
      .sort((a, b) => (timeOf(a) ?? 0) - (timeOf(b) ?? 0))[0] ?? null
    const when = studioWhen(next)
    context.push(when ? `${snoozed.length} snoozed, next back ${when}` : `${snoozed.length} snoozed`)
  }
  if (clientDrafts.length > 0) {
    context.push(`${plural(clientDrafts.length, 'client draft', 'client drafts')} not confirmed by the client yet`)
  }
  if (failed.length > 0) {
    context.push(`${plural(failed.length, 'approval', 'approvals')} did not apply in the last ${DIGEST_FAILED_WINDOW_DAYS} days`)
  }
  if (approvedLastWeek + rejectedLastWeek > 0) {
    const parts: string[] = []
    if (approvedLastWeek > 0) parts.push(`${approvedLastWeek} approved`)
    if (rejectedLastWeek > 0) parts.push(`${rejectedLastWeek} rejected`)
    context.push(`Last week: ${parts.join(', ')}`)
  }
  if (context.length > 0) blocks.push({ type: 'context', elements: [mrkdwn(context.join('\n'))] })

  if (ownNotes.length > 0) blocks.push({ type: 'section', text: mrkdwn(ownNotesSection(ownNotes, at)) })

  blocks.push(openInboxBlock())

  return {
    audience: 'studio',
    payload: { text: `Monday digest: ${counted ?? 'no call suggestions waiting'}`, blocks },
    counts: {
      audience: 'studio',
      waiting: waiting.length,
      snoozed: snoozed.length,
      clientDrafts: clientDrafts.length,
      failed: failed.length,
      approvedLastWeek,
      rejectedLastWeek,
      ownNotes: ownNotes.length,
    },
  }
}

/** The personal digest: a member's own waiting notes and the button, or null
 *  when none are waiting. Nothing about anybody else's queue. */
export function buildPersonalDigest(notes: readonly DigestSuggestion[], at: Date): DigestContent | null {
  if (notes.length === 0) return null
  return {
    audience: 'personal',
    payload: {
      text: `Monday digest: ${plural(notes.length, 'of your notes is', 'of your notes are')} waiting`,
      blocks: [
        { type: 'section', text: mrkdwn(ownNotesSection(notes, at)) },
        openInboxBlock(),
      ],
    },
    counts: {
      audience: 'personal',
      waiting: 0,
      snoozed: 0,
      clientDrafts: 0,
      failed: 0,
      approvedLastWeek: 0,
      rejectedLastWeek: 0,
      ownNotes: notes.length,
    },
  }
}

// ── The plan: who gets what ─────────────────────────────────────────────────

interface PlannedMessage {
  identity: DigestIdentity
  content: DigestContent | null
}

interface DigestPlan {
  /** The studio digest as a founder with no notes of their own would read it. */
  preview: DigestContent | null
  messages: PlannedMessage[]
}

async function planDigest(database: Drizzle, at: Date): Promise<DigestPlan> {
  const [rows, identities, founderIds] = await Promise.all([
    loadDigestSuggestions(database, at),
    loadDigestIdentities(database),
    loadActiveFounderIds(database),
  ])

  const needsScope = identities
    .filter(identity => !(identity.level === 'founder' && identity.teamMemberId && founderIds.has(identity.teamMemberId)))
    .map(identity => identity.teamMemberId)
    .filter((id): id is string => !!id)
  const clerkUserIds = await loadClerkUserIds(database, needsScope)

  const messages: PlannedMessage[] = []
  for (const identity of identities) {
    const founder = identity.level === 'founder'
      && !!identity.teamMemberId
      && founderIds.has(identity.teamMemberId)
    if (founder) {
      messages.push({ identity, content: buildStudioDigest(rows, founderOwnNotes(rows, identity.teamMemberId), at) })
      continue
    }

    // A member, or a founder whose super_admin role has ended since the cache
    // was written: never more than a member gets, under a member's rule.
    const notes = agedOwnNotes(rows, identity.teamMemberId, at)
    if (notes.length === 0) {
      messages.push({ identity, content: null })
      continue
    }
    const clerkUserId = identity.teamMemberId ? clerkUserIds.get(identity.teamMemberId) ?? null : null
    // One member's scoping lookup failing is that member's problem: it reads
    // as nothing reachable, so they get no digest and the founders still do.
    let scope: string[] | null
    try {
      scope = await resolveAccessScoping(database, clerkUserId)
    } catch {
      scope = []
    }
    const reachable = notes.filter(note => reaches(scope, note.orgId))
    messages.push({ identity, content: buildPersonalDigest(reachable, at) })
  }

  return { preview: buildStudioDigest(rows, [], at), messages }
}

// ── The claim ───────────────────────────────────────────────────────────────

type Claim = { state: 'claimed'; id: string } | { state: 'taken' } | { state: 'unavailable' }

/**
 * This week's digest for this Slack user, claimed before anything is posted.
 *
 * INSERT OR IGNORE against the unique (week_key, slack_user_id), then a
 * read-back: only the run whose own id comes back owns the send. Any error,
 * including a missing table, is 'unavailable', and an unclaimed digest is not
 * sent: a second copy on a Monday morning is worse than none.
 */
async function claimDigest(database: Drizzle, weekKey: string, slackUserId: string): Promise<Claim> {
  const id = crypto.randomUUID()
  try {
    await database.run(sql`
      INSERT OR IGNORE INTO slack_digests (id, week_key, slack_user_id, created_at)
      VALUES (${id}, ${weekKey}, ${slackUserId}, ${new Date().toISOString()})
    `)
    const rows = await database.all<{ id: string }>(sql`
      SELECT id FROM slack_digests
      WHERE week_key = ${weekKey} AND slack_user_id = ${slackUserId}
      LIMIT 1
    `)
    const holder = rows?.[0]?.id
    if (!holder) return { state: 'unavailable' }
    return holder === id ? { state: 'claimed', id } : { state: 'taken' }
  } catch {
    return { state: 'unavailable' }
  }
}

/** Stamp what was sent onto the claim. After a post that landed, so a failure
 *  here keeps the claim: the message is in Slack either way. */
async function settleClaim(database: Drizzle, id: string, ref: SlackMessageRef, counts: DigestCounts): Promise<void> {
  try {
    await database.run(sql`
      UPDATE slack_digests
      SET channel_id = ${ref.channel}, ts = ${ref.ts}, summary = ${JSON.stringify(counts)}
      WHERE id = ${id}
    `)
  } catch {
    // The claim row already stops a second send, which is its job.
  }
}

/** Give the week back after a failed send, so the second Sunday slot retries. */
async function releaseClaim(database: Drizzle, id: string): Promise<void> {
  try {
    await database.run(sql`DELETE FROM slack_digests WHERE id = ${id}`)
  } catch {
    // Nothing more to do: the week stays claimed and this person misses one
    // digest, which is the safe way round.
  }
}

/** Cache a DM channel the digest had to open. Only where none was cached, and
 *  never updated_at, which is the identity's level clock (lib/slack/identity.ts). */
async function rememberDmChannel(database: Drizzle, identityId: string, channel: string): Promise<void> {
  try {
    await database
      .update(schema.slackIdentities)
      .set({ dmChannelId: channel })
      .where(and(eq(schema.slackIdentities.id, identityId), isNull(schema.slackIdentities.dmChannelId)))
  } catch {
    // The next run opens it again. A cache, not a record.
  }
}

// ── The run ─────────────────────────────────────────────────────────────────

/** Injected in tests so nothing reaches Slack. */
export interface DigestDeps {
  postMessage?: (input: PostMessageInput) => Promise<SlackMessageRef>
  openDm?: (slackUserId: string) => Promise<string>
}

export interface DigestRunOptions {
  /** The instant the run is for. Defaults to now. */
  at?: Date
  /** Send outside the Monday window. Never skips the weekly claim. */
  force?: boolean
  /** Build every message and send none. Reads only; works without Slack. */
  dryRun?: boolean
  deps?: DigestDeps
}

/** One message a dry run would have sent. */
export interface DigestPayload {
  slackUserId: string
  audience: DigestAudience
  text: string
  blocks: SlackBlock[]
}

export type DigestRunReason = 'slack_not_configured' | 'disabled' | 'outside_window' | 'dry_run'

export interface DigestRunSummary {
  /** True only when the run went as far as the recipients. */
  ran: boolean
  /** Why it stopped early, or 'dry_run'. */
  reason?: DigestRunReason
  weekKey: string
  /** Founders and members considered: sent + alreadySent + nothingToSay + failed. */
  recipients: number
  sent: number
  alreadySent: number
  nothingToSay: number
  failed: number
  /** Dry run only: the studio digest as a founder with no notes of their own
   *  would read it, whoever the app knows about. Null when it would be silent. */
  preview?: SlackMessagePayload | null
  /** Dry run only: one entry per person who would get a message. */
  payloads?: DigestPayload[]
}

/**
 * The Monday digest (CN.3 contract section 5).
 *
 * The order of the checks is the contract: a dry run first (it needs no
 * Slack), then no token (nothing read, nothing written), then the kill
 * switch, then the window. Every Slack call is wrapped per person: one DM
 * that cannot be opened is counted and the next person still gets theirs.
 */
export async function runSuggestionDigest(
  database: Drizzle,
  options: DigestRunOptions = {},
): Promise<DigestRunSummary> {
  const at = options.at ?? new Date()
  const slot = nzDigestSlot(at)
  const summary: DigestRunSummary = {
    ran: false,
    weekKey: slot.weekKey,
    recipients: 0,
    sent: 0,
    alreadySent: 0,
    nothingToSay: 0,
    failed: 0,
  }

  if (options.dryRun === true) {
    const plan = await planDigest(database, at)
    const payloads: DigestPayload[] = []
    for (const message of plan.messages) {
      summary.recipients++
      if (!message.content) {
        summary.nothingToSay++
        continue
      }
      payloads.push({
        slackUserId: message.identity.slackUserId,
        audience: message.content.audience,
        text: message.content.payload.text,
        blocks: message.content.payload.blocks,
      })
    }
    return { ...summary, reason: 'dry_run', preview: plan.preview?.payload ?? null, payloads }
  }

  if (!slackBotToken()) return { ...summary, reason: 'slack_not_configured' }
  if (await digestDisabled(database)) return { ...summary, reason: 'disabled' }
  if (!slot.inWindow && options.force !== true) return { ...summary, reason: 'outside_window' }

  const post = options.deps?.postMessage ?? slackPostMessage
  const open = options.deps?.openDm ?? slackOpenDm
  const plan = await planDigest(database, at)
  summary.ran = true

  for (const { identity, content } of plan.messages) {
    summary.recipients++
    if (!content) {
      summary.nothingToSay++
      continue
    }

    const claim = await claimDigest(database, slot.weekKey, identity.slackUserId)
    if (claim.state === 'taken') {
      summary.alreadySent++
      continue
    }
    if (claim.state === 'unavailable') {
      summary.failed++
      continue
    }

    try {
      let channel = identity.dmChannelId
      if (!channel) {
        channel = await open(identity.slackUserId)
        if (!channel) throw new Error('No DM channel')
        await rememberDmChannel(database, identity.id, channel)
      }
      const ref = await post({ channel, text: content.payload.text, blocks: content.payload.blocks })
      await settleClaim(database, claim.id, ref, content.counts)
      summary.sent++
    } catch {
      await releaseClaim(database, claim.id)
      summary.failed++
    }
  }

  return summary
}
