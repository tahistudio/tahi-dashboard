/**
 * lib/org-lifecycle/delete.ts
 *
 * Remove an organisation and everything under it, INCLUDING its invoices,
 * invoice items, subscriptions and tracks.
 *
 * That is deliberately wider than the import cleanup's hard delete, which
 * refuses over a single invoice. The founder's actual problem is a dummy
 * "Acme Widgets Test" carrying six STRIPE TEST invoices: refusing over
 * finance rows would leave that row on the client list forever, and archiving
 * it only hides it. So this endpoint moves the lock from "does it hold
 * finance data" to "is it a real client", and answers that question with six
 * independent refusals:
 *
 *   1. the typed name must match the organisation's name EXACTLY,
 *   2. no manyrequests_id (the import adopted it, so it is a real client),
 *   3. no LIVE clerk_org_id (a real login exists against it),
 *   4. no contact carrying a LIVE clerk_user_id (a real person can sign in),
 *   5. no pipeline or sales artefact: a deal, a lead behind one, a CRM
 *      activity, a discovery call, a contract, a contract document, a
 *      proposal, a project schedule or a project calculation,
 *   6. no REAL LEDGER: an invoice carrying a paid Stripe or Xero id while the
 *      organisation also carries a Xero contact id. A Stripe customer id on
 *      its own does NOT refuse, because a test-mode customer looks exactly
 *      like a live one; the dry run prints it, and every invoice's rail id,
 *      amount and date, so the operator sees what goes.
 *
 * ONE narrow exception exists, `removeClerkOrganisation`: an accidental
 * workspace, the organisation self-serve provisioning creates when a Tahi
 * teammate accepts a team invite with no active organisation. Refusals 3 and 4
 * are then replaced by a stricter eligibility rule (see assessAccidentalWorkspace
 * below), and the Clerk organisation is deleted BEFORE any database row, through
 * a deleter the route injects.
 *
 * Refusals 3 and 4 are checked against Clerk through the injected
 * `clerkPresence`: an id Clerk answers 404 for is STALE (the workspace or the
 * person was removed in the Clerk dashboard and D1 simply still names them)
 * and refuses nothing, while a Clerk that cannot be reached keeps the refusal.
 * Fail closed, never delete on a guess.
 *
 * discovery_calls is on the refusal list and always will be: the
 * pre-call-digest cron runs unattended every ten minutes and mails real people
 * off that table.
 *
 * Like the merge, this module imports no route, no mailer, no notification
 * helper and no Clerk. A delete cannot send anything to anyone.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { isProtectedOrg } from '@/lib/import/manyrequests/cleanup'
import {
  CONTACT_REFERENCE_COLUMNS,
  ORG_SCOPED_TABLES,
  PARENT_KEYED_TABLES,
  PIPELINE_REFUSAL_TABLES,
  chunkIds,
  orgTableHandle,
  tableHandle,
} from './refs'

// ── shapes ───────────────────────────────────────────────────────────────────

export interface InvoiceLine {
  id: string
  number: string | null
  status: string | null
  totalUsd: number | null
  currency: string | null
  createdAt: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
}

/**
 * The accidental-workspace assessment.
 *
 * A Tahi teammate who accepts a team invite with no active organisation lands
 * on client onboarding, and a refresh runs self-serve provisioning: Clerk gets
 * a "Somebody's workspace" organisation, D1 gets an organisation row, and the
 * teammate's own address becomes a contact with a clerk_user_id. Those two
 * facts are exactly the pair the ordinary delete refuses over, so the row is
 * unremovable by design, which is the wrong answer for a row that is nothing
 * but an accident.
 *
 * `removeClerkOrganisation` swaps those two refusals for a stricter test:
 * every login attached must belong to Tahi staff, the Clerk organisation must
 * not be the studio's own, and the row must carry no ledger, no rail id, no
 * import key and no pipeline. Anything else and it is somebody's real client.
 */
export interface AccidentalWorkspace {
  /** True when the caller asked for the Clerk organisation to go too. */
  requested: boolean
  /** True when every eligibility check passes. Computed either way. */
  eligible: boolean
  /** Why not, in the operator's words. Empty when eligible. */
  reasons: string[]
  /** The Clerk organisation that would be deleted, if there is one. */
  clerkOrgId: string | null
  /** Contact emails carrying a Clerk login that would be unlinked. */
  contactEmails: string[]
  /** The subset of those that match a team_members row. */
  teamEmails: string[]
  /** Set on an applied run only. */
  clerkResult: 'deleted' | 'already_gone' | null
}

export interface OrgDeletePlan {
  dryRun: boolean
  org: { id: string; name: string; status: string | null }
  /** SQL table name -> rows that would go. */
  tables: Record<string, number>
  /** Every invoice on the org, so the operator can read the ledger before it goes. */
  invoices: InvoiceLine[]
  /** Printed, never a refusal on its own: a test-mode customer looks real. */
  stripeCustomerId: string | null
  xeroContactId: string | null
  /** Always present, so the dialog can offer the checkbox off a plain dry run. */
  accidentalWorkspace: AccidentalWorkspace
  warnings: string[]
  applied: { rowsDeleted: number; invoicesDeleted: number; orgsDeleted: number }
}

export class OrgDeleteRefusal extends Error {
  readonly refusals: string[]
  /**
   * Carried on the refusal too: the dialog needs to know whether the row it
   * was just refused is an eligible accidental workspace, and a refusal is
   * the only answer it gets in that case.
   */
  readonly accidentalWorkspace: AccidentalWorkspace | null
  constructor(refusals: string[], accidentalWorkspace: AccidentalWorkspace | null = null) {
    super(refusals[0] ?? 'Delete refused.')
    this.name = 'OrgDeleteRefusal'
    this.refusals = refusals
    this.accidentalWorkspace = accidentalWorkspace
  }
}

/**
 * The Clerk organisation could not be removed. Thrown BEFORE any D1 write, so
 * a database that still has the organisation is the correct outcome here.
 */
export class ClerkOrganisationDeleteFailed extends Error {
  constructor(public readonly clerkOrgId: string, public readonly reason: unknown = null) {
    super('The Clerk organisation could not be removed, so nothing in the database was changed.')
    this.name = 'ClerkOrganisationDeleteFailed'
  }
}

/**
 * Removes one Clerk organisation, answering 'already_gone' for a 404 and
 * throwing for anything else. Injected by the route: nothing in this folder
 * may import Clerk (lib/org-lifecycle/__tests__/policy.test.ts holds that
 * true), so the caller supplies the one line that talks to it.
 */
export type ClerkOrgDeleter = (clerkOrgId: string) => Promise<'deleted' | 'already_gone'>

/**
 * Whether an id still names something in Clerk. 'unknown' is Clerk being
 * unreachable, and it FAILS CLOSED: an unverifiable login keeps its refusal.
 */
export type ClerkExistence = 'exists' | 'gone' | 'unknown'

/**
 * Reads Clerk to tell a live login from a stale id. Both refusals over logins
 * ask it first, because a founder who deleted the organisation and the user in
 * the Clerk dashboard is left with D1 columns that describe a login nobody can
 * use, and refusing over those is refusing over nothing.
 *
 * Injected for the same reason as the deleter: this folder may not import
 * Clerk. Omit it and every id is assumed live, which is the old behaviour.
 */
export interface ClerkPresence {
  organisationExists: (clerkOrgId: string) => Promise<ClerkExistence>
  userExists: (clerkUserId: string) => Promise<ClerkExistence>
}

/** Case-insensitive, whitespace-insensitive address comparison. */
function normaliseEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export class OrgDeleteNameMismatch extends Error {
  constructor(public readonly expected: string) {
    super(`The typed name does not match. Type the organisation name exactly: ${expected}`)
    this.name = 'OrgDeleteNameMismatch'
  }
}

export class OrgNotFoundForDelete extends Error {
  constructor(public readonly orgId: string) {
    super('No organisation with that id.')
    this.name = 'OrgNotFoundForDelete'
  }
}

export interface OrgDeleteInput {
  orgId: string
  confirmName: string
  dryRun: boolean
  /**
   * Replace the two login refusals with the accidental-workspace eligibility
   * rule, and remove the Clerk organisation before the D1 rows. Default false.
   */
  removeClerkOrganisation?: boolean
  /** Supplied by the route when removeClerkOrganisation is true. */
  deleteClerkOrganisation?: ClerkOrgDeleter
  /**
   * Supplied by the route always. Without it every stored id is assumed live,
   * which is the conservative answer a unit test wants by default.
   */
  clerkPresence?: ClerkPresence
}

// ── the plan ─────────────────────────────────────────────────────────────────

export async function runOrgDelete(database: DB, input: OrgDeleteInput): Promise<OrgDeletePlan> {
  const { orgId } = input

  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      status: schema.organisations.status,
      manyrequestsId: schema.organisations.manyrequestsId,
      clerkOrgId: schema.organisations.clerkOrgId,
      stripeCustomerId: schema.organisations.stripeCustomerId,
      xeroContactId: schema.organisations.xeroContactId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  if (!org) throw new OrgNotFoundForDelete(orgId)

  // The typed name is checked FIRST and on its own, so an operator who
  // mistyped never learns anything about a row they were not looking at.
  if (input.confirmName !== org.name) throw new OrgDeleteNameMismatch(org.name)

  const refusals: string[] = []

  if (isProtectedOrg(orgId)) {
    refusals.push('That organisation is protected (the QA client or the internal studio marker) and is never deleted.')
  }
  if (org.manyrequestsId) {
    refusals.push(
      `${org.name} carries a ManyRequests id (${org.manyrequestsId}), so the import adopted it as a real client. Merge it into the surviving client instead.`,
    )
  }
  // Every stored login id, checked against Clerk before it is allowed to
  // refuse anything. A 404 there means the id is stale: the person or the
  // workspace was removed in the Clerk dashboard and D1 simply still names it.
  const orgClerkState: ClerkExistence = org.clerkOrgId
    ? input.clerkPresence
      ? await input.clerkPresence.organisationExists(org.clerkOrgId)
      : 'exists'
    : 'gone'

  const contactRows = await contactsWithClerkIds(database, orgId)
  const linkedContacts: Array<{ id: string; name: string; email: string }> = []
  const staleContactEmails: string[] = []
  const unreachableContactEmails: string[] = []
  for (const row of contactRows) {
    const state: ClerkExistence = input.clerkPresence ? await input.clerkPresence.userExists(row.clerkUserId) : 'exists'
    if (state === 'gone') {
      staleContactEmails.push(row.email)
      continue
    }
    if (state === 'unknown') unreachableContactEmails.push(row.email)
    linkedContacts.push({ id: row.id, name: row.name, email: row.email })
  }

  // Pipeline and sales artefacts. One row in any of these refuses and names
  // the table, because they are always real: a deal is a sale, a proposal and
  // a contract are documents somebody signed off, and discovery_calls feeds an
  // unattended mailer.
  const pipelineCounts: Record<string, number> = {}
  for (const entry of PIPELINE_REFUSAL_TABLES) {
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const rows = await database.select({ orgId: handle.column }).from(handle.table).where(eq(handle.column, orgId))
    if (rows.length > 0) pipelineCounts[entry.table] = rows.length
  }
  // A lead has no org_id: it reaches an organisation through the deal it was
  // promoted into, so it is counted through that deal rather than skipped.
  const leadCount = await countLeadsBehindDeals(database, orgId)
  if (leadCount > 0) pipelineCounts.leads = leadCount

  const pipelineNamed = Object.entries(pipelineCounts)
    .map(([table, count]) => `${table} (${count})`)
    .join(', ')
  if (pipelineNamed) {
    refusals.push(
      `${org.name} holds pipeline and sales rows this endpoint will never delete: ${pipelineNamed}. Pipeline and sales artefacts are always real.`,
    )
  }

  // The ledger read, which is both a refusal test and the dry run's headline.
  const invoiceRows = await database
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      status: schema.invoices.status,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      createdAt: schema.invoices.createdAt,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      paidAt: schema.invoices.paidAt,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.orgId, orgId))

  const paidOnARail = invoiceRows.filter(
    (row) => (row.status === 'paid' || row.paidAt) && (row.stripeInvoiceId || row.xeroInvoiceId),
  )
  if (paidOnARail.length > 0 && org.xeroContactId) {
    refusals.push(
      `${org.name} has ${paidOnARail.length} paid invoice(s) on a live rail and a Xero contact id (${org.xeroContactId}). That is a real ledger, not test data. Merge this organisation into the client it duplicates instead of deleting it.`,
    )
  }

  // ── the accidental workspace ───────────────────────────────────────────
  // Computed on every run, requested or not, so the dialog can offer the
  // checkbox off the refusal it just received.
  const assessment = await assessAccidentalWorkspace(database, {
    requested: input.removeClerkOrganisation === true,
    name: org.name,
    clerkOrgId: org.clerkOrgId,
    manyrequestsId: org.manyrequestsId,
    stripeCustomerId: org.stripeCustomerId,
    xeroContactId: org.xeroContactId,
    linkedContacts,
    invoiceCount: invoiceRows.length,
    pipelineNamed,
  })
  const accidental = assessment.workspace

  // The two login refusals stand UNLESS the caller asked for the Clerk
  // organisation to go and every eligibility check passed.
  const loginRefusalsWaived = accidental.requested && accidental.eligible
  if (!loginRefusalsWaived) {
    if (org.clerkOrgId && orgClerkState === 'exists') {
      refusals.push(
        `${org.name} carries a Clerk organisation id (${org.clerkOrgId}), which means a real login exists against it. Archive it instead.`,
      )
    }
    if (org.clerkOrgId && orgClerkState === 'unknown') {
      refusals.push(
        `${org.name} carries a Clerk organisation id (${org.clerkOrgId}) and Clerk could not be reached to check whether it still exists. Refusing while that is unknown.`,
      )
    }
    if (linkedContacts.length > 0) {
      refusals.push(
        `${linkedContacts.length} contact(s) on ${org.name} can sign in to the portal (${linkedContacts.map((row) => row.email).join(', ')}). A real person is attached to this client. Archive it instead.`,
      )
    }
    if (unreachableContactEmails.length > 0) {
      refusals.push(
        `Clerk could not be reached to check ${unreachableContactEmails.join(', ')}. Refusing while it is unknown whether those logins still exist.`,
      )
    }
    // Only the reasons the plain refusals do not already say, so a refusal
    // never prints the same fact twice.
    if (accidental.requested) refusals.push(...assessment.novelReasons)
  }

  if (refusals.length > 0) throw new OrgDeleteRefusal(refusals, accidental)

  // ── the blast radius ───────────────────────────────────────────────────
  const tables: Record<string, number> = {}
  for (const entry of ORG_SCOPED_TABLES) {
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const rows = await database.select({ orgId: handle.column }).from(handle.table).where(eq(handle.column, orgId))
    if (rows.length > 0) tables[entry.table] = rows.length
  }

  const parents = await loadParentIds(database, orgId)
  for (const entry of PARENT_KEYED_TABLES) {
    const handle = tableHandle(entry.schemaKey, entry.column)
    if (!handle) continue
    const ids = parents[entry.parentSchemaKey] ?? []
    let count = 0
    for (const chunk of chunkIds(ids)) {
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(inArray(handle.column, chunk))
      count += rows.length
    }
    if (count > 0) tables[entry.table] = (tables[entry.table] ?? 0) + count
  }

  const contactIds = (parents.contacts ?? []) as string[]
  for (const entry of CONTACT_REFERENCE_COLUMNS) {
    // Rows on a table that is already swept by org_id are counted there.
    if (ORG_SCOPED_TABLES.some((row) => row.table === entry.table)) continue
    if (PARENT_KEYED_TABLES.some((row) => row.table === entry.table)) continue
    const handle = tableHandle(entry.schemaKey, entry.column)
    if (!handle) continue
    let count = 0
    for (const chunk of chunkIds(contactIds)) {
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(inArray(handle.column, chunk))
      count += rows.length
    }
    if (count > 0) tables[entry.table] = (tables[entry.table] ?? 0) + count
  }

  const invoices: InvoiceLine[] = invoiceRows.map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    totalUsd: row.totalUsd,
    currency: row.currency,
    createdAt: row.createdAt,
    stripeInvoiceId: row.stripeInvoiceId,
    xeroInvoiceId: row.xeroInvoiceId,
  }))

  const warnings: string[] = [
    'This is irreversible. Archive is the reversible answer and is right for anything uncertain.',
    'Nothing here sends email. No invite, notification or digest is raised by a delete.',
  ]
  if (org.stripeCustomerId) {
    warnings.push(
      `${org.name} carries a Stripe customer id (${org.stripeCustomerId}). That alone is not a refusal, because a test-mode customer looks exactly like a live one, but the customer stays in Stripe: delete it there too if it is not wanted.`,
    )
  }
  if (invoices.length > 0) {
    warnings.push(`${invoices.length} invoice(s) and their line items go with this client. Read the list before confirming.`)
  }
  if (org.clerkOrgId && orgClerkState === 'gone') {
    warnings.push(
      `Clerk organisation ${org.clerkOrgId} no longer exists, id treated as stale. The stored clerk_org_id refuses nothing.`,
    )
  }
  if (staleContactEmails.length > 0) {
    warnings.push(
      `${staleContactEmails.length} stored login(s) no longer exist in Clerk and were treated as stale: ${staleContactEmails.join(', ')}.`,
    )
  }
  if (loginRefusalsWaived && org.clerkOrgId) {
    warnings.push(
      `The Clerk organisation ${org.clerkOrgId} is deleted first, and only then the database rows. Everyone signed into it loses that workspace: ${accidental.contactEmails.join(', ') || 'no contact addresses'}.`,
    )
  }

  const plan: OrgDeletePlan = {
    dryRun: input.dryRun,
    org: { id: org.id, name: org.name, status: org.status },
    tables,
    invoices,
    stripeCustomerId: org.stripeCustomerId,
    xeroContactId: org.xeroContactId,
    accidentalWorkspace: accidental,
    warnings,
    applied: { rowsDeleted: 0, invoicesDeleted: 0, orgsDeleted: 0 },
  }

  if (input.dryRun) return plan

  // Clerk FIRST. If it refuses for anything other than "already gone" the run
  // stops here, with the organisation and its rows untouched: an orphaned D1
  // row is recoverable, a Clerk workspace with no client behind it is not.
  if (loginRefusalsWaived && org.clerkOrgId) {
    const deleter = input.deleteClerkOrganisation
    if (!deleter) {
      throw new ClerkOrganisationDeleteFailed(org.clerkOrgId, 'No Clerk deleter was supplied to runOrgDelete.')
    }
    try {
      accidental.clerkResult = await deleter(org.clerkOrgId)
    } catch (error) {
      throw new ClerkOrganisationDeleteFailed(org.clerkOrgId, error)
    }
  }

  plan.applied.rowsDeleted = await deleteOrgTree(database, orgId, parents)
  plan.applied.invoicesDeleted = invoices.length
  plan.applied.orgsDeleted = 1
  return plan
}

/**
 * Every contact at the organisation carrying a non-empty clerk_user_id, with
 * that id, so each one can be checked against Clerk before it refuses.
 */
async function contactsWithClerkIds(
  database: DB,
  orgId: string,
): Promise<Array<{ id: string; name: string; email: string; clerkUserId: string }>> {
  const rows = await database
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      clerkUserId: schema.contacts.clerkUserId,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
  return rows
    .filter((row) => typeof row.clerkUserId === 'string' && row.clerkUserId.trim() !== '')
    .map((row) => ({ id: row.id, name: row.name, email: row.email, clerkUserId: String(row.clerkUserId) }))
}

// ── the accidental workspace ─────────────────────────────────────────────────

interface AccidentalInput {
  requested: boolean
  name: string
  clerkOrgId: string | null
  manyrequestsId: string | null
  stripeCustomerId: string | null
  xeroContactId: string | null
  linkedContacts: Array<{ id: string; name: string; email: string }>
  invoiceCount: number
  /** The pipeline tables holding rows, already named, or an empty string. */
  pipelineNamed: string
}

interface Assessment {
  workspace: AccidentalWorkspace
  /** The reasons the ordinary refusal list does not already state. */
  novelReasons: string[]
}

/**
 * The eligibility rule, checked before anything is written:
 *
 *   a. the caller is a super admin  (enforced at the route, not here),
 *   b. the Clerk organisation is not NEXT_PUBLIC_TAHI_ORG_ID,
 *   c. every contact carrying a clerk_user_id has an email matching a
 *      team_members row, case-insensitively, so the only logins attached
 *      belong to Tahi staff,
 *   d. no invoice, no Stripe customer or Xero contact id, no ManyRequests id
 *      and none of the pipeline rows the ordinary delete refuses over.
 */
async function assessAccidentalWorkspace(database: DB, input: AccidentalInput): Promise<Assessment> {
  const staffRows = await database.select({ email: schema.teamMembers.email }).from(schema.teamMembers)
  const staffEmails = new Set(staffRows.map((row) => normaliseEmail(row.email)).filter((value) => value !== ''))

  const contactEmails = input.linkedContacts.map((row) => row.email)
  const teamEmails = contactEmails.filter((email) => staffEmails.has(normaliseEmail(email)))
  const outsiders = contactEmails.filter((email) => !staffEmails.has(normaliseEmail(email)))

  const reasons: string[] = []
  const novelReasons: string[] = []
  const add = (sentence: string, novel: boolean) => {
    reasons.push(sentence)
    if (novel) novelReasons.push(sentence)
  }

  const studioOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? ''
  if (input.clerkOrgId && studioOrgId && input.clerkOrgId === studioOrgId) {
    add(
      `${input.name} is linked to the Tahi Studio Clerk organisation (${input.clerkOrgId}). The studio organisation is never deletable, by any route, for any reason.`,
      true,
    )
  }
  if (outsiders.length > 0) {
    add(
      `${outsiders.length} login(s) on ${input.name} do not belong to a Tahi team member (${outsiders.join(', ')}). An accidental workspace only ever carries staff logins, so this is somebody's real client.`,
      true,
    )
  }
  if (input.invoiceCount > 0) {
    add(
      `${input.name} holds ${input.invoiceCount} invoice(s). An accidental workspace has no ledger at all, so removing its Clerk organisation is refused.`,
      true,
    )
  }
  const railIds = [
    input.stripeCustomerId ? `Stripe customer ${input.stripeCustomerId}` : null,
    input.xeroContactId ? `Xero contact ${input.xeroContactId}` : null,
  ].filter((value): value is string => value !== null)
  if (railIds.length > 0) {
    add(
      `${input.name} carries a paid rail id (${railIds.join(', ')}). An accidental workspace was never billed, so removing its Clerk organisation is refused.`,
      true,
    )
  }
  if (input.manyrequestsId) {
    add(`${input.name} carries a ManyRequests id (${input.manyrequestsId}), so the import adopted it as a real client.`, false)
  }
  if (input.pipelineNamed) {
    add(`${input.name} holds pipeline and sales rows: ${input.pipelineNamed}.`, false)
  }

  return {
    workspace: {
      requested: input.requested,
      eligible: reasons.length === 0,
      reasons,
      clerkOrgId: input.clerkOrgId,
      contactEmails,
      teamEmails,
      clerkResult: null,
    },
    novelReasons,
  }
}

// ── the sweep ────────────────────────────────────────────────────────────────

type ParentIds = Record<string, string[]>

/**
 * The ids of every parent whose children are keyed on it rather than on the
 * org. Read once, used by both the count and the delete, so the dry run and
 * the apply cannot describe different row sets.
 */
async function loadParentIds(database: DB, orgId: string): Promise<ParentIds> {
  const out: ParentIds = {}
  const parentKeys = Array.from(new Set(PARENT_KEYED_TABLES.map((entry) => entry.parentSchemaKey)))
  for (const key of [...parentKeys, 'contacts']) {
    const handle = orgTableHandle(key)
    const idHandle = tableHandle(key, 'id')
    if (!handle || !idHandle) {
      // subscriptions is org-scoped so it lands above; tracks hang off it and
      // never carry an org_id of their own.
      out[key] = []
      continue
    }
    const rows = await database.select({ id: idHandle.column }).from(handle.table).where(eq(handle.column, orgId))
    out[key] = rows.map((row) => String(row.id))
  }
  return out
}

/**
 * Children first, in dependency order, then the organisation. Every step is
 * explicit: the schema declares ON DELETE CASCADE on most of these, but SQLite
 * only enforces a foreign key when PRAGMA foreign_keys is on and D1 does not
 * guarantee that per statement, so relying on the cascade leaves orphan rows
 * pointing at an org that no longer exists.
 */
async function deleteOrgTree(database: DB, orgId: string, parents: ParentIds): Promise<number> {
  let deleted = 0

  // 1. Rows keyed on a request, a task, a conversation, a message, an
  //    invoice, a subscription or a brand. These cannot be seen by an org_id
  //    sweep, so they go first or they are orphaned.
  for (const entry of PARENT_KEYED_TABLES) {
    const handle = tableHandle(entry.schemaKey, entry.column)
    if (!handle) continue
    const ids = parents[entry.parentSchemaKey] ?? []
    for (const chunk of chunkIds(ids)) {
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(inArray(handle.column, chunk))
      if (rows.length === 0) continue
      await database.delete(handle.table).where(inArray(handle.column, chunk))
      deleted += rows.length
    }
  }

  // 2. Rows keyed on one of this org's contacts and living on a table the
  //    org_id sweep does not reach (notifications, notification preferences,
  //    mentions).
  const contactIds = parents.contacts ?? []
  for (const entry of CONTACT_REFERENCE_COLUMNS) {
    if (ORG_SCOPED_TABLES.some((row) => row.table === entry.table)) continue
    if (PARENT_KEYED_TABLES.some((row) => row.table === entry.table)) continue
    const handle = tableHandle(entry.schemaKey, entry.column)
    if (!handle) continue
    for (const chunk of chunkIds(contactIds)) {
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(inArray(handle.column, chunk))
      if (rows.length === 0) continue
      await database.delete(handle.table).where(inArray(handle.column, chunk))
      deleted += rows.length
    }
  }

  // 3. The portal-visibility rules written against this org and its people.
  await database
    .delete(schema.featureVisibility)
    .where(and(eq(schema.featureVisibility.subjectType, 'organisation'), eq(schema.featureVisibility.subjectId, orgId)))
  for (const chunk of chunkIds(contactIds)) {
    await database
      .delete(schema.featureVisibility)
      .where(and(eq(schema.featureVisibility.subjectType, 'contact'), inArray(schema.featureVisibility.subjectId, chunk)))
  }

  // 4. Every org-scoped table. ALL of them, not only the ones the import
  //    cleanup marks 'delete': the refusals above have already proved this row
  //    holds no pipeline or sales artefact, and invoices, subscriptions,
  //    projects, client costs, private services and case studies are exactly
  //    the test rows this endpoint exists to clear.
  for (const entry of ORG_SCOPED_TABLES) {
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const rows = await database.select({ orgId: handle.column }).from(handle.table).where(eq(handle.column, orgId))
    if (rows.length === 0) continue
    await database.delete(handle.table).where(eq(handle.column, orgId))
    deleted += rows.length
  }

  await database.delete(schema.organisations).where(eq(schema.organisations.id, orgId))
  deleted += 1
  return deleted
}

/**
 * Leads that were promoted into a deal on this organisation. Counted, never
 * deleted: the refusal fires the moment one exists.
 */
async function countLeadsBehindDeals(database: DB, orgId: string): Promise<number> {
  const deals = await database.select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.orgId, orgId))
  const dealIds = deals.map((row) => row.id)
  let count = 0
  for (const chunk of chunkIds(dealIds)) {
    const rows = await database
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(inArray(schema.leads.promotedDealId, chunk))
    count += rows.length
  }
  return count
}
