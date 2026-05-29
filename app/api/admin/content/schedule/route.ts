/**
 * GET /api/admin/content/schedule
 *
 * Phase I · Slice 5 — feeds the Schedule tab.
 *
 * Returns three buckets in one round trip:
 *
 *   readyDrafts            — drafts with status='ready' and no publish row.
 *                            For each: pre-computed auto-slot + cooldown
 *                            preview so the UI can show "Next slot: …"
 *                            inline without an extra request.
 *
 *   scheduledDrafts        — drafts that have been staged in Webflow
 *                            (publishedWebflowItemId set) but not yet
 *                            published (publishedAt IS NULL).
 *
 *   publishHistory         — every publish_history row, newest first.
 *                            Includes both already-live and scheduled
 *                            posts (since the publish row is created in
 *                            both cases).
 *
 * Admin-only.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { computeNextSlot } from '@/lib/publish-scheduler'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // ── publish_history (most recent 50)
  const history = await database
    .select({
      id: schema.publishHistory.id,
      draftId: schema.publishHistory.draftId,
      webflowItemId: schema.publishHistory.webflowItemId,
      url: schema.publishHistory.url,
      title: schema.publishHistory.title,
      clusterSlug: schema.publishHistory.clusterSlug,
      publishedAt: schema.publishHistory.publishedAt,
      createdAt: schema.publishHistory.createdAt,
    })
    .from(schema.publishHistory)
    .orderBy(desc(schema.publishHistory.publishedAt))
    .limit(50)

  // ── ready drafts (no publishedWebflowItemId)
  const readyRaw = await database
    .select({
      id: schema.contentDrafts.id,
      ideaId: schema.contentDrafts.ideaId,
      title: schema.contentDrafts.title,
      mainCategorySlug: schema.contentDrafts.mainCategorySlug,
      contentScore: schema.contentDrafts.contentScore,
      coverSvgUrl: schema.contentDrafts.coverSvgUrl,
      authorSlug: schema.contentDrafts.authorSlug,
      shortenedName: schema.contentDrafts.shortenedName,
      ideaTitle: schema.contentIdeas.title,
      clusterName: schema.contentClusters.name,
      clusterSlug: schema.contentClusters.slug,
    })
    .from(schema.contentDrafts)
    .leftJoin(schema.contentIdeas, eq(schema.contentDrafts.ideaId, schema.contentIdeas.id))
    .leftJoin(schema.contentClusters, eq(schema.contentIdeas.clusterId, schema.contentClusters.id))
    .where(and(
      // 'ready' = legacy Slice-2 drafts; 'ready_for_publish' = round-table
      // (Slice 9) drafts. Both are publishable + belong here.
      inArray(schema.contentDrafts.status, ['ready', 'ready_for_publish']),
      isNull(schema.contentDrafts.publishedWebflowItemId),
    ))
    .orderBy(desc(schema.contentDrafts.updatedAt))
    .limit(50)

  // Pre-compute the auto slot for each ready draft using the same
  // publish_history that we just fetched.
  const recentSlots = history.map(h => h.publishedAt)
  const recentClusters = history.map(h => ({
    cluster: h.clusterSlug ?? '',
    publishedAt: h.publishedAt,
    title: h.title,
  }))

  const readyDrafts = readyRaw.map(d => {
    const cluster = d.mainCategorySlug ?? d.clusterSlug ?? ''
    const auto = computeNextSlot({
      mode: 'auto',
      recentSlots,
      newCluster: cluster,
      recentClusters,
    })
    return {
      ...d,
      autoSlot: {
        scheduledFor: auto.scheduledFor,
        reason: auto.reason,
        cooldownConflicts: auto.cooldownConflicts,
      },
    }
  })

  // ── scheduled (staged-in-webflow but not yet published) drafts
  const scheduledDrafts = await database
    .select({
      id: schema.contentDrafts.id,
      title: schema.contentDrafts.title,
      mainCategorySlug: schema.contentDrafts.mainCategorySlug,
      scheduledFor: schema.contentDrafts.scheduledFor,
      publishUrl: schema.contentDrafts.publishUrl,
      publishedWebflowItemId: schema.contentDrafts.publishedWebflowItemId,
      clusterName: schema.contentClusters.name,
      clusterSlug: schema.contentClusters.slug,
    })
    .from(schema.contentDrafts)
    .leftJoin(schema.contentIdeas, eq(schema.contentDrafts.ideaId, schema.contentIdeas.id))
    .leftJoin(schema.contentClusters, eq(schema.contentIdeas.clusterId, schema.contentClusters.id))
    .where(and(
      isNotNull(schema.contentDrafts.publishedWebflowItemId),
      isNotNull(schema.contentDrafts.scheduledFor),
      isNull(schema.contentDrafts.publishedAt),
    ))
    .orderBy(schema.contentDrafts.scheduledFor)
    .limit(50)

  // Counts strip
  const [{ count: readyCount = 0 } = { count: 0 }] = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.contentDrafts)
    .where(and(
      // 'ready' = legacy Slice-2 drafts; 'ready_for_publish' = round-table
      // (Slice 9) drafts. Both are publishable + belong here.
      inArray(schema.contentDrafts.status, ['ready', 'ready_for_publish']),
      isNull(schema.contentDrafts.publishedWebflowItemId),
    ))

  return NextResponse.json({
    readyDrafts,
    scheduledDrafts,
    publishHistory: history,
    counts: {
      ready: Number(readyCount) || 0,
      scheduled: scheduledDrafts.length,
      published: history.filter(h => {
        // Exclude future-dated rows from "published" count
        return Date.parse(h.publishedAt) <= Date.now()
      }).length,
    },
  })
}
