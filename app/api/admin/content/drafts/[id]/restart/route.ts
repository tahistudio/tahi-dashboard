/**
 * POST /api/admin/content/drafts/[id]/restart
 *
 * Restart a draft from scratch. Wipes every pipeline output (body,
 * revisions, reviews, editor overrides, variants, cover, schema, scores,
 * stage lock, error message) and resets status to 'queued'. Keeps the
 * idea linkage + draft id intact so anything pointing at the draft id
 * still works.
 *
 * Hard guard: refuses if the draft has been published to Webflow. A
 * restart would orphan the live post + its scorecard history.
 *
 * Contract:
 *   POST -> { ok: true, deleted: { revisions, reviews, overrides, variants } }
 *   409 if the draft has already been published.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const database = await db()

  const [draft] = await database
    .select({
      id: schema.contentDrafts.id,
      publishedWebflowItemId: schema.contentDrafts.publishedWebflowItemId,
    })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.publishedWebflowItemId) {
    return NextResponse.json({
      error: 'Cannot restart a published draft. Unpublish it in Webflow first.',
    }, { status: 409 })
  }

  const revs = await database.delete(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, id)).returning({ id: schema.draftRevisions.id })
  const revws = await database.delete(schema.draftReviews)
    .where(eq(schema.draftReviews.draftId, id)).returning({ id: schema.draftReviews.id })
  const overs = await database.delete(schema.editorOverrides)
    .where(eq(schema.editorOverrides.draftId, id)).returning({ id: schema.editorOverrides.id })
  const vars = await database.delete(schema.draftVariants)
    .where(eq(schema.draftVariants.draftId, id)).returning({ id: schema.draftVariants.id })

  const now = new Date().toISOString()
  await database.update(schema.contentDrafts).set({
    status: 'queued',
    researchSummary: null,
    validatedCitations: null,
    bodyMarkdown: null,
    bodyHtml: null,
    title: null,
    metaTitle: null,
    metaDescription: null,
    postExcerpt: null,
    shortenedName: null,
    summary: null,
    keyTakeaways: null,
    faqsJson: null,
    authorSlug: null,
    mainCategorySlug: null,
    otherCategorySlugs: null,
    postType: null,
    salesNotes: null,
    readabilityNotes: null,
    contentScore: null,
    scoreBreakdown: null,
    coverSvgUrl: null,
    coverTemplate: null,
    schemaJsonLd: null,
    hreflangBlock: null,
    errorMessage: null,
    stageLockedAt: null,
    pausedFromStatus: null,
    scheduledFor: null,
    updatedAt: now,
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({
    ok: true,
    deleted: {
      revisions: revs.length,
      reviews: revws.length,
      overrides: overs.length,
      variants: vars.length,
    },
  })
}
