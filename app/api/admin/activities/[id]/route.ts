import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/admin/activities/[id]
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await req.json() as {
    type?: string
    title?: string
    description?: string | null
    dealId?: string | null
    orgId?: string | null
    contactId?: string | null
    scheduledAt?: string | null
    completedAt?: string | null
    durationMinutes?: number | null
    outcome?: string | null
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.type !== undefined) updates.type = body.type
  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.dealId !== undefined) updates.dealId = body.dealId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.contactId !== undefined) updates.contactId = body.contactId
  if (body.scheduledAt !== undefined) updates.scheduledAt = body.scheduledAt
  if (body.completedAt !== undefined) updates.completedAt = body.completedAt
  if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes
  if (body.outcome !== undefined) updates.outcome = body.outcome

  await database
    .update(schema.activities)
    .set(updates)
    .where(eq(schema.activities.id, id))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/activities/[id]
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  await database
    .delete(schema.activities)
    .where(eq(schema.activities.id, id))

  return NextResponse.json({ success: true })
}
