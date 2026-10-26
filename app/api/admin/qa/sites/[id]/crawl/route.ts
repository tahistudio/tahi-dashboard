import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchText, isRecord, loadSite, parseTarget, serverFetch, targetOrigin } from '@/lib/qa/server'
import { isSafePublicUrl } from '@/lib/qa/ssrf'
import { CRAWL_DEFAULT_PAGES, CRAWL_MAX_PAGES, acceptCanonicalOrigin, runCrawl } from '@/lib/qa/crawl'
import { upsertSitePages } from '@/lib/qa/page-upsert'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/qa/sites/[id]/crawl  body { target: 'staging' | 'live', maxPages? }
 *
 * Breadth first crawl from '/' over one target's origin (runCrawl in
 * lib/qa/crawl.ts): up to 4 pages in flight, every upstream hop counted
 * against CRAWL_HOP_BUDGET so the request stays under the Worker subrequest
 * cap, and hops never leave the origin. The origin is first resolved by
 * fetching '/' once: a www or http to https redirect moves the crawl to that
 * origin (canonicalOrigin in the response), any other redirect is not followed.
 * Stops when maxPages paths are found
 * or the budget is used. Found paths are upserted with source 'crawl'.
 * truncated is true when a limit stopped the crawl with paths unexplored.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const target = parseTarget(body.target)
  if (!target) return NextResponse.json({ error: "target must be 'staging' or 'live'" }, { status: 400 })
  let maxPages = CRAWL_DEFAULT_PAGES
  if (body.maxPages !== undefined) {
    if (typeof body.maxPages !== 'number' || !Number.isInteger(body.maxPages) || body.maxPages < 1 || body.maxPages > CRAWL_MAX_PAGES) {
      return NextResponse.json({ error: `maxPages must be a whole number from 1 to ${CRAWL_MAX_PAGES}` }, { status: 400 })
    }
    maxPages = body.maxPages
  }

  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const origin = targetOrigin(site, target)
  if (!origin || !isSafePublicUrl(origin)) return NextResponse.json({ error: 'This site has no URL for that target' }, { status: 400 })

  // Resolve the canonical origin first: fetch '/' once with redirects allowed (each hop is SSRF checked and counted).
  // Only a www or http to https move is followed; any other redirect keeps the original origin.
  let resolveHops = 0
  const home = await fetchText(`${origin}/`, serverFetch, { onHop: () => { resolveHops++ } })
  const moved = home ? acceptCanonicalOrigin(origin, home.finalUrl) : null
  const crawlOrigin = moved && isSafePublicUrl(moved) ? moved : origin

  const outcome = await runCrawl({
    origin: crawlOrigin,
    maxPages,
    hopsUsed: resolveHops,
    fetchPage: async (url, countHop) => {
      // Every hop stays on the crawl origin, so a redirect off-site is never fetched or followed.
      const page = await fetchText(url, serverFetch, { sameOrigin: crawlOrigin, onHop: countHop })
      return page ? { html: page.text, finalUrl: page.finalUrl } : null
    },
  })

  const counts = await upsertSitePages(database, id, outcome.paths, 'crawl')
  return NextResponse.json({
    found: outcome.paths.length,
    added: counts.added,
    restored: counts.restored,
    truncated: outcome.truncated,
    ...(crawlOrigin !== origin ? { canonicalOrigin: crawlOrigin } : {}),
  })
}
