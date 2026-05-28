import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/proposals/[id]/preview-data
 *
 * Returns the LIVE state of a proposal in the same shape as the public
 * endpoint, for admin-only "preview before publish" flows. Bypasses the
 * publishedSnapshot — the admin sees exactly what they're about to push
 * to the client.
 *
 * Auth: Clerk session, Tahi admin only. Token is not required because
 * this is admin-side, not public.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
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
      status: schema.proposals.status,
      decidedAt: schema.proposals.decidedAt,
      decidedVariantId: schema.proposals.decidedVariantId,
      coverTheme: schema.proposals.coverTheme,
      orgName: schema.organisations.name,
    })
    .from(schema.proposals)
    .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
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
      themeMode: schema.proposalSections.themeMode,
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

  const { id: internalId, ...safeProposal } = proposal
  return NextResponse.json({
    proposal: safeProposal,
    sections,
    variants,
    analyticsResourceId: internalId,
    isPreview: true,
  })
}
