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
      publishedSnapshot: schema.proposals.publishedSnapshot,
      publishedAt: schema.proposals.publishedAt,
      coverTheme: schema.proposals.coverTheme,
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

  // ── Snapshot path: read the published snapshot if present ───────────
  // Phase 9 draft/publish model — admin edits the live tables freely; the
  // public viewer reads the published snapshot so unpublished changes
  // don't leak. Falls back to live tables if no snapshot exists yet
  // (handles legacy proposals from before Phase 9).
  if (proposal.publishedSnapshot) {
    try {
      const snapshot = JSON.parse(proposal.publishedSnapshot) as {
        proposal?: Partial<typeof proposal>
        sections?: unknown[]
        variants?: unknown[]
      }
      // Identity-of-record fields stay live (status, decidedAt, etc.) so
      // accept/decline state is always current. Content fields come from
      // the snapshot.
      const merged = {
        title: snapshot.proposal?.title ?? proposal.title,
        subtitle: snapshot.proposal?.subtitle ?? proposal.subtitle,
        preparedFor: snapshot.proposal?.preparedFor ?? proposal.preparedFor,
        preparedBy: snapshot.proposal?.preparedBy ?? proposal.preparedBy,
        effectiveDate: snapshot.proposal?.effectiveDate ?? proposal.effectiveDate,
        expiresAt: snapshot.proposal?.expiresAt ?? proposal.expiresAt,
        status: proposal.status,
        decidedAt: proposal.decidedAt,
        decidedVariantId: proposal.decidedVariantId,
        // Cover theme stays live (it's metadata, not content) so admin
        // toggles flow through immediately without re-publishing.
        coverTheme: proposal.coverTheme,
        orgName: proposal.orgName,
      }
      return NextResponse.json({
        proposal: merged,
        sections: snapshot.sections ?? [],
        variants: snapshot.variants ?? [],
        analyticsResourceId: proposal.id,
      })
    } catch {
      // Corrupt snapshot — fall through to live data so the viewer still works.
    }
  }

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

  // Strip internal ID + snapshot fields from rendered output but expose ID for analytics tracking.
  const { id: internalId, publishedSnapshot: _snap, publishedAt: _pAt, ...safeProposal } = proposal
  void _snap; void _pAt;
  return NextResponse.json({
    proposal: safeProposal,
    sections,
    variants,
    analyticsResourceId: internalId,
  })
}
