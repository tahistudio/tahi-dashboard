import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string; variantId: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId, variantId } = await ctx.params
  const body = await req.json() as {
    name?: string
    tagline?: string | null
    oneOffAmount?: number
    monthlyAmount?: number
    currency?: string
    scopeHtml?: string | null
    pricingNotesHtml?: string | null
    timelineScheduleId?: string | null
    ctaLabel?: string | null
    isFeatured?: boolean
    position?: number
  }
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.tagline !== undefined) updates.tagline = body.tagline?.trim() ?? null
  if (body.oneOffAmount !== undefined) updates.oneOffAmount = Math.max(0, Math.round(body.oneOffAmount))
  if (body.monthlyAmount !== undefined) updates.monthlyAmount = Math.max(0, Math.round(body.monthlyAmount))
  if (body.currency !== undefined) updates.currency = body.currency
  if (body.scopeHtml !== undefined) updates.scopeHtml = body.scopeHtml
  if (body.pricingNotesHtml !== undefined) updates.pricingNotesHtml = body.pricingNotesHtml
  if (body.timelineScheduleId !== undefined) updates.timelineScheduleId = body.timelineScheduleId
  if (body.ctaLabel !== undefined) updates.ctaLabel = body.ctaLabel?.trim() ?? null
  if (body.isFeatured !== undefined) updates.isFeatured = body.isFeatured ? 1 : 0
  if (body.position !== undefined) updates.position = body.position

  await database.update(schema.proposalVariants).set(updates)
    .where(and(eq(schema.proposalVariants.id, variantId), eq(schema.proposalVariants.proposalId, proposalId)))
  await database.update(schema.proposals).set({ updatedAt: new Date().toISOString() }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId, variantId } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.proposalVariants)
    .where(and(eq(schema.proposalVariants.id, variantId), eq(schema.proposalVariants.proposalId, proposalId)))
  await database.update(schema.proposals).set({ updatedAt: new Date().toISOString() }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ success: true })
}
