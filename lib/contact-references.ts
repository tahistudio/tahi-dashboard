/**
 * lib/contact-references.ts
 *
 * Every column that can hold a contacts.id, in one place, so deleting or
 * merging a contact can count them, name them, and re-point them without a
 * route hand-listing tables it will forget about the next time one is added.
 *
 * Three foreign keys point at contacts (deal_contacts, activities,
 * brand_contacts). Everything else is a polymorphic pair: an id column beside
 * a type column that says whether the id names a team member or a contact, so
 * every read and write here carries that discriminator. A row typed
 * 'team_member' that happens to share a uuid is never touched.
 *
 * NOT here, on purpose:
 *   - request_reads, notifications, notification_preferences,
 *     announcement_dismissals and message_reactions. Their user_id is the
 *     Clerk user id, not the contact row, so a contact merge has nothing to
 *     move: the login survives on whichever row keeps clerk_user_id.
 *   - audit_log.actor_id. The log is immutable by design; a merged-away
 *     contact stays named in the history of what it did.
 *   - onboarding_invites.contact_email. Bound to an address, not a row.
 *
 * The writes are raw SQL through `database.run` rather than the typed
 * builder: fourteen tables of different shapes share one UPDATE, and SQLite
 * refuses a qualified column in SET, so the statement is assembled from bare
 * identifiers. That also makes every statement renderable in a test, which
 * is how the "every column" claim is proven rather than trusted.
 */

import { eq, getTableName, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface ColumnReference {
  key: string
  singular: string
  plural: string
  table: AnySQLiteTable
  column: AnySQLiteColumn
  /** Polymorphic columns: the discriminator that says the id names a contact. */
  type?: { column: AnySQLiteColumn; value: string }
  /**
   * Junctions where (parent, contact) is unique. When the survivor already
   * sits on the same parent, the duplicate's row is dropped instead of
   * re-pointed, which is what the unique index would refuse anyway.
   */
  uniqueWith?: AnySQLiteColumn
}

const CONTACT = 'contact'

/** Ordered the way the reason sentence should read: work first, CRM last. */
export const CONTACT_COLUMN_REFERENCES: readonly ColumnReference[] = [
  {
    key: 'requests', singular: 'request', plural: 'requests',
    table: schema.requests, column: schema.requests.submittedById,
    type: { column: schema.requests.submittedByType, value: CONTACT },
  },
  {
    key: 'messages', singular: 'message', plural: 'messages',
    table: schema.messages, column: schema.messages.authorId,
    type: { column: schema.messages.authorType, value: CONTACT },
  },
  {
    key: 'files', singular: 'file', plural: 'files',
    table: schema.files, column: schema.files.uploadedById,
    type: { column: schema.files.uploadedByType, value: CONTACT },
  },
  {
    key: 'tasks', singular: 'task', plural: 'tasks',
    table: schema.tasks, column: schema.tasks.assigneeId,
    type: { column: schema.tasks.assigneeType, value: CONTACT },
  },
  {
    key: 'checklistItems', singular: 'checklist item', plural: 'checklist items',
    table: schema.requestSteps, column: schema.requestSteps.createdById,
    type: { column: schema.requestSteps.createdByType, value: CONTACT },
  },
  {
    key: 'requestParticipants', singular: 'request participant', plural: 'request participants',
    table: schema.requestParticipants, column: schema.requestParticipants.participantId,
    type: { column: schema.requestParticipants.participantType, value: CONTACT },
    uniqueWith: schema.requestParticipants.requestId,
  },
  {
    key: 'conversations', singular: 'conversation', plural: 'conversations',
    table: schema.conversationParticipants, column: schema.conversationParticipants.participantId,
    type: { column: schema.conversationParticipants.participantType, value: CONTACT },
    uniqueWith: schema.conversationParticipants.conversationId,
  },
  {
    key: 'mentions', singular: 'mention', plural: 'mentions',
    table: schema.mentions, column: schema.mentions.mentionedId,
    type: { column: schema.mentions.mentionedType, value: CONTACT },
  },
  {
    key: 'deals', singular: 'deal', plural: 'deals',
    table: schema.dealContacts, column: schema.dealContacts.contactId,
    uniqueWith: schema.dealContacts.dealId,
  },
  {
    key: 'activities', singular: 'activity', plural: 'activities',
    table: schema.activities, column: schema.activities.contactId,
  },
  {
    key: 'brands', singular: 'brand', plural: 'brands',
    table: schema.brandContacts, column: schema.brandContacts.contactId,
    uniqueWith: schema.brandContacts.brandId,
  },
  {
    key: 'billedSubscriptions', singular: 'billed subscription', plural: 'billed subscriptions',
    table: schema.subscriptions, column: schema.subscriptions.billedContactId,
  },
  {
    key: 'permissionOverrides', singular: 'permission override', plural: 'permission overrides',
    table: schema.featureVisibility, column: schema.featureVisibility.subjectId,
    type: { column: schema.featureVisibility.subjectType, value: CONTACT },
    uniqueWith: schema.featureVisibility.featureKey,
  },
]

/**
 * scheduled_calls.attendees is JSON: [{ id, type, name, email }]. It is the
 * one reference that is not a column, so it is counted with LIKE and
 * re-pointed by parsing each hit rather than by string surgery on the JSON.
 */
const CALLS_KEY = 'calls'

export interface ContactReferenceCount {
  key: string
  singular: string
  plural: string
  count: number
}

export interface ContactReferences {
  counts: ContactReferenceCount[]
  total: number
  /** "3 requests, 2 messages, 1 call". Empty when nothing references the contact. */
  summary: string
}

const ident = (column: AnySQLiteColumn) => sql.identifier(column.name)
const tableIdent = (table: AnySQLiteTable) => sql.identifier(getTableName(table))

function typeClause(ref: ColumnReference, alias?: string): SQL {
  if (!ref.type) return sql.empty()
  const col = alias ? sql`${sql.identifier(alias)}.${ident(ref.type.column)}` : ident(ref.type.column)
  return sql` and ${col} = ${ref.type.value}`
}

function attendeesPattern(contactId: string): string {
  return `%${contactId}%`
}

async function countOne(database: DrizzleDB, ref: ColumnReference, contactId: string): Promise<number> {
  const row = await database.get<{ n: number | string | null }>(
    sql`select count(*) as n from ${tableIdent(ref.table)} where ${ident(ref.column)} = ${contactId}${typeClause(ref)}`,
  )
  return Number(row?.n ?? 0)
}

async function countCalls(database: DrizzleDB, contactId: string): Promise<number> {
  const row = await database.get<{ n: number | string | null }>(
    sql`select count(*) as n from ${tableIdent(schema.scheduledCalls)} where ${ident(schema.scheduledCalls.attendees)} like ${attendeesPattern(contactId)}`,
  )
  return Number(row?.n ?? 0)
}

/** "3 requests, 2 messages, 1 call": non-zero entries only, in table order. */
export function describeContactReferences(counts: ContactReferenceCount[]): string {
  return counts
    .filter(c => c.count > 0)
    .map(c => `${c.count} ${c.count === 1 ? c.singular : c.plural}`)
    .join(', ')
}

export async function countContactReferences(database: DrizzleDB, contactId: string): Promise<ContactReferences> {
  const [columnCounts, calls] = await Promise.all([
    Promise.all(CONTACT_COLUMN_REFERENCES.map(ref => countOne(database, ref, contactId))),
    countCalls(database, contactId),
  ])
  const counts: ContactReferenceCount[] = CONTACT_COLUMN_REFERENCES.map((ref, i) => ({
    key: ref.key, singular: ref.singular, plural: ref.plural, count: columnCounts[i],
  }))
  counts.push({ key: CALLS_KEY, singular: 'call', plural: 'calls', count: calls })
  const total = counts.reduce((sum, c) => sum + c.count, 0)
  return { counts, total, summary: describeContactReferences(counts) }
}

async function repointOne(database: DrizzleDB, ref: ColumnReference, fromId: string, toId: string): Promise<void> {
  if (ref.uniqueWith) {
    // Drop the duplicate's row wherever the survivor already has one on the
    // same parent. The survivor's row wins because it carries the survivor's
    // state (role, read cursor, override effect).
    await database.run(
      sql`delete from ${tableIdent(ref.table)} where ${ident(ref.column)} = ${fromId}${typeClause(ref)} and ${ident(ref.uniqueWith)} in (select ${sql.identifier('s')}.${ident(ref.uniqueWith)} from ${tableIdent(ref.table)} as ${sql.identifier('s')} where ${sql.identifier('s')}.${ident(ref.column)} = ${toId}${typeClause(ref, 's')})`,
    )
  }
  await database.run(
    sql`update ${tableIdent(ref.table)} set ${ident(ref.column)} = ${toId} where ${ident(ref.column)} = ${fromId}${typeClause(ref)}`,
  )
}

interface Attendee {
  id?: unknown
  [key: string]: unknown
}

async function repointCalls(database: DrizzleDB, fromId: string, toId: string): Promise<void> {
  const hits = await database
    .select({ id: schema.scheduledCalls.id, attendees: schema.scheduledCalls.attendees })
    .from(schema.scheduledCalls)
    .where(sql`${schema.scheduledCalls.attendees} like ${attendeesPattern(fromId)}`)
  for (const hit of hits) {
    let parsed: unknown
    try {
      parsed = JSON.parse(hit.attendees)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    let changed = false
    const next = (parsed as Attendee[]).map(a => {
      if (a && typeof a === 'object' && a.id === fromId) {
        changed = true
        return { ...a, id: toId }
      }
      return a
    })
    if (!changed) continue
    await database
      .update(schema.scheduledCalls)
      .set({ attendees: JSON.stringify(next) })
      .where(eq(schema.scheduledCalls.id, hit.id))
  }
}

/**
 * Re-point every reference from one contact to another. Callers have already
 * proven both rows exist at the same organisation; this does not check. Runs
 * statement by statement in table order (D1 has no multi-statement
 * transaction through this driver), which is why the caller deletes the
 * source row LAST: a failure part way leaves a contact with fewer references,
 * never a reference to a row that is gone.
 */
export async function repointContactReferences(database: DrizzleDB, fromId: string, toId: string): Promise<void> {
  for (const ref of CONTACT_COLUMN_REFERENCES) {
    await repointOne(database, ref, fromId, toId)
  }
  await repointCalls(database, fromId, toId)
}

// ── The contact row, as the management routes read it ────────────────────────

export interface ContactAdminRow {
  id: string
  orgId: string
  name: string
  email: string
  phone: string | null
  role: string | null
  isPrimary: boolean | null
  portalRole: string
  clerkUserId: string | null
  lastLoginAt: string | null
  personId: string | null
  manyrequestsId: string | null
}

export async function getContactForAdmin(database: DrizzleDB, id: string): Promise<ContactAdminRow | null> {
  const [row] = await database
    .select({
      id: schema.contacts.id,
      orgId: schema.contacts.orgId,
      name: schema.contacts.name,
      email: schema.contacts.email,
      phone: schema.contacts.phone,
      role: schema.contacts.role,
      isPrimary: schema.contacts.isPrimary,
      portalRole: schema.contacts.portalRole,
      clerkUserId: schema.contacts.clerkUserId,
      lastLoginAt: schema.contacts.lastLoginAt,
      personId: schema.contacts.personId,
      manyrequestsId: schema.contacts.manyrequestsId,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, id))
    .limit(1)
  return row ?? null
}

export interface SiblingContact {
  id: string
  name: string
  email: string
  isPrimary: boolean | null
  clerkUserId: string | null
}

/** The other contacts at the same organisation. */
export async function listSiblingContacts(database: DrizzleDB, contact: Pick<ContactAdminRow, 'id' | 'orgId'>): Promise<SiblingContact[]> {
  const rows = await database
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      isPrimary: schema.contacts.isPrimary,
      clerkUserId: schema.contacts.clerkUserId,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, contact.orgId))
  return rows.filter(r => r.id !== contact.id)
}

/**
 * True when removing this contact would leave an organisation that still has
 * people but nobody flagged primary: the invoices and the invite would have
 * no address. A lone contact is never blocked by this; an empty org has no
 * primary either way.
 */
export function isOnlyPrimary(contact: Pick<ContactAdminRow, 'isPrimary'>, siblings: SiblingContact[]): boolean {
  if (!contact.isPrimary) return false
  if (siblings.length === 0) return false
  return !siblings.some(s => s.isPrimary)
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase()
}
