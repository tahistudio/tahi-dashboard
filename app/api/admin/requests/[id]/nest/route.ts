/**
 * POST /api/admin/requests/[id]/nest
 *
 * Body : { parentRequestId: string | null }
 *
 * Sets (or clears when null) the parent of a request. Used by the
 * drag-to-nest interaction on the requests list / kanban.
 *
 * Guard rails :
 *   - Parent and child must share the same orgId.
 *   - Cannot set a child's parent to a request that already has a parent
 *     (one-level-only nesting).
 *   - Cannot set a request to parent itself.
 *   - Cannot set a request as parent of a request that has its own children
 *     (would create a three-level tree).
 *
 * When parentRequestId is null, the request becomes top-level, subPosition
 * is cleared.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: childId } = await params
  const body = await req.json().catch(() => null) as { parentRequestId?: string | null } | null

  const database = await db()
  const drizzle = database as Drizzle

  const [child] = await drizzle
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, childId))
    .limit(1)
  if (!child) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, child.orgId)
  if (denied) return denied

  // Clear parent (un-nest)
  if (body?.parentRequestId === null || body?.parentRequestId === undefined) {
    await drizzle
      .update(schema.requests)
      .set({ parentRequestId: null, subPosition: null })
      .where(eq(schema.requests.id, childId))
    return NextResponse.json({ ok: true, parentRequestId: null })
  }

  const parentId = body.parentRequestId

  if (parentId === childId) {
    return NextResponse.json({ error: 'A request cannot be its own parent' }, { status: 400 })
  }

  // Block if the child has its own children — would create 3 levels.
  const [existingChildOfChild] = await drizzle
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(eq(schema.requests.parentRequestId, childId))
    .limit(1)
  if (existingChildOfChild) {
    return NextResponse.json({
      error: 'This request has sub-requests of its own. V1 only supports one level of nesting — move its sub-requests out before nesting this one.',
    }, { status: 400 })
  }

  const [parent] = await drizzle
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.id, parentId))
    .limit(1)
  if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

  if (parent.orgId !== child.orgId) {
    return NextResponse.json({ error: 'Parent and child must belong to the same client' }, { status: 400 })
  }
  if (parent.parentRequestId) {
    return NextResponse.json({ error: 'Target already has a parent. V1 only supports one level of nesting.' }, { status: 400 })
  }

  // Pick next subPosition.
  const [last] = await drizzle
    .select({ subPosition: schema.requests.subPosition })
    .from(schema.requests)
    .where(and(eq(schema.requests.parentRequestId, parentId), isNotNull(schema.requests.subPosition)))
    .orderBy(desc(schema.requests.subPosition))
    .limit(1)
  const nextPos = (last?.subPosition ?? -1) + 1

  await drizzle
    .update(schema.requests)
    .set({ parentRequestId: parentId, subPosition: nextPos })
    .where(eq(schema.requests.id, childId))

  return NextResponse.json({ ok: true, parentRequestId: parentId, subPosition: nextPos })
}
