/**
 * lib/org-lifecycle/merge.ts
 *
 * Fold one organisation (the SHELL) into another (the SURVIVOR).
 *
 * The studio came out of the ManyRequests import with duplicate rows sitting
 * next to the real client: a "Charles Bilash (DUPLICATE, do not use)" holding
 * the real client's Xero contact id and one of their invoices, three
 * Stripe-import "Evan Kwan" shells holding Physitrack's Stripe customer id,
 * two "Tara Winery" rows. Archiving a shell hides it; it does not give the
 * real client back their ledger. This does.
 *
 * NOTHING IS DESTROYED. Every row moves. The only row removed is the shell
 * organisation itself, plus a shell CONTACT whose email already exists on the
 * survivor (its references are re-pointed onto the surviving person first, so
 * the history moves with them rather than dying with the duplicate row).
 *
 * The four external ids (xero_contact_id, stripe_customer_id, manyrequests_id,
 * clerk_org_id) are carried ONLY into an empty field. When both sides hold a
 * different non-null value the merge is REFUSED and the field is named: an
 * external id is the studio's join to somebody else's system and overwriting
 * one silently re-points a ledger.
 *
 * This module writes D1 directly. It imports no route, no mailer, no
 * notification helper and no Clerk: a merge cannot put a message in anyone's
 * inbox, which is the standing rule for every operation in this family.
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { isProtectedOrg } from '@/lib/import/manyrequests/cleanup'
import {
  CONTACT_REFERENCE_COLUMNS,
  ORG_SCOPED_TABLES,
  chunkIds,
  contactRefKey,
  orgTableHandle,
  tableHandle,
  type DynamicUpdate,
} from './refs'

// ── shapes ───────────────────────────────────────────────────────────────────

/** One external id and what the merge would do with it. */
export interface ExternalIdPlan {
  /** The organisations column, e.g. 'xero_contact_id'. */
  field: string
  shellValue: string | null
  survivorValue: string | null
  carried: boolean
  note: string
}

/** One organisation column the survivor would take from the shell. */
export interface ColumnFillPlan {
  field: string
  value: string
  note: string
}

export interface ContactMovePlan {
  id: string
  name: string
  email: string
}

export interface ContactFoldPlan {
  id: string
  name: string
  email: string
  /** The surviving contact its references are re-pointed at. */
  intoContactId: string
}

export interface OrgMergePlan {
  dryRun: boolean
  shell: { id: string; name: string }
  survivor: { id: string; name: string }
  /** SQL table name -> rows that carry the shell's org_id today. */
  tables: Record<string, number>
  externalIds: ExternalIdPlan[]
  columns: ColumnFillPlan[]
  contacts: {
    moved: ContactMovePlan[]
    folded: ContactFoldPlan[]
    /** "table.column" -> rows re-pointed off a folded contact. */
    references: Record<string, number>
  }
  warnings: string[]
  applied: {
    rowsMoved: number
    contactsMoved: number
    contactsFolded: number
    contactReferencesRepointed: number
    orgsRemoved: number
  }
}

/** A refusal, thrown so the route can answer 400 with the sentence. */
export class OrgMergeRefusal extends Error {
  readonly refusals: string[]
  constructor(refusals: string[]) {
    super(refusals[0] ?? 'Merge refused.')
    this.name = 'OrgMergeRefusal'
    this.refusals = refusals
  }
}

/** No shell with that id. Thrown so a repeated merge answers 404, not 500. */
export class OrgNotFound extends Error {
  constructor(public readonly orgId: string) {
    super('No organisation with that id.')
    this.name = 'OrgNotFound'
  }
}

interface OrgRow {
  id: string
  name: string
  status: string | null
  website: string | null
  industry: string | null
  accentColour: string | null
  planType: string | null
  internalNotes: string | null
  xeroContactId: string | null
  stripeCustomerId: string | null
  manyrequestsId: string | null
  clerkOrgId: string | null
}

const ORG_COLUMNS = {
  id: schema.organisations.id,
  name: schema.organisations.name,
  status: schema.organisations.status,
  website: schema.organisations.website,
  industry: schema.organisations.industry,
  accentColour: schema.organisations.accentColour,
  planType: schema.organisations.planType,
  internalNotes: schema.organisations.internalNotes,
  xeroContactId: schema.organisations.xeroContactId,
  stripeCustomerId: schema.organisations.stripeCustomerId,
  manyrequestsId: schema.organisations.manyrequestsId,
  clerkOrgId: schema.organisations.clerkOrgId,
}

/**
 * The four joins to somebody else's system. `column` is what the plan and the
 * audit row name, because that is the identifier a human recognises when they
 * go and look in Xero or Stripe.
 */
const EXTERNAL_ID_FIELDS: ReadonlyArray<{ key: keyof OrgRow; column: string; property: string }> = [
  { key: 'xeroContactId', column: 'xero_contact_id', property: 'xeroContactId' },
  { key: 'stripeCustomerId', column: 'stripe_customer_id', property: 'stripeCustomerId' },
  { key: 'manyrequestsId', column: 'manyrequests_id', property: 'manyrequestsId' },
  { key: 'clerkOrgId', column: 'clerk_org_id', property: 'clerkOrgId' },
]

/** A plan type that means "no plan chosen", so the shell's may fill it. */
function planIsEmpty(value: string | null): boolean {
  return !value || value === 'none'
}

function isEmpty(value: string | null): boolean {
  return value === null || value === undefined || value.trim() === ''
}

// ── the plan ─────────────────────────────────────────────────────────────────

export interface OrgMergeInput {
  shellId: string
  survivorId: string
  dryRun: boolean
}

/**
 * Build the plan and, unless this is a dry run, apply it. One function answers
 * both modes so what the dry run shows is exactly what the apply does.
 */
export async function runOrgMerge(database: DB, input: OrgMergeInput): Promise<OrgMergePlan> {
  const { shellId, survivorId } = input

  if (shellId === survivorId) {
    throw new OrgMergeRefusal(['An organisation cannot be merged into itself.'])
  }

  const rows = (await database
    .select(ORG_COLUMNS)
    .from(schema.organisations)
    .where(or(eq(schema.organisations.id, shellId), eq(schema.organisations.id, survivorId)))) as OrgRow[]

  const shell = rows.find((row) => row.id === shellId)
  const survivor = rows.find((row) => row.id === survivorId)

  // Idempotency: a shell that has already been merged is simply gone, and the
  // route turns this into a 404 rather than a 500 or a silent success.
  if (!shell) throw new OrgNotFound(shellId)

  const refusals: string[] = []
  if (!survivor) {
    refusals.push('No organisation with that id to merge into.')
  } else if (survivor.status === 'archived') {
    refusals.push(
      `${survivor.name} is archived. Unarchive it first: merging into an archived client hides the rows that were just moved.`,
    )
  }
  if (isProtectedOrg(shellId)) {
    refusals.push('That organisation is protected (the QA client or the internal studio marker) and is never merged away.')
  }
  if (refusals.length > 0) throw new OrgMergeRefusal(refusals)
  if (!survivor) throw new OrgMergeRefusal(['No organisation with that id to merge into.'])

  // ── external ids ───────────────────────────────────────────────────────
  const externalIds: ExternalIdPlan[] = []
  for (const field of EXTERNAL_ID_FIELDS) {
    const shellValue = (shell[field.key] as string | null) ?? null
    const survivorValue = (survivor[field.key] as string | null) ?? null
    if (shellValue && survivorValue && shellValue !== survivorValue) {
      refusals.push(
        `Both organisations carry a different ${field.column} (${shell.name}: ${shellValue}, ${survivor.name}: ${survivorValue}). An external id is a join to somebody else's system and this never overwrites one. Clear the wrong one by hand first.`,
      )
      continue
    }
    externalIds.push({
      field: field.column,
      shellValue,
      survivorValue,
      carried: Boolean(shellValue) && !survivorValue,
      note: !shellValue
        ? 'The shell holds none.'
        : survivorValue
          ? 'The survivor already holds the same value.'
          : `Carried onto ${survivor.name}.`,
    })
  }
  if (refusals.length > 0) throw new OrgMergeRefusal(refusals)

  // ── organisation columns filled from the shell ─────────────────────────
  const columns: ColumnFillPlan[] = []
  const orgPatch: Record<string, unknown> = {}

  if (isEmpty(survivor.website) && !isEmpty(shell.website)) {
    columns.push({ field: 'website', value: shell.website as string, note: 'The survivor has none.' })
    orgPatch.website = shell.website
  }
  if (isEmpty(survivor.industry) && !isEmpty(shell.industry)) {
    columns.push({ field: 'industry', value: shell.industry as string, note: 'The survivor has none.' })
    orgPatch.industry = shell.industry
  }
  if (isEmpty(survivor.accentColour) && !isEmpty(shell.accentColour)) {
    columns.push({ field: 'accent_colour', value: shell.accentColour as string, note: 'The survivor has none.' })
    orgPatch.accentColour = shell.accentColour
  }
  if (planIsEmpty(survivor.planType) && !planIsEmpty(shell.planType)) {
    columns.push({ field: 'plan_type', value: shell.planType as string, note: 'The survivor has no plan.' })
    orgPatch.planType = shell.planType
  }
  if (!isEmpty(shell.internalNotes)) {
    const appended = isEmpty(survivor.internalNotes)
      ? (shell.internalNotes as string)
      : `${survivor.internalNotes}\n\nMerged from ${shell.name}:\n${shell.internalNotes}`
    columns.push({
      field: 'internal_notes',
      value: shell.internalNotes as string,
      note: isEmpty(survivor.internalNotes) ? 'The survivor has none.' : 'Appended under a "Merged from" heading.',
    })
    orgPatch.internalNotes = appended
  }

  // custom_mrr and billing_model live in D1 via migration 0016 but are NOT on
  // the Drizzle schema (SELECT * would crash a pre-migration environment), so
  // they are read and written with raw SQL, guarded exactly like the client
  // PATCH route guards them.
  const billingFill = await planBillingFill(database, shell.id, survivor.id)
  for (const entry of billingFill.columns) columns.push(entry)

  // ── org-scoped tables ──────────────────────────────────────────────────
  const tables: Record<string, number> = {}
  for (const entry of ORG_SCOPED_TABLES) {
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    const found = await database.select({ orgId: handle.column }).from(handle.table).where(eq(handle.column, shellId))
    if (found.length > 0) tables[entry.table] = found.length
  }

  // ── contacts ───────────────────────────────────────────────────────────
  const contactPlan = await planContacts(database, shellId, survivorId)

  // ── warnings ───────────────────────────────────────────────────────────
  const warnings: string[] = []
  const numberClash = await countRequestNumberClashes(database, shellId, survivorId)
  if (numberClash > 0) {
    warnings.push(
      `${numberClash} request number(s) are used on both clients. Requests keep the number they were filed under, so two of them will display the same #. Nothing is renumbered.`,
    )
  }
  if (contactPlan.channelFold) {
    warnings.push(
      'Both clients have an org message channel. The shell channel\'s messages and participants move into the survivor\'s channel and the empty shell channel row is removed, because one channel per client is a unique index.',
    )
  }
  warnings.push('Nothing here sends email. No invite, notification or digest is raised by a merge.')

  const plan: OrgMergePlan = {
    dryRun: input.dryRun,
    shell: { id: shell.id, name: shell.name },
    survivor: { id: survivor.id, name: survivor.name },
    tables,
    externalIds,
    columns,
    contacts: {
      moved: contactPlan.moved,
      folded: contactPlan.folded.map((row) => ({ id: row.id, name: row.name, email: row.email, intoContactId: row.intoContactId })),
      references: contactPlan.references,
    },
    warnings,
    applied: { rowsMoved: 0, contactsMoved: 0, contactsFolded: 0, contactReferencesRepointed: 0, orgsRemoved: 0 },
  }

  if (input.dryRun) return plan

  // ── apply ──────────────────────────────────────────────────────────────
  // Order matters and is not arbitrary:
  //   1. the org message channel, which is a unique index on (org_id) and
  //      would abort the sweep below,
  //   2. every org_id column, which is the bulk of the move,
  //   3. the contacts, which re-point onto the surviving person,
  //   4. the shell organisation row, which frees the unique indexes on
  //      clerk_org_id and manyrequests_id,
  //   5. the survivor's own columns, which is where those ids land.
  // D1 gives no cross-statement transaction, so the carried ids are written
  // into the audit row by the caller: if step 5 fails they are recoverable
  // from the log rather than only from a backup.
  if (contactPlan.channelFold) {
    await foldOrgChannel(database, contactPlan.channelFold)
  }

  for (const entry of ORG_SCOPED_TABLES) {
    if (entry.schemaKey === 'contacts') continue // handled below, with the folds
    const count = tables[entry.table] ?? 0
    if (count === 0) continue
    const handle = orgTableHandle(entry.schemaKey)
    if (!handle) continue
    if (entry.schemaKey === 'teamMemberAccessOrgs') {
      await dedupeAccessOrgs(database, shellId, survivorId)
    }
    // Every org-scoped table spells the column `orgId` on the Drizzle schema,
    // which the static test over db/schema.ts keeps true.
    await (database.update(handle.table) as unknown as DynamicUpdate)
      .set({ orgId: survivorId })
      .where(eq(handle.column, shellId))
    plan.applied.rowsMoved += count
  }

  const contactResult = await applyContacts(database, contactPlan, survivorId)
  plan.applied.contactsMoved = contactResult.moved
  plan.applied.contactsFolded = contactResult.folded
  plan.applied.contactReferencesRepointed = contactResult.repointed
  plan.applied.rowsMoved += contactResult.moved

  // The shell's own portal-visibility rules describe a row that is about to
  // stop existing. They are removed rather than carried: re-pointing them
  // would silently rewrite the SURVIVOR's portal permissions, which nobody
  // asked for and which the permissions builder is the place to change.
  await database
    .delete(schema.featureVisibility)
    .where(and(eq(schema.featureVisibility.subjectType, 'organisation'), eq(schema.featureVisibility.subjectId, shellId)))

  await database.delete(schema.organisations).where(eq(schema.organisations.id, shellId))
  plan.applied.orgsRemoved = 1

  const now = new Date().toISOString()
  const survivorPatch: Record<string, unknown> = { ...orgPatch, updatedAt: now }
  for (const field of EXTERNAL_ID_FIELDS) {
    const entry = externalIds.find((row) => row.field === field.column)
    if (entry?.carried) survivorPatch[field.property] = entry.shellValue
  }
  await (database.update(schema.organisations) as unknown as DynamicUpdate)
    .set(survivorPatch)
    .where(eq(schema.organisations.id, survivorId))

  await applyBillingFill(database, survivorId, billingFill.patch)

  return plan
}

// ── billing columns that live outside the Drizzle schema ─────────────────────

interface BillingFill {
  columns: ColumnFillPlan[]
  patch: Record<string, string | number | null>
}

/**
 * custom_mrr / custom_mrr_currency / billing_model exist in D1 (migration
 * 0016) but not on the Drizzle schema, so they are read with raw SQL and the
 * whole read is guarded: a pre-0016 environment, or a unit-test double with no
 * `.all`, simply contributes nothing rather than failing the merge.
 */
async function planBillingFill(database: DB, shellId: string, survivorId: string): Promise<BillingFill> {
  const columns: ColumnFillPlan[] = []
  const patch: Record<string, string | number | null> = {}
  try {
    const rows = await database.all<{
      id: string
      custom_mrr: number | null
      custom_mrr_currency: string | null
      billing_model: string | null
    }>(
      sql`SELECT id, custom_mrr, custom_mrr_currency, billing_model FROM organisations WHERE id IN (${shellId}, ${survivorId})`,
    )
    const shell = rows?.find((row) => row.id === shellId)
    const survivor = rows?.find((row) => row.id === survivorId)
    if (!shell || !survivor) return { columns, patch }
    if (survivor.custom_mrr == null && shell.custom_mrr != null) {
      columns.push({ field: 'custom_mrr', value: String(shell.custom_mrr), note: 'The survivor has none.' })
      patch.custom_mrr = shell.custom_mrr
      if (shell.custom_mrr_currency) patch.custom_mrr_currency = shell.custom_mrr_currency
    }
    if (!survivor.billing_model && shell.billing_model) {
      columns.push({ field: 'billing_model', value: shell.billing_model, note: 'The survivor has none.' })
      patch.billing_model = shell.billing_model
    }
  } catch {
    // Pre-migration-0016, or a test double with no raw-SQL surface.
  }
  return { columns, patch }
}

async function applyBillingFill(database: DB, survivorId: string, patch: Record<string, string | number | null>): Promise<void> {
  for (const [column, value] of Object.entries(patch)) {
    try {
      await database.run(sql`UPDATE organisations SET ${sql.raw(column)} = ${value} WHERE id = ${survivorId}`)
    } catch {
      // Column does not exist yet. Skipped, exactly like the client PATCH route.
    }
  }
}

// ── request numbers ──────────────────────────────────────────────────────────

/**
 * How many request numbers appear on BOTH clients. requests.request_number is
 * minted per organisation (MAX + 1 over that org's rows) with no unique index,
 * so a merge legitimately produces two requests displaying #004. Nothing is
 * renumbered: a request number is quoted in email threads and invoices. The
 * dry run says so instead.
 */
async function countRequestNumberClashes(database: DB, shellId: string, survivorId: string): Promise<number> {
  const [shellRows, survivorRows] = await Promise.all([
    database.select({ n: schema.requests.requestNumber }).from(schema.requests).where(eq(schema.requests.orgId, shellId)),
    database.select({ n: schema.requests.requestNumber }).from(schema.requests).where(eq(schema.requests.orgId, survivorId)),
  ])
  const survivorNumbers = new Set(survivorRows.map((row) => row.n).filter((n): n is number => n != null))
  return shellRows.filter((row) => row.n != null && survivorNumbers.has(row.n)).length
}

// ── contacts ─────────────────────────────────────────────────────────────────

interface ContactRow {
  id: string
  name: string
  email: string
}

interface ChannelFold {
  shellConversationId: string
  survivorConversationId: string
}

interface ContactPlanning {
  moved: ContactMovePlan[]
  folded: Array<ContactFoldPlan & { name: string }>
  references: Record<string, number>
  channelFold: ChannelFold | null
}

/** Case-insensitive, trimmed. The same key the importer matches contacts on. */
function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

async function planContacts(database: DB, shellId: string, survivorId: string): Promise<ContactPlanning> {
  const [shellContacts, survivorContacts] = (await Promise.all([
    database
      .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, shellId)),
    database
      .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, survivorId)),
  ])) as [ContactRow[], ContactRow[]]

  const survivorByEmail = new Map(survivorContacts.map((row) => [emailKey(row.email ?? ''), row]))

  const moved: ContactMovePlan[] = []
  const folded: Array<ContactFoldPlan & { name: string }> = []
  for (const contact of shellContacts) {
    const match = survivorByEmail.get(emailKey(contact.email ?? ''))
    if (match) folded.push({ id: contact.id, name: contact.name, email: contact.email, intoContactId: match.id })
    else moved.push({ id: contact.id, name: contact.name, email: contact.email })
  }

  const references: Record<string, number> = {}
  const foldedIds = folded.map((row) => row.id)
  for (const entry of CONTACT_REFERENCE_COLUMNS) {
    const handle = tableHandle(entry.schemaKey, entry.column)
    if (!handle) continue
    let count = 0
    for (const chunk of chunkIds(foldedIds)) {
      const where = entry.typeColumn
        ? and(inArray(handle.column, chunk), typePredicate(entry.schemaKey, entry.typeColumn, entry.typeValue as string))
        : inArray(handle.column, chunk)
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(where as SQL)
      count += rows.length
    }
    if (count > 0) references[contactRefKey(entry)] = count
  }

  return { moved, folded, references, channelFold: await planChannelFold(database, shellId, survivorId) }
}

/**
 * The type predicate for a dual-identity column. Null when the schema in play
 * has no such column (a test double), in which case the id match alone stands,
 * which is the same answer for a uuid namespace that does not collide.
 */
function typePredicate(schemaKey: string, typeColumn: string, typeValue: string): SQL | undefined {
  const handle = tableHandle(schemaKey, typeColumn)
  if (!handle) return undefined
  return eq(handle.column, typeValue)
}

/**
 * conversations carries a UNIQUE partial index on (org_id) WHERE type =
 * 'org_channel' (migration 0092). Re-pointing a shell channel at a survivor
 * that already has one aborts the whole statement, so the two channels are
 * folded instead: the shell's messages and participants move onto the
 * survivor's channel and the emptied shell row goes.
 */
async function planChannelFold(database: DB, shellId: string, survivorId: string): Promise<ChannelFold | null> {
  const [shellChannels, survivorChannels] = await Promise.all([
    database
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.orgId, shellId), eq(schema.conversations.type, 'org_channel'))),
    database
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.orgId, survivorId), eq(schema.conversations.type, 'org_channel'))),
  ])
  if (shellChannels.length === 0 || survivorChannels.length === 0) return null
  return { shellConversationId: shellChannels[0].id, survivorConversationId: survivorChannels[0].id }
}

async function foldOrgChannel(database: DB, fold: ChannelFold): Promise<void> {
  await database
    .update(schema.messages)
    .set({ conversationId: fold.survivorConversationId })
    .where(eq(schema.messages.conversationId, fold.shellConversationId))

  // One participant row per person per room is a unique index, so anybody
  // already in the survivor's channel loses their duplicate shell row rather
  // than aborting the move.
  const survivorParticipants = await database
    .select({ participantId: schema.conversationParticipants.participantId })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.conversationId, fold.survivorConversationId))
  const existing = survivorParticipants.map((row) => row.participantId)
  for (const chunk of chunkIds(existing)) {
    await database
      .delete(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, fold.shellConversationId),
          inArray(schema.conversationParticipants.participantId, chunk),
        ),
      )
  }
  await database
    .update(schema.conversationParticipants)
    .set({ conversationId: fold.survivorConversationId })
    .where(eq(schema.conversationParticipants.conversationId, fold.shellConversationId))

  await database.delete(schema.conversations).where(eq(schema.conversations.id, fold.shellConversationId))
}

/**
 * team_member_access_orgs is a join table with no unique index, so re-pointing
 * a shell row onto a survivor an access rule already names would list the
 * client twice for that person. The duplicate is dropped first.
 */
async function dedupeAccessOrgs(database: DB, shellId: string, survivorId: string): Promise<void> {
  const survivorRows = await database
    .select({ accessId: schema.teamMemberAccessOrgs.accessId })
    .from(schema.teamMemberAccessOrgs)
    .where(eq(schema.teamMemberAccessOrgs.orgId, survivorId))
  for (const chunk of chunkIds(survivorRows.map((row) => row.accessId))) {
    await database
      .delete(schema.teamMemberAccessOrgs)
      .where(and(eq(schema.teamMemberAccessOrgs.orgId, shellId), inArray(schema.teamMemberAccessOrgs.accessId, chunk)))
  }
}

async function applyContacts(
  database: DB,
  planning: ContactPlanning,
  survivorId: string,
): Promise<{ moved: number; folded: number; repointed: number }> {
  let repointed = 0

  for (const fold of planning.folded) {
    for (const entry of CONTACT_REFERENCE_COLUMNS) {
      const handle = tableHandle(entry.schemaKey, entry.column)
      if (!handle) continue

      // conversation_participants holds one row per person per room. Folding
      // two contacts who are both in the same room would violate that index,
      // so the duplicate goes before the rest are re-pointed.
      if (entry.schemaKey === 'conversationParticipants') {
        await dropDuplicateParticipants(database, fold.id, fold.intoContactId)
      }

      const where = entry.typeColumn
        ? and(eq(handle.column, fold.id), typePredicate(entry.schemaKey, entry.typeColumn, entry.typeValue as string))
        : eq(handle.column, fold.id)
      const rows = await database.select({ ref: handle.column }).from(handle.table).where(where as SQL)
      if (rows.length === 0) continue
      await (database.update(handle.table) as unknown as DynamicUpdate)
        .set({ [entry.column]: fold.intoContactId })
        .where(where)
      repointed += rows.length
    }

    // The duplicate person's own portal-visibility rules go with the row, for
    // the same reason the org's do: carrying them would rewrite the surviving
    // person's permissions without anyone choosing that.
    await database
      .delete(schema.featureVisibility)
      .where(and(eq(schema.featureVisibility.subjectType, 'contact'), eq(schema.featureVisibility.subjectId, fold.id)))

    await database.delete(schema.contacts).where(eq(schema.contacts.id, fold.id))
  }

  const movedIds = planning.moved.map((row) => row.id)
  for (const chunk of chunkIds(movedIds)) {
    await database
      .update(schema.contacts)
      .set({ orgId: survivorId, updatedAt: new Date().toISOString() })
      .where(inArray(schema.contacts.id, chunk))
  }

  return { moved: movedIds.length, folded: planning.folded.length, repointed }
}

async function dropDuplicateParticipants(database: DB, foldedContactId: string, survivorContactId: string): Promise<void> {
  const survivorRooms = await database
    .select({ conversationId: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(eq(schema.conversationParticipants.participantId, survivorContactId))
  for (const chunk of chunkIds(survivorRooms.map((row) => row.conversationId))) {
    await database
      .delete(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.participantId, foldedContactId),
          inArray(schema.conversationParticipants.conversationId, chunk),
        ),
      )
  }
}

/**
 * The org's contacts that carry a Clerk user id, i.e. a real person who can
 * sign in to the portal today. The delete refuses over these; filtered in JS
 * rather than in SQL because it is one small read either way and this keeps
 * the predicate readable.
 */
export async function contactsWithLogins(database: DB, orgId: string): Promise<ContactRow[]> {
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
    .map((row) => ({ id: row.id, name: row.name, email: row.email }))
}
