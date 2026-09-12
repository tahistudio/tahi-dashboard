/**
 * lib/import/manyrequests/residue.ts
 *
 * The residue sweep (MC.9). What the org-level cleanup cannot see.
 *
 * runCleanup archives and deletes ORGANISATIONS and the rows that carry their
 * org_id. This module handles the leftovers that carry no org_id at all: a
 * track whose subscription was hard-deleted before a subscription delete
 * existed, a subtask whose task is gone, a request thread pointing at a request
 * that was wiped, a notification nobody can ever read. Every one of them is
 * invisible to an org_id sweep by construction.
 *
 * Two kinds of finding, and the difference matters:
 *
 *   STRUCTURAL   The row is provably dangling: its parent id joins to nothing.
 *                Six classes, all re-derived from the live tables on every run,
 *                so the sweep stays correct as the data moves.
 *   KNOWN        RESIDUE_ALLOWLIST. Ordinary well-formed rows that only a human
 *                audit could identify as junk (a demo task titled "Get moneys",
 *                a 1.1 second timer smoke entry). An id alone is not evidence,
 *                so every entry carries a predicate that must ALSO hold at plan
 *                time. A reused id, or a row that changed since the audit, is
 *                refused as predicate_failed rather than deleted, and an entry
 *                whose row is already gone is reported as already_gone rather
 *                than raising.
 *
 * THE STANDING LIMITS, which this module obeys and does not relitigate:
 *   - It NEVER archives or deletes an organisation. P10 removes Acme Corp's
 *     seed subscription and its tracks; Acme Corp itself stays.
 *   - It NEVER touches invoices, invoice_items, deals, leads, contracts,
 *     proposals, schedules, files or discovery_calls. discovery_calls is not
 *     even read: the pre-call-digest cron mails real people off that table
 *     every ten minutes.
 *   - Any row carrying its own ManyRequests key is refused as
 *     manyrequests_keyed, at plan time AND again in the delete statement, so a
 *     row the import adopts between the dry run and the apply survives.
 *
 * Like the rest of this directory it imports no mailer, no notification
 * helper, no invite and no route. The static walk in
 * __tests__/no-mail-imports.test.ts covers every file here, this one included.
 *
 * Reads are whole-table and the joins are done in memory, exactly as
 * planWipeDemo already does: these are five-figure tables at worst, the sweep
 * is a one-shot maintenance operation behind a super-admin gate, and a plan
 * built from one consistent read is easier to trust than one built from a
 * dozen correlated subqueries.
 */

import { and, inArray, isNull } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { isProtectedOrg } from './protected-orgs'

/** D1 caps bound parameters at 100 per statement. The repo chunks at 90. */
const ID_CHUNK = 90

function chunkIds(ids: readonly string[]): string[][] {
  const out: string[][] = []
  for (let index = 0; index < ids.length; index += ID_CHUNK) out.push(ids.slice(index, index + ID_CHUNK))
  return out
}

// ── plan shapes ──────────────────────────────────────────────────────────────

export type ResidueClass =
  | 'orphan_tracks'
  | 'orphan_subtasks'
  | 'orphan_blockers'
  | 'orphan_request_threads'
  | 'orphan_notifications'
  | 'seed_subscriptions'
  | 'known_residue'

/**
 * Why a row the sweep looked at is NOT being deleted.
 *
 *   manyrequests_keyed  It carries a ManyRequests id, so the import owns it.
 *   predicate_failed    The audit's sanity check no longer holds (a reused id,
 *                       a renamed row, a track that has since picked up work).
 *   already_gone        An allowlisted row that no longer exists. Reported, not
 *                       an error: the sweep is meant to be idempotent.
 */
export type ResidueRefusalReason = 'manyrequests_keyed' | 'predicate_failed' | 'already_gone'

export interface ResidueRow {
  table: string
  id: string
  reason: string
}

export interface ResidueRefusal {
  table: string
  id: string
  reason: ResidueRefusalReason
  detail: string
}

export interface ResidueGroup {
  /** The class key, stable enough for a UI to switch on. */
  class: ResidueClass
  /** A human label for the same thing. */
  label: string
  /** The class's primary table. Individual rows carry their own table too, because a class can span a parent and its children. */
  table: string
  rows: ResidueRow[]
  refusals: ResidueRefusal[]
}

export interface ResiduePlan {
  groups: ResidueGroup[]
  totals: { rows: number; refusals: number }
  /** Zero on a dry run. Filled in by applyResidue, per class and in total. */
  applied: { total: number; byClass: Record<ResidueClass, number> }
}

const CLASS_LABELS: Record<ResidueClass, string> = {
  orphan_tracks: 'Orphan tracks',
  orphan_subtasks: 'Orphan checklist items',
  orphan_blockers: 'Orphan blockers',
  orphan_request_threads: 'Orphan request threads',
  orphan_notifications: 'Orphan notifications',
  seed_subscriptions: 'Seed subscriptions',
  known_residue: 'Known residue (audited rows)',
}

const CLASS_TABLES: Record<ResidueClass, string> = {
  orphan_tracks: 'tracks',
  orphan_subtasks: 'task_subtasks',
  orphan_blockers: 'work_blockers',
  orphan_request_threads: 'conversations',
  orphan_notifications: 'notifications',
  seed_subscriptions: 'subscriptions',
  known_residue: 'mixed',
}

export const RESIDUE_CLASSES: readonly ResidueClass[] = [
  'orphan_tracks',
  'orphan_subtasks',
  'orphan_blockers',
  'orphan_request_threads',
  'orphan_notifications',
  'seed_subscriptions',
  'known_residue',
]

/**
 * FK-safe delete order. D1 does not reliably enforce ON DELETE CASCADE, so
 * children go first and explicitly: participants before conversations,
 * checklist items and blockers and time entries before tasks, tracks before
 * subscriptions. Getting this wrong leaves exactly the orphans the sweep
 * exists to remove.
 */
export const RESIDUE_APPLY_ORDER: readonly string[] = [
  'conversation_participants',
  'conversations',
  'task_subtasks',
  'work_blockers',
  'time_entries',
  'tasks',
  'tracks',
  'subscriptions',
  'notifications',
]

/** SQL table name to the key it carries on the Drizzle schema object. */
const TABLE_SCHEMA_KEY: Record<string, string> = {
  conversation_participants: 'conversationParticipants',
  conversations: 'conversations',
  task_subtasks: 'taskSubtasks',
  work_blockers: 'workBlockers',
  time_entries: 'timeEntries',
  tasks: 'tasks',
  tracks: 'tracks',
  subscriptions: 'subscriptions',
  notifications: 'notifications',
}

/**
 * The residue tables that carry a ManyRequests key. Only subscriptions does.
 * The delete statement re-applies the guard, so a subscription the import
 * adopts between the dry run and the apply is left alone even though it was in
 * the plan.
 */
const TABLE_SOURCE_KEY: Record<string, string | undefined> = {
  subscriptions: 'manyrequestsId',
}

// ── the audited allowlist ────────────────────────────────────────────────────

/**
 * The rows the 2026-09-07 client-data-hygiene audit named by hand, because no
 * structural predicate can see them: they are ordinary, well-formed rows that a
 * person recognised as junk.
 *
 * An id is not evidence. Every entry therefore carries the audit's own sanity
 * facts, re-checked against the live row at plan time; a row that no longer
 * matches is refused, never deleted.
 *
 * Deliberately NOT here: notification 7874bc66-b9cd-4897-90c5-6a86f77c88f0.
 * The audit lists it as optional because its request still exists and it
 * belongs to the protected QA organisation, so the default sweep leaves it.
 */
export type ResidueAllowlistEntry =
  | {
      table: 'tasks'
      id: string
      /**
       * The audit's titles for this batch. A list rather than one string for
       * the two ids whose exact title the audit did not pin to an id (it named
       * four titles across four ids and matched only two of the pairs). Any
       * other title means the id was reused, and the row is refused.
       */
      titles: readonly string[]
      note: string
    }
  | { table: 'time_entries'; id: string; maxSeconds: number; note: string }
  | { table: 'conversations'; id: string; name: string; note: string }
  | { table: 'notifications'; id: string; entityId: string; note: string }
  | { table: 'task_subtasks'; id: string; taskId: string; note: string }
  | { table: 'work_blockers'; id: string; blockedId: string; blockerId: string; note: string }

const P18_GET_MONEYS = 'Get moneys'
const P18_GET_MONEYSD = 'Get moneysd'
const P18_PRODUCT_PAGES = 'Update 18 product pages: copy, images, and sections'

export const RESIDUE_ALLOWLIST: readonly ResidueAllowlistEntry[] = [
  // P18. Four demo tasks created by the dev Clerk user between 30 Mar and
  // 4 Apr 2026. One is a client_task on Stride: the task is the artefact, the
  // real Stride request it hangs off is never touched.
  {
    table: 'tasks',
    id: 'efa2daf2-329b-4087-ab5a-dbafe5cc8aab',
    titles: [P18_GET_MONEYS],
    note: 'P18 demo task "Get moneys" on Stride. The real Stride request it points at stays.',
  },
  {
    table: 'tasks',
    id: 'd8dbfc14-24a8-48e7-a14d-12960acdbe65',
    titles: [P18_GET_MONEYSD],
    note: 'P18 demo task "Get moneysd", the blocker half of the demo pair.',
  },
  {
    table: 'tasks',
    id: '776055e7-ff78-4cf9-bf89-9440187ef48a',
    titles: [P18_GET_MONEYS, P18_PRODUCT_PAGES],
    note: 'P18 demo task, one of the two the audit named by title without pinning the title to the id.',
  },
  {
    table: 'tasks',
    id: '6e8e0fe0-c81d-4fc5-b2d6-e048b26623b6',
    titles: [P18_GET_MONEYS, P18_PRODUCT_PAGES],
    note: 'P18 demo task, one of the two the audit named by title without pinning the title to the id.',
  },
  // P18 children. Structurally caught today (their task is already gone, and
  // one blocker already points at a deleted request), listed anyway so the
  // sweep still removes them if the structural pass ever misses them.
  {
    table: 'task_subtasks',
    id: 'ad8161b7-6d7a-4a54-acca-58fe1cf25efa',
    taskId: 'c4409924-dbee-4e5d-b0d9-6e8806817734',
    note: 'P18 checklist item "One" on a task that no longer exists.',
  },
  {
    table: 'task_subtasks',
    id: 'b53ab058-2042-4a89-956b-fc0600624500',
    taskId: 'c4409924-dbee-4e5d-b0d9-6e8806817734',
    note: 'P18 checklist item "Two" on a task that no longer exists.',
  },
  {
    table: 'work_blockers',
    id: 'f49e4ab9-816b-467f-ae47-b6593076589c',
    blockedId: 'efa2daf2-329b-4087-ab5a-dbafe5cc8aab',
    blockerId: 'd8dbfc14-24a8-48e7-a14d-12960acdbe65',
    note: 'P18 blocker linking the two demo tasks this sweep removes.',
  },
  {
    table: 'work_blockers',
    id: 'a05e04f1-3e83-4c06-8197-624c85120a81',
    blockedId: '7aa2657e-94b5-4ca3-a0a7-0ff7c82bb378',
    blockerId: '79866e68-95d2-4eeb-943d-b7153575f49f',
    note: 'P18 blocker on a real Stride request, blocked by a test request that was deleted. Only the blocker row goes.',
  },
  // P19. Three live_timer smoke entries on the internal studio organisation,
  // 19s, 1.5s and 8.5s. e4798e41 is the one the audit also lists under P18.
  {
    table: 'time_entries',
    id: '60858e75-7f05-4b63-ad11-18fa9356c3d8',
    maxSeconds: 60,
    note: 'P19 timer smoke entry, 19 seconds on the internal studio organisation.',
  },
  {
    table: 'time_entries',
    id: 'e4798e41-3cf6-4406-8857-ad12c13f8c32',
    maxSeconds: 60,
    note: 'P19 timer smoke entry, 1.5 seconds, logged against a P18 demo task.',
  },
  {
    table: 'time_entries',
    id: '7002cf74-70df-46cd-bf52-7064ea6cf976',
    maxSeconds: 60,
    note: 'P19 timer smoke entry, 8.5 seconds on the internal studio organisation.',
  },
  // P20. The three test conversations that are NOT request_thread rows, so no
  // dangling request_id can find them. All three hold zero messages.
  {
    table: 'conversations',
    id: '2ee90ded-57e0-4b87-9dac-233795f99e57',
    name: 'Test',
    note: 'P20 empty group conversation named "Test".',
  },
  {
    table: 'conversations',
    id: '14fab59c-eff2-4abf-96e8-efe514787cb7',
    name: 'Test',
    note: 'P20 empty group conversation named "Test".',
  },
  {
    table: 'conversations',
    id: 'b10af089-85af-4c56-adae-007467bfc449',
    name: 'Alice Johnson',
    note: 'P20 empty direct thread with the Acme Corp seed contact.',
  },
  // P21. The four mandatory orphan notifications. Most are caught structurally
  // (their request is gone); the new_message one is listed because its
  // entity_type may not be the literal 'request' the structural pass keys on.
  {
    table: 'notifications',
    id: '6e07cd0a-8c9e-4c05-8e86-e49d0de6708c',
    entityId: 'a3cf20b5-7bd3-47dd-a080-aba22d4b2f04',
    note: 'P21 status-change notification for a deleted contact about a deleted request.',
  },
  {
    table: 'notifications',
    id: 'fc0ff3d9-3515-4de9-a15f-70543e845715',
    entityId: '27209702-f6b9-43fb-b335-d328be7c3783',
    note: 'P21 status-change notification about a deleted request.',
  },
  {
    table: 'notifications',
    id: '91425e36-3ef6-4a33-9d16-8d147d4ecd98',
    entityId: '27209702-f6b9-43fb-b335-d328be7c3783',
    note: 'P21 status-change notification for a deleted contact about a deleted request.',
  },
  {
    table: 'notifications',
    id: 'a7159dd2-5265-4732-a3e9-4d96a8fd0799',
    entityId: '79866e68-95d2-4eeb-943d-b7153575f49f',
    note: 'P21 new-message notification about a deleted test request.',
  },
]

// ── schema plumbing ──────────────────────────────────────────────────────────

type SchemaRecord = Record<string, Record<string, unknown> | undefined>

interface ResidueTableHandle {
  table: SQLiteTable
  idColumn: SQLiteColumn
  /** The ManyRequests key column, when the table has one. */
  keyColumn: SQLiteColumn | null
}

/**
 * The Drizzle handle for one residue table, resolved lazily and null when the
 * schema in play does not carry it. Lazy on purpose: a module-level map would
 * read schema.tracks at import time and blow up under a partial test double.
 */
function residueTableHandle(table: string): ResidueTableHandle | null {
  const schemaKey = TABLE_SCHEMA_KEY[table]
  if (!schemaKey) return null
  const record = (schema as unknown as SchemaRecord)[schemaKey]
  if (!record) return null
  const idColumn = record.id
  if (!idColumn) return null
  const keyField = TABLE_SOURCE_KEY[table]
  const keyColumn = keyField ? record[keyField] : undefined
  return {
    table: record as unknown as SQLiteTable,
    idColumn: idColumn as SQLiteColumn,
    keyColumn: (keyColumn ?? null) as SQLiteColumn | null,
  }
}

// ── the shapes read out of D1 ────────────────────────────────────────────────

interface OrgRow {
  id: string
  name: string
  status: string
}
interface SubscriptionRow {
  id: string
  orgId: string
  manyrequestsId: string | null
  stripeSubscriptionId: string | null
}
interface TrackRow {
  id: string
  subscriptionId: string
}
interface TaskRow {
  id: string
  title: string
  trackId: string | null
}
interface SubtaskRow {
  id: string
  taskId: string
}
interface BlockerRow {
  id: string
  blockedType: string
  blockedId: string
  blockerType: string
  blockerId: string
}
interface TimeEntryRow {
  id: string
  source: string
  hours: number
}
interface ConversationRow {
  id: string
  type: string
  name: string | null
  requestId: string | null
}
interface ParticipantRow {
  id: string
  conversationId: string
}
interface NotificationRow {
  id: string
  userId: string
  userType: string
  entityType: string | null
  entityId: string | null
}

interface ResidueContext {
  tasksById: Map<string, TaskRow>
  subtasksById: Map<string, SubtaskRow>
  blockersById: Map<string, BlockerRow>
  timeEntriesById: Map<string, TimeEntryRow>
  conversationsById: Map<string, ConversationRow>
  notificationsById: Map<string, NotificationRow>
  messageCountByConversation: Map<string, number>
  participantsByConversation: Map<string, ParticipantRow[]>
  subtasksByTask: Map<string, SubtaskRow[]>
}

function countBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    out.set(value, (out.get(value) ?? 0) + 1)
  }
  return out
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const value = key(row)
    if (!value) continue
    const bucket = out.get(value)
    if (bucket) bucket.push(row)
    else out.set(value, [row])
  }
  return out
}

// ── the plan ─────────────────────────────────────────────────────────────────

/**
 * Build the residue plan. Pure in the sense that matters: it reads and writes
 * nothing, so what a dry run reports is exactly what applyResidue removes.
 */
export async function planResidue(database: DB): Promise<ResiduePlan> {
  const plan = emptyResiduePlan()
  const groups = new Map<ResidueClass, ResidueGroup>(plan.groups.map((group) => [group.class, group]))
  /** `${table}:${id}` for every row already planned, so no id is listed twice. */
  const planned = new Set<string>()

  function add(residueClass: ResidueClass, table: string, id: string, reason: string): boolean {
    const key = `${table}:${id}`
    if (planned.has(key)) return false
    planned.add(key)
    groups.get(residueClass)?.rows.push({ table, id, reason })
    return true
  }

  function refuse(
    residueClass: ResidueClass,
    table: string,
    id: string,
    reason: ResidueRefusalReason,
    detail: string,
  ): void {
    groups.get(residueClass)?.refusals.push({ table, id, reason, detail })
  }

  const [orgRows, subscriptionRows, trackRows, requestRows, taskRows] = await Promise.all([
    database
      .select({ id: schema.organisations.id, name: schema.organisations.name, status: schema.organisations.status })
      .from(schema.organisations) as unknown as Promise<OrgRow[]>,
    database
      .select({
        id: schema.subscriptions.id,
        orgId: schema.subscriptions.orgId,
        manyrequestsId: schema.subscriptions.manyrequestsId,
        stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
      })
      .from(schema.subscriptions) as unknown as Promise<SubscriptionRow[]>,
    database
      .select({ id: schema.tracks.id, subscriptionId: schema.tracks.subscriptionId })
      .from(schema.tracks) as unknown as Promise<TrackRow[]>,
    database
      .select({ id: schema.requests.id, trackId: schema.requests.trackId })
      .from(schema.requests) as unknown as Promise<Array<{ id: string; trackId: string | null }>>,
    database
      .select({ id: schema.tasks.id, title: schema.tasks.title, trackId: schema.tasks.trackId })
      .from(schema.tasks) as unknown as Promise<TaskRow[]>,
  ])

  const [subtaskRows, blockerRows, timeEntryRows, conversationRows, participantRows] = await Promise.all([
    database
      .select({ id: schema.taskSubtasks.id, taskId: schema.taskSubtasks.taskId })
      .from(schema.taskSubtasks) as unknown as Promise<SubtaskRow[]>,
    database
      .select({
        id: schema.workBlockers.id,
        blockedType: schema.workBlockers.blockedType,
        blockedId: schema.workBlockers.blockedId,
        blockerType: schema.workBlockers.blockerType,
        blockerId: schema.workBlockers.blockerId,
      })
      .from(schema.workBlockers) as unknown as Promise<BlockerRow[]>,
    database
      .select({ id: schema.timeEntries.id, source: schema.timeEntries.source, hours: schema.timeEntries.hours })
      .from(schema.timeEntries) as unknown as Promise<TimeEntryRow[]>,
    database
      .select({
        id: schema.conversations.id,
        type: schema.conversations.type,
        name: schema.conversations.name,
        requestId: schema.conversations.requestId,
      })
      .from(schema.conversations) as unknown as Promise<ConversationRow[]>,
    database
      .select({ id: schema.conversationParticipants.id, conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants) as unknown as Promise<ParticipantRow[]>,
  ])

  const [messageRows, notificationRows, contactRows, teamMemberRows, invoiceRows] = await Promise.all([
    database
      .select({ id: schema.messages.id, conversationId: schema.messages.conversationId })
      .from(schema.messages) as unknown as Promise<Array<{ id: string; conversationId: string | null }>>,
    database
      .select({
        id: schema.notifications.id,
        userId: schema.notifications.userId,
        userType: schema.notifications.userType,
        entityType: schema.notifications.entityType,
        entityId: schema.notifications.entityId,
      })
      .from(schema.notifications) as unknown as Promise<NotificationRow[]>,
    database
      .select({ id: schema.contacts.id, clerkUserId: schema.contacts.clerkUserId })
      .from(schema.contacts) as unknown as Promise<Array<{ id: string; clerkUserId: string | null }>>,
    database
      .select({ id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId })
      .from(schema.teamMembers) as unknown as Promise<Array<{ id: string; clerkUserId: string | null }>>,
    database
      .select({ id: schema.invoices.id, orgId: schema.invoices.orgId })
      .from(schema.invoices) as unknown as Promise<Array<{ id: string; orgId: string }>>,
  ])

  const liveSubscriptionIds = new Set(subscriptionRows.map((row) => row.id))
  const liveRequestIds = new Set(requestRows.map((row) => row.id))
  const liveTaskIds = new Set(taskRows.map((row) => row.id))
  const orgById = new Map(orgRows.map((row) => [row.id, row]))
  const requestsByTrack = countBy(requestRows, (row) => row.trackId)
  const tasksByTrack = countBy(taskRows, (row) => row.trackId)
  const invoicesByOrg = countBy(invoiceRows, (row) => row.orgId)
  const tracksBySubscription = groupBy(trackRows, (row) => row.subscriptionId)
  const messageCountByConversation = countBy(messageRows, (row) => row.conversationId)
  const participantsByConversation = groupBy(participantRows, (row) => row.conversationId)
  const subtasksByTask = groupBy(subtaskRows, (row) => row.taskId)

  const context: ResidueContext = {
    tasksById: new Map(taskRows.map((row) => [row.id, row])),
    subtasksById: new Map(subtaskRows.map((row) => [row.id, row])),
    blockersById: new Map(blockerRows.map((row) => [row.id, row])),
    timeEntriesById: new Map(timeEntryRows.map((row) => [row.id, row])),
    conversationsById: new Map(conversationRows.map((row) => [row.id, row])),
    notificationsById: new Map(notificationRows.map((row) => [row.id, row])),
    messageCountByConversation,
    participantsByConversation,
    subtasksByTask,
  }

  // ── orphan_tracks ──────────────────────────────────────────────────────
  // A track carries no org_id at all: its organisation is only reachable
  // through its subscription, which is exactly why the org sweep cannot see
  // these. A track still holding a request or a task is refused instead of
  // deleted, because that is work, not residue.
  for (const track of trackRows) {
    if (liveSubscriptionIds.has(track.subscriptionId)) continue
    const held = (requestsByTrack.get(track.id) ?? 0) + (tasksByTrack.get(track.id) ?? 0)
    if (held > 0) {
      refuse(
        'orphan_tracks',
        'tracks',
        track.id,
        'predicate_failed',
        `Its subscription ${track.subscriptionId} is gone, but ${held} request(s) or task(s) still sit on this track.`,
      )
      continue
    }
    add(
      'orphan_tracks',
      'tracks',
      track.id,
      `Its subscription ${track.subscriptionId} joins to no subscription, and no request or task sits on the track.`,
    )
  }

  // ── orphan_subtasks ────────────────────────────────────────────────────
  for (const subtask of subtaskRows) {
    if (liveTaskIds.has(subtask.taskId)) continue
    add('orphan_subtasks', 'task_subtasks', subtask.id, `Its task ${subtask.taskId} joins to no task.`)
  }

  // ── orphan_blockers ────────────────────────────────────────────────────
  // work_blockers is polymorphic on both ends with no foreign key anywhere, so
  // a dangling end is the only signal there is.
  const blockerEndGone = (type: string, id: string): boolean => {
    if (type === 'task') return !liveTaskIds.has(id)
    if (type === 'request') return !liveRequestIds.has(id)
    return false
  }
  for (const blocker of blockerRows) {
    const knownEnds = blocker.blockedType === 'task' || blocker.blockedType === 'request'
    const knownBlocker = blocker.blockerType === 'task' || blocker.blockerType === 'request'
    if (!knownEnds || !knownBlocker) {
      refuse(
        'orphan_blockers',
        'work_blockers',
        blocker.id,
        'predicate_failed',
        `Unrecognised end types (${blocker.blockedType} blocked by ${blocker.blockerType}), so neither end can be resolved.`,
      )
      continue
    }
    const gone: string[] = []
    if (blockerEndGone(blocker.blockedType, blocker.blockedId)) {
      gone.push(`the blocked ${blocker.blockedType} ${blocker.blockedId}`)
    }
    if (blockerEndGone(blocker.blockerType, blocker.blockerId)) {
      gone.push(`the blocking ${blocker.blockerType} ${blocker.blockerId}`)
    }
    if (gone.length === 0) continue
    add('orphan_blockers', 'work_blockers', blocker.id, `Points at ${gone.join(' and ')}, which no longer exists.`)
  }

  // ── orphan_request_threads ─────────────────────────────────────────────
  // conversations.request_id has no foreign key, so a wiped request leaves the
  // thread behind. Only an EMPTY thread goes: one that still holds messages is
  // refused and reported, because a message is content and this sweep removes
  // scaffolding.
  for (const conversation of conversationRows) {
    if (conversation.type !== 'request_thread') continue
    if (!conversation.requestId) continue
    if (liveRequestIds.has(conversation.requestId)) continue
    const messages = messageCountByConversation.get(conversation.id) ?? 0
    if (messages > 0) {
      refuse(
        'orphan_request_threads',
        'conversations',
        conversation.id,
        'predicate_failed',
        `Its request ${conversation.requestId} is gone, but the thread still holds ${messages} message(s).`,
      )
      continue
    }
    add(
      'orphan_request_threads',
      'conversations',
      conversation.id,
      `Request thread for ${conversation.requestId}, which joins to no request, and it holds no messages.`,
    )
    for (const participant of participantsByConversation.get(conversation.id) ?? []) {
      add(
        'orphan_request_threads',
        'conversation_participants',
        participant.id,
        `Participant of orphan request thread ${conversation.id}.`,
      )
    }
  }

  // ── orphan_notifications ───────────────────────────────────────────────
  // Two independent halves, either of which makes the row unreachable.
  //
  // The recipient half is deliberately narrow. notifications.user_id must hold
  // a CLERK user id (the bell and the SSE stream query by it), so a Clerk
  // shaped id is NEVER treated as missing: D1 cannot prove a Clerk user is
  // gone, and guessing would delete live notifications. What it does catch is
  // the legacy rows that hold a domain row id instead, which are invisible to
  // the bell by construction and join to no contact or team member either.
  const contactIds = new Set(contactRows.map((row) => row.id))
  const contactClerkIds = new Set(contactRows.map((row) => row.clerkUserId).filter((id): id is string => Boolean(id)))
  const memberIds = new Set(teamMemberRows.map((row) => row.id))
  const memberClerkIds = new Set(
    teamMemberRows.map((row) => row.clerkUserId).filter((id): id is string => Boolean(id)),
  )
  const recipientGone = (row: NotificationRow): boolean => {
    if (!row.userId) return false
    if (row.userId.startsWith('user_')) return false
    if (row.userType === 'contact') return !contactIds.has(row.userId) && !contactClerkIds.has(row.userId)
    if (row.userType === 'team_member') return !memberIds.has(row.userId) && !memberClerkIds.has(row.userId)
    return false
  }
  for (const notification of notificationRows) {
    const reasons: string[] = []
    if (notification.entityType === 'request' && notification.entityId && !liveRequestIds.has(notification.entityId)) {
      reasons.push(`its request ${notification.entityId} no longer exists`)
    }
    if (recipientGone(notification)) {
      reasons.push(`its ${notification.userType} recipient ${notification.userId} joins to no contact or team member`)
    }
    if (reasons.length === 0) continue
    add('orphan_notifications', 'notifications', notification.id, `Unreachable notification: ${reasons.join(', and ')}.`)
  }

  // ── seed_subscriptions ─────────────────────────────────────────────────
  // P10. A subscription on an ARCHIVED organisation that holds no invoices,
  // where no request and no task sits on any of its tracks. The tracks go with
  // it. The ORGANISATION IS NEVER TOUCHED: Acme Corp stays, archived, with its
  // case study submission intact.
  for (const subscription of subscriptionRows) {
    const org = orgById.get(subscription.orgId)
    if (!org || org.status !== 'archived') continue
    if (isProtectedOrg(subscription.orgId)) continue
    if ((invoicesByOrg.get(subscription.orgId) ?? 0) > 0) continue
    const subscriptionTracks = tracksBySubscription.get(subscription.id) ?? []
    const busy = subscriptionTracks.filter(
      (track) => (requestsByTrack.get(track.id) ?? 0) + (tasksByTrack.get(track.id) ?? 0) > 0,
    )
    if (busy.length > 0) continue
    if (subscription.manyrequestsId) {
      refuse(
        'seed_subscriptions',
        'subscriptions',
        subscription.id,
        'manyrequests_keyed',
        `Carries a ManyRequests id (${subscription.manyrequestsId}), so the import adopted it.`,
      )
      continue
    }
    if (subscription.stripeSubscriptionId) {
      refuse(
        'seed_subscriptions',
        'subscriptions',
        subscription.id,
        'predicate_failed',
        `Carries a Stripe subscription id (${subscription.stripeSubscriptionId}). Billing links are always real.`,
      )
      continue
    }
    for (const track of subscriptionTracks) {
      add(
        'seed_subscriptions',
        'tracks',
        track.id,
        `Empty track on the seed subscription ${subscription.id} of archived organisation ${org.name}.`,
      )
    }
    add(
      'seed_subscriptions',
      'subscriptions',
      subscription.id,
      `Seed subscription on archived organisation ${org.name}, which holds no invoices and no work on its tracks. The organisation itself is never touched.`,
    )
  }

  // ── known_residue ──────────────────────────────────────────────────────
  const plannedTaskIds: string[] = []
  for (const entry of RESIDUE_ALLOWLIST) {
    if (planned.has(`${entry.table}:${entry.id}`)) continue
    const verdict = checkAllowlistEntry(entry, context)
    if (verdict.outcome === 'gone') {
      refuse('known_residue', entry.table, entry.id, 'already_gone', 'Already removed. Nothing to do.')
      continue
    }
    if (verdict.outcome === 'keyed') {
      refuse('known_residue', entry.table, entry.id, 'manyrequests_keyed', verdict.detail)
      continue
    }
    if (verdict.outcome === 'failed') {
      refuse('known_residue', entry.table, entry.id, 'predicate_failed', verdict.detail)
      continue
    }
    add('known_residue', entry.table, entry.id, entry.note)
    if (entry.table === 'tasks') plannedTaskIds.push(entry.id)
    if (entry.table === 'conversations') {
      for (const participant of participantsByConversation.get(entry.id) ?? []) {
        add('known_residue', 'conversation_participants', participant.id, `Participant of residue conversation ${entry.id}.`)
      }
    }
  }

  // The sweep must not create the orphans it exists to remove, so anything
  // hanging off a task it is about to delete goes with it.
  //
  // Time entries are the deliberate exception. They are the billing ledger,
  // time_entries.task_id carries no foreign key precisely so a deleted task
  // cannot cascade into it, and the schema says outright that a dangling id is
  // the better outcome. Only the three audited smoke entries go, by id.
  for (const taskId of plannedTaskIds) {
    for (const subtask of subtasksByTask.get(taskId) ?? []) {
      add('known_residue', 'task_subtasks', subtask.id, `Checklist item on residue task ${taskId}.`)
    }
  }
  const plannedTaskIdSet = new Set(plannedTaskIds)
  for (const blocker of blockerRows) {
    const touchesResidueTask =
      (blocker.blockedType === 'task' && plannedTaskIdSet.has(blocker.blockedId)) ||
      (blocker.blockerType === 'task' && plannedTaskIdSet.has(blocker.blockerId))
    if (!touchesResidueTask) continue
    add('known_residue', 'work_blockers', blocker.id, 'Blocker on a residue task this sweep removes.')
  }

  for (const group of plan.groups) {
    plan.totals.rows += group.rows.length
    plan.totals.refusals += group.refusals.length
  }
  return plan
}

type AllowlistVerdict =
  | { outcome: 'ok' }
  | { outcome: 'gone' }
  | { outcome: 'keyed'; detail: string }
  | { outcome: 'failed'; detail: string }

/**
 * The audit's sanity facts, re-checked against the live row. This is what turns
 * a list of ids into evidence: a reused id, a renamed conversation or a timer
 * entry that has grown into a real session fails here and is refused.
 */
function checkAllowlistEntry(entry: ResidueAllowlistEntry, context: ResidueContext): AllowlistVerdict {
  switch (entry.table) {
    case 'tasks': {
      const row = context.tasksById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      const title = (row.title ?? '').trim()
      if (!entry.titles.includes(title)) {
        return {
          outcome: 'failed',
          detail: `Title is now "${title}", not ${entry.titles.map((value) => `"${value}"`).join(' or ')}. The id has been reused.`,
        }
      }
      return { outcome: 'ok' }
    }
    case 'time_entries': {
      const row = context.timeEntriesById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      if (row.source !== 'live_timer') {
        return { outcome: 'failed', detail: `Source is "${row.source}", not "live_timer". This is no longer a timer smoke entry.` }
      }
      const seconds = Math.round((row.hours ?? 0) * 3600)
      if (!(seconds < entry.maxSeconds)) {
        return { outcome: 'failed', detail: `Duration is ${seconds}s, not under ${entry.maxSeconds}s. This is real logged time.` }
      }
      return { outcome: 'ok' }
    }
    case 'conversations': {
      const row = context.conversationsById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      const name = (row.name ?? '').trim()
      if (name !== entry.name) {
        return { outcome: 'failed', detail: `Name is now "${name}", not "${entry.name}". The id has been reused.` }
      }
      const messages = context.messageCountByConversation.get(entry.id) ?? 0
      if (messages > 0) {
        return { outcome: 'failed', detail: `It now holds ${messages} message(s), so it is a real thread.` }
      }
      return { outcome: 'ok' }
    }
    case 'notifications': {
      const row = context.notificationsById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      if (row.entityId !== entry.entityId) {
        return {
          outcome: 'failed',
          detail: `It now points at ${row.entityId ?? 'nothing'}, not ${entry.entityId}. The id has been reused.`,
        }
      }
      return { outcome: 'ok' }
    }
    case 'task_subtasks': {
      const row = context.subtasksById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      if (row.taskId !== entry.taskId) {
        return { outcome: 'failed', detail: `It now hangs off task ${row.taskId}, not ${entry.taskId}. The id has been reused.` }
      }
      return { outcome: 'ok' }
    }
    case 'work_blockers': {
      const row = context.blockersById.get(entry.id)
      if (!row) return { outcome: 'gone' }
      const keyed = sourceKeyOf(row)
      if (keyed) return { outcome: 'keyed', detail: `Carries a ManyRequests id (${keyed}).` }
      if (row.blockedId !== entry.blockedId || row.blockerId !== entry.blockerId) {
        return {
          outcome: 'failed',
          detail: `It now links ${row.blockedId} to ${row.blockerId}, not ${entry.blockedId} to ${entry.blockerId}. The id has been reused.`,
        }
      }
      return { outcome: 'ok' }
    }
  }
}

/**
 * The ManyRequests key of a row, whatever table it came from. None of the
 * residue tables except subscriptions declares the column today, so this reads
 * it defensively: adding the column to one of them later must make the sweep
 * refuse the row, not silently keep deleting it.
 */
function sourceKeyOf(row: object): string | null {
  const value = (row as Record<string, unknown>).manyrequestsId
  return typeof value === 'string' && value.length > 0 ? value : null
}

function emptyResiduePlan(): ResiduePlan {
  return {
    groups: RESIDUE_CLASSES.map((residueClass) => ({
      class: residueClass,
      label: CLASS_LABELS[residueClass],
      table: CLASS_TABLES[residueClass],
      rows: [],
      refusals: [],
    })),
    totals: { rows: 0, refusals: 0 },
    applied: {
      total: 0,
      byClass: {
        orphan_tracks: 0,
        orphan_subtasks: 0,
        orphan_blockers: 0,
        orphan_request_threads: 0,
        orphan_notifications: 0,
        seed_subscriptions: 0,
        known_residue: 0,
      },
    },
  }
}

// ── the apply ────────────────────────────────────────────────────────────────

/**
 * Remove exactly what the plan lists, children first, and count what the
 * statements actually removed rather than what was planned.
 *
 * Two guards repeat here rather than being trusted from plan time:
 *   1. Every id is re-read before it is deleted, so a row another operation
 *      removed in between is reported as applied zero instead of inflating the
 *      audit row.
 *   2. The ManyRequests key filter is re-applied IN the delete statement, so a
 *      subscription the import adopted since the dry run survives.
 *
 * The plan object is mutated with the applied counts and returned, so the
 * response carries the plan and what happened to it in one shape.
 */
export async function applyResidue(database: DB, plan: ResiduePlan): Promise<ResiduePlan> {
  const byTable = new Map<string, Array<{ id: string; residueClass: ResidueClass }>>()
  for (const group of plan.groups) {
    for (const row of group.rows) {
      const bucket = byTable.get(row.table)
      const item = { id: row.id, residueClass: group.class }
      if (bucket) bucket.push(item)
      else byTable.set(row.table, [item])
    }
  }

  for (const table of RESIDUE_APPLY_ORDER) {
    const entries = byTable.get(table)
    if (!entries || entries.length === 0) continue
    const handle = residueTableHandle(table)
    if (!handle) continue

    const ids = entries.map((entry) => entry.id)
    const alive = new Set<string>()
    for (const chunk of chunkIds(ids)) {
      const rows = (await database
        .select({ id: handle.idColumn })
        .from(handle.table)
        .where(deleteWhere(handle, chunk))) as unknown as Array<{ id: string }>
      for (const row of rows) alive.add(row.id)
    }

    const deletable = ids.filter((id) => alive.has(id))
    for (const chunk of chunkIds(deletable)) {
      await database.delete(handle.table).where(deleteWhere(handle, chunk))
    }
    for (const entry of entries) {
      if (!alive.has(entry.id)) continue
      plan.applied.byClass[entry.residueClass] += 1
      plan.applied.total += 1
    }
  }

  return plan
}

function deleteWhere(handle: ResidueTableHandle, chunk: readonly string[]) {
  const ids = inArray(handle.idColumn, chunk as string[])
  return handle.keyColumn ? and(ids, isNull(handle.keyColumn)) : ids
}
