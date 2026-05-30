/**
 * lib/site-index.ts
 *
 * Maintains the site_index table: a Haiku-summarised cache of every live
 * URL on tahi.studio. Used by:
 *   1. Round-table writer — internal-linking context with summaries
 *   2. Glossary auto-link at publish — find all type='glossary' entries
 *   3. Related-posts at publish — find related blog posts
 *   4. Back-link cron — find old posts to back-link from
 *
 * Sync runs weekly via /api/admin/cron/site-index-sync. Incremental —
 * only fetches pages whose content has changed (SHA-256 hash compare).
 */

import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { eq, inArray, and } from 'drizzle-orm'
import { claudeJson } from '@/lib/anthropic-cost'
import { HAIKU_MODEL } from '@/lib/ai-models'
import { embed, cosineSimilarity } from '@/lib/openai'

type DrizzleDB = Awaited<ReturnType<typeof db>>

const SITEMAP_URL = 'https://www.tahi.studio/sitemap.xml'

export interface SiteIndexEntry {
  url: string
  relativeUrl: string
  type: 'blog' | 'glossary' | 'service' | 'work' | 'about' | 'contact' | 'page' | 'other'
  title: string | null
  summary: string | null
}

function classifyUrl(relativeUrl: string): SiteIndexEntry['type'] {
  const p = relativeUrl.toLowerCase()
  if (p.startsWith('/blog/')) return 'blog'
  if (p.startsWith('/resources/glossary/') || p.startsWith('/glossary/')) return 'glossary'
  if (p.startsWith('/services/') || p === '/services') return 'service'
  if (p.startsWith('/work/') || p === '/work') return 'work'
  if (p === '/about') return 'about'
  if (p === '/contact') return 'contact'
  if (p === '/' || p.split('/').filter(Boolean).length <= 1) return 'page'
  return 'other'
}

/** Parse a sitemap.xml string into a list of relative URLs.
 *  Handles both flat <urlset> and sitemap-index nested forms. */
export function parseSitemapXml(xml: string): string[] {
  const urls: string[] = []
  // <loc>...</loc> is universal.
  const locMatches = xml.matchAll(/<loc>([^<]+)<\/loc>/g)
  for (const m of locMatches) {
    const raw = m[1].trim()
    if (!raw) continue
    urls.push(raw)
  }
  return urls
}

/** Convert an absolute tahi.studio URL to a normalised relative path. */
function toRelative(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/(^|\.)tahi\.studio$/i.test(u.hostname)) return null
    return u.pathname.replace(/\/+$/, '') || '/'
  } catch { return null }
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Fetch a single page + extract title + raw body text for hashing. */
async function fetchPage(url: string): Promise<{ ok: boolean; title: string | null; bodyText: string }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TahiContentBot/1.0 (+https://www.tahi.studio)' } })
    if (!res.ok) return { ok: false, title: null, bodyText: '' }
    const html = await res.text()
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+\|\s+Tahi Studio\s*$/i, '').trim() : null
    // Crude body text — strip <head>, <script>, <style>, tags. Good
    // enough for hash-comparison + summarisation input.
    const bodyOnly = html.replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)  // cap for haiku input
    return { ok: true, title, bodyText: bodyOnly }
  } catch {
    return { ok: false, title: null, bodyText: '' }
  }
}

async function safeEmbed(text: string): Promise<string | null> {
  const t = text.trim()
  if (!t) return null
  try {
    const r = await embed(t.slice(0, 4000))
    return JSON.stringify(r.vector)
  } catch { return null }
}

async function summarisePage(
  database: DrizzleDB,
  url: string,
  title: string | null,
  bodyText: string,
): Promise<string> {
  if (!bodyText) return ''
  try {
    const { result } = await claudeJson({
      database, scope: 'site_index', scopeId: url, stage: 'site_index_summary',
      model: HAIKU_MODEL, maxTokens: 200,
      skipCostCap: true,
      systemPrompt: 'You write one-sentence summaries of webpages for an internal-linking index. Output JSON: { "summary": "one-sentence neutral summary, 15-25 words, no marketing language, focused on what someone would learn or do on this page." }',
      userPrompt: `URL: ${url}\nTitle: ${title ?? '(none)'}\n\nPage text (truncated):\n${bodyText}\n\nReturn the JSON now.`,
      parse: (raw: string) => JSON.parse(raw) as { summary: string },
    })
    return result.summary?.trim() ?? ''
  } catch {
    return ''
  }
}

interface SyncResult {
  fetched: number
  newRows: number
  changedRows: number
  unchangedRows: number
  deactivated: number
  errors: number
}

export async function syncSiteIndex(
  database: DrizzleDB,
  opts: { maxPages?: number; budgetMs?: number } = {},
): Promise<SyncResult> {
  const maxPages = opts.maxPages ?? 500
  const budgetMs = opts.budgetMs ?? 25_000
  const t0 = Date.now()

  const result: SyncResult = {
    fetched: 0, newRows: 0, changedRows: 0,
    unchangedRows: 0, deactivated: 0, errors: 0,
  }

  // 1) Pull sitemap + filter to tahi.studio + dedupe + cap.
  // Sitemaps can list the same URL twice (or once with and once without
  // a trailing slash). Without dedupe, the same URL gets handled twice
  // in the loop below and the second iteration triggers a UNIQUE error
  // on site_index.url because existingByUrl was built before the first
  // INSERT landed.
  let urls: string[]
  try {
    const res = await fetch(SITEMAP_URL, { headers: { 'User-Agent': 'TahiContentBot/1.0' } })
    if (!res.ok) throw new Error(`Sitemap ${res.status}`)
    urls = Array.from(new Set(
      parseSitemapXml(await res.text())
        .filter(u => toRelative(u) !== null)
    )).slice(0, maxPages)
  } catch (err) {
    throw new Error(`Sitemap fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (urls.length === 0) return result

  // 2) Load existing rows for all URLs we just pulled. D1 caps SQL
  //    variables per query around 100, so we chunk the IN clause.
  const CHUNK = 80
  const existing: Array<{ id: string; url: string; contentHash: string | null; lastSeenAt: string | null }> = []
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK)
    const rows = await database
      .select({
        id: schema.siteIndex.id,
        url: schema.siteIndex.url,
        contentHash: schema.siteIndex.contentHash,
        lastSeenAt: schema.siteIndex.lastSeenAt,
      })
      .from(schema.siteIndex)
      .where(inArray(schema.siteIndex.url, slice))
    existing.push(...rows)
  }
  const existingByUrl = new Map(existing.map(r => [r.url, r]))
  // Re-fetch threshold — if a URL was last seen within this window we
  // skip the page fetch + hash entirely and just bump lastSeenAt later.
  // 6 days fits the weekly cron cadence.
  const STALE_AFTER_MS = 6 * 86_400_000

  // 3) For each URL: fetch, hash, decide insert/update/skip.
  const now = new Date().toISOString()
  for (const url of urls) {
    if (Date.now() - t0 > budgetMs) break
    const relativeUrl = toRelative(url)
    if (!relativeUrl) continue

    // Skip path: existing row, recently seen → just mark lastSeenAt
    // without re-fetching. Lets the sync drain hundreds of URLs per
    // tick instead of being throttled by per-URL page fetches.
    const prevQuick = existingByUrl.get(url)
    if (prevQuick && prevQuick.lastSeenAt) {
      const ageMs = Date.now() - Date.parse(prevQuick.lastSeenAt)
      if (!Number.isNaN(ageMs) && ageMs < STALE_AFTER_MS) {
        await database.update(schema.siteIndex).set({
          lastSeenAt: now, isActive: 1, updatedAt: now,
        }).where(eq(schema.siteIndex.id, prevQuick.id))
        result.unchangedRows++
        continue
      }
    }

    const page = await fetchPage(url)
    if (!page.ok) { result.errors++; continue }
    result.fetched++

    const contentHash = await sha256Hex(page.bodyText)
    const prev = existingByUrl.get(url)
    const type = classifyUrl(relativeUrl)

    if (!prev) {
      // New URL — fetch summary + embedding, insert.
      const summary = await summarisePage(database, url, page.title, page.bodyText)
      const embedding = await safeEmbed(`${page.title ?? ''}\n${summary}`)
      const newId = crypto.randomUUID()
      try {
        await database.insert(schema.siteIndex).values({
          id: newId,
          url, relativeUrl, type,
          title: page.title,
          summary, contentHash,
          lastSeenAt: now,
          summarisedAt: summary ? now : null,
          isActive: 1,
          embedding,
          createdAt: now, updatedAt: now,
        })
        // Backstop: if a parallel writer raced us between the SELECT
        // and INSERT (or the sitemap had a sneaky duplicate the dedupe
        // above missed), fall through to update by URL instead of
        // crashing the whole sync.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/UNIQUE/i.test(msg) && /url/i.test(msg)) {
          await database.update(schema.siteIndex).set({
            type, title: page.title, summary, contentHash,
            lastSeenAt: now,
            summarisedAt: summary ? now : null,
            isActive: 1, embedding, updatedAt: now,
          }).where(eq(schema.siteIndex.url, url))
        } else {
          throw err
        }
      }
      // Update the in-memory map so subsequent iterations of this same
      // sync don't re-hit the insert branch.
      existingByUrl.set(url, { id: newId, url, contentHash, lastSeenAt: now })
      result.newRows++
    } else if (prev.contentHash !== contentHash) {
      // Changed — re-summarise + re-embed.
      const summary = await summarisePage(database, url, page.title, page.bodyText)
      const embedding = await safeEmbed(`${page.title ?? ''}\n${summary}`)
      await database.update(schema.siteIndex).set({
        type, title: page.title, summary, contentHash,
        lastSeenAt: now,
        summarisedAt: summary ? now : null,
        isActive: 1,
        embedding,
        updatedAt: now,
      }).where(eq(schema.siteIndex.id, prev.id))
      result.changedRows++
    } else {
      // Unchanged — just bump lastSeenAt + isActive.
      await database.update(schema.siteIndex).set({
        lastSeenAt: now, isActive: 1, updatedAt: now,
      }).where(eq(schema.siteIndex.id, prev.id))
      result.unchangedRows++
    }
  }

  // 4) Deactivate rows the sitemap no longer references.
  const stale = await database
    .select({ id: schema.siteIndex.id, url: schema.siteIndex.url })
    .from(schema.siteIndex)
    .where(eq(schema.siteIndex.isActive, 1))
  for (const row of stale) {
    if (!urls.includes(row.url)) {
      await database.update(schema.siteIndex).set({
        isActive: 0, updatedAt: now,
      }).where(eq(schema.siteIndex.id, row.id))
      result.deactivated++
    }
  }

  return result
}

/** Upsert a single page into the site index — fetch, summarise, embed.
 *  Called from the publish route + scheduled-publish cron at the moment
 *  a post goes live, so the new URL is immediately available to the
 *  next publish's glossary auto-link, related-posts, and back-link
 *  candidate lookup. The weekly cron handles the rest of the catalogue.
 *
 *  Returns { ok, fresh, error?, summary?, title? } so callers can log. */
export async function upsertSiteIndexEntry(
  database: DrizzleDB,
  url: string,
): Promise<{ ok: boolean; fresh: boolean; title?: string | null; summary?: string | null; error?: string }> {
  const relativeUrl = toRelative(url)
  if (!relativeUrl) return { ok: false, fresh: false, error: 'Not a tahi.studio URL' }

  const page = await fetchPage(url)
  if (!page.ok) return { ok: false, fresh: false, error: 'page fetch failed' }
  const contentHash = await sha256Hex(page.bodyText)
  const summary = await summarisePage(database, url, page.title, page.bodyText)
  const embedding = await safeEmbed(`${page.title ?? ''}\n${summary}`)
  const type = classifyUrl(relativeUrl)
  const now = new Date().toISOString()

  const [prev] = await database
    .select({ id: schema.siteIndex.id })
    .from(schema.siteIndex)
    .where(eq(schema.siteIndex.url, url))
    .limit(1)

  if (prev) {
    await database.update(schema.siteIndex).set({
      type, title: page.title, summary, contentHash,
      lastSeenAt: now, summarisedAt: summary ? now : null,
      isActive: 1, embedding, updatedAt: now,
    }).where(eq(schema.siteIndex.id, prev.id))
    return { ok: true, fresh: false, title: page.title, summary }
  }
  try {
    await database.insert(schema.siteIndex).values({
      id: crypto.randomUUID(),
      url, relativeUrl, type,
      title: page.title, summary, contentHash,
      lastSeenAt: now, summarisedAt: summary ? now : null,
      isActive: 1, embedding,
      createdAt: now, updatedAt: now,
    })
    return { ok: true, fresh: true, title: page.title, summary }
  } catch (err) {
    // Race with another writer: row appeared between our SELECT and
    // INSERT. Update by URL instead of crashing.
    const msg = err instanceof Error ? err.message : String(err)
    if (/UNIQUE/i.test(msg) && /url/i.test(msg)) {
      await database.update(schema.siteIndex).set({
        type, title: page.title, summary, contentHash,
        lastSeenAt: now, summarisedAt: summary ? now : null,
        isActive: 1, embedding, updatedAt: now,
      }).where(eq(schema.siteIndex.url, url))
      return { ok: true, fresh: false, title: page.title, summary }
    }
    throw err
  }
}

/** Find the top-N most semantically related LIVE blog posts to a given
 *  article text. Used at publish to populate Webflow's related-blog-posts
 *  multi-reference + by the back-link cron to find candidate old posts.
 *
 *  Returns matches sorted by similarity DESC. `excludeRelativeUrl` skips
 *  the article itself if it's already in the site index.
 *
 *  Threshold default 0.50 (loose) — caller can raise it for stricter
 *  back-link discovery (we use 0.72 there). */
export async function findRelatedBlogPosts(
  database: DrizzleDB,
  articleText: string,
  options: {
    topN?: number
    minSimilarity?: number
    excludeRelativeUrl?: string
  } = {},
): Promise<Array<{ url: string; relativeUrl: string; title: string | null; summary: string | null; similarity: number }>> {
  const topN = options.topN ?? 3
  const threshold = options.minSimilarity ?? 0.5

  const t = articleText.trim()
  if (!t) return []

  let articleEmbedding: number[]
  try {
    const r = await embed(t.slice(0, 4000))
    articleEmbedding = r.vector
  } catch { return [] }
  if (!articleEmbedding || articleEmbedding.length === 0) return []

  const rows = await database
    .select({
      url: schema.siteIndex.url,
      relativeUrl: schema.siteIndex.relativeUrl,
      title: schema.siteIndex.title,
      summary: schema.siteIndex.summary,
      embedding: schema.siteIndex.embedding,
    })
    .from(schema.siteIndex)
    .where(and(
      eq(schema.siteIndex.isActive, 1),
      eq(schema.siteIndex.type, 'blog'),
    ))

  const scored: Array<{ url: string; relativeUrl: string; title: string | null; summary: string | null; similarity: number }> = []
  for (const row of rows) {
    if (options.excludeRelativeUrl && row.relativeUrl === options.excludeRelativeUrl) continue
    if (!row.embedding) continue
    let vec: number[]
    try { vec = JSON.parse(row.embedding) as number[] } catch { continue }
    if (!Array.isArray(vec) || vec.length !== articleEmbedding.length) continue
    const sim = cosineSimilarity(articleEmbedding, vec)
    if (sim < threshold) continue
    scored.push({ url: row.url, relativeUrl: row.relativeUrl, title: row.title, summary: row.summary, similarity: sim })
  }

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, topN)
}
