import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Params = { params: Promise<{ id: string; stepId: string }> }

// PATCH /api/admin/requests/[id]/steps/[stepId]
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: requestId, stepId } = await params
  const body = await req.json() as {
    title?: string
    description?: string | null
    completed?: boolean
    orderIndex?: number
    parentStepId?: string | null
    assigneeId?: string | null
  }

  const database = await db() as unknown as D1

  type Updates = Partial<typeof schema.requestSteps.$inferInsert>
  const updates: Updates = { updatedAt: new Date().toISOString() }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.completed !== undefined) {
    updates.completed = body.completed
    updates.completedAt = body.completed ? new Date().toISOString() : null
  }
  if (body.orderIndex !== undefined) updates.orderIndex = body.orderIndex
  if (body.parentStepId !== undefined) updates.parentStepId = body.parentStepId
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId

  const rows = await database
    .update(schema.requestSteps)
    .set(updates)
    .where(and(eq(schema.requestSteps.id, stepId), eq(schema.requestSteps.requestId, requestId)))
    .returning()

  if (!rows.length) return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  return NextResponse.json({ step: rows[0] })
}

// DELETE /api/admin/requests/[id]/steps/[stepId]
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: requestId, stepId } = await params
  const database = await db() as unknown as D1

  // Recursively delete children (SQLite self-ref FK doesn't auto-cascade)
  await deleteTree(database, stepId)

  const rows = await database
    .delete(schema.requestSteps)
    .where(and(eq(schema.requestSteps.id, stepId), eq(schema.requestSteps.requestId, requestId)))
    .returning()

  if (!rows.length) return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

async function deleteTree(database: D1, parentId: string) {
  const children = await database
    .select({ id: schema.requestSteps.id })
    .from(schema.requestSteps)
    .where(eq(schema.requestSteps.parentStepId, parentId))

  for (const { id } of children) {
    await deleteTree(database, id)
    await database.delete(schema.requestSteps).where(eq(schema.requestSteps.id, id))
  }
}
