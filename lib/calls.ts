/**
 * Discovery call helpers — shared logic for the per-parent call routes
 * (/api/admin/leads/[id]/calls, /api/admin/deals/[id]/calls, etc).
 *
 * Calls are polymorphic: any of leadId / dealId / requestId / taskId /
 * orgId can be set. At least one must be present at the API layer.
 * This helper handles validation + create + the activity hook.
 */

import { schema } from '@/db/d1'
import type { db } from '@/lib/db'
import { desc, eq, getTableColumns } from 'drizzle-orm'
import { normalizeCallInstant } from '@/lib/call-time'

type Database = Awaited<ReturnType<typeof db>>

export type CallParentType = 'lead' | 'deal' | 'request' | 'task' | 'org'

export interface CreateCallInput {
  title: string
  scheduledAt: string
  durationMinutes?: number
  googleMeetUrl?: string | null
  googleCalendarEventId?: string | null
  attendees?: Array<{ name?: string; email?: string; role?: string }>
}

interface CreateCallResult {
  id: string
}

/** Map a parent type to the discoveryCalls column name + activity-row
 *  parent column. Keeps the rest of the helper parent-agnostic. */
function parentColumns(parent: CallParentType): {
  callColumn: 'leadId' | 'dealId' | 'requestId' | 'taskId' | 'orgId'
  activityColumn: 'leadId' | 'dealId' | 'orgId' | null
} {
  switch (parent) {
    case 'lead':    return { callColumn: 'leadId',    activityColumn: 'leadId' }
    case 'deal':    return { callColumn: 'dealId',    activityColumn: 'dealId' }
    case 'request': return { callColumn: 'requestId', activityColumn: null }
    case 'task':    return { callColumn: 'taskId',    activityColumn: null }
    case 'org':     return { callColumn: 'orgId',     activityColumn: 'orgId' }
  }
}

/** Create a discovery call attached to the given parent. Writes an
 *  activity row when the parent type has a matching column on activities
 *  (lead / deal / org). request/task activities are skipped for now —
 *  those tables get their own comment-stream model, not the unified
 *  activities table. */
export async function createCallForParent(
  database: Database,
  parent: CallParentType,
  parentId: string,
  body: CreateCallInput,
  userId: string,
): Promise<CreateCallResult> {
  if (!body.title?.trim()) throw new Error('title is required')
  if (!body.scheduledAt) throw new Error('scheduledAt is required (ISO 8601)')
  // Normalise to an absolute UTC instant at the boundary. A naive input
  // (no offset) is read as Pacific/Auckland wall-clock time, not UTC.
  // See lib/call-time.ts for why that distinction is the whole bug.
  const normalizedScheduledAt = normalizeCallInstant(body.scheduledAt)
  if (!normalizedScheduledAt) throw new Error('scheduledAt is not a valid date')
  const scheduledDate = new Date(normalizedScheduledAt)

  const { callColumn, activityColumn } = parentColumns(parent)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.discoveryCalls).values({
    id,
    [callColumn]: parentId,
    title: body.title.trim(),
    scheduledAt: normalizedScheduledAt,
    durationMinutes: body.durationMinutes ?? 30,
    googleMeetUrl: body.googleMeetUrl?.trim() || null,
    googleCalendarEventId: body.googleCalendarEventId?.trim() || null,
    attendees: JSON.stringify(body.attendees ?? []),
    status: 'scheduled',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // Activity hook only fires for parent types that have a matching
  // column on activities (lead / deal / org). Skip for request/task.
  if (activityColumn) {
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: `${parent}_call_scheduled`,
      title: `Call scheduled: ${body.title.trim()}`,
      description: `For ${scheduledDate.toISOString()}`,
      [activityColumn]: parentId,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  return { id }
}

/**
 * List all calls attached to a given parent, newest scheduled first, with
 * their linked org / deal / lead / request names joined in (mirrors the
 * join pattern in the unified /calls index, see
 * app/api/admin/calls/index/route.ts). A call is polymorphic and can carry
 * several link fields at once (a deal call can also be tied to a
 * request), so all four joins run regardless of which column is the
 * immediate parent, letting <LinkedToPanel> render every link's label
 * without a follow-up fetch.
 */
export async function listCallsForParent(
  database: Database,
  parent: CallParentType,
  parentId: string,
) {
  const { callColumn } = parentColumns(parent)
  const column = schema.discoveryCalls[callColumn]
  return database
    .select({
      ...getTableColumns(schema.discoveryCalls),
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
      leadName: schema.leads.name,
      requestTitle: schema.requests.title,
    })
    .from(schema.discoveryCalls)
    .leftJoin(schema.organisations, eq(schema.discoveryCalls.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.discoveryCalls.dealId, schema.deals.id))
    .leftJoin(schema.leads, eq(schema.discoveryCalls.leadId, schema.leads.id))
    .leftJoin(schema.requests, eq(schema.discoveryCalls.requestId, schema.requests.id))
    .where(eq(column, parentId))
    .orderBy(desc(schema.discoveryCalls.scheduledAt))
}

// ── Meeting type vocabulary ──────────────────────────────────────────────
//
// Set by the calendar sync classifier (app/api/admin/integrations/google/
// sync-calendar/route.ts) and reclassifiable by hand from the /calls index
// or a call's own detail. Kept here as the single source of truth so the
// PATCH routes, the MCP tool description and the UI dropdown never drift.

export const MEETING_TYPES = ['discovery', 'client', 'partnership', 'unclassified'] as const
export type MeetingType = typeof MEETING_TYPES[number]

export function isMeetingType(value: unknown): value is MeetingType {
  return typeof value === 'string' && (MEETING_TYPES as readonly string[]).includes(value)
}

// ── Link-field validation (who a call is "for") ──────────────────────────
//
// discoveryCalls is polymorphic: orgId / leadId / dealId / requestId can
// each be set independently. A PATCH that relinks a call must not be able
// to point it at a row that doesn't exist, so every non-null id in the
// patch is checked against its own table before the update runs.

export interface CallLinkFields {
  orgId?: string | null
  leadId?: string | null
  dealId?: string | null
  requestId?: string | null
}

export interface CallLinkValidationError {
  field: keyof CallLinkFields
  message: string
}

/**
 * Org id implied by each field that was present in `fields`, resolved in
 * the same lookup that already checked the row exists (no extra query):
 *   - orgId    -> the field's own value (or null, when explicitly cleared)
 *   - leadId   -> always null (leads carry no organisation column)
 *   - dealId   -> the deal's own orgId, which may itself be null for a
 *                 pre-client deal
 *   - requestId -> the request's own orgId (requests.orgId is NOT NULL,
 *                 so this is only null when the field was cleared/absent)
 * Only set for fields present in the input `fields` object.
 */
export type CallLinkOrgIds = Partial<Record<keyof CallLinkFields, string | null>>

export interface CallLinkValidationResult {
  error: CallLinkValidationError | null
  orgIds: CallLinkOrgIds
}

/**
 * Validate that every non-null id present in `fields` references a real
 * row, and resolve the organisation each link implies (for access-scoping
 * checks upstream, see PATCH /api/admin/discovery-calls/[id]). A field
 * that is `null` or omitted is always valid (it means "leave unlinked" /
 * "leave unchanged"). Returns the first failing field's error, or a null
 * error when everything checks out.
 */
export async function validateCallLinkFields(
  database: Database,
  fields: CallLinkFields,
): Promise<CallLinkValidationResult> {
  const orgIds: CallLinkOrgIds = {}

  if (fields.orgId) {
    const [row] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, fields.orgId))
      .limit(1)
    if (!row) return { error: { field: 'orgId', message: 'orgId does not reference an existing organisation' }, orgIds }
    orgIds.orgId = fields.orgId
  } else if ('orgId' in fields) {
    orgIds.orgId = null
  }

  if (fields.leadId) {
    const [row] = await database
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(eq(schema.leads.id, fields.leadId))
      .limit(1)
    if (!row) return { error: { field: 'leadId', message: 'leadId does not reference an existing lead' }, orgIds }
    orgIds.leadId = null // leads carry no organisation column
  } else if ('leadId' in fields) {
    orgIds.leadId = null
  }

  if (fields.dealId) {
    const [row] = await database
      .select({ id: schema.deals.id, orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(eq(schema.deals.id, fields.dealId))
      .limit(1)
    if (!row) return { error: { field: 'dealId', message: 'dealId does not reference an existing deal' }, orgIds }
    orgIds.dealId = row.orgId
  } else if ('dealId' in fields) {
    orgIds.dealId = null
  }

  if (fields.requestId) {
    const [row] = await database
      .select({ id: schema.requests.id, orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, fields.requestId))
      .limit(1)
    if (!row) return { error: { field: 'requestId', message: 'requestId does not reference an existing request' }, orgIds }
    orgIds.requestId = row.orgId
  } else if ('requestId' in fields) {
    orgIds.requestId = null
  }

  return { error: null, orgIds }
}

/**
 * Resolve the single organisation a call currently belongs to, for access-
 * scoping checks on a relink (a scoped member must not be able to unlink
 * or read someone else's call). Priority: the call's own orgId first (the
 * most direct link), then its deal's org, then its request's org (requests
 * always have an org). A lead-only call, or one with no links at all, has
 * no organisation to check against, so it resolves to null (pre-client,
 * see requireAccessToOrgOrPreClient in lib/require-access.ts).
 */
export async function resolveCallOrgId(
  database: Database,
  call: { orgId: string | null; dealId: string | null; requestId: string | null },
): Promise<string | null> {
  if (call.orgId) return call.orgId
  if (call.dealId) {
    const [row] = await database
      .select({ orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(eq(schema.deals.id, call.dealId))
      .limit(1)
    return row?.orgId ?? null
  }
  if (call.requestId) {
    const [row] = await database
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, call.requestId))
      .limit(1)
    return row?.orgId ?? null
  }
  return null
}
