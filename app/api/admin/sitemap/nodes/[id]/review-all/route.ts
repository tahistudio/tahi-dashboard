/**
 * POST /api/admin/sitemap/nodes/[id]/review-all
 *
 * Fans out all 6 sub-agent reviewers in parallel against the node.
 * Returns an array of { reviewerKey, ok, review?, error? } so partial
 * failures don't sink the whole batch.
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
  SITEMAP_REVIEWERS,
  parseSitemapReviewerOutput,
  type SitemapReviewerKey,
  type SitemapNodeForReview,
} from '@/lib/sitemap-reviewers'
import { claudeJson } from '@/lib/anthropic-cost'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

interface ReviewerOutcome {
  reviewerKey: SitemapReviewerKey
  ok: boolean
  reviewId?: string
  score?: number
  summary?: string
  error?: string
}

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const database = await db()
  const [node] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx: SitemapNodeForReview = node as SitemapNodeForReview
  const now = new Date().toISOString()

  const outcomes = await Promise.all(SITEMAP_REVIEWERS.map(async (reviewer): Promise<ReviewerOutcome> => {
    try {
      const { result, costCents } = await claudeJson({
        database,
        scope: 'sitemap',
        scopeId: id,
        stage: `sitemap_${reviewer.key}`,
        model: reviewer.model,
        systemPrompt: reviewer.systemPrompt,
        userPrompt: reviewer.buildUserPrompt(ctx),
        maxTokens: 1500,
        parse: parseSitemapReviewerOutput,
      })
      const reviewId = crypto.randomUUID()
      await database.insert(schema.sitemapNodeReviews).values({
        id: reviewId,
        nodeId: id,
        reviewerKey: reviewer.key,
        score: result.score,
        summary: result.summary,
        suggestions: JSON.stringify(result.suggestions),
        critique: result.critique,
        costCents,
        createdAt: now,
      })
      return { reviewerKey: reviewer.key, ok: true, reviewId, score: result.score, summary: result.summary }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      return { reviewerKey: reviewer.key, ok: false, error: message }
    }
  }))

  return NextResponse.json({ outcomes })
}
