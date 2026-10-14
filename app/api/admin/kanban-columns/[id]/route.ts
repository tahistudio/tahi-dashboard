import { requireStudioAdmin } from '@/lib/internal-route-access'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, sql } from 'drizzle-orm'

// PATCH /api/admin/kanban-columns/[id] - update column
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'settings')
  if (featureDenied) return featureDenied

  const { id } = await params
  const body = await req.json() as {
    label?: string
    colour?: string
    position?: number
    statusValue?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [scopeTarget] = await drizzle.select({ orgId: schema.kanbanColumns.orgId }).from(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id)).limit(1)
  if (!scopeTarget) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (scopeTarget.orgId) {
    const scopeDenied = await requireAccessToOrg(drizzle, userId, scopeTarget.orgId)
    if (scopeDenied) return scopeDenied
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.label?.trim()) updates.label = body.label.trim()
  if (body.colour !== undefined) updates.colour = body.colour
  if (body.position !== undefined) updates.position = body.position
  if (body.statusValue?.trim()) updates.statusValue = body.statusValue.trim()

  await drizzle
    .update(schema.kanbanColumns)
    .set(updates)
    .where(eq(schema.kanbanColumns.id, id))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/kanban-columns/[id] - delete column
// Guards against removing a column whose statusValue still has live requests
// (scoped to the column's org for per-client columns).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'settings')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [scopeTarget] = await drizzle.select({ orgId: schema.kanbanColumns.orgId }).from(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id)).limit(1)
  if (!scopeTarget) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (scopeTarget.orgId) {
    const scopeDenied = await requireAccessToOrg(drizzle, userId, scopeTarget.orgId)
    if (scopeDenied) return scopeDenied
  }

  const [column] = await drizzle
    .select()
    .from(schema.kanbanColumns)
    .where(eq(schema.kanbanColumns.id, id))
    .limit(1)

  if (!column) {
    return NextResponse.json({ error: 'Column not found' }, { status: 404 })
  }

  if (!column.orgId) {
    const adminDenied = await requireStudioAdmin({ userId, orgId }, 'settings')
    if (adminDenied) return adminDenied
  }
  const inUseWhere = column.orgId
    ? and(
        eq(schema.requests.status, column.statusValue),
        eq(schema.requests.orgId, column.orgId),
      )
    : eq(schema.requests.status, column.statusValue)

  const [{ count }] = await drizzle
    .select({ count: sql<number>`count(*)` })
    .from(schema.requests)
    .where(inUseWhere)

  if (Number(count) > 0) {
    return NextResponse.json(
      { error: `${count} request(s) still sit in this column. Move them first.` },
      { status: 409 },
    )
  }

  await drizzle.delete(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id))

  return NextResponse.json({ success: true })
}
