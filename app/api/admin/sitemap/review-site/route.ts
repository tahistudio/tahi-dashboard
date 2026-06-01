/**
 * POST /api/admin/sitemap/review-site — "Boardroom" mode.
 *
 * Fans out all 6 site-level reviewers in parallel against the WHOLE
 * sitemap (not a single node). Persists each result with nodeId='SITE'
 * sentinel in sitemap_node_reviews so the same table holds page-level
 * + site-level critique without a schema change.
 *
 * Gated to Liam + Staci.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, eq } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'
import {
  SITE_REVIEWERS,
  parseSiteReviewerOutput,
  type SiteNodeSummary,
  type SitemapSiteReviewerKey,
} from '@/lib/sitemap-site-reviewers'
import { claudeJson } from '@/lib/anthropic-cost'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const SITE_SENTINEL = 'SITE'

interface ReviewerOutcome {
  reviewerKey: SitemapSiteReviewerKey
  ok: boolean
  reviewId?: string
  score?: number
  summary?: string
  error?: string
}

export async function POST(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const database = await db()

  const nodes = await database
    .select()
    .from(schema.sitemapNodes)
    .orderBy(asc(schema.sitemapNodes.sortOrder))

  if (nodes.length === 0) {
    return NextResponse.json({ error: 'Sitemap is empty. Add nodes before running the boardroom.' }, { status: 400 })
  }

  // Compute depth per node (root parentId === null).
  const depthOf = new Map<string, number>()
  function computeDepth(id: string, parentId: string | null): number {
    if (depthOf.has(id)) return depthOf.get(id)!
    if (!parentId) { depthOf.set(id, 0); return 0 }
    const parent = nodes.find(n => n.id === parentId)
    const d = parent ? computeDepth(parent.id, parent.parentId) + 1 : 0
    depthOf.set(id, d)
    return d
  }
  const summary: SiteNodeSummary[] = nodes.map(n => ({
    id: n.id,
    parentId: n.parentId,
    depth: computeDepth(n.id, n.parentId),
    title: n.title,
    nodeType: n.nodeType as SiteNodeSummary['nodeType'],
    slug: n.slug,
    url: n.url,
    purpose: n.purpose,
    icpAudience: n.icpAudience,
    primaryKeyword: n.primaryKeyword,
    aeoIntent: n.aeoIntent,
    positioningVertical: n.positioningVertical,
    successMetric: n.successMetric,
    status: n.status,
    specialFeatures: n.specialFeatures,
    contentBlocksNeeded: n.contentBlocksNeeded,
  }))

  const now = new Date().toISOString()

  const outcomes = await Promise.all(SITE_REVIEWERS.map(async (reviewer): Promise<ReviewerOutcome> => {
    try {
      const { result, costCents } = await claudeJson({
        database,
        scope: 'sitemap',
        scopeId: SITE_SENTINEL,
        stage: `sitemap_site_${reviewer.key}`,
        model: reviewer.model,
        systemPrompt: reviewer.systemPrompt,
        userPrompt: reviewer.buildUserPrompt(summary),
        maxTokens: 2500,
        parse: parseSiteReviewerOutput,
      })
      const reviewId = crypto.randomUUID()
      // Store the full result (incl. topStrengths/Gaps/Risks) in suggestions
      // as the JSON payload, since we don't have a dedicated column for those.
      const fullPayload = JSON.stringify({
        topStrengths: result.topStrengths,
        topGaps: result.topGaps,
        topRisks: result.topRisks,
        suggestions: result.suggestions,
      })
      await database.insert(schema.sitemapNodeReviews).values({
        id: reviewId,
        nodeId: SITE_SENTINEL,
        reviewerKey: reviewer.key,
        score: result.score,
        summary: result.summary,
        suggestions: fullPayload,
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

// GET returns the latest site-level review for each reviewer.
export async function GET(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const database = await db()
  const rows = await database
    .select()
    .from(schema.sitemapNodeReviews)
    .where(eq(schema.sitemapNodeReviews.nodeId, SITE_SENTINEL))
  // Sort desc by createdAt and keep first per reviewer.
  rows.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const seen = new Set<string>()
  const latest: typeof rows = []
  for (const r of rows) {
    if (seen.has(r.reviewerKey)) continue
    seen.add(r.reviewerKey)
    latest.push(r)
  }
  return NextResponse.json({ reviews: latest })
}
