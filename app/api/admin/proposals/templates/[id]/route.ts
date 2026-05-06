import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const [template] = await database
    .select()
    .from(schema.proposalTemplates)
    .where(eq(schema.proposalTemplates.id, id))
    .limit(1)
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ template })
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const body = await req.json() as { name?: string; description?: string; snapshot?: unknown; variableDefs?: unknown }
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.snapshot !== undefined) updates.snapshot = JSON.stringify(body.snapshot)
  if (body.variableDefs !== undefined) updates.variableDefs = body.variableDefs ? JSON.stringify(body.variableDefs) : null
  await database.update(schema.proposalTemplates).set(updates).where(eq(schema.proposalTemplates.id, id))
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.proposalTemplates).where(eq(schema.proposalTemplates.id, id))
  return NextResponse.json({ success: true })
}
