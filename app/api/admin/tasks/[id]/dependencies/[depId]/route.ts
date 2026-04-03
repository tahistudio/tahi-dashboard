import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

// ── DELETE /api/admin/tasks/[id]/dependencies/[depId] ──────────────────────
// Remove a task dependency
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; depId: string }> }
) {
  const { orgId } = await getRequestAuth(_req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId, depId } = await params

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify the dependency exists and belongs to this task
  const [dep] = await drizzle
    .select({ id: schema.taskDependencies.id })
    .from(schema.taskDependencies)
    .where(
      and(
        eq(schema.taskDependencies.id, depId),
        eq(schema.taskDependencies.taskId, taskId)
      )
    )
    .limit(1)

  if (!dep) {
    return NextResponse.json({ error: 'Dependency not found' }, { status: 404 })
  }

  await drizzle
    .delete(schema.taskDependencies)
    .where(eq(schema.taskDependencies.id, depId))

  return NextResponse.json({ success: true })
}
