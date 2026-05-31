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
  const maxPosts = body.maxPosts ?? 50
  const budgetMs = body.budgetMs ?? 25_000
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
        posts.push({
          webflowItemId: it.id,
          draftId: null,
          url: `https://www.tahi.studio/blog/${slug}`,
          publishedAt: it.lastPublished ?? it.createdOn ?? new Date().toISOString(),
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
        posts.push({
          webflowItemId: it.id,
          draftId: null,
          url: `https://www.tahi.studio/resources/glossary/${slug}`,
          publishedAt: it.lastPublished ?? it.createdOn ?? new Date().toISOString(),
        })
      }
      if (page.items.length < 100) break
      offset += page.items.length
    }
  } catch (err) { console.error('glossary collection fetch failed', err) }

  let updated = 0
  let inserted = 0
  const errors: Array<{ url: string; error: string }> = []
  const startDate7 = isoDaysAgo(7)
  const startDate30 = isoDaysAgo(30)
  const endDate = isoDaysAgo(1)
  const nowIso = new Date().toISOString()

  for (const p of posts) {
    if (Date.now() - t0 > budgetMs) break
    if (!p.webflowItemId || !p.url) continue

    try {
      // GSC analytics — filter to this URL.
      let gscRows7: Array<{ clicks: number; impressions: number; position: number }> = []
      let gscRows30: Array<{ clicks: number; impressions: number; position: number }> = []
      if (gscSiteUrl) {
        const filter = [{ filters: [{ dimension: 'page', operator: 'equals', expression: p.url }] }]
        try {
          gscRows7 = await searchAnalytics(accessToken, gscSiteUrl, {
            startDate: startDate7, endDate, dimensions: ['date'], dimensionFilterGroups: filter,
          })
        } catch { /* keep empty */ }
        try {
          gscRows30 = await searchAnalytics(accessToken, gscSiteUrl, {
            startDate: startDate30, endDate, dimensions: ['date'], dimensionFilterGroups: filter,
          })
        } catch { /* keep empty */ }
      }
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

      // URL indexing status.
      let indexStatus: string | null = null
      let firstIndexedAt: string | null = null
      if (gscSiteUrl) {
        try {
          const ins = await inspectUrl(accessToken, p.url, gscSiteUrl)
          indexStatus = ins.indexStatus ?? null
          firstIndexedAt = ins.lastCrawlTime ?? null
        } catch { /* skip */ }
      }

      // GA4 sessions.
      let ga4Sessions7: number | null = null
      let ga4Sessions30: number | null = null
      if (ga4PropertyId) {
        try {
          const pagePath = new URL(p.url).pathname
          const rep30 = await runGa4Report(accessToken, ga4PropertyId, {
            startDate: startDate30, endDate,
            dimensions: ['pagePath'], metrics: ['sessions'],
          })
          ga4Sessions30 = rep30
            .filter(r => r.dimensionValues[0]?.value === pagePath)
            .reduce((a, r) => a + (Number(r.metricValues[0]?.value) || 0), 0)
          const rep7 = await runGa4Report(accessToken, ga4PropertyId, {
            startDate: startDate7, endDate,
            dimensions: ['pagePath'], metrics: ['sessions'],
          })
          ga4Sessions7 = rep7
            .filter(r => r.dimensionValues[0]?.value === pagePath)
            .reduce((a, r) => a + (Number(r.metricValues[0]?.value) || 0), 0)
        } catch { /* skip */ }
      }

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
        gscIndexStatus: indexStatus,
        gscFirstIndexedAt: firstIndexedAt,
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
  }

  return NextResponse.json({
    ok: true,
    scanned: posts.length,
    updated,
    inserted,
    errors,
  })
}
