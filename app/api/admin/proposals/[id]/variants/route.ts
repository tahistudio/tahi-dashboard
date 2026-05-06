import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// POST /api/admin/proposals/[id]/variants
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId } = await ctx.params
  const body = await req.json() as {
    name?: string
    tagline?: string | null
    oneOffAmount?: number
    monthlyAmount?: number
    currency?: string
    scopeHtml?: string
    pricingNotesHtml?: string
    timelineScheduleId?: string | null
    ctaLabel?: string | null
    isFeatured?: boolean
    position?: number
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const database = await db() as unknown as D1
  let position = body.position
  if (position == null) {
    const [maxRow] = await database
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.proposalVariants.position}), -1)` })
      .from(schema.proposalVariants)
      .where(eq(schema.proposalVariants.proposalId, proposalId))
    position = (maxRow?.maxPos ?? -1) + 1
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.proposalVariants).values({
    id,
    proposalId,
    name: body.name.trim(),
    tagline: body.tagline?.trim() ?? null,
    oneOffAmount: Math.max(0, Math.round(body.oneOffAmount ?? 0)),
    monthlyAmount: Math.max(0, Math.round(body.monthlyAmount ?? 0)),
    currency: body.currency ?? 'NZD',
    scopeHtml: body.scopeHtml ?? null,
    pricingNotesHtml: body.pricingNotesHtml ?? null,
    timelineScheduleId: body.timelineScheduleId ?? null,
    ctaLabel: body.ctaLabel?.trim() ?? null,
    isFeatured: body.isFeatured ? 1 : 0,
    position,
    createdAt: now,
    updatedAt: now,
  })

  await database.update(schema.proposals).set({ updatedAt: now }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ id }, { status: 201 })
}
