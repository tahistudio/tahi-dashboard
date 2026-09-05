import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, inArray, isNull, or } from 'drizzle-orm'
import { isTaskPriority } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { createNotification } from '@/lib/notifications'
import { resolveTeamMember } from '@/lib/team-identity'

// ── PATCH /api/admin/tasks/bulk ───────────────────────────────────────────
/**
 * Bulk update: { taskIds, updates: { status?, priority?, assigneeId?, dueDate? } }.
 *
 * Scoped exactly like the list route (CLAUDE.md rule 11): a member reaches
 * the clients they are scoped to, plus the studio's own unclientted tasks.
 * The reachable ids are resolved first, so the count returned is the number
 * of rows this user actually changed rather than the number of ids they sent.
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    taskIds?: string[]
    updates?: {
      status?: string
      priority?: string
      assigneeId?: string | null
      dueDate?: string | null
    }
  }

  const { taskIds, updates } = body

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: 'taskIds must be a non-empty array' }, { status: 400 })
  }
  if (!updates || typeof updates !== 'object') {
    return NextResponse.json({ error: 'updates object is required' }, { status: 400 })
  }
  if (updates.status !== undefined && !TASK_STATUSES.some(s => s.value === updates.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  if (updates.priority !== undefined && !isTaskPriority(updates.priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const setFields: Record<string, unknown> = { updatedAt: now }

  if (updates.status !== undefined) {
    setFields.status = updates.status
    setFields.completedAt = updates.status === 'done' ? now : null
  }
  if (updates.priority !== undefined) setFields.priority = updates.priority
  if (updates.assigneeId !== undefined) {
    setFields.assigneeId = updates.assigneeId || null
    setFields.assigneeType = updates.assigneeId ? 'team_member' : null
  }
  if (updates.dueDate !== undefined) setFields.dueDate = updates.dueDate || null

  if (Object.keys(setFields).length <= 1) {
    return NextResponse.json({ error: 'At least one update field is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)
  const scopeClause = scopedOrgIds === null
    ? undefined
    : scopedOrgIds.length === 0
      ? isNull(schema.tasks.orgId)
      : or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))

  // Resolve first so the response can say what actually changed. A bogus id
  // used to come back as a success, which made every bulk failure silent.
  // The title comes back with the id because the assignment notification
  // below names each task, exactly as the per-task door does.
  const idClause = inArray(schema.tasks.id, taskIds)
  const reachable = await drizzle
    .select({ id: schema.tasks.id, title: schema.tasks.title })
    .from(schema.tasks)
    .where(scopeClause ? and(idClause, scopeClause) : idClause)

  const reachableIds = reachable.map(r => r.id)
  if (reachableIds.length === 0) {
    return NextResponse.json({ success: true, updatedCount: 0 })
  }

  await drizzle
    .update(schema.tasks)
    .set(setFields)
    .where(inArray(schema.tasks.id, reachableIds))

  // Moving a whole selection onto somebody is still an assignment, and until
  // now this was the one door that did it silently: PATCH /tasks/[id] tells
  // the assignee, POST /tasks now tells them, and the board's bulk bar handed
  // over ten tasks without a word.
  //
  // One row per task rather than one for the batch, because each notification
  // deep-links to the task it is about. The recipient is a team member because
  // that is what the write above stores: this door assigns from the team
  // picker only. And never the caller: taking work on yourself is not news.
  const newAssigneeId = updates.assigneeId
  if (newAssigneeId) {
    const me = await resolveTeamMember(drizzle, userId)
    if (me?.id !== newAssigneeId) {
      for (const task of reachable) {
        await createNotification(drizzle, {
          recipient: { teamMemberId: newAssigneeId },
          type: 'task_assigned',
          title: `Task assigned to you: "${task.title ?? 'Untitled'}"`,
          body: null,
          entityType: 'task',
          entityId: task.id,
        })
      }
    }
  }

  return NextResponse.json({ success: true, updatedCount: reachableIds.length })
}
