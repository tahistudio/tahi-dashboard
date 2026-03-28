import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// PATCH /api/admin/kanban-columns/[id] - update column
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    label?: string
    colour?: string
    position?: number
    statusValue?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.delete(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id))

  return NextResponse.json({ success: true })
}
