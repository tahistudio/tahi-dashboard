/**
 * GET /api/admin/content/health/sitemap
 *
 * Pulls https://www.tahi.studio/sitemap.xml, parses every <loc>, and
 * returns the flat list of URLs plus a count grouped by top-level path
 * segment (so the UI can show "/blog: 57, /resources/glossary: 119" etc).
 *
 * No DB writes — pure read-through. 60s cache header so we don't hammer
 * the live site if the page re-fetches.
 *
 * Contract (must stay stable — frontend Health tab depends on it):
 *   { urls: string[], byPath: Record<string, number>, totalCount: number, fetchedAt: string }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SITEMAP_URL = 'https://www.tahi.studio/sitemap.xml'

/**
 * Extract every <loc>…</loc> URL from sitemap XML, including the
 * recursive case where the root sitemap is an INDEX pointing at
 * sub-sitemaps. We don't ship a full XML parser — simple regex is
 * enough for Webflow's well-formed output and keeps the worker bundle
 * small.
 */
async function fetchSitemapUrls(rootUrl: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []  // belt-and-braces against pathological cycles
  const res = await fetch(rootUrl, {
    headers: { Accept: 'application/xml, text/xml, */*' },
  })
  if (!res.ok) {
    throw new Error(`Sitemap fetch failed: ${res.status} ${rootUrl}`)
  }
  const xml = await res.text()
  const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map(m => m[1])
  // Detect sitemap-index vs urlset. A sitemap index lists OTHER sitemap
  // URLs (typically ending in .xml). Recurse into each one.
  const isIndex = /<sitemapindex/i.test(xml)
  if (!isIndex) return locs
  const urls: string[] = []
  for (const sub of locs) {
    try {
      urls.push(...await fetchSitemapUrls(sub, depth + 1))
    } catch (err) {
      console.error('sitemap sub-fetch failed', sub, err)
    }
  }
  return urls
}

function bucketByPath(urls: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const u of urls) {
    let path = '/'
    try {
      path = new URL(u).pathname
    } catch {
      continue
    }
    // Group by the first 1-2 path segments so /resources/glossary/foo
    // rolls up into /resources/glossary.
    const segs = path.split('/').filter(Boolean)
    let bucket = '/'
    if (segs.length === 0) bucket = '/'
    else if (segs.length === 1) bucket = `/${segs[0]}`
    else bucket = `/${segs[0]}/${segs[1]}`
    out[bucket] = (out[bucket] ?? 0) + 1
  }
  return out
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const urls = await fetchSitemapUrls(SITEMAP_URL)
    // Dedupe + sort for deterministic output
    const unique = Array.from(new Set(urls)).sort()
    const payload = {
      urls: unique,
      byPath: bucketByPath(unique),
      totalCount: unique.length,
      fetchedAt: new Date().toISOString(),
    }
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    console.error('sitemap fetch failed', err)
    return NextResponse.json({
      error: 'Failed to fetch sitemap',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }
}
