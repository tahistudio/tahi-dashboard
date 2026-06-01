/**
 * POST /api/admin/cron/post-scorecard-sync
 *
 * Pulls GSC + GA4 stats for every published post and writes/refreshes a
 * row in post_scorecards. Run weekly (matches the cadence everything
 * else uses) so each published post accumulates a real performance
 * history. Without this, every prompt/threshold tuning decision is
 * vibes; with it, we have a feedback loop.
 *
 * For each post in publish_history:
 *   - Last 7 days: impressions, clicks, avg position from GSC
 *   - Last 30 days: same
 *   - 7 + 30 day GA4 sessions
 *   - Indexed status via URL Inspection
 *
 * Upserts on webflowItemId. Best-effort per post — one failing post
 * doesn't block the rest.
 *
 * Contract:
 *   POST { maxPosts?, budgetMs? }
 *   200: { scanned, updated, inserted, errors }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import {
  getGoogleAccessToken,
  listGscSites,
  resolveGscPropertyForUrl,
  searchAnalytics,
  inspectUrl,
  runGa4Report,
} from '@/lib/google'
import {
  getBlogPostsCollectionId, getGlossaryCollectionId, listCollectionItems,
} from '@/lib/webflow'

export const dynamic = 'force-dynamic'

interface SyncBody {
  maxPosts?: number
  budgetMs?: number
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as SyncBody
  const maxPosts = body.maxPosts ?? 200    // covers the full 145-URL site comfortably
  const budgetMs = body.budgetMs ?? 22_000  // leave headroom inside Worker 30s limit
  const t0 = Date.now()

  const database = await db()

  // Need Google access token.
  let accessToken: string
  try {
    const tokens = await getGoogleAccessToken(database)
    accessToken = tokens.accessToken
  } catch (err) {
    return NextResponse.json({
      error: 'Google not connected. Connect on /settings.',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 503 })
  }

  // Resolve the GSC property for tahi.studio once.
  let gscSiteUrl: string | null = null
  try {
    const sites = await listGscSites(accessToken)
    const site = resolveGscPropertyForUrl('https://www.tahi.studio/blog/', sites)
    gscSiteUrl = site?.siteUrl ?? null
  } catch (err) {
    console.error('GSC site resolution failed', err)
  }

  // GA4 property id from settings (optional).
  const [ga4Row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'ga4.propertyId'))
    .limit(1)
  const ga4PropertyId = ga4Row?.value ?? null

  // Pull ALL live Webflow blog + glossary URLs (NOT publish_history,
  // which only has round-table pipeline output — misses legacy items).
  interface PostTarget {
    webflowItemId: string
    draftId: string | null
    url: string
    publishedAt: string
  }
  const posts: PostTarget[] = []
  let skippedDrafts = 0
  let skippedArchived = 0
  try {
    const blogCollectionId = await getBlogPostsCollectionId()
    let offset = 0
    while (posts.length < maxPosts) {
      const page = await listCollectionItems(blogCollectionId, { offset, limit: 100 })
      if (page.items.length === 0) break
      for (const it of page.items) {
        if (posts.length >= maxPosts) break
        const slug = (it.fieldData.slug as string | undefined) ?? ''
        if (!slug) continue
        // Skip Webflow drafts (no live URL) + archived items. lastPublished
        // is the authoritative marker — null = never published live, so
        // there's nothing for Google to crawl + no point scoring it.
        if (it.isDraft) { skippedDrafts++; continue }
        if (it.isArchived) { skippedArchived++; continue }
        if (!it.lastPublished) { skippedDrafts++; continue }
        posts.push({
          webflowItemId: it.id,
          draftId: null,
          url: `https://www.tahi.studio/blog/${slug}`,
          publishedAt: it.lastPublished,
        })
      }
      if (page.items.length < 100) break
      offset += page.items.length
    }
  } catch (err) { console.error('blog collection fetch failed', err) }
  try {
    const glossaryCollectionId = await getGlossaryCollectionId()
    let offset = 0
    while (posts.length < maxPosts) {
      const page = await listCollectionItems(glossaryCollectionId, { offset, limit: 100 })
      if (page.items.length === 0) break
      for (const it of page.items) {
        if (posts.length >= maxPosts) break
        const slug = (it.fieldData.slug as string | undefined) ?? ''
        if (!slug) continue
        if (it.isDraft) { skippedDrafts++; continue }
        if (it.isArchived) { skippedArchived++; continue }
        if (!it.lastPublished) { skippedDrafts++; continue }
        posts.push({
          webflowItemId: it.id,
          draftId: null,
          url: `https://www.tahi.studio/resources/glossary/${slug}`,
          publishedAt: it.lastPublished,
        })
      }
      if (page.items.length < 100) break
      offset += page.items.length
    }
  } catch (err) { console.error('glossary collection fetch failed', err) }

  // Purge any scorecard rows for items that are no longer published live
  // (item became a draft / archived / deleted in Webflow). Otherwise the
  // "unindexed" bucket keeps showing them and confuses the underperformers
  // ranking. Match on webflowItemId; anything not in the current published
  // set gets deleted.
  let purged = 0
  try {
    const livePublishedIds = new Set(posts.map(p => p.webflowItemId))
    const existingRows = await database
      .select({ id: schema.postScorecards.id, webflowItemId: schema.postScorecards.webflowItemId })
      .from(schema.postScorecards)
      .limit(500)
    for (const row of existingRows) {
      if (row.webflowItemId && !livePublishedIds.has(row.webflowItemId)) {
        await database.delete(schema.postScorecards).where(eq(schema.postScorecards.id, row.id))
        purged++
      }
    }
  } catch (err) { console.error('scorecard purge failed', err) }

  let updated = 0
  let inserted = 0
  const errors: Array<{ url: string; error: string }> = []
  const startDate7 = isoDaysAgo(7)
  const startDate30 = isoDaysAgo(30)
  const endDate = isoDaysAgo(1)
  const nowIso = new Date().toISOString()

  // Pre-fetch GA4's 30d + 7d sessions report ONCE for the whole site
  // (was running per-URL × 50 = 100 expensive GA4 calls). One report
  // returns all pagePaths × sessions; we look up each URL in-memory.
  const ga4Sessions30Map = new Map<string, number>()
  const ga4Sessions7Map = new Map<string, number>()
  if (ga4PropertyId) {
    try {
      const [r30, r7] = await Promise.all([
        runGa4Report(accessToken, ga4PropertyId, {
          startDate: startDate30, endDate, dimensions: ['pagePath'], metrics: ['sessions'],
        }),
        runGa4Report(accessToken, ga4PropertyId, {
          startDate: startDate7, endDate, dimensions: ['pagePath'], metrics: ['sessions'],
        }),
      ])
      for (const row of r30) {
        const path = row.dimensionValues[0]?.value ?? ''
        if (path) ga4Sessions30Map.set(path, Number(row.metricValues[0]?.value) || 0)
      }
      for (const row of r7) {
        const path = row.dimensionValues[0]?.value ?? ''
        if (path) ga4Sessions7Map.set(path, Number(row.metricValues[0]?.value) || 0)
      }
    } catch (err) { console.error('GA4 batched report failed', err) }
  }

  // Per-URL GSC work runs in parallel batches of 6 so 50 URLs drain
  // in ~5-8 batches × 2-3s = under 25s budget. Each batch fires 3
  // GSC calls × 6 URLs = 18 concurrent requests, well under the GSC
  // 1200 req/min quota.
  const CONCURRENCY = 6
  for (let i = 0; i < posts.length; i += CONCURRENCY) {
    if (Date.now() - t0 > budgetMs) break
    const batch = posts.slice(i, i + CONCURRENCY).filter(p => p.webflowItemId && p.url)
    await Promise.allSettled(batch.map(async p => {
      try {
        // GSC analytics + URL inspect in parallel.
        const filter = [{ filters: [{ dimension: 'page', operator: 'equals', expression: p.url }] }]
        const [gscRows7, gscRows30, indexStatusResult] = await Promise.all([
          gscSiteUrl
            ? searchAnalytics(accessToken, gscSiteUrl, { startDate: startDate7, endDate, dimensions: ['date'], dimensionFilterGroups: filter }).catch(() => [])
            : Promise.resolve([]),
          gscSiteUrl
            ? searchAnalytics(accessToken, gscSiteUrl, { startDate: startDate30, endDate, dimensions: ['date'], dimensionFilterGroups: filter }).catch(() => [])
            : Promise.resolve([]),
          gscSiteUrl
            ? inspectUrl(accessToken, p.url, gscSiteUrl).catch(() => null)
            : Promise.resolve(null),
        ])
        const sum7 = gscRows7.reduce((a, r) => ({
          clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions,
          position: a.position + r.position * r.impressions,
        }), { clicks: 0, impressions: 0, position: 0 })
        const sum30 = gscRows30.reduce((a, r) => ({
          clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions,
          position: a.position + r.position * r.impressions,
        }), { clicks: 0, impressions: 0, position: 0 })
        const avgPos7 = sum7.impressions > 0 ? Math.round((sum7.position / sum7.impressions) * 100) : null
        const avgPos30 = sum30.impressions > 0 ? Math.round((sum30.position / sum30.impressions) * 100) : null

        // GA4 — pulled from the prefetched map.
        const pagePath = (() => {
          try { return new URL(p.url).pathname } catch { return '' }
        })()
        const ga4Sessions30 = pagePath ? (ga4Sessions30Map.get(pagePath) ?? 0) : null
        const ga4Sessions7 = pagePath ? (ga4Sessions7Map.get(pagePath) ?? 0) : null

        // Upsert.
        const [existing] = await database
          .select({ id: schema.postScorecards.id })
          .from(schema.postScorecards)
          .where(eq(schema.postScorecards.webflowItemId, p.webflowItemId))
          .limit(1)

        const row = {
          webflowItemId: p.webflowItemId,
          draftId: p.draftId,
          url: p.url,
          publishedAt: p.publishedAt,
          gscIndexStatus: indexStatusResult?.indexStatus ?? null,
          gscFirstIndexedAt: indexStatusResult?.lastCrawlTime ?? null,
          gscImpressions7d: sum7.impressions || null,
          gscClicks7d: sum7.clicks || null,
          gscAvgPosition7d: avgPos7,
          gscImpressions30d: sum30.impressions || null,
          gscClicks30d: sum30.clicks || null,
          gscAvgPosition30d: avgPos30,
          ga4Sessions7d: ga4Sessions7,
          ga4Sessions30d: ga4Sessions30,
          updatedAt: nowIso,
        }
        if (existing) {
          await database.update(schema.postScorecards).set(row)
            .where(eq(schema.postScorecards.id, existing.id))
          updated++
        } else {
          await database.insert(schema.postScorecards).values({
            id: crypto.randomUUID(),
            createdAt: nowIso,
            ...row,
          })
          inserted++
        }
      } catch (err) {
        errors.push({ url: p.url, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' })
      }
    }))
  }

  return NextResponse.json({
    ok: true,
    scanned: posts.length,
    skippedDrafts,
    skippedArchived,
    purged,
    updated,
    inserted,
    errors,
  })
}
