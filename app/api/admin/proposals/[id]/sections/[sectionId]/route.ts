import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string; sectionId: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId, sectionId } = await ctx.params
  const body = await req.json() as {
    type?: string
    title?: string | null
    subtitle?: string | null
    data?: unknown
    position?: number
  }
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.type !== undefined) updates.type = body.type
  if (body.title !== undefined) updates.title = body.title?.trim() ?? null
  if (body.subtitle !== undefined) updates.subtitle = body.subtitle?.trim() ?? null
  if (body.position !== undefined) updates.position = body.position
  if (body.data !== undefined) updates.data = body.data === null ? null : JSON.stringify(body.data)

  await database.update(schema.proposalSections).set(updates)
    .where(and(eq(schema.proposalSections.id, sectionId), eq(schema.proposalSections.proposalId, proposalId)))
  await database.update(schema.proposals).set({ updatedAt: new Date().toISOString() }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId, sectionId } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.proposalSections)
    .where(and(eq(schema.proposalSections.id, sectionId), eq(schema.proposalSections.proposalId, proposalId)))
  await database.update(schema.proposals).set({ updatedAt: new Date().toISOString() }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ success: true })
}
