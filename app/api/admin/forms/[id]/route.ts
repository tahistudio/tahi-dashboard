import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// PATCH /api/admin/forms/[id] - update form template
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
    name?: string
    category?: string
    orgId?: string
    questions?: Array<{ id: string; type: string; label: string; required: boolean; options?: string[] }>
    isDefault?: boolean
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.category !== undefined) updates.category = body.category || null
  if (body.orgId !== undefined) updates.orgId = body.orgId || null
  if (body.questions !== undefined) updates.questions = JSON.stringify(body.questions)
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault ? 1 : 0

  await drizzle
    .update(schema.requestForms)
    .set(updates)
    .where(eq(schema.requestForms.id, id))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/forms/[id] - delete form template
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

  await drizzle.delete(schema.requestForms).where(eq(schema.requestForms.id, id))

  return NextResponse.json({ success: true })
}
