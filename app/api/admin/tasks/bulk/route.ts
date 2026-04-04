import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── PATCH /api/admin/tasks/bulk ───────────────────────────────────────────
// Bulk update tasks: accepts { taskIds: string[], updates: { status?, priority?, assigneeId? } }
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    taskIds?: string[]
    updates?: {
      status?: string
      priority?: string
      assigneeId?: string | null
    }
  }

  const { taskIds, updates } = body

  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return NextResponse.json({ error: 'taskIds must be a non-empty array' }, { status: 400 })
  }

  if (!updates || typeof updates !== 'object') {
    return NextResponse.json({ error: 'updates object is required' }, { status: 400 })
  }

  // Validate fields
  if (updates.status !== undefined) {
    const validStatuses = ['todo', 'in_progress', 'blocked', 'done']
    if (!validStatuses.includes(updates.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
  }
  if (updates.priority !== undefined) {
    const validPriorities = ['standard', 'high', 'urgent']
    if (!validPriorities.includes(updates.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
  }

  // Build the set clause
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const setFields: Record<string, unknown> = { updatedAt: now }

  if (updates.status !== undefined) {
    setFields.status = updates.status
    if (updates.status === 'done') {
      setFields.completedAt = now
    }
  }
  if (updates.priority !== undefined) setFields.priority = updates.priority
  if (updates.assigneeId !== undefined) setFields.assigneeId = updates.assigneeId

  // Check there is at least one field to update besides updatedAt
  if (Object.keys(setFields).length <= 1) {
    return NextResponse.json({ error: 'At least one update field is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  let updatedCount = 0
  for (const taskId of taskIds) {
    await drizzle
      .update(schema.tasks)
      .set(setFields)
      .where(eq(schema.tasks.id, taskId))
    updatedCount++
  }

  return NextResponse.json({ success: true, updatedCount })
}
