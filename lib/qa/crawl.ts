/**
 * Link extraction and the crawl scheduler for Site QA. Pure (no Next, no D1) so
 * the worker can import it too. Regex based, like lib/qa/sitemap.ts.
 */
import { normalisePath } from './sitemap'

export const CRAWL_MAX_PAGES = 150
export const CRAWL_DEFAULT_PAGES = 100

const ANCHOR_HREF = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
const ASSET_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|avif|zip|mp4|mp3|css|js|xml|txt|ico|woff2?)$/i

function decodeAttr(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/**
 * Returns the unique same-origin page paths linked from one HTML document.
 * Relative hrefs resolve against pageUrl. Skips non-http(s) schemes (mailto,
 * tel, javascript, data), pure hash links, other origins (www and apex are
 * different origins) and asset files. Query strings and hashes are dropped and
 * paths are normalised with normalisePath.
 */
export function extractLinks(html: string, pageUrl: string, origin: string): string[] {
  let base: URL
  let sameOrigin: string
  try {
    base = new URL(pageUrl)
    sameOrigin = new URL(origin).origin
  } catch {
    return []
  }
  const out = new Set<string>()
  const re = new RegExp(ANCHOR_HREF.source, ANCHOR_HREF.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const raw = decodeAttr((m[1] ?? m[2] ?? m[3] ?? '').trim())
    if (!raw || raw.startsWith('#')) continue
    let url: URL
    try {
      url = new URL(raw, base)
    } catch {
      continue
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    if (url.origin !== sameOrigin) continue
    if (ASSET_EXT.test(url.pathname)) continue
    const path = normalisePath(url.pathname)
    if (path) out.add(path)
  }
  return [...out]
}

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host
}

/**
 * Decides whether landing on finalUrl when fetching the site's homepage is an
 * acceptable canonical move. Returns the canonical origin to crawl instead of
 * siteOrigin when finalUrl differs only by a www. prefix added or removed, an
 * http to https upgrade, or both. Returns null for no change or any other move
 * (other host, https to http, a custom port, unparseable input).
 */
export function acceptCanonicalOrigin(siteOrigin: string, finalUrl: string): string | null {
  let site: URL
  let final: URL
  try {
    site = new URL(siteOrigin)
    final = new URL(finalUrl)
  } catch {
    return null
  }
  if (final.origin === site.origin) return null
  if (site.protocol !== 'http:' && site.protocol !== 'https:') return null
  if (final.protocol !== 'http:' && final.protocol !== 'https:') return null
  if (site.protocol === 'https:' && final.protocol === 'http:') return null
  if (site.port !== final.port) return null
  if (stripWww(site.hostname) !== stripWww(final.hostname)) return null
  return final.origin
}

/** Upstream fetches (redirect hops included) one crawl may make. D1 statements and other Worker work count against the 1000 subrequest cap too, so this stays well under it. */
export const CRAWL_HOP_BUDGET = 300
/** Wall clock allowance for one crawl. No new page fetch starts after it, so the request stays well inside the Worker time limit. */
export const CRAWL_DEADLINE_MS = 25_000
/** Page fetches in flight at once. */
export const CRAWL_CONCURRENCY = 4
/** fetchText follows at most 5 redirects, so one page fetch is at most 6 upstream hops. */
export const CRAWL_MAX_HOPS_PER_FETCH = 6

export interface CrawlPage { html: string; finalUrl: string }

export interface CrawlPlan {
  /** Origin of the site being crawled, for example https://acme.com */
  origin: string
  maxPages: number
  /** Reads one page. Must call countHop once per upstream fetch it makes. Returns null when the page cannot be read. */
  fetchPage: (url: string, countHop: () => void) => Promise<CrawlPage | null>
  hopBudget?: number
  concurrency?: number
  /** Upstream fetches already spent before the crawl starts (for example resolving the canonical origin). */
  hopsUsed?: number
  /** Stop starting page fetches after this many milliseconds. Defaults to CRAWL_DEADLINE_MS. */
  deadlineMs?: number
  /** Clock in milliseconds, injectable for tests. Defaults to Date.now. */
  now?: () => number
}

export interface CrawlOutcome {
  /** Found page paths, starting with '/', in discovery order. */
  paths: string[]
  /** True when a limit (page cap, hop budget or deadline) stopped the crawl with pages unexplored or links dropped. */
  truncated: boolean
  /** Upstream fetches made. */
  hops: number
}

/**
 * Breadth first crawl from '/' with a small worker pool. A new page fetch only
 * starts when the hop budget still covers the worst case for every fetch in
 * flight plus the new one, so the total can never pass hopBudget. Pure: all
 * I/O goes through plan.fetchPage.
 */
export async function runCrawl(plan: CrawlPlan): Promise<CrawlOutcome> {
  const hopBudget = plan.hopBudget ?? CRAWL_HOP_BUDGET
  const concurrency = Math.max(1, plan.concurrency ?? CRAWL_CONCURRENCY)
  const now = plan.now ?? Date.now
  const startedAt = now()
  const deadlineMs = plan.deadlineMs ?? CRAWL_DEADLINE_MS
  const found: string[] = ['/']
  const seen = new Set<string>(found)
  let next = 0
  let inFlight = 0
  let hops = plan.hopsUsed ?? 0
  let droppedLinks = false
  let waiters: Array<() => void> = []
  const wake = () => {
    const pending = waiters
    waiters = []
    for (const resolve of pending) resolve()
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (found.length >= plan.maxPages) return
      if (next >= found.length) {
        if (inFlight === 0) return
        await new Promise<void>(resolve => { waiters.push(resolve) })
        continue
      }
      if (now() - startedAt >= deadlineMs) return
      if (hops + CRAWL_MAX_HOPS_PER_FETCH * (inFlight + 1) > hopBudget) return
      const path = found[next++]
      const pageUrl = `${plan.origin}${path}`
      inFlight++
      try {
        const page = await plan.fetchPage(pageUrl, () => { hops++ })
        if (page) {
          for (const link of extractLinks(page.html, page.finalUrl, plan.origin)) {
            if (seen.has(link)) continue
            if (found.length >= plan.maxPages) {
              droppedLinks = true
              break
            }
            seen.add(link)
            found.push(link)
          }
        }
      } finally {
        inFlight--
        wake()
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { paths: found, truncated: next < found.length || droppedLinks, hops }
}
