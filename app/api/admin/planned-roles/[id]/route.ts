import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH /api/admin/planned-roles/[id]
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    department?: string | null
    reportsToId?: string | null
    priority?: string
    status?: string
    description?: string | null
  }

  const database = await db() as unknown as D1

  const updates: Record<string, unknown> = {}

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.department !== undefined) updates.department = body.department
  if (body.reportsToId !== undefined) updates.reportsToId = body.reportsToId
  if (body.priority !== undefined) updates.priority = body.priority
  if (body.status !== undefined) updates.status = body.status
  if (body.description !== undefined) updates.description = body.description

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await database
    .update(schema.plannedRoles)
    .set(updates)
    .where(eq(schema.plannedRoles.id, id))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/planned-roles/[id]
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  await database
    .delete(schema.plannedRoles)
    .where(eq(schema.plannedRoles.id, id))

  return NextResponse.json({ success: true })
}
