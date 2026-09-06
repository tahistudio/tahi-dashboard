/**
 * lib/org-lifecycle/refs.ts
 *
 * The shared map of what an organisation actually owns, so merge and delete
 * both work from one list instead of from two people's memories.
 *
 * Three lists live here:
 *
 *   ORG_SCOPED_TABLES        re-exported from the import cleanup. It is the
 *                            authoritative set of tables carrying org_id and a
 *                            static test re-derives it from db/schema.ts, so a
 *                            new org-scoped table cannot be forgotten by
 *                            either operation.
 *   PARENT_KEYED_TABLES      rows that hang off a request, a task, a
 *                            conversation, a message, an invoice, a
 *                            subscription or a brand rather than off the org.
 *                            The org_id sweep cannot see them; a delete that
 *                            skips them leaves orphans.
 *   CONTACT_REFERENCE_COLUMNS every column in db/schema.ts that holds a
 *                            contacts.id. A merge that folds two duplicate
 *                            contacts together has to re-point all of them or
 *                            the surviving person loses their history.
 *
 * There are NO cascading foreign keys in D1 (SQLite only enforces them with
 * PRAGMA foreign_keys on, which D1 does not guarantee per statement), so every
 * child is handled by hand, in order.
 */

import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { schema } from '@/db/d1'

export { ORG_SCOPED_TABLES } from '@/lib/import/manyrequests/cleanup'
export type { OrgScopedTable, OrgScopedPolicy } from '@/lib/import/manyrequests/cleanup'

/**
 * Ids per IN clause. D1 caps bound parameters at 100 per statement and the
 * repo already chunks at 90 in four other places (lib/blockers-server.ts,
 * lib/delivery-aggregate.ts, lib/request-participants.ts and the import
 * cleanup). A merge of a real client walks hundreds of requests, so this is
 * load-bearing here rather than theoretical.
 */
export const ID_CHUNK = 90

export function chunkIds(ids: readonly string[]): string[][] {
  const out: string[][] = []
  for (let index = 0; index < ids.length; index += ID_CHUNK) out.push(ids.slice(index, index + ID_CHUNK))
  return out
}

export interface TableHandle {
  table: SQLiteTable
  column: SQLiteColumn
}

/**
 * The Drizzle handle for one (table, column) pair, or null when the schema in
 * play does not carry it. Null is the honest answer under a unit-test double,
 * whose schema is a plain object; the static tests over db/schema.ts are what
 * prove the real schema carries every entry.
 */
export function tableHandle(schemaKey: string, columnKey: string): TableHandle | null {
  const record = (schema as unknown as Record<string, Record<string, unknown> | undefined>)[schemaKey]
  if (!record) return null
  const column = record[columnKey] as SQLiteColumn | undefined
  if (!column) return null
  return { table: record as unknown as SQLiteTable, column }
}

/** The org_id handle for one org-scoped table. */
export function orgTableHandle(schemaKey: string): TableHandle | null {
  return tableHandle(schemaKey, 'orgId')
}

/**
 * Drizzle types `.set()` against the concrete table, which a dynamically
 * chosen SQLiteTable cannot satisfy. This is the one narrow escape hatch, and
 * it is a named type rather than `any` so the shape stays checked at the call
 * site.
 */
export interface DynamicUpdate {
  set: (values: Record<string, unknown>) => { where: (where: unknown) => Promise<unknown> }
}

// ── rows keyed on a parent, not on the org ───────────────────────────────────

export interface ParentKeyedTable {
  /** The child table's key on the Drizzle schema object. */
  schemaKey: string
  /** Its SQL name, which is what the plan reports and the tests assert. */
  table: string
  /** The child column holding the parent id. */
  column: string
  /** The parent table's key on the schema object. */
  parentSchemaKey: string
  /** The parent's SQL name, for the ordering assertions. */
  parentTable: string
}

/**
 * Every table whose rows die with an organisation but carry no org_id: they
 * key on a request, a task, a conversation, a message, an invoice, a
 * subscription or a brand. Deleting the parents without these first is exactly
 * the orphan state the import cleanup was written to stop.
 *
 * Ordered parent-last within each family, because the delete walks this list
 * top to bottom and then sweeps the org-scoped parents.
 */
export const PARENT_KEYED_TABLES: readonly ParentKeyedTable[] = [
  { schemaKey: 'requestParticipants', table: 'request_participants', column: 'requestId', parentSchemaKey: 'requests', parentTable: 'requests' },
  { schemaKey: 'requestReads', table: 'request_reads', column: 'requestId', parentSchemaKey: 'requests', parentTable: 'requests' },
  { schemaKey: 'requestSteps', table: 'request_steps', column: 'requestId', parentSchemaKey: 'requests', parentTable: 'requests' },
  { schemaKey: 'taskSubtasks', table: 'task_subtasks', column: 'taskId', parentSchemaKey: 'tasks', parentTable: 'tasks' },
  { schemaKey: 'conversationParticipants', table: 'conversation_participants', column: 'conversationId', parentSchemaKey: 'conversations', parentTable: 'conversations' },
  { schemaKey: 'messageReactions', table: 'message_reactions', column: 'messageId', parentSchemaKey: 'messages', parentTable: 'messages' },
  { schemaKey: 'voiceNotes', table: 'voice_notes', column: 'messageId', parentSchemaKey: 'messages', parentTable: 'messages' },
  { schemaKey: 'invoiceItems', table: 'invoice_items', column: 'invoiceId', parentSchemaKey: 'invoices', parentTable: 'invoices' },
  { schemaKey: 'tracks', table: 'tracks', column: 'subscriptionId', parentSchemaKey: 'subscriptions', parentTable: 'subscriptions' },
  { schemaKey: 'brandContacts', table: 'brand_contacts', column: 'brandId', parentSchemaKey: 'brands', parentTable: 'brands' },
]

// ── columns holding a contacts.id ────────────────────────────────────────────

export interface ContactRefColumn {
  schemaKey: string
  /** SQL table name, which is what the plan reports and the tests assert. */
  table: string
  /** The Drizzle property holding the contact id. */
  column: string
  /** SQL column name, for the plan key. */
  sqlColumn: string
  /**
   * The sibling column that says which identity kind the id is, and the value
   * that means "a contact". Omitted on columns that can only ever hold a
   * contact id (subscriptions.billed_contact_id, the three junctions).
   */
  typeColumn?: string
  typeValue?: string
}

/**
 * EVERY column in db/schema.ts that holds a contacts.id, so folding a
 * duplicate contact into the surviving one moves the whole person and not the
 * six columns somebody remembered. A static test re-derives the candidates
 * from db/schema.ts and fails when a new one appears unlisted.
 *
 * Four columns are DELIBERATELY absent, and each for a reason:
 *
 *   audit_log.actor_id          The audit log is immutable by design. A merge
 *                               records what it did; it never rewrites what
 *                               was already recorded.
 *   message_reactions.user_id   No participant-type sibling, and reactions are
 *                               written with the Clerk user id rather than a
 *                               contacts.id, so re-pointing it would corrupt a
 *                               different identity space.
 *   mentions.mentioned_by_id    No type sibling either: the author of a
 *                               mention may be a team member or a contact and
 *                               nothing on the row says which.
 *   announcements.target_ids    A JSON blob of org ids on a broadcast that has
 *                               already been sent. History, not a live link.
 */
export const CONTACT_REFERENCE_COLUMNS: readonly ContactRefColumn[] = [
  { schemaKey: 'requests', table: 'requests', column: 'submittedById', sqlColumn: 'submitted_by_id', typeColumn: 'submittedByType', typeValue: 'contact' },
  { schemaKey: 'requestParticipants', table: 'request_participants', column: 'participantId', sqlColumn: 'participant_id', typeColumn: 'participantType', typeValue: 'contact' },
  { schemaKey: 'requestParticipants', table: 'request_participants', column: 'addedById', sqlColumn: 'added_by_id', typeColumn: 'addedByType', typeValue: 'contact' },
  { schemaKey: 'requestReads', table: 'request_reads', column: 'userId', sqlColumn: 'user_id', typeColumn: 'userType', typeValue: 'contact' },
  { schemaKey: 'requestSteps', table: 'request_steps', column: 'createdById', sqlColumn: 'created_by_id', typeColumn: 'createdByType', typeValue: 'contact' },
  { schemaKey: 'conversationParticipants', table: 'conversation_participants', column: 'participantId', sqlColumn: 'participant_id', typeColumn: 'participantType', typeValue: 'contact' },
  { schemaKey: 'messages', table: 'messages', column: 'authorId', sqlColumn: 'author_id', typeColumn: 'authorType', typeValue: 'contact' },
  { schemaKey: 'files', table: 'files', column: 'uploadedById', sqlColumn: 'uploaded_by_id', typeColumn: 'uploadedByType', typeValue: 'contact' },
  { schemaKey: 'tasks', table: 'tasks', column: 'assigneeId', sqlColumn: 'assignee_id', typeColumn: 'assigneeType', typeValue: 'contact' },
  { schemaKey: 'mentions', table: 'mentions', column: 'mentionedId', sqlColumn: 'mentioned_id', typeColumn: 'mentionedType', typeValue: 'contact' },
  { schemaKey: 'notifications', table: 'notifications', column: 'userId', sqlColumn: 'user_id', typeColumn: 'userType', typeValue: 'contact' },
  { schemaKey: 'notificationPreferences', table: 'notification_preferences', column: 'userId', sqlColumn: 'user_id', typeColumn: 'userType', typeValue: 'contact' },
  { schemaKey: 'subscriptions', table: 'subscriptions', column: 'billedContactId', sqlColumn: 'billed_contact_id' },
  { schemaKey: 'dealContacts', table: 'deal_contacts', column: 'contactId', sqlColumn: 'contact_id' },
  { schemaKey: 'activities', table: 'activities', column: 'contactId', sqlColumn: 'contact_id' },
  { schemaKey: 'brandContacts', table: 'brand_contacts', column: 'contactId', sqlColumn: 'contact_id' },
]

/** The plan key for one contact reference, e.g. "messages.author_id". */
export function contactRefKey(entry: ContactRefColumn): string {
  return `${entry.table}.${entry.sqlColumn}`
}

/**
 * The pipeline and sales artefacts a hard delete refuses over. Named
 * separately from the import cleanup's 'refuse' policy because this endpoint
 * deliberately DOES remove invoices, subscriptions, tracks, projects, client
 * costs, private services and case studies: the founder's problem is a dummy
 * client carrying six Stripe test invoices, and refusing over them would leave
 * the row on the list forever.
 *
 * discovery_calls is in this list and always will be: the pre-call-digest cron
 * runs unattended every ten minutes and mails real people off that table.
 */
export const PIPELINE_REFUSAL_TABLES: readonly { schemaKey: string; table: string; label: string }[] = [
  { schemaKey: 'deals', table: 'deals', label: 'deal' },
  { schemaKey: 'activities', table: 'activities', label: 'CRM activity' },
  { schemaKey: 'discoveryCalls', table: 'discovery_calls', label: 'discovery call' },
  { schemaKey: 'contracts', table: 'contracts', label: 'contract' },
  { schemaKey: 'contractDocuments', table: 'contract_documents', label: 'contract document' },
  { schemaKey: 'proposals', table: 'proposals', label: 'proposal' },
  { schemaKey: 'projectSchedules', table: 'project_schedules', label: 'project schedule' },
  { schemaKey: 'projectCalculations', table: 'project_calculations', label: 'project calculation' },
]
