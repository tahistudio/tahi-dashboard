import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { BlockerRow } from '@/lib/blockers'
import { addBlocker, guardSubject, listBlockers } from '@/lib/blockers-server'

/**
 * Legacy alias over the polymorphic blocker routes.
 *
 * Kept for one release so the three shipped MCP tools (add_task_dependency,
 * remove_task_dependency, list_task_dependencies) and any saved agent
 * transcript keep working through the deploy window. It writes to
 * work_blockers like everything else; task_dependencies is frozen.
 *
 * The response keeps the old field names AND adds the new ones, so an old
 * reader is unbroken and a new one does not need a second shape. A blocker
 * that is a request appears here too, with `type: 'request'`: hiding it would
 * make this endpoint disagree with the count on the list route.
 */
type Params = { params: Promise<{ id: string }> }

function legacyShape(rows: readonly BlockerRow[]) {
  return rows.map(row => ({
    depId: row.linkId,
    taskId: row.otherId,
    taskTitle: row.otherTitle,
    taskStatus: row.otherStatus,
    type: row.otherType,
    ref: row.otherRef,
  }))
}

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const subject = { type: 'task' as const, id }
  const denied = await guardSubject(drizzle, userId, subject)
  if (denied) return denied

  const lists = await listBlockers(drizzle, subject)
  return NextResponse.json({
    blockedBy: legacyShape(lists.blockedBy),
    blocks: legacyShape(lists.blocks),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { dependsOnTaskId?: string }
  if (!body.dependsOnTaskId?.trim()) {
    return NextResponse.json({ error: 'dependsOnTaskId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  return addBlocker(
    drizzle,
    userId,
    { type: 'task', id },
    { type: 'task', id: body.dependsOnTaskId },
  )
}
