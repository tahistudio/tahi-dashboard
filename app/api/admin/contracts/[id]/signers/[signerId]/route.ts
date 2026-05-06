import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string; signerId: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: contractId, signerId } = await ctx.params
  const body = await req.json() as {
    role?: string
    name?: string
    email?: string
    position?: number
    status?: 'pending' | 'signed' | 'skipped'
  }
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.role !== undefined) updates.role = body.role
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.email !== undefined) updates.email = body.email.trim()
  if (body.position !== undefined) updates.position = body.position
  if (body.status !== undefined) updates.status = body.status
  await database.update(schema.contractSigners).set(updates)
    .where(and(eq(schema.contractSigners.id, signerId), eq(schema.contractSigners.contractId, contractId)))
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id: contractId, signerId } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.contractSigners)
    .where(and(eq(schema.contractSigners.id, signerId), eq(schema.contractSigners.contractId, contractId)))
  return NextResponse.json({ success: true })
}
