import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

/**
 * Public read-only proposal endpoint. No auth — token validates access.
 * 404s on missing/revoked/non-shared tokens to avoid leaking existence.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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
      orgName: schema.organisations.name,
    })
    .from(schema.proposals)
    .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
    .where(eq(schema.proposals.publicShareToken, token))
    .limit(1)

  // Allow viewing accepted/declined proposals so the recipient still sees
  // the result of their decision; only outright revoked / never-shared
  // tokens 404.
  if (!proposal || (proposal.status !== 'shared' && proposal.status !== 'accepted' && proposal.status !== 'declined' && proposal.status !== 'expired')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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
      .where(eq(schema.proposalSections.proposalId, proposal.id))
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
      .where(eq(schema.proposalVariants.proposalId, proposal.id))
      .orderBy(asc(schema.proposalVariants.position)),
  ])

  // Strip internal ID from rendered output but expose for analytics tracking.
  const { id: internalId, ...safeProposal } = proposal
  return NextResponse.json({
    proposal: safeProposal,
    sections,
    variants,
    analyticsResourceId: internalId,
  })
}
