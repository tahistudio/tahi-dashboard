import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface ProposalSnapshot {
  proposal: {
    title: string
    subtitle: string | null
    preparedFor: string | null
    preparedBy: string | null
    effectiveDate: string | null
    expiresAt: string | null
  }
  sections: Array<Record<string, unknown>>
  variants: Array<Record<string, unknown>>
}

/**
 * Builds the snapshot shape POST /api/admin/proposals/[id]/publish writes:
 * the cover, the sections and the variants, each ordered by position.
 *
 * Shared with POST /api/admin/proposals/[id]/share, which takes a first
 * snapshot at share time so a proposal shared and never published cannot
 * serve the public viewer whatever the studio happened to be typing.
 *
 * Returns null when the proposal does not exist.
 */
export async function buildProposalSnapshot(database: D1, id: string): Promise<ProposalSnapshot | null> {
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
  if (!proposal) return null

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

  return {
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
}
