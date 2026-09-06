/**
 * lib/import/manyrequests/cleanup.ts
 *
 * The seed-data cleanup that runs AFTER the import, never before: several of
 * the rows it touches are the merge targets the import writes into.
 *
 * Three operations, in increasing order of consequence:
 *
 *   archive     Sets organisations.status to 'archived'. Reversible, and the
 *               default answer for anything uncertain.
 *   hardDelete  Removes an organisation and EVERY table that carries its
 *               org_id, from a list derived from db/schema.ts rather than from
 *               memory (ORG_SCOPED_TABLES, kept honest by a static test).
 *               Refused unless the row is on the allowlist below AND holds no
 *               Xero contact, no Stripe customer, no invoice, and no row in any
 *               table the policy marks 'refuse'. Four independent locks,
 *               because the standing rule is that clients, contacts, invoices
 *               and finance data are always real, and because a partial sweep
 *               leaves the orphan rows it claims to be preventing.
 *   wipeDemo    Removes the seed requests, messages, time entries, tasks and
 *               scheduled calls that carry no ManyRequests key and hang off a
 *               dummy org (or off no org at all). Pipeline, finance and CRM
 *               rows are never in scope.
 *
 * discovery_calls IS NEVER TOUCHED, by anything here, at all. The
 * pre-call-digest cron runs unattended every ten minutes and sends real email
 * 25 to 35 minutes before each scheduled call; creating or moving a row in that
 * table is the one way this work could put a message in a real person's inbox.
 *
 * Like the importer, nothing in this module imports a route, a notification
 * helper, a mailer or Clerk. The same static test covers it.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'

/**
 * Ids per IN clause. D1 caps bound parameters at 100 per statement, which the
 * repo already encodes three times (lib/blockers-server.ts,
 * lib/delivery-aggregate.ts, lib/request-participants.ts all chunk at 90).
 * Today's counts are far under it and this module worked by luck; it breaks the
 * first time a dummy org or the demo sweep touches more than ~100 rows.
 */
const ID_CHUNK = 90

function chunkIds(ids: readonly string[]): string[][] {
  const out: string[][] = []
  for (let index = 0; index < ids.length; index += ID_CHUNK) out.push(ids.slice(index, index + ID_CHUNK))
  return out
}

/** A row the cleanup is allowed to hard-delete, identified twice over. */
export interface DummyOrgEntry {
  /** The leading characters of the D1 uuid, as recorded in the reconciliation. */
  idPrefix: string
  /** The exact organisation name. Both must match before anything is deleted. */
  name: string
  note: string
}

/**
 * The hard-delete allowlist. An organisation is deletable only when its id
 * starts with one of these prefixes AND its name matches exactly: the
 * reconciliation recorded eight-character id prefixes, and a prefix alone is
 * not a safe key for an irreversible operation on a client table.
 */
export const DUMMY_ORGS: readonly DummyOrgEntry[] = [
  { idPrefix: 'd753f180', name: 'Acme Corp', note: 'Seed org. 8 requests, 2 messages, contacts on acme.example.com.' },
  { idPrefix: 'b4e26e39', name: 'Beta Labs', note: 'Seed org. 3 requests, contacts on betalabs.example.com.' },
  { idPrefix: '9ee08285', name: 'Gamma Design', note: 'Seed org. 1 request, contacts on gammadesign.example.com.' },
  { idPrefix: 'b160a626', name: 'Lifecycle Test Co', note: 'e2e fixture. 1 "retret" request.' },
  { idPrefix: '2d97e532', name: 'Pp', note: 'Junk. 1 "retret" request, 1 message.' },
  { idPrefix: '4150d15f', name: 'Tahi Studio', note: 'Internal scratch org. 2 junk requests, 6 messages.' },
  { idPrefix: '77da2c11', name: 'Tahi Studio', note: 'Internal scratch org. Empty but for a duplicate contact.' },
  { idPrefix: 'c4ed4811', name: 'Evan Kwan', note: 'Stripe-import duplicate of Physitrack with ZERO invoices.' },
  { idPrefix: '2859abca', name: 'Evan Kwan', note: 'Stripe-import duplicate of Physitrack with ZERO invoices.' },
  { idPrefix: 'fbab8478', name: 'Evan Kwan', note: 'Stripe-import duplicate of Physitrack with ZERO invoices.' },
]

/**
 * Never archived, never deleted, whatever a caller asks for. The QA org is
 * explicitly kept (it is how the studio smoke-tests the portal) and org_tahi is
 * the internal marker every "is this us" check reads.
 */
export const PROTECTED_ORG_IDS: readonly string[] = ['org_tahi']
export const PROTECTED_ORG_ID_PREFIXES: readonly string[] = ['d468fd7e']

/**
 * Request titles that are unambiguously test artefacts, including the two that
 * sit on REAL clients (Physitrack's "test", St Stephen's "dsfsd"). Matched
 * case-insensitively and only ever on a request with no ManyRequests key, so an
 * imported request can never be caught by a title collision.
 */
export const DEMO_REQUEST_TITLES: readonly string[] = [
  'test',
  'dsfsd',
  'retret',
  'second test',
  'fgfdh',
  'ysyhs',
]

/** The self-labelled deletions, e.g. "ZZ spine-test request (delete me)". */
export const DEMO_REQUEST_TITLE_PREFIXES: readonly string[] = ['zz ']

/**
 * EVERY table in db/schema.ts that carries org_id, and what a hard delete does
 * about it. A static test re-derives this list from db/schema.ts and fails if a
 * table is missing, so a new org-scoped table cannot be forgotten here.
 *
 *   'delete'  org-owned scaffolding with no independent value. Removed with
 *             the organisation.
 *   'refuse'  real business data (finance, pipeline, delivery artefacts) or a
 *             table this slice must never touch. A single row in one of these
 *             REFUSES the hard delete outright and names the table, because the
 *             standing rule is that clients, contacts, invoices and finance
 *             data are always real.
 *
 * discovery_calls is 'refuse' and not merely unlisted: the pre-call-digest cron
 * runs unattended every ten minutes off that table and mails real people, so
 * nothing here may create, move or remove a row in it.
 */
export type OrgScopedPolicy = 'delete' | 'refuse'

export interface OrgScopedTable {
  /** The key on the Drizzle schema object. */
  schemaKey: string
  /** The SQL table name, which is what a test derives from db/schema.ts. */
  table: string
  policy: OrgScopedPolicy
}

export const ORG_SCOPED_TABLES: readonly OrgScopedTable[] = [
  { schemaKey: 'contacts', table: 'contacts', policy: 'delete' },
  { schemaKey: 'onboardingInvites', table: 'onboarding_invites', policy: 'delete' },
  { schemaKey: 'projects', table: 'projects', policy: 'refuse' },
  { schemaKey: 'subscriptions', table: 'subscriptions', policy: 'delete' },
  { schemaKey: 'requests', table: 'requests', policy: 'delete' },
  { schemaKey: 'activeTimers', table: 'active_timers', policy: 'delete' },
  { schemaKey: 'conversations', table: 'conversations', policy: 'delete' },
  { schemaKey: 'messages', table: 'messages', policy: 'delete' },
  { schemaKey: 'files', table: 'files', policy: 'delete' },
  { schemaKey: 'invoices', table: 'invoices', policy: 'refuse' },
  { schemaKey: 'timeEntries', table: 'time_entries', policy: 'delete' },
  { schemaKey: 'tasks', table: 'tasks', policy: 'delete' },
  { schemaKey: 'taskTemplates', table: 'task_templates', policy: 'delete' },
  { schemaKey: 'clientCosts', table: 'client_costs', policy: 'refuse' },
  { schemaKey: 'caseStudySubmissions', table: 'case_study_submissions', policy: 'refuse' },
  { schemaKey: 'caseStudies', table: 'case_studies', policy: 'refuse' },
  { schemaKey: 'teamMemberAccessOrgs', table: 'team_member_access_orgs', policy: 'delete' },
  { schemaKey: 'requestForms', table: 'request_forms', policy: 'delete' },
  { schemaKey: 'kanbanColumns', table: 'kanban_columns', policy: 'delete' },
  { schemaKey: 'contracts', table: 'contracts', policy: 'refuse' },
  { schemaKey: 'discoveryCalls', table: 'discovery_calls', policy: 'refuse' },
  { schemaKey: 'scheduledCalls', table: 'scheduled_calls', policy: 'delete' },
  { schemaKey: 'deals', table: 'deals', policy: 'refuse' },
  { schemaKey: 'activities', table: 'activities', policy: 'refuse' },
  { schemaKey: 'brands', table: 'brands', policy: 'delete' },
  { schemaKey: 'projectSchedules', table: 'project_schedules', policy: 'refuse' },
  { schemaKey: 'proposals', table: 'proposals', policy: 'refuse' },
  { schemaKey: 'contractDocuments', table: 'contract_documents', policy: 'refuse' },
  { schemaKey: 'projectCalculations', table: 'project_calculations', policy: 'refuse' },
  // Evidence rows for withheld mail (migration 0094). They belong to the org's
  // tree: a dummy org's suppressions name dummy addresses, and the dry run
  // still lists the table before anyone confirms a hard delete.
  { schemaKey: 'emailSuppressions', table: 'email_suppressions', policy: 'delete' },
]

interface OrgTableHandle {
  table: SQLiteTable
  orgColumn: SQLiteColumn
}

/**
 * The Drizzle handle for one org-scoped table, or null when the schema in play
 * does not carry it. Null is the honest answer under a unit-test double, whose
 * schema is a plain object with no columns; the static test over db/schema.ts
 * is what proves the real schema carries every entry.
 *
 * Only the org column is needed. team_member_access_orgs is a join table with
 * no `id` at all, so counting and deleting both key on org_id.
 */
function orgTableHandle(schemaKey: string): OrgTableHandle | null {
  const record = (schema as unknown as Record<string, Record<string, unknown> | undefined>)[schemaKey]
  if (!record) return null
  const orgColumn = record.orgId as SQLiteColumn | undefined
  if (!orgColumn) return null
  return { table: record as unknown as SQLiteTable, orgColumn }
}

/**
 * Every table still holding rows for this organisation, so the dry run states
 * the whole blast radius rather than the six tables somebody remembered. It is
 * derived from ORG_SCOPED_TABLES, which a static test keeps in step with
 * db/schema.ts, so a table added to the schema later cannot go unreported.
 */
async function countOrgChildren(database: DB, orgId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const entry of ORG_SCOPED_TABLES) {
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const rows = await database
      .select({ orgId: handle.orgColumn })
      .from(handle.table)
      .where(eq(handle.orgColumn, orgId))
    if (rows.length > 0) counts[entry.table] = rows.length
  }
  return counts
}

export function isProtectedOrg(orgId: string): boolean {
  if (PROTECTED_ORG_IDS.includes(orgId)) return true
  return PROTECTED_ORG_ID_PREFIXES.some((prefix) => orgId.startsWith(prefix))
}

export function matchesDummyAllowlist(org: { id: string; name: string }): DummyOrgEntry | null {
  return (
    DUMMY_ORGS.find((entry) => org.id.startsWith(entry.idPrefix) && org.name.trim() === entry.name) ?? null
  )
}

export function isDemoRequestTitle(title: string): boolean {
  const key = title.trim().toLowerCase()
  if (DEMO_REQUEST_TITLES.includes(key)) return true
  return DEMO_REQUEST_TITLE_PREFIXES.some((prefix) => key.startsWith(prefix))
}

// ── plan shapes ──────────────────────────────────────────────────────────────

export interface CleanupRefusal {
  orgId: string
  name: string
  reason: string
}

export interface CleanupOrgAction {
  orgId: string
  name: string
  /** Child rows that go with the org, so a dry run states the blast radius. */
  children: Record<string, number>
}

export interface WipeDemoPlan {
  requests: Array<{ id: string; title: string; reason: string }>
  messages: number
  timeEntries: number
  requestParticipants: number
  requestReads: number
  tasks: Array<{ id: string; title: string }>
  taskSubtasks: number
  scheduledCalls: number
}

export interface CleanupPlan {
  dryRun: boolean
  archive: CleanupOrgAction[]
  hardDelete: CleanupOrgAction[]
  refused: CleanupRefusal[]
  wipeDemo: WipeDemoPlan | null
  applied: {
    archived: number
    orgsDeleted: number
    rowsDeleted: number
  }
  warnings: string[]
}

export interface CleanupInput {
  dryRun: boolean
  archive: readonly string[]
  hardDelete: readonly string[]
  wipeDemo: boolean
}

function emptyWipe(): WipeDemoPlan {
  return {
    requests: [],
    messages: 0,
    timeEntries: 0,
    requestParticipants: 0,
    requestReads: 0,
    tasks: [],
    taskSubtasks: 0,
    scheduledCalls: 0,
  }
}

// ── the plan ─────────────────────────────────────────────────────────────────

/**
 * Build the plan, and only then decide whether to apply it. The same function
 * answers both modes, so what a dry run shows is exactly what an apply does.
 */
export async function runCleanup(database: DB, input: CleanupInput): Promise<CleanupPlan> {
  const plan: CleanupPlan = {
    dryRun: input.dryRun,
    archive: [],
    hardDelete: [],
    refused: [],
    wipeDemo: null,
    applied: { archived: 0, orgsDeleted: 0, rowsDeleted: 0 },
    warnings: [
      'discovery_calls is never touched by this endpoint. The pre-call-digest cron mails real people off that table every ten minutes.',
    ],
  }

  const requestedIds = Array.from(new Set([...input.archive, ...input.hardDelete]))
  const orgs = requestedIds.length
    ? await database
        .select({
          id: schema.organisations.id,
          name: schema.organisations.name,
          status: schema.organisations.status,
          xeroContactId: schema.organisations.xeroContactId,
          stripeCustomerId: schema.organisations.stripeCustomerId,
          manyrequestsId: schema.organisations.manyrequestsId,
        })
        .from(schema.organisations)
        .where(inArray(schema.organisations.id, requestedIds))
    : []
  const orgById = new Map(orgs.map((org) => [org.id, org]))

  // ── archive ────────────────────────────────────────────────────────────
  for (const orgId of input.archive) {
    const org = orgById.get(orgId)
    if (!org) {
      plan.refused.push({ orgId, name: '(not found)', reason: 'No organisation with that id.' })
      continue
    }
    if (isProtectedOrg(orgId)) {
      plan.refused.push({ orgId, name: org.name, reason: 'Protected organisation (the QA client or the internal studio marker).' })
      continue
    }
    if (org.status === 'archived') {
      plan.refused.push({ orgId, name: org.name, reason: 'Already archived; nothing to do.' })
      continue
    }
    plan.archive.push({ orgId, name: org.name, children: {} })
  }

  // ── hard delete ────────────────────────────────────────────────────────
  for (const orgId of input.hardDelete) {
    const org = orgById.get(orgId)
    if (!org) {
      plan.refused.push({ orgId, name: '(not found)', reason: 'No organisation with that id.' })
      continue
    }
    if (isProtectedOrg(orgId)) {
      plan.refused.push({ orgId, name: org.name, reason: 'Protected organisation (the QA client or the internal studio marker).' })
      continue
    }
    const allowed = matchesDummyAllowlist(org)
    if (!allowed) {
      plan.refused.push({
        orgId,
        name: org.name,
        reason: 'Not on the dummy allowlist. Hard delete is limited to the ten seed organisations the reconciliation named, matched on BOTH id prefix and exact name.',
      })
      continue
    }
    if (org.xeroContactId) {
      plan.refused.push({ orgId, name: org.name, reason: `Holds a Xero contact id (${org.xeroContactId}). Merge it, do not delete it.` })
      continue
    }
    if (org.stripeCustomerId) {
      plan.refused.push({ orgId, name: org.name, reason: `Holds a Stripe customer id (${org.stripeCustomerId}). Merge it, do not delete it.` })
      continue
    }
    if (org.manyrequestsId) {
      plan.refused.push({ orgId, name: org.name, reason: 'Carries a ManyRequests id, so the import adopted it. It is not a dummy row.' })
      continue
    }
    const invoices = await database
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, orgId))
    if (invoices.length > 0) {
      plan.refused.push({
        orgId,
        name: org.name,
        reason: `Holds ${invoices.length} invoice(s). Finance rows are always real; re-point them at the surviving client and archive this shell instead.`,
      })
      continue
    }

    const children = await countOrgChildren(database, orgId)
    // Nothing is orphaned and nothing real is destroyed: a single row in any
    // table the policy marks 'refuse' (finance, pipeline, delivery artefacts,
    // and discovery_calls which this endpoint may never touch at all) stops the
    // delete and names the table, rather than leaving rows pointing at an
    // organisation that no longer exists.
    const blocking = ORG_SCOPED_TABLES.filter(
      (entry) => entry.policy === 'refuse' && (children[entry.table] ?? 0) > 0,
    )
    if (blocking.length > 0) {
      plan.refused.push({
        orgId,
        name: org.name,
        reason: `Holds rows this endpoint will not delete: ${blocking.map((entry) => `${entry.table} (${children[entry.table]})`).join(', ')}. Finance, pipeline and delivery rows are always real, and discovery_calls is never touched at all. Re-point them at the surviving client and archive this shell instead.`,
      })
      continue
    }
    plan.hardDelete.push({ orgId, name: org.name, children })
  }

  // ── wipe demo ──────────────────────────────────────────────────────────
  if (input.wipeDemo) {
    plan.wipeDemo = await planWipeDemo(database)
  }

  if (input.dryRun) return plan

  // ── apply ──────────────────────────────────────────────────────────────
  for (const action of plan.archive) {
    await database
      .update(schema.organisations)
      .set({ status: 'archived', updatedAt: new Date().toISOString() })
      .where(eq(schema.organisations.id, action.orgId))
    plan.applied.archived += 1
  }

  for (const action of plan.hardDelete) {
    plan.applied.rowsDeleted += await deleteOrgTree(database, action.orgId)
    plan.applied.orgsDeleted += 1
  }

  if (plan.wipeDemo) {
    plan.applied.rowsDeleted += await applyWipeDemo(database, plan.wipeDemo)
  }

  return plan
}

/**
 * Delete an organisation and everything hanging off it, children first.
 *
 * The schema declares ON DELETE CASCADE on most of these, but SQLite only
 * enforces a foreign key when PRAGMA foreign_keys is on and D1 does not
 * guarantee it per statement, so every child is removed explicitly. Getting
 * this wrong leaves orphan rows pointing at an org that no longer exists, which
 * is exactly the state two requests in the current database are already in.
 *
 * "Every child" means every table in ORG_SCOPED_TABLES marked 'delete', which
 * is derived from db/schema.ts rather than from memory. The 'refuse' tables are
 * never reached here: runCleanup refuses the whole delete before it gets this
 * far if the organisation holds a single row in one of them.
 */
async function deleteOrgTree(database: DB, orgId: string): Promise<number> {
  let deleted = 0

  // Grandchildren first: rows keyed on a request, a task or a conversation
  // rather than on the org, which the org_id sweep below cannot see.
  const requests = await database
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.orgId, orgId))
  const requestIds = requests.map((row) => row.id)
  for (const chunk of chunkIds(requestIds)) {
    await database.delete(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, chunk))
    await database.delete(schema.requestReads).where(inArray(schema.requestReads.requestId, chunk))
  }

  const tasks = await database.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.orgId, orgId))
  for (const chunk of chunkIds(tasks.map((task) => task.id))) {
    await database.delete(schema.taskSubtasks).where(inArray(schema.taskSubtasks.taskId, chunk))
  }

  const conversations = await database
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.orgId, orgId))
  for (const chunk of chunkIds(conversations.map((row) => row.id))) {
    await database
      .delete(schema.conversationParticipants)
      .where(inArray(schema.conversationParticipants.conversationId, chunk))
  }

  // Then every org-scoped table the policy says may go.
  for (const entry of ORG_SCOPED_TABLES) {
    if (entry.policy !== 'delete') continue
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const rows = await database
      .select({ orgId: handle.orgColumn })
      .from(handle.table)
      .where(eq(handle.orgColumn, orgId))
    if (rows.length === 0) continue
    await database.delete(handle.table).where(eq(handle.orgColumn, orgId))
    deleted += rows.length
  }

  await database.delete(schema.organisations).where(eq(schema.organisations.id, orgId))
  deleted += 1
  return deleted
}

/**
 * The demo sweep. A row qualifies only when it carries NO ManyRequests key
 * (so nothing the import created or adopted can ever be caught) AND it is
 * either attached to a dummy organisation, attached to no organisation that
 * still exists, or titled as an obvious test artefact.
 */
export async function planWipeDemo(database: DB): Promise<WipeDemoPlan> {
  const wipe = emptyWipe()

  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
  const liveOrgIds = new Set(orgs.map((org) => org.id))
  const dummyOrgIds = new Set(orgs.filter((org) => matchesDummyAllowlist(org) !== null).map((org) => org.id))

  const requests = await database
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      manyrequestsId: schema.requests.manyrequestsId,
    })
    .from(schema.requests)

  for (const request of requests) {
    if (request.manyrequestsId) continue
    if (isProtectedOrg(request.orgId)) continue
    if (dummyOrgIds.has(request.orgId)) {
      wipe.requests.push({ id: request.id, title: request.title, reason: 'On a dummy organisation.' })
      continue
    }
    if (!liveOrgIds.has(request.orgId)) {
      wipe.requests.push({ id: request.id, title: request.title, reason: 'Orphan: its org_id joins to no organisation.' })
      continue
    }
    if (isDemoRequestTitle(request.title)) {
      wipe.requests.push({ id: request.id, title: request.title, reason: 'Self-labelled test artefact on a real client.' })
    }
  }

  const requestIds = wipe.requests.map((row) => row.id)
  for (const chunk of chunkIds(requestIds)) {
    const [messages, timeEntries, participants, reads] = await Promise.all([
      database.select({ id: schema.messages.id }).from(schema.messages).where(inArray(schema.messages.requestId, chunk)),
      database.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(inArray(schema.timeEntries.requestId, chunk)),
      database.select({ id: schema.requestParticipants.id }).from(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, chunk)),
      database.select({ id: schema.requestReads.id }).from(schema.requestReads).where(inArray(schema.requestReads.requestId, chunk)),
    ])
    wipe.messages += messages.length
    wipe.timeEntries += timeEntries.length
    wipe.requestParticipants += participants.length
    wipe.requestReads += reads.length
  }

  for (const chunk of chunkIds([...dummyOrgIds])) {
    const [orgMessages, orgTime, orgTasks, orgCalls] = await Promise.all([
      database
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(inArray(schema.messages.orgId, chunk), isNull(schema.messages.manyrequestsId))),
      database.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(inArray(schema.timeEntries.orgId, chunk)),
      database
        .select({ id: schema.tasks.id, title: schema.tasks.title })
        .from(schema.tasks)
        .where(inArray(schema.tasks.orgId, chunk)),
      database.select({ id: schema.scheduledCalls.id }).from(schema.scheduledCalls).where(inArray(schema.scheduledCalls.orgId, chunk)),
    ])
    wipe.messages += orgMessages.length
    wipe.timeEntries += orgTime.length
    wipe.tasks.push(...orgTasks)
    wipe.scheduledCalls += orgCalls.length
    for (const taskChunk of chunkIds(orgTasks.map((task) => task.id))) {
      const subtasks = await database
        .select({ id: schema.taskSubtasks.id })
        .from(schema.taskSubtasks)
        .where(inArray(schema.taskSubtasks.taskId, taskChunk))
      wipe.taskSubtasks += subtasks.length
    }
  }

  return wipe
}

export async function applyWipeDemo(database: DB, wipe: WipeDemoPlan): Promise<number> {
  let deleted = 0
  const taskIds = wipe.tasks.map((row) => row.id)

  for (const chunk of chunkIds(taskIds)) {
    await database.delete(schema.taskSubtasks).where(inArray(schema.taskSubtasks.taskId, chunk))
    await database.delete(schema.tasks).where(inArray(schema.tasks.id, chunk))
    deleted += chunk.length
  }

  // COUNT WHAT THE STATEMENT ACTUALLY REMOVES. The request delete is filtered
  // by isNull(manyrequests_id), so a request the import has since adopted
  // survives it. Counting the planned ids instead overstated the number and
  // wrote the inflated figure into the audit row.
  const plannedRequestIds = wipe.requests.map((row) => row.id)
  const deletableRequestIds: string[] = []
  for (const chunk of chunkIds(plannedRequestIds)) {
    const rows = await database
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(and(inArray(schema.requests.id, chunk), isNull(schema.requests.manyrequestsId)))
    deletableRequestIds.push(...rows.map((row) => row.id))
  }

  for (const chunk of chunkIds(plannedRequestIds)) {
    await database.delete(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, chunk))
    await database.delete(schema.requestReads).where(inArray(schema.requestReads.requestId, chunk))
    await database.delete(schema.timeEntries).where(inArray(schema.timeEntries.requestId, chunk))
    // Only messages with no ManyRequests key: an imported comment on an adopted
    // request must survive even if the request itself is somehow in scope.
    await database
      .delete(schema.messages)
      .where(and(inArray(schema.messages.requestId, chunk), isNull(schema.messages.manyrequestsId)))
  }
  for (const chunk of chunkIds(deletableRequestIds)) {
    await database.delete(schema.requests).where(inArray(schema.requests.id, chunk))
    deleted += chunk.length
  }

  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
  const dummyIds = orgs.filter((org) => matchesDummyAllowlist(org) !== null).map((org) => org.id)
  for (const chunk of chunkIds(dummyIds)) {
    await database
      .delete(schema.messages)
      .where(and(inArray(schema.messages.orgId, chunk), isNull(schema.messages.manyrequestsId)))
    await database.delete(schema.timeEntries).where(inArray(schema.timeEntries.orgId, chunk))
    await database.delete(schema.scheduledCalls).where(inArray(schema.scheduledCalls.orgId, chunk))
  }

  return deleted
}
