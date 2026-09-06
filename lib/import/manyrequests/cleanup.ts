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
 *   hardDelete  Removes an organisation and its children. Refused unless the
 *               row is on the allowlist below AND holds no Xero contact, no
 *               Stripe customer and no invoice. Three independent locks,
 *               because the standing rule is that clients, contacts, invoices
 *               and finance data are always real.
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
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'

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

async function countOrgChildren(database: DB, orgId: string): Promise<Record<string, number>> {
  const [requests, contacts, messages, timeEntries, tasks, calls] = await Promise.all([
    database.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.orgId, orgId)),
    database.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.orgId, orgId)),
    database.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.orgId, orgId)),
    database.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(eq(schema.timeEntries.orgId, orgId)),
    database.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.orgId, orgId)),
    database.select({ id: schema.scheduledCalls.id }).from(schema.scheduledCalls).where(eq(schema.scheduledCalls.orgId, orgId)),
  ])
  return {
    requests: requests.length,
    contacts: contacts.length,
    messages: messages.length,
    time_entries: timeEntries.length,
    tasks: tasks.length,
    scheduled_calls: calls.length,
  }
}

/**
 * Delete an organisation and everything hanging off it, children first.
 *
 * The schema declares ON DELETE CASCADE on most of these, but SQLite only
 * enforces a foreign key when PRAGMA foreign_keys is on and D1 does not
 * guarantee it per statement, so every child is removed explicitly. Getting
 * this wrong leaves orphan rows pointing at an org that no longer exists, which
 * is exactly the state two requests in the current database are already in.
 */
async function deleteOrgTree(database: DB, orgId: string): Promise<number> {
  let deleted = 0
  const requests = await database
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.orgId, orgId))
  const requestIds = requests.map((row) => row.id)

  if (requestIds.length > 0) {
    await database.delete(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, requestIds))
    await database.delete(schema.requestReads).where(inArray(schema.requestReads.requestId, requestIds))
  }
  await database.delete(schema.messages).where(eq(schema.messages.orgId, orgId))
  await database.delete(schema.timeEntries).where(eq(schema.timeEntries.orgId, orgId))
  const tasks = await database.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.orgId, orgId))
  if (tasks.length > 0) {
    await database.delete(schema.taskSubtasks).where(inArray(schema.taskSubtasks.taskId, tasks.map((t) => t.id)))
    await database.delete(schema.tasks).where(eq(schema.tasks.orgId, orgId))
    deleted += tasks.length
  }
  await database.delete(schema.scheduledCalls).where(eq(schema.scheduledCalls.orgId, orgId))
  if (requestIds.length > 0) {
    await database.delete(schema.requests).where(inArray(schema.requests.id, requestIds))
    deleted += requestIds.length
  }
  await database.delete(schema.contacts).where(eq(schema.contacts.orgId, orgId))
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
  if (requestIds.length > 0) {
    const [messages, timeEntries, participants, reads] = await Promise.all([
      database.select({ id: schema.messages.id }).from(schema.messages).where(inArray(schema.messages.requestId, requestIds)),
      database.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(inArray(schema.timeEntries.requestId, requestIds)),
      database.select({ id: schema.requestParticipants.id }).from(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, requestIds)),
      database.select({ id: schema.requestReads.id }).from(schema.requestReads).where(inArray(schema.requestReads.requestId, requestIds)),
    ])
    wipe.messages += messages.length
    wipe.timeEntries += timeEntries.length
    wipe.requestParticipants += participants.length
    wipe.requestReads += reads.length
  }

  const dummyIds = [...dummyOrgIds]
  if (dummyIds.length > 0) {
    const [orgMessages, orgTime, orgTasks, orgCalls] = await Promise.all([
      database
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(and(inArray(schema.messages.orgId, dummyIds), isNull(schema.messages.manyrequestsId))),
      database.select({ id: schema.timeEntries.id }).from(schema.timeEntries).where(inArray(schema.timeEntries.orgId, dummyIds)),
      database
        .select({ id: schema.tasks.id, title: schema.tasks.title })
        .from(schema.tasks)
        .where(inArray(schema.tasks.orgId, dummyIds)),
      database.select({ id: schema.scheduledCalls.id }).from(schema.scheduledCalls).where(inArray(schema.scheduledCalls.orgId, dummyIds)),
    ])
    wipe.messages += orgMessages.length
    wipe.timeEntries += orgTime.length
    wipe.tasks.push(...orgTasks)
    wipe.scheduledCalls += orgCalls.length
    if (orgTasks.length > 0) {
      const subtasks = await database
        .select({ id: schema.taskSubtasks.id })
        .from(schema.taskSubtasks)
        .where(inArray(schema.taskSubtasks.taskId, orgTasks.map((task) => task.id)))
      wipe.taskSubtasks += subtasks.length
    }
  }

  return wipe
}

async function applyWipeDemo(database: DB, wipe: WipeDemoPlan): Promise<number> {
  let deleted = 0
  const requestIds = wipe.requests.map((row) => row.id)
  const taskIds = wipe.tasks.map((row) => row.id)

  if (taskIds.length > 0) {
    await database.delete(schema.taskSubtasks).where(inArray(schema.taskSubtasks.taskId, taskIds))
    await database.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds))
    deleted += taskIds.length
  }

  if (requestIds.length > 0) {
    await database.delete(schema.requestParticipants).where(inArray(schema.requestParticipants.requestId, requestIds))
    await database.delete(schema.requestReads).where(inArray(schema.requestReads.requestId, requestIds))
    await database.delete(schema.timeEntries).where(inArray(schema.timeEntries.requestId, requestIds))
    // Only messages with no ManyRequests key: an imported comment on an adopted
    // request must survive even if the request itself is somehow in scope.
    await database
      .delete(schema.messages)
      .where(and(inArray(schema.messages.requestId, requestIds), isNull(schema.messages.manyrequestsId)))
    await database
      .delete(schema.requests)
      .where(and(inArray(schema.requests.id, requestIds), isNull(schema.requests.manyrequestsId)))
    deleted += requestIds.length
  }

  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
  const dummyIds = orgs.filter((org) => matchesDummyAllowlist(org) !== null).map((org) => org.id)
  if (dummyIds.length > 0) {
    await database
      .delete(schema.messages)
      .where(and(inArray(schema.messages.orgId, dummyIds), isNull(schema.messages.manyrequestsId)))
    await database.delete(schema.timeEntries).where(inArray(schema.timeEntries.orgId, dummyIds))
    await database.delete(schema.scheduledCalls).where(inArray(schema.scheduledCalls.orgId, dummyIds))
  }

  return deleted
}
