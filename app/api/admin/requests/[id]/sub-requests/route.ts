/**
 * /api/admin/requests/[id]/sub-requests
 *
 *   GET  → list children of this request, ordered by subPosition ASC.
 *   POST → create a child request. Inherits orgId from parent, sets
 *          parentRequestId, picks a subPosition at the end of the list.
 *          Body accepts the same fields as the top-level POST /requests
 *          minus `orgId` (forced to parent's) and `parentRequestId`
 *          (forced to the parent id here).
 *
 * Nesting constraint : if the parent is itself a sub-request, we reject
 * with 400 — we only support one level of nesting.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [parent] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, parent.orgId)
  if (denied) return denied

  const children = await drizzle
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      size: schema.requests.size,
      category: schema.requests.category,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      assigneeName: schema.teamMembers.name,
      dueDate: schema.requests.dueDate,
      estimatedHours: schema.requests.estimatedHours,
      subPosition: schema.requests.subPosition,
      requestNumber: schema.requests.requestNumber,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .leftJoin(schema.teamMembers, eq(schema.requests.assigneeId, schema.teamMembers.id))
    .where(eq(schema.requests.parentRequestId, id))
    .orderBy(asc(schema.requests.subPosition), asc(schema.requests.createdAt))

  return NextResponse.json({ subRequests: children })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: parentId } = await params
  const body = await req.json().catch(() => null) as {
    title?: string
    description?: string | null
    size?: 'small' | 'large'
    category?: string | null
    priority?: string
    assigneeId?: string | null
    dueDate?: string | null
    estimatedHours?: number | null
  } | null

  if (!body?.title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const [parent] = await drizzle
    .select({
      orgId: schema.requests.orgId,
      parentRequestId: schema.requests.parentRequestId,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, parentId))
    .limit(1)
  if (!parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
  if (parent.parentRequestId) {
    return NextResponse.json({ error: 'Cannot nest: parent is already a sub-request (one level only)' }, { status: 400 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, parent.orgId)
  if (denied) return denied

  // Figure out next subPosition.
  const [last] = await drizzle
    .select({ subPosition: schema.requests.subPosition })
    .from(schema.requests)
    .where(and(eq(schema.requests.parentRequestId, parentId), isNotNull(schema.requests.subPosition)))
    .orderBy(desc(schema.requests.subPosition))
    .limit(1)
  const nextPos = (last?.subPosition ?? -1) + 1

  const newId = crypto.randomUUID()
  await drizzle.insert(schema.requests).values({
    id: newId,
    orgId: parent.orgId,
    parentRequestId: parentId,
    subPosition: nextPos,
    title: body.title.trim(),
    description: body.description ?? null,
    size: body.size ?? 'small',
    type: body.size === 'large' ? 'large_task' : 'small_task', // keep legacy column in sync
    category: body.category ?? null,
    priority: body.priority ?? 'standard',
    assigneeId: body.assigneeId ?? null,
    dueDate: body.dueDate ?? null,
    estimatedHours: body.estimatedHours ?? null,
    status: 'submitted',
    submittedById: userId,
    submittedByType: 'team_member',
  })

  return NextResponse.json({ id: newId }, { status: 201 })
}
