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
import { desc, eq } from 'drizzle-orm'
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

/** List all calls attached to a given parent, newest scheduled first. */
export async function listCallsForParent(
  database: Database,
  parent: CallParentType,
  parentId: string,
) {
  const { callColumn } = parentColumns(parent)
  const column = schema.discoveryCalls[callColumn]
  return database
    .select()
    .from(schema.discoveryCalls)
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
 * Validate that every non-null id present in `fields` references a real
 * row. A field that is `null` or omitted is always valid (it means "leave
 * unlinked" / "leave unchanged"). Returns the first failing field's error,
 * or null when everything checks out.
 */
export async function validateCallLinkFields(
  database: Database,
  fields: CallLinkFields,
): Promise<CallLinkValidationError | null> {
  if (fields.orgId) {
    const [row] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, fields.orgId))
      .limit(1)
    if (!row) return { field: 'orgId', message: 'orgId does not reference an existing organisation' }
  }
  if (fields.leadId) {
    const [row] = await database
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(eq(schema.leads.id, fields.leadId))
      .limit(1)
    if (!row) return { field: 'leadId', message: 'leadId does not reference an existing lead' }
  }
  if (fields.dealId) {
    const [row] = await database
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(eq(schema.deals.id, fields.dealId))
      .limit(1)
    if (!row) return { field: 'dealId', message: 'dealId does not reference an existing deal' }
  }
  if (fields.requestId) {
    const [row] = await database
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.id, fields.requestId))
      .limit(1)
    if (!row) return { field: 'requestId', message: 'requestId does not reference an existing request' }
  }
  return null
}
