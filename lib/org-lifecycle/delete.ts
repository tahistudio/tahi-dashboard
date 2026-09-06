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
 *   3. no clerk_org_id (a real login exists against it),
 *   4. no contact carrying a clerk_user_id (a real person can sign in),
 *   5. no pipeline or sales artefact: a deal, a lead behind one, a CRM
 *      activity, a discovery call, a contract, a contract document, a
 *      proposal, a project schedule or a project calculation,
 *   6. no REAL LEDGER: an invoice carrying a paid Stripe or Xero id while the
 *      organisation also carries a Xero contact id. A Stripe customer id on
 *      its own does NOT refuse, because a test-mode customer looks exactly
 *      like a live one; the dry run prints it, and every invoice's rail id,
 *      amount and date, so the operator sees what goes.
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
import { contactsWithLogins } from './merge'
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
  warnings: string[]
  applied: { rowsDeleted: number; invoicesDeleted: number; orgsDeleted: number }
}

export class OrgDeleteRefusal extends Error {
  readonly refusals: string[]
  constructor(refusals: string[]) {
    super(refusals[0] ?? 'Delete refused.')
    this.name = 'OrgDeleteRefusal'
    this.refusals = refusals
  }
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
  if (org.clerkOrgId) {
    refusals.push(
      `${org.name} carries a Clerk organisation id (${org.clerkOrgId}), which means a real login exists against it. Archive it instead.`,
    )
  }

  const linkedContacts = await contactsWithLogins(database, orgId)
  if (linkedContacts.length > 0) {
    refusals.push(
      `${linkedContacts.length} contact(s) on ${org.name} can sign in to the portal (${linkedContacts.map((row) => row.email).join(', ')}). A real person is attached to this client. Archive it instead.`,
    )
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

  if (Object.keys(pipelineCounts).length > 0) {
    const named = Object.entries(pipelineCounts)
      .map(([table, count]) => `${table} (${count})`)
      .join(', ')
    refusals.push(
      `${org.name} holds pipeline and sales rows this endpoint will never delete: ${named}. Pipeline and sales artefacts are always real.`,
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

  if (refusals.length > 0) throw new OrgDeleteRefusal(refusals)

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

  const plan: OrgDeletePlan = {
    dryRun: input.dryRun,
    org: { id: org.id, name: org.name, status: org.status },
    tables,
    invoices,
    stripeCustomerId: org.stripeCustomerId,
    xeroContactId: org.xeroContactId,
    warnings,
    applied: { rowsDeleted: 0, invoicesDeleted: 0, orgsDeleted: 0 },
  }

  if (input.dryRun) return plan

  plan.applied.rowsDeleted = await deleteOrgTree(database, orgId, parents)
  plan.applied.invoicesDeleted = invoices.length
  plan.applied.orgsDeleted = 1
  return plan
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
