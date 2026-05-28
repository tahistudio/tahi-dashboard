/**
 * POST /api/admin/content/health/scan
 *
 * Runs a GSC URL Inspection scan over a list of URLs (defaults to the
 * tahi.studio sitemap) and upserts every result into the blog_health
 * table. One row per URL — re-running overwrites the existing snapshot.
 *
 * Rate limit: GSC's URL Inspection API allows ~600 req/min, but
 * Cloudflare Workers have a per-request CPU budget. We process URLs in
 * batches of 20 in parallel, sequentially across batches, with a 25s
 * total wall-clock budget. If more URLs remain when we hit the budget,
 * we return `continueFromIndex` so the caller (UI) can re-call with
 * the remaining slice.
 *
 * Contract (must stay stable):
 *   POST body: { urls?: string[], continueFromIndex?: number }
 *   200: {
 *     scanned: number,                // count of URLs we ATTEMPTED this call
 *     completed: number,              // count that succeeded
 *     indexed: number,                // verdict === 'PASS'
 *     notIndexed: number,             // verdict in ['PARTIAL', 'FAIL', 'NEUTRAL']
 *     errors: number,                 // GSC errors / network failures
 *     errorDetails: Array<{url, error}>,
 *     continueFromIndex?: number,     // present when more URLs remain
 *     totalUrls: number,              // total in the working set
 *     completedAt: string,            // ISO
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getGoogleAccessToken, inspectUrl, GoogleNotConnectedError } from '@/lib/google'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://www.tahi.studio/'
const SITEMAP_URL = 'https://www.tahi.studio/sitemap.xml'

const BATCH_SIZE = 20
const TIME_BUDGET_MS = 25_000

async function fetchSitemapUrls(rootUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  const res = await fetch(rootUrl, {
    headers: { Accept: 'application/xml, text/xml, */*' },
  })
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`)
  const xml = await res.text()
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map(m => m[1])
  const isIndex = /<sitemapindex/i.test(xml)
  if (!isIndex) return locs
  const urls: string[] = []
  for (const sub of locs) {
    try {
      urls.push(...await fetchSitemapUrls(sub, depth + 1))
    } catch { /* skip bad sub-sitemaps */ }
  }
  return urls
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { urls?: string[]; continueFromIndex?: number }
  const startIndex = Math.max(0, body.continueFromIndex ?? 0)

  // Resolve the working set of URLs
  let urls: string[]
  if (Array.isArray(body.urls) && body.urls.length > 0) {
    urls = body.urls
  } else {
    try {
      const all = await fetchSitemapUrls(SITEMAP_URL)
      urls = Array.from(new Set(all)).sort()
    } catch (err) {
      console.error('sitemap fetch failed in scan', err)
      return NextResponse.json({
        error: 'Failed to fetch sitemap',
        detail: err instanceof Error ? err.message : String(err),
      }, { status: 502 })
    }
  }

  const totalUrls = urls.length
  const slice = urls.slice(startIndex)

  // Get a live Google access token
  const database = await db()
  let tokens
  try {
    tokens = await getGoogleAccessToken(database)
  } catch (err) {
    const status = err instanceof GoogleNotConnectedError ? 412 : 500
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status })
  }

  let scanned = 0
  let completed = 0
  let indexed = 0
  let notIndexed = 0
  let errors = 0
  const errorDetails: Array<{ url: string; error: string }> = []
  let continueFromIndex: number | undefined

  for (let i = 0; i < slice.length; i += BATCH_SIZE) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      continueFromIndex = startIndex + i
      break
    }
    const batch = slice.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(batch.map(async (url) => {
      try {
        const r = await inspectUrl(tokens.accessToken, url, SITE_URL)
        return { url, ok: true as const, r }
      } catch (err) {
        return {
          url,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }))

    // Persist sequentially per batch — D1 can't take large parallel
    // upsert storms cleanly.
    const nowIso = new Date().toISOString()
    for (const res of results) {
      scanned++
      if (!res.ok) {
        errors++
        errorDetails.push({ url: res.url, error: res.error })
        continue
      }
      completed++
      if (res.r.indexStatus === 'PASS') indexed++
      else if (res.r.indexStatus === 'PARTIAL' || res.r.indexStatus === 'FAIL' || res.r.indexStatus === 'NEUTRAL') notIndexed++

      const existing = await database
        .select({ url: schema.blogHealth.url })
        .from(schema.blogHealth)
        .where(eq(schema.blogHealth.url, res.url))
        .limit(1)
      const row = {
        url: res.url,
        lastCheckedAt: nowIso,
        indexStatus: res.r.indexStatus ?? null,
        coverageState: res.r.coverageState ?? null,
        pageFetchState: res.r.pageFetchState ?? null,
        robotsTxtState: res.r.robotsTxtState ?? null,
        indexingState: res.r.indexingState ?? null,
        userCanonical: res.r.userCanonical ?? null,
        googleCanonical: res.r.googleCanonical ?? null,
        raw: JSON.stringify(res.r.raw ?? null),
        source: 'sitemap' as const,
        updatedAt: nowIso,
      }
      if (existing.length > 0) {
        await database.update(schema.blogHealth).set(row).where(eq(schema.blogHealth.url, res.url))
      } else {
        await database.insert(schema.blogHealth).values({ ...row, createdAt: nowIso })
      }
    }
  }

  return NextResponse.json({
    scanned,
    completed,
    indexed,
    notIndexed,
    errors,
    errorDetails: errorDetails.slice(0, 50),
    continueFromIndex,
    totalUrls,
    completedAt: new Date().toISOString(),
  })
}
