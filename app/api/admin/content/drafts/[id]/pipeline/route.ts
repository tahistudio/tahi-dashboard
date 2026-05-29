/**
 * GET /api/admin/content/drafts/[id]/pipeline
 *
 * Full pipeline snapshot for a round-table draft: latest body + every
 * revision + every reviewer critique grouped by revision + editor's
 * conflict resolutions (with Liam's overrides if any) + running cost
 * total + service status.
 *
 * Powers the round-table draft detail page where Liam reviews a draft.
 *
 * Sibling to the existing [id]/route.ts (which serves the legacy
 * Slice-3-era SlideOver). This route is the Slice-9 deep view.
 *
 * Contract (stable; the draft detail UI reads this):
 *   {
 *     draft: { id, status, title, metaTitle, metaDescription, bodyHtml,
 *              bodyMarkdown, contentScore, coverSvgUrl, createdAt, updatedAt,
 *              errorMessage, ideaId },
 *     idea: { id, title, angle, targetKeyword, clusterId } | null,
 *     brief: StrategistOutput | null,
 *     voiceWeights: { reviewerKey: weight },
 *     revisions: [{ revisionNumber, source, bodyHtml, bodyMarkdown,
 *                   wordCount, reason, createdAt }],
 *     reviewsByRevision: { '1': [Review], '2': [...] },
 *     conflicts: [EditorOverride],
 *     variants: [DraftVariant],
 *     spendCents: number,
 *     services: { perplexity, replicate, openai, anthropic },
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'
import { getDraftSpendCents } from '@/lib/ai-cost'
import { checkServiceStatus } from '@/lib/round-table'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const database = await db()

  const [draft] = await database
    .select()
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const [idea] = draft.ideaId
    ? await database.select({
        id: schema.contentIdeas.id,
        title: schema.contentIdeas.title,
        angle: schema.contentIdeas.angle,
        targetKeyword: schema.contentIdeas.targetKeyword,
        clusterId: schema.contentIdeas.clusterId,
      }).from(schema.contentIdeas).where(eq(schema.contentIdeas.id, draft.ideaId)).limit(1)
    : []

  const revisions = await database
    .select()
    .from(schema.draftRevisions)
    .where(eq(schema.draftRevisions.draftId, id))
    .orderBy(asc(schema.draftRevisions.revisionNumber))

  const allReviews = await database
    .select()
    .from(schema.draftReviews)
    .where(eq(schema.draftReviews.draftId, id))
    .orderBy(asc(schema.draftReviews.revisionNumber))

  const reviewsByRevision: Record<string, Array<{
    reviewerKey: string
    score: number | null
    verdict: string | null
    summary: string | null
    weight: string | null
    durationMs: number | null
    critique: unknown
  }>> = {}
  for (const r of allReviews) {
    const key = String(r.revisionNumber)
    reviewsByRevision[key] ??= []
    reviewsByRevision[key].push({
      reviewerKey: r.reviewerKey,
      score: r.score,
      verdict: r.verdict,
      summary: r.summary,
      weight: r.weight,
      durationMs: r.durationMs,
      critique: r.critique ? safeJson(r.critique) : null,
    })
  }

  const conflicts = await database
    .select()
    .from(schema.editorOverrides)
    .where(eq(schema.editorOverrides.draftId, id))

  const variants = await database
    .select()
    .from(schema.draftVariants)
    .where(eq(schema.draftVariants.draftId, id))

  // Pull brief + voice weights + link-check out of scoreBreakdown JSON
  let brief: unknown = null
  let voiceWeights: Record<string, number> = {}
  let linkCheck: unknown = null
  if (draft.scoreBreakdown) {
    try {
      const parsed = JSON.parse(draft.scoreBreakdown) as { brief?: unknown; voiceWeights?: Record<string, number>; linkCheck?: unknown }
      brief = parsed.brief ?? null
      voiceWeights = parsed.voiceWeights ?? {}
      linkCheck = parsed.linkCheck ?? null
    } catch { /* keep defaults */ }
  }

  const spendCents = await getDraftSpendCents(database, id)
  const services = checkServiceStatus()

  return NextResponse.json({
    draft: {
      id: draft.id,
      ideaId: draft.ideaId,
      status: draft.status,
      pausedFromStatus: draft.pausedFromStatus,
      title: draft.title,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      bodyHtml: draft.bodyHtml,
      bodyMarkdown: draft.bodyMarkdown,
      keyTakeaways: draft.keyTakeaways,
      faqsJson: draft.faqsJson,
      contentScore: draft.contentScore,
      coverSvgUrl: draft.coverSvgUrl,
      errorMessage: draft.errorMessage,
      stageLockedAt: draft.stageLockedAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    },
    idea: idea ?? null,
    brief,
    voiceWeights,
    linkCheck,
    revisions: revisions.map(r => ({
      revisionNumber: r.revisionNumber,
      source: r.source,
      bodyHtml: r.bodyHtml,
      bodyMarkdown: r.bodyMarkdown,
      wordCount: r.wordCount,
      reason: r.reason,
      createdAt: r.createdAt,
    })),
    reviewsByRevision,
    conflicts,
    variants,
    spendCents,
    services,
  })
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}
