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
  const scheduledDate = new Date(body.scheduledAt)
  if (Number.isNaN(scheduledDate.getTime())) throw new Error('scheduledAt is not a valid date')

  const { callColumn, activityColumn } = parentColumns(parent)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.discoveryCalls).values({
    id,
    [callColumn]: parentId,
    title: body.title.trim(),
    scheduledAt: body.scheduledAt,
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
