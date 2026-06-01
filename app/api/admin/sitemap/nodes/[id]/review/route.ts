/**
 * POST /api/admin/sitemap/nodes/[id]/review
 * Body: { reviewerKey: SitemapReviewerKey }
 *
 * Runs a single reviewer against the node, stores the result in
 * sitemap_node_reviews, returns the new review row.
 *
 * Gated to Liam + Staci.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'
import {
  getReviewer,
  parseSitemapReviewerOutput,
  type SitemapReviewerKey,
  type SitemapNodeForReview,
} from '@/lib/sitemap-reviewers'
import { claudeJson } from '@/lib/anthropic-cost'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const VALID_KEYS: SitemapReviewerKey[] = [
  'seo_aeo', 'icp', 'brand_voice', 'cro', 'sales', 'marketing',
]

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { reviewerKey?: string }
  const reviewerKey = body.reviewerKey as SitemapReviewerKey | undefined
  if (!reviewerKey || !VALID_KEYS.includes(reviewerKey)) {
    return NextResponse.json({ error: 'reviewerKey required, must be one of: ' + VALID_KEYS.join(', ') }, { status: 400 })
  }
  const database = await db()
  const [node] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const reviewer = getReviewer(reviewerKey)
  const ctx: SitemapNodeForReview = node as SitemapNodeForReview

  try {
    const { result, costCents } = await claudeJson({
      database,
      scope: 'sitemap',
      scopeId: id,
      stage: `sitemap_${reviewerKey}`,
      model: reviewer.model,
      systemPrompt: reviewer.systemPrompt,
      userPrompt: reviewer.buildUserPrompt(ctx),
      maxTokens: 1500,
      parse: parseSitemapReviewerOutput,
    })

    const reviewId = crypto.randomUUID()
    const now = new Date().toISOString()
    await database.insert(schema.sitemapNodeReviews).values({
      id: reviewId,
      nodeId: id,
      reviewerKey,
      score: result.score,
      summary: result.summary,
      suggestions: JSON.stringify(result.suggestions),
      critique: result.critique,
      costCents,
      createdAt: now,
    })
    const [review] = await database
      .select()
      .from(schema.sitemapNodeReviews)
      .where(eq(schema.sitemapNodeReviews.id, reviewId))
      .limit(1)
    return NextResponse.json({ review })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.json({ error: `Reviewer failed: ${message}` }, { status: 500 })
  }
}
