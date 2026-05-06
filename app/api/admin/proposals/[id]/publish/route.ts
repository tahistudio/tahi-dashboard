import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/proposals/[id]/publish
 *
 * Snapshots the current sections + variants + cover-page metadata into
 * `publishedSnapshot`. The public viewer reads from this snapshot so
 * admin edits to the live tables don't leak until the next publish.
 *
 * Idempotent — calling repeatedly just re-snapshots the latest state.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [proposal] = await database
    .select({
      id: schema.proposals.id,
      title: schema.proposals.title,
      subtitle: schema.proposals.subtitle,
      preparedFor: schema.proposals.preparedFor,
      preparedBy: schema.proposals.preparedBy,
      effectiveDate: schema.proposals.effectiveDate,
      expiresAt: schema.proposals.expiresAt,
    })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, id))
    .limit(1)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [sections, variants] = await Promise.all([
    database.select({
      id: schema.proposalSections.id,
      type: schema.proposalSections.type,
      title: schema.proposalSections.title,
      subtitle: schema.proposalSections.subtitle,
      data: schema.proposalSections.data,
      position: schema.proposalSections.position,
    })
      .from(schema.proposalSections)
      .where(eq(schema.proposalSections.proposalId, id))
      .orderBy(asc(schema.proposalSections.position)),
    database.select({
      id: schema.proposalVariants.id,
      name: schema.proposalVariants.name,
      tagline: schema.proposalVariants.tagline,
      oneOffAmount: schema.proposalVariants.oneOffAmount,
      monthlyAmount: schema.proposalVariants.monthlyAmount,
      currency: schema.proposalVariants.currency,
      scopeHtml: schema.proposalVariants.scopeHtml,
      pricingNotesHtml: schema.proposalVariants.pricingNotesHtml,
      timelineScheduleId: schema.proposalVariants.timelineScheduleId,
      ctaLabel: schema.proposalVariants.ctaLabel,
      isFeatured: schema.proposalVariants.isFeatured,
      position: schema.proposalVariants.position,
    })
      .from(schema.proposalVariants)
      .where(eq(schema.proposalVariants.proposalId, id))
      .orderBy(asc(schema.proposalVariants.position)),
  ])

  const snapshot = {
    proposal: {
      title: proposal.title,
      subtitle: proposal.subtitle,
      preparedFor: proposal.preparedFor,
      preparedBy: proposal.preparedBy,
      effectiveDate: proposal.effectiveDate,
      expiresAt: proposal.expiresAt,
    },
    sections,
    variants,
  }

  const now = new Date().toISOString()
  await database.update(schema.proposals).set({
    publishedSnapshot: JSON.stringify(snapshot),
    publishedAt: now,
    updatedAt: now,
  }).where(eq(schema.proposals.id, id))

  return NextResponse.json({ publishedAt: now, sectionCount: sections.length, variantCount: variants.length })
}
