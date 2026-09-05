import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeBlocker } from '@/lib/blockers-server'

// ── DELETE /api/admin/tasks/[id]/dependencies/[depId] ──────────────────────
// Legacy alias over DELETE /api/admin/tasks/[id]/blockers/[linkId]. Kept for
// one release so the shipped remove_task_dependency MCP tool and any saved
// agent transcript keep working through the deploy window. depId is a
// work_blockers link id; task_dependencies is frozen.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; depId: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, depId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return removeBlocker(drizzle, userId, { type: 'task', id }, depId)
}
