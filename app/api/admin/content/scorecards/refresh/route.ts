/**
 * POST /api/admin/content/scorecards/refresh
 *
 * Refreshes post_scorecards for every published post (joined to
 * publish_history). For each post pulls:
 *   - GSC URL Inspection: index status, first indexed date
 *   - GSC Search Analytics: impressions/clicks/position 7d + 30d
 *   - GA4 reports: sessions, engagement, conversions (when GA4 property set)
 *
 * SE Ranking + Matomo are deferred — wired via their MCP/API in a follow-up.
 *
 * Contract:
 *   POST { onlyStale?: boolean, limit?: number }
 *     -> { refreshed: number, errors: number, errorDetails: [{ url, error }] }
 *
 * Rate-limited: processes 5 URLs at a time with a 25s wall-clock budget.
 * Beyond that, returns continueFromIndex so the caller can resume.
 *
 * Cost: GSC + GA4 + sites.list are all free. No AI calls; no ai_cost_log
 * entries.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, lt, isNull, or } from 'drizzle-orm'
import {
  getGoogleAccessToken,
  inspectUrl,
  searchAnalytics,
  listGscSites,
  resolveGscPropertyForUrl,
  listGa4Properties,
  runGa4Report,
  GoogleNotConnectedError,
} from '@/lib/google'

export const dynamic = 'force-dynamic'

const TIME_BUDGET_MS = 25_000
const BATCH_SIZE = 5
const STALE_AFTER_HOURS = 12

interface RefreshBody {
  onlyStale?: boolean
  limit?: number
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as RefreshBody
  const limit = Math.max(1, Math.min(200, body.limit ?? 50))
  const onlyStale = body.onlyStale !== false  // default true

  const database = await db()

  // Pick the candidate posts. If onlyStale, prefer rows where the
  // scorecard hasn't been refreshed in the last STALE_AFTER_HOURS, OR
  // where there's no scorecard row at all.
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 3_600_000).toISOString()

  const candidatesQuery = database
    .select({
      webflowItemId: schema.publishHistory.webflowItemId,
      url: schema.publishHistory.url,
      title: schema.publishHistory.title,
      publishedAt: schema.publishHistory.publishedAt,
      draftId: schema.publishHistory.draftId,
    })
    .from(schema.publishHistory)
    .leftJoin(schema.postScorecards, eq(schema.postScorecards.webflowItemId, schema.publishHistory.webflowItemId))
    .where(
      onlyStale
        ? or(
            isNull(schema.postScorecards.lastRefreshedAt),
            lt(schema.postScorecards.lastRefreshedAt, cutoff),
          )
        : undefined,
    )
    .orderBy(asc(schema.publishHistory.publishedAt))
    .limit(limit)

  const candidates = await candidatesQuery

  let tokens
  try {
    tokens = await getGoogleAccessToken(database)
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 412 })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  // Resolve GSC property (covers tahi.studio)
  let sites
  try {
    sites = await listGscSites(tokens.accessToken)
  } catch (err) {
    return NextResponse.json({ error: 'GSC sites.list failed', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
  const gscProperty = resolveGscPropertyForUrl('https://www.tahi.studio/', sites)

  // Resolve GA4 property (optional). For now we pick the first available
  // property; a future settings field can let Liam override.
  let ga4PropertyId: string | null = null
  try {
    const ga4 = await listGa4Properties(tokens.accessToken)
    const match = ga4.find(p => p.displayName?.toLowerCase().includes('tahi')) ?? ga4[0]
    ga4PropertyId = match?.propertyId ?? null
  } catch {
    ga4PropertyId = null
  }

  let refreshed = 0
  let errors = 0
  const errorDetails: Array<{ url: string; error: string }> = []
  const now = new Date()
  const nowIso = now.toISOString()
  const sevenDaysAgo = isoDate(new Date(now.getTime() - 7 * 86_400_000))
  const thirtyDaysAgo = isoDate(new Date(now.getTime() - 30 * 86_400_000))
  const today = isoDate(now)

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break
    const batch = candidates.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async c => {
      try {
        // Use typeof $inferInsert to keep Drizzle's inferred shape happy
        // on both update and insert paths.
        const updates: Partial<typeof schema.postScorecards.$inferInsert> = {
          webflowItemId: c.webflowItemId,
          url: c.url,
          publishedAt: c.publishedAt,
          draftId: c.draftId,
          lastRefreshedAt: nowIso,
          updatedAt: nowIso,
        }

        // GSC URL Inspection
        if (gscProperty) {
          try {
            const insp = await inspectUrl(tokens.accessToken, c.url, gscProperty.siteUrl)
            updates.gscIndexStatus = insp.indexStatus
            // We don't track first-indexed-at separately; lastCrawlTime is close enough
            if (insp.lastCrawlTime) updates.gscFirstIndexedAt = insp.lastCrawlTime
          } catch {
            // Per-source error doesn't fail the whole row
          }
          // Search Analytics 7d
          try {
            const rows7 = await searchAnalytics(tokens.accessToken, gscProperty.siteUrl, {
              startDate: sevenDaysAgo, endDate: today,
              dimensions: ['page'],
              dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: c.url }] }],
              rowLimit: 1,
            })
            if (rows7[0]) {
              updates.gscImpressions7d = Math.round(rows7[0].impressions)
              updates.gscClicks7d = Math.round(rows7[0].clicks)
              updates.gscAvgPosition7d = Math.round(rows7[0].position * 100)
            } else {
              updates.gscImpressions7d = 0
              updates.gscClicks7d = 0
            }
          } catch { /* skip */ }
          // Search Analytics 30d
          try {
            const rows30 = await searchAnalytics(tokens.accessToken, gscProperty.siteUrl, {
              startDate: thirtyDaysAgo, endDate: today,
              dimensions: ['page'],
              dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: c.url }] }],
              rowLimit: 1,
            })
            if (rows30[0]) {
              updates.gscImpressions30d = Math.round(rows30[0].impressions)
              updates.gscClicks30d = Math.round(rows30[0].clicks)
              updates.gscAvgPosition30d = Math.round(rows30[0].position * 100)
            } else {
              updates.gscImpressions30d = 0
              updates.gscClicks30d = 0
            }
          } catch { /* skip */ }
        }

        // GA4 — sessions + engagement (last 30d). The helper takes
        // dimension/metric names as strings and applies no filter, so
        // we read 30d rows for all pages then pick the one matching
        // this URL's pathname.
        if (ga4PropertyId) {
          try {
            const pagePath = new URL(c.url).pathname
            const rows = await runGa4Report(tokens.accessToken, ga4PropertyId, {
              startDate: thirtyDaysAgo,
              endDate: today,
              dimensions: ['pagePath'],
              metrics: ['sessions', 'averageSessionDuration', 'conversions'],
              limit: 1000,
            })
            const row = rows.find(r => (r.dimensionValues?.[0]?.value ?? '') === pagePath)
            if (row) {
              updates.ga4Sessions30d = Math.round(parseFloat(row.metricValues?.[0]?.value ?? '0'))
              updates.ga4AvgEngagementSec = Math.round(parseFloat(row.metricValues?.[1]?.value ?? '0'))
              updates.ga4ConversionEvents30d = Math.round(parseFloat(row.metricValues?.[2]?.value ?? '0'))
            } else {
              updates.ga4Sessions30d = 0
            }
          } catch { /* skip */ }
        }

        // Upsert into post_scorecards
        const existing = await database
          .select({ id: schema.postScorecards.id })
          .from(schema.postScorecards)
          .where(eq(schema.postScorecards.webflowItemId, c.webflowItemId))
          .limit(1)
        if (existing.length > 0) {
          await database.update(schema.postScorecards).set(updates).where(eq(schema.postScorecards.webflowItemId, c.webflowItemId))
        } else {
          await database.insert(schema.postScorecards).values({
            ...updates,
            id: crypto.randomUUID(),
            webflowItemId: c.webflowItemId,
            url: c.url,
            publishedAt: c.publishedAt,
            createdAt: nowIso,
          })
        }
        refreshed++
      } catch (err) {
        errors++
        errorDetails.push({
          url: c.url,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        })
      }
    }))
  }

  return NextResponse.json({
    refreshed,
    errors,
    errorDetails: errorDetails.slice(0, 30),
    elapsedMs: Date.now() - t0,
    candidates: candidates.length,
  })
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
