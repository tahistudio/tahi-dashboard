/**
 * GET /api/admin/content/drafts
 *
 * Lists drafts. Default ordering: most-recently-updated first so
 * in-flight drafts (status='researching'|'drafting'|'reviewing'|'finalising')
 * surface at the top of the list.
 *
 * Query:
 *   ?status=ready|failed|in_progress|all   default 'all'
 *   ?limit=N                                default 50, capped at 100
 *
 * Contract:
 *   { drafts: DraftWithIdea[], counts: { queued, researching, drafting, reviewing, finalising, ready, failed, total } }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const IN_PROGRESS_STATUSES = ['queued', 'researching', 'drafting', 'reviewing', 'finalising'] as const

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'all'
  const limit = (() => {
    const n = parseInt(url.searchParams.get('limit') ?? '50', 10)
    if (!Number.isFinite(n) || n < 1) return 50
    return Math.min(100, n)
  })()

  const database = await db()

  let whereClause
  if (statusParam === 'in_progress') {
    whereClause = inArray(schema.contentDrafts.status, IN_PROGRESS_STATUSES as unknown as string[])
  } else if (statusParam !== 'all') {
    whereClause = eq(schema.contentDrafts.status, statusParam)
  }

  const drafts = await database
    .select({
      id: schema.contentDrafts.id,
      ideaId: schema.contentDrafts.ideaId,
      status: schema.contentDrafts.status,
      title: schema.contentDrafts.title,
      contentScore: schema.contentDrafts.contentScore,
      scoreBreakdown: schema.contentDrafts.scoreBreakdown,
      coverSvgUrl: schema.contentDrafts.coverSvgUrl,
      coverTemplate: schema.contentDrafts.coverTemplate,
      authorSlug: schema.contentDrafts.authorSlug,
      mainCategorySlug: schema.contentDrafts.mainCategorySlug,
      postType: schema.contentDrafts.postType,
      errorMessage: schema.contentDrafts.errorMessage,
      createdAt: schema.contentDrafts.createdAt,
      updatedAt: schema.contentDrafts.updatedAt,
      ideaTitle: schema.contentIdeas.title,
      ideaBrand: schema.contentIdeas.brand,
      ideaStatus: schema.contentIdeas.status,
      ideaTargetKeyword: schema.contentIdeas.targetKeyword,
      ideaRecommendedWordCount: schema.contentIdeas.recommendedWordCount,
      clusterName: schema.contentClusters.name,
      clusterSlug: schema.contentClusters.slug,
    })
    .from(schema.contentDrafts)
    .leftJoin(schema.contentIdeas, eq(schema.contentDrafts.ideaId, schema.contentIdeas.id))
    .leftJoin(schema.contentClusters, eq(schema.contentIdeas.clusterId, schema.contentClusters.id))
    .where(whereClause)
    .orderBy(desc(schema.contentDrafts.updatedAt))
    .limit(limit)

  const countsRows = await database
    .select({
      status: schema.contentDrafts.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.contentDrafts)
    .groupBy(schema.contentDrafts.status)

  const counts: Record<string, number> = {
    queued: 0, researching: 0, drafting: 0, reviewing: 0,
    finalising: 0, ready: 0, failed: 0, total: 0,
  }
  for (const row of countsRows) {
    const key = row.status ?? 'unknown'
    counts[key] = Number(row.count ?? 0)
    counts.total += Number(row.count ?? 0)
  }

  return NextResponse.json({ drafts, counts })
  void and  // kept to mirror neighbouring routes; tree-shaken away
}
