/**
 * lib/import/manyrequests/upsert.ts
 *
 * The write side: reads the D1 snapshot the planners need, applies a plan with
 * Drizzle directly, and takes the mail probe.
 *
 * EVERY WRITE IN THIS FILE IS A PLAIN INSERT, UPDATE OR DELETE. There is no
 * call to an API route, no createNotifications, no email dispatcher, no
 * request-status-effects, no domain event and no Clerk client anywhere in the
 * module graph rooted here, which is enforced by a static test. That is the
 * whole reason the importer exists as a library rather than as a caller of
 * POST /api/admin/clients: that route emails a portal invite BY DEFAULT
 * (`body.sendInvite !== false`, opt-out not opt-in), and PATCHing a request to
 * delivered or client_review fans an email out to every contact at the org.
 * Three more routes fetch the Resend endpoint directly and would not respect a
 * stubbed mailer, so "no routes at all" is the only sound rule.
 */

import { eq, inArray, sql } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import type {
  EntityCounts,
  EntityPlan,
  ImportEntity,
  MailProbe,
} from './types'
import type {
  ImportSnapshot,
  SnapshotContact,
  SnapshotInvoice,
  SnapshotInvoiceItem,
  SnapshotOrg,
  SnapshotRequest,
  SnapshotTeamMember,
} from './plan'

/** Rows per multi-row INSERT. SQLite caps bound variables at 999 and the
 *  widest row here is a request at roughly 25 columns, so 20 leaves headroom. */
const INSERT_BATCH = 20

// ── the snapshot ─────────────────────────────────────────────────────────────

/**
 * Read every D1 row the planners compare against.
 *
 * Only the matching and diffing columns are selected, never `select()`
 * unqualified: the tables this reads are small (59 organisations, 43 contacts,
 * 124 invoices) but `messages` grows to the full comment history after the
 * first run, and it only ever needs its id and its key.
 */
export async function readImportSnapshot(database: DB): Promise<ImportSnapshot> {
  const [
    orgs,
    contacts,
    teamMembers,
    roles,
    teamMemberRoles,
    brands,
    services,
    subscriptions,
    requests,
    messages,
    invoices,
    invoiceItems,
  ] = await Promise.all([
    database.select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      status: schema.organisations.status,
      manyrequestsId: schema.organisations.manyrequestsId,
      mrHoursRemaining: schema.organisations.mrHoursRemaining,
      mrHoursPurchased: schema.organisations.mrHoursPurchased,
    }).from(schema.organisations),
    database.select({
      id: schema.contacts.id,
      orgId: schema.contacts.orgId,
      name: schema.contacts.name,
      email: schema.contacts.email,
      isPrimary: schema.contacts.isPrimary,
      portalRole: schema.contacts.portalRole,
      clerkUserId: schema.contacts.clerkUserId,
      manyrequestsId: schema.contacts.manyrequestsId,
    }).from(schema.contacts),
    database.select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      title: schema.teamMembers.title,
      manyrequestsId: schema.teamMembers.manyrequestsId,
    }).from(schema.teamMembers),
    database.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles),
    database.select({
      id: schema.teamMemberRoles.id,
      teamMemberId: schema.teamMemberRoles.teamMemberId,
      roleId: schema.teamMemberRoles.roleId,
      endedAt: schema.teamMemberRoles.endedAt,
    }).from(schema.teamMemberRoles),
    database.select({
      id: schema.brands.id,
      orgId: schema.brands.orgId,
      name: schema.brands.name,
      manyrequestsId: schema.brands.manyrequestsId,
    }).from(schema.brands),
    database.select({
      id: schema.services.id,
      name: schema.services.name,
      manyrequestsId: schema.services.manyrequestsId,
      price: schema.services.price,
      currency: schema.services.currency,
      isRecurring: schema.services.isRecurring,
    }).from(schema.services),
    database.select({
      id: schema.subscriptions.id,
      orgId: schema.subscriptions.orgId,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
      billingInterval: schema.subscriptions.billingInterval,
      manyrequestsId: schema.subscriptions.manyrequestsId,
      mrServiceName: schema.subscriptions.mrServiceName,
      hoursPerPeriod: schema.subscriptions.hoursPerPeriod,
      creditsPerPeriod: schema.subscriptions.creditsPerPeriod,
      billedContactId: schema.subscriptions.billedContactId,
    }).from(schema.subscriptions),
    database.select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      status: schema.requests.status,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      requestNumber: schema.requests.requestNumber,
      dueDate: schema.requests.dueDate,
      deliveredAt: schema.requests.deliveredAt,
      estimatedHours: schema.requests.estimatedHours,
      brandId: schema.requests.brandId,
      description: schema.requests.description,
      formResponses: schema.requests.formResponses,
      submittedById: schema.requests.submittedById,
      submittedByType: schema.requests.submittedByType,
      manyrequestsId: schema.requests.manyrequestsId,
    }).from(schema.requests),
    database.select({
      id: schema.messages.id,
      manyrequestsId: schema.messages.manyrequestsId,
    }).from(schema.messages),
    database.select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      status: schema.invoices.status,
      currency: schema.invoices.currency,
      amountUsd: schema.invoices.amountUsd,
      totalUsd: schema.invoices.totalUsd,
      taxAmountUsd: schema.invoices.taxAmountUsd,
      discountAmountUsd: schema.invoices.discountAmountUsd,
      paidAt: schema.invoices.paidAt,
      source: schema.invoices.source,
      manyrequestsId: schema.invoices.manyrequestsId,
    }).from(schema.invoices),
    database.select({
      id: schema.invoiceItems.id,
      invoiceId: schema.invoiceItems.invoiceId,
      description: schema.invoiceItems.description,
      quantity: schema.invoiceItems.quantity,
      unitPriceUsd: schema.invoiceItems.unitPriceUsd,
      totalUsd: schema.invoiceItems.totalUsd,
      manyrequestsId: schema.invoiceItems.manyrequestsId,
    }).from(schema.invoiceItems),
  ])

  return {
    orgs: orgs as SnapshotOrg[],
    contacts: contacts as SnapshotContact[],
    teamMembers: teamMembers as SnapshotTeamMember[],
    roles,
    teamMemberRoles,
    brands,
    services,
    subscriptions,
    requests: requests as SnapshotRequest[],
    messages,
    invoices: invoices as SnapshotInvoice[],
    invoiceItems: invoiceItems as SnapshotInvoiceItem[],
  }
}

// ── the mail probe ───────────────────────────────────────────────────────────

/**
 * The evidence that nothing tried to mail.
 *
 * `email_suppressions` is the withheld-send log, written BEFORE the Resend key
 * is looked at, so a send attempt leaves a row whether or not a key is
 * configured. Its migration is a separate slice, so a missing table is read as
 * `null` rather than a failure: the second witness is always present.
 *
 * `notifications` is that second witness and it is the stronger one for this
 * job. `createNotifications` inserts a bell row for every recipient it
 * resolves, and it is the same function that attaches the email plan, so an
 * unchanged notification count is direct evidence that no notification helper
 * was reached at all.
 */
export async function readMailProbe(database: DB): Promise<MailProbe> {
  const notifications = await countRows(database, 'notifications')
  let suppressions: number | null = null
  try {
    suppressions = await countRows(database, 'email_suppressions')
  } catch {
    // The table belongs to the email-allowlist slice and may not exist yet.
    suppressions = null
  }
  return { suppressions, notifications: notifications ?? 0 }
}

async function countRows(database: DB, table: string): Promise<number | null> {
  const result = await database.all<{ c: number }>(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`))
  const first = Array.isArray(result) ? result[0] : undefined
  const value = first?.c
  return typeof value === 'number' ? value : Number(value ?? 0)
}

// ── applying a plan ──────────────────────────────────────────────────────────

type AnyTable =
  | typeof schema.organisations
  | typeof schema.contacts
  | typeof schema.teamMembers
  | typeof schema.teamMemberRoles
  | typeof schema.brands
  | typeof schema.services
  | typeof schema.subscriptions
  | typeof schema.requests
  | typeof schema.messages
  | typeof schema.invoices
  | typeof schema.invoiceItems

const TABLES: Readonly<Record<string, AnyTable>> = {
  organisations: schema.organisations,
  contacts: schema.contacts,
  team_members: schema.teamMembers,
  team_member_roles: schema.teamMemberRoles,
  brands: schema.brands,
  services: schema.services,
  subscriptions: schema.subscriptions,
  requests: schema.requests,
  messages: schema.messages,
  invoices: schema.invoices,
  invoice_items: schema.invoiceItems,
}

export const ENTITY_TABLE: Readonly<Record<ImportEntity, string>> = {
  team: 'team_members',
  organisations: 'organisations',
  contacts: 'contacts',
  brands: 'brands',
  services: 'services',
  subscriptions: 'subscriptions',
  requests: 'requests',
  messages: 'messages',
  invoices: 'invoices',
}

function tableFor(name: string): AnyTable {
  const table = TABLES[name]
  if (!table) throw new Error(`The importer has no table binding for "${name}".`)
  return table
}

/** Every one of the eleven tables keys on a text `id`, but the union of their
 *  column types collapses under `eq`, so the accessor is narrowed once here. */
function idColumn(table: AnyTable): SQLiteColumn {
  return table.id as SQLiteColumn
}

/**
 * Placeholders the plan carries because the row it points at may not exist
 * until this apply creates it. Resolved here, immediately before the write.
 *
 *   __teamMemberEmail        -> team_members.id, for a role assignment
 *   __invoiceManyrequestsId  -> invoices.id, for a line item
 *
 * `__pending:` is the OTHER kind: a projected id a dry run invented so the next
 * entity could be planned against the world this run would build. It must never
 * reach a write, so any value carrying it fails the row loudly instead of
 * landing a dangling foreign key. An apply re-reads D1 between entities and so
 * never produces one.
 */
const PLACEHOLDER_TEAM_EMAIL = '__teamMemberEmail'
const PLACEHOLDER_INVOICE_KEY = '__invoiceManyrequestsId'
const PENDING_ID_PREFIX = '__pending:'

export interface ApplyOutcome {
  inserted: number
  updated: number
  deleted: number
  /** Rows the apply could not place, with the reason. Never thrown away. */
  failures: Array<{ manyrequestsId: string; label: string; reason: string }>
}

export async function applyEntityPlan(database: DB, plan: EntityPlan): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { inserted: 0, updated: 0, deleted: 0, failures: [] }

  // Group inserts by their target table so a plan that writes two tables (team
  // plus its role rows, invoices plus their lines) still batches cleanly.
  const insertsByTable = new Map<string, EntityPlan['toInsert']>()
  for (const row of plan.toInsert) {
    const target = row.table ?? plan.table
    const list = insertsByTable.get(target) ?? []
    list.push(row)
    insertsByTable.set(target, list)
  }

  // Parents before children: a role assignment needs its team member and a
  // line item needs its invoice, and both may be created by this same plan.
  const ordered = [...insertsByTable.entries()].sort(([a], [b]) => tableRank(a) - tableRank(b))

  for (const [tableName, rows] of ordered) {
    const table = tableFor(tableName)
    const resolved: Array<Record<string, unknown>> = []
    for (const row of rows) {
      const values = await resolvePlaceholders(database, row.values)
      if ('__error' in values) {
        outcome.failures.push({
          manyrequestsId: row.manyrequestsId,
          label: row.label,
          reason: String(values.__error),
        })
        continue
      }
      resolved.push(values)
    }
    for (let offset = 0; offset < resolved.length; offset += INSERT_BATCH) {
      const batch = resolved.slice(offset, offset + INSERT_BATCH)
      if (batch.length === 0) continue
      // Drizzle's typed insert cannot be expressed over a union of eleven
      // tables without collapsing to `never`, so the values go in as records.
      // The columns are produced by the planners in this same module graph and
      // every one is checked by the schema at the D1 boundary.
      await (database.insert(table) as unknown as {
        values: (rows: Array<Record<string, unknown>>) => Promise<unknown>
      }).values(batch)
      outcome.inserted += batch.length
    }
  }

  for (const row of plan.toUpdate) {
    const table = tableFor(row.table ?? plan.table)
    const changes = await resolvePlaceholders(database, row.changes)
    if ('__error' in changes) {
      outcome.failures.push({ manyrequestsId: row.manyrequestsId, label: row.label, reason: String(changes.__error) })
      continue
    }
    await (database.update(table) as unknown as {
      set: (values: Record<string, unknown>) => { where: (clause: unknown) => Promise<unknown> }
    })
      .set(changes)
      .where(eq(idColumn(table), row.id))
    outcome.updated += 1
  }

  const deletesByTable = new Map<string, string[]>()
  for (const row of plan.toDelete) {
    const list = deletesByTable.get(row.table) ?? []
    list.push(row.id)
    deletesByTable.set(row.table, list)
  }
  for (const [tableName, ids] of deletesByTable) {
    const table = tableFor(tableName)
    for (let offset = 0; offset < ids.length; offset += INSERT_BATCH) {
      const batch = ids.slice(offset, offset + INSERT_BATCH)
      await database.delete(table).where(inArray(idColumn(table), batch))
      outcome.deleted += batch.length
    }
  }

  return outcome
}

/** organisations before contacts, team_members before their roles, invoices
 *  before their line items. Anything unranked sorts last. */
function tableRank(name: string): number {
  const order = [
    'organisations',
    'team_members',
    'team_member_roles',
    'contacts',
    'brands',
    'services',
    'subscriptions',
    'requests',
    'invoices',
    'invoice_items',
    'messages',
  ]
  const index = order.indexOf(name)
  return index === -1 ? order.length : index
}

async function resolvePlaceholders(
  database: DB,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (key === PLACEHOLDER_TEAM_EMAIL) {
      const email = typeof value === 'string' ? value : ''
      const rows = await database
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.email, email))
        .limit(1)
      const id = rows[0]?.id
      if (!id) return { __error: `No team member with email ${email}; the role assignment cannot be placed.` }
      out.teamMemberId = id
      continue
    }
    if (key === PLACEHOLDER_INVOICE_KEY) {
      const invoiceKey = typeof value === 'string' ? value : ''
      const rows = await database
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(eq(schema.invoices.manyrequestsId, invoiceKey))
        .limit(1)
      const id = rows[0]?.id
      if (!id) return { __error: `No invoice with ManyRequests key ${invoiceKey}; the line item cannot be placed.` }
      out.invoiceId = id
      continue
    }
    if (typeof value === 'string' && value.startsWith(PENDING_ID_PREFIX)) {
      return {
        __error: `Field "${key}" still holds a dry-run projected id (${value}). A projected id must never be written; re-read the snapshot before applying this entity.`,
      }
    }
    out[key] = value
  }
  return out
}

/** The counts a caller sees for one entity, dry run or applied. */
export function countsFor(plan: EntityPlan, outcome: ApplyOutcome | null): EntityCounts {
  return {
    entity: plan.entity,
    table: plan.table,
    toInsert: plan.toInsert.length,
    toUpdate: plan.toUpdate.length,
    toDelete: plan.toDelete.length,
    unchanged: plan.unchanged,
    skipped: plan.skipped.length,
    inserted: outcome?.inserted ?? 0,
    updated: outcome?.updated ?? 0,
    deleted: outcome?.deleted ?? 0,
  }
}
