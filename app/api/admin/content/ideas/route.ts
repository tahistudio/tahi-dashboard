/**
 * GET /api/admin/content/ideas
 *
 * Lists content ideas, optionally filtered by status + week. Default is
 * the current ISO week's `proposed` slate (the Monday-triage view).
 *
 * Query:
 *   ?status=proposed|approved|rejected|drafted|scheduled|published|all
 *           default 'proposed'
 *   ?week=YYYY-Www | current | all
 *           default 'current'
 *
 * Contract:
 *   {
 *     ideas: IdeaWithCluster[],
 *     week: string,                  // resolved week label
 *     counts: { proposed, approved, rejected, drafted, scheduled, published, total }
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, desc, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/** ISO week label like 2026-W22. Matches the format the cron writes. */
export function isoWeekLabel(date = new Date()): string {
  // Copy + roll to Thursday in current week (ISO week-of-Thursday rule).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'proposed'
  const weekParam = url.searchParams.get('week') ?? 'current'

  const resolvedWeek = weekParam === 'current' ? isoWeekLabel() : weekParam

  const database = await db()

  const conditions = []
  if (statusParam !== 'all') {
    conditions.push(eq(schema.contentIdeas.status, statusParam))
  }
  if (resolvedWeek !== 'all') {
    conditions.push(eq(schema.contentIdeas.weekLabel, resolvedWeek))
  }

  const rows = await database
    .select({
      id: schema.contentIdeas.id,
      clusterId: schema.contentIdeas.clusterId,
      title: schema.contentIdeas.title,
      angle: schema.contentIdeas.angle,
      targetKeyword: schema.contentIdeas.targetKeyword,
      sourceSignal: schema.contentIdeas.sourceSignal,
      signalSources: schema.contentIdeas.signalSources,
      recommendedWordCount: schema.contentIdeas.recommendedWordCount,
      rationale: schema.contentIdeas.rationale,
      brand: schema.contentIdeas.brand,
      score: schema.contentIdeas.score,
      status: schema.contentIdeas.status,
      weekLabel: schema.contentIdeas.weekLabel,
      liamOpinion: schema.contentIdeas.liamOpinion,
      liamAnswers: schema.contentIdeas.liamAnswers,
      createdAt: schema.contentIdeas.createdAt,
      updatedAt: schema.contentIdeas.updatedAt,
      clusterName: schema.contentClusters.name,
      clusterSlug: schema.contentClusters.slug,
    })
    .from(schema.contentIdeas)
    .leftJoin(schema.contentClusters, eq(schema.contentIdeas.clusterId, schema.contentClusters.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.contentIdeas.score), desc(schema.contentIdeas.createdAt))

  // Counts for the header strip: scoped to the resolved week (or all).
  const countConditions = resolvedWeek !== 'all'
    ? eq(schema.contentIdeas.weekLabel, resolvedWeek)
    : undefined
  const counts = await database
    .select({
      status: schema.contentIdeas.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(schema.contentIdeas)
    .where(countConditions)
    .groupBy(schema.contentIdeas.status)

  const countMap: Record<string, number> = {
    proposed: 0, approved: 0, rejected: 0,
    drafted: 0, scheduled: 0, published: 0, total: 0,
  }
  for (const row of counts) {
    const key = row.status ?? 'unknown'
    countMap[key] = Number(row.count ?? 0)
    countMap.total += Number(row.count ?? 0)
  }

  return NextResponse.json({
    ideas: rows,
    week: resolvedWeek,
    counts: countMap,
  })
}
