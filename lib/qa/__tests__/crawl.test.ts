import { describe, it, expect } from 'vitest'
import {
  acceptCanonicalOrigin, extractLinks, runCrawl, CRAWL_MAX_PAGES, CRAWL_DEFAULT_PAGES, CRAWL_HOP_BUDGET, CRAWL_CONCURRENCY, CRAWL_MAX_HOPS_PER_FETCH,
  type CrawlPage,
} from '@/lib/qa/crawl'

const ORIGIN = 'https://acme.com'
const PAGE = 'https://acme.com/services/'

describe('extractLinks', () => {
  it('resolves relative hrefs against the page URL', () => {
    const html = `<a href="team">Team</a><a href="../about">About</a><a href="/contact">Contact</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/services/team', '/about', '/contact'])
  })

  it('keeps absolute links on the same origin', () => {
    const html = `<a href="https://acme.com/blog/post-1/">Post</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/blog/post-1'])
  })

  it('treats www and apex as different origins', () => {
    const html = `<a href="https://www.acme.com/www-only">x</a><a href="https://acme.com/apex">y</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/apex'])
  })

  it('skips other origins and protocol-relative links to them', () => {
    const html = `<a href="https://other.com/page">x</a><a href="//other.com/page">y</a><a href="http://acme.com.evil.io/">z</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual([])
  })

  it('skips mailto, tel, javascript and data links', () => {
    const html = `<a href="mailto:hi@acme.com">m</a><a href="tel:+6400000">t</a><a href="javascript:void(0)">j</a><a href="data:text/html,hi">d</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual([])
  })

  it('skips pure hash links and drops hashes and query strings from kept links', () => {
    const html = `<a href="#top">top</a><a href="/pricing?plan=pro#faq">p</a><a href="/pricing#team">q</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/pricing'])
  })

  it('skips asset extensions', () => {
    const html = [
      'deck.pdf', 'logo.PNG', 'photo.jpeg', 'hero.webp', 'icon.svg', 'a.avif', 'b.zip', 'c.mp4',
      'd.mp3', 's.css', 'app.js', 'feed.xml', 'r.txt', 'fav.ico', 'f.woff', 'f.woff2',
    ].map(f => `<a href="/files/${f}">x</a>`).join('')
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual([])
  })

  it('reads single, double and unquoted attributes', () => {
    const html = `<a class="nav" href="/one">1</a><a href='/two'>2</a><a href=/three>3</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/one', '/two', '/three'])
  })

  it('decodes &amp; in attribute values', () => {
    const html = `<a href="/search?a=1&amp;b=2">s</a><a href="/q?x=1&amp;y=2#z">t</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/search', '/q'])
  })

  it('returns each path once', () => {
    const html = `<a href="/about">a</a><a href="/about/">b</a><a href="https://acme.com/about">c</a><a href="/about?x=1">d</a>`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual(['/about'])
  })

  it('ignores the root slash variants and keeps the home page as /', () => {
    const html = `<a href="/">home</a><a href="https://acme.com/">home2</a><a href="./">here</a>`
    expect(extractLinks(html, ORIGIN + '/', ORIGIN)).toEqual(['/'])
  })

  it('does not match tags that only start with a in their name', () => {
    const html = `<abbr href="/nope">x</abbr><area href="/nope2">`
    expect(extractLinks(html, PAGE, ORIGIN)).toEqual([])
  })

  it('returns an empty list for bad input URLs', () => {
    expect(extractLinks(`<a href="/x">x</a>`, 'not a url', ORIGIN)).toEqual([])
    expect(extractLinks(`<a href="/x">x</a>`, PAGE, 'nope')).toEqual([])
  })
})

describe('crawl limits', () => {
  it('exports the documented limits', () => {
    expect(CRAWL_MAX_PAGES).toBe(150)
    expect(CRAWL_DEFAULT_PAGES).toBe(100)
    expect(CRAWL_HOP_BUDGET).toBe(300)
    expect(CRAWL_CONCURRENCY).toBe(4)
    expect(CRAWL_MAX_HOPS_PER_FETCH).toBe(6)
  })
})

/** A fake site: path -> linked hrefs. Reports hops per fetch and tracks concurrency. */
function fakeSite(pages: Record<string, string[]>, opts: { hopsPerFetch?: number; failPaths?: string[]; delayMs?: number } = {}) {
  const state = { active: 0, maxActive: 0, fetched: [] as string[] }
  const fetchPage = async (url: string, countHop: () => void): Promise<CrawlPage | null> => {
    const path = new URL(url).pathname
    state.fetched.push(path)
    state.active++
    state.maxActive = Math.max(state.maxActive, state.active)
    for (let i = 0; i < (opts.hopsPerFetch ?? 1); i++) countHop()
    await new Promise(resolve => setTimeout(resolve, opts.delayMs ?? 1))
    state.active--
    if (opts.failPaths?.includes(path) || !pages[path]) return null
    return { html: pages[path].map(h => `<a href="${h}">x</a>`).join(''), finalUrl: url }
  }
  return { state, fetchPage }
}

describe('runCrawl', () => {
  it('finds every reachable page once, in breadth first order', async () => {
    const { fetchPage, state } = fakeSite({ '/': ['/a', '/b'], '/a': ['/', '/c'], '/b': ['/c'], '/c': [] })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 50, fetchPage, concurrency: 1 })
    expect(out.paths).toEqual(['/', '/a', '/b', '/c'])
    expect(out.truncated).toBe(false)
    expect(state.fetched).toEqual(['/', '/a', '/b', '/c'])
    expect(out.hops).toBe(4)
  })

  it('never runs more than the concurrency limit at once, and does use the pool', async () => {
    const links = Array.from({ length: 20 }, (_, i) => `/p${i}`)
    const pages: Record<string, string[]> = { '/': links }
    for (const l of links) pages[l] = []
    const { fetchPage, state } = fakeSite(pages, { delayMs: 5 })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 100, fetchPage })
    expect(out.paths).toHaveLength(21)
    expect(state.maxActive).toBe(4)
  })

  it('stops at maxPages and reports truncated when links were dropped', async () => {
    const pages: Record<string, string[]> = { '/': ['/a', '/b', '/c', '/d'], '/a': [], '/b': [], '/c': [], '/d': [] }
    const { fetchPage } = fakeSite(pages)
    const out = await runCrawl({ origin: ORIGIN, maxPages: 3, fetchPage })
    expect(out.paths).toHaveLength(3)
    expect(out.truncated).toBe(true)
  })

  it('reports truncated when maxPages is reached with a found page still unexplored', async () => {
    const { fetchPage } = fakeSite({ '/': ['/a'], '/a': [] })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 2, fetchPage })
    expect(out.paths).toEqual(['/', '/a'])
    expect(out.truncated).toBe(true)
  })

  it('keeps the total hops under the budget even when every fetch uses the worst case', async () => {
    const links = Array.from({ length: 60 }, (_, i) => `/p${i}`)
    const pages: Record<string, string[]> = { '/': links }
    for (const l of links) pages[l] = []
    const { fetchPage } = fakeSite(pages, { hopsPerFetch: CRAWL_MAX_HOPS_PER_FETCH })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 150, fetchPage, hopBudget: 60 })
    expect(out.hops).toBeLessThanOrEqual(60)
    expect(out.hops).toBeGreaterThan(0)
    expect(out.truncated).toBe(true)
  })

  it('treats a failed page as a dead end and carries on', async () => {
    const { fetchPage } = fakeSite({ '/': ['/bad', '/ok'], '/ok': ['/deep'], '/deep': [] }, { failPaths: ['/bad'] })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 50, fetchPage })
    expect(out.paths).toEqual(['/', '/bad', '/ok', '/deep'])
    expect(out.truncated).toBe(false)
  })

  it('resolves links against the final URL after a same-origin redirect', async () => {
    const fetchPage = async (url: string, countHop: () => void): Promise<CrawlPage | null> => {
      countHop()
      if (new URL(url).pathname === '/') return { html: '<a href="docs">docs</a>', finalUrl: ORIGIN + '/start/' }
      return { html: '', finalUrl: url }
    }
    const out = await runCrawl({ origin: ORIGIN, maxPages: 10, fetchPage })
    expect(out.paths).toEqual(['/', '/start/docs'])
  })

  it('ignores off-origin links on a page', async () => {
    const fetchPage = async (_url: string, countHop: () => void): Promise<CrawlPage | null> => {
      countHop()
      return { html: '<a href="https://evil.com/x">x</a><a href="/in">in</a>', finalUrl: ORIGIN + '/' }
    }
    const out = await runCrawl({ origin: ORIGIN, maxPages: 10, fetchPage })
    expect(out.paths).toEqual(['/', '/in'])
  })
})

describe('acceptCanonicalOrigin', () => {
  it('accepts www added or removed', () => {
    expect(acceptCanonicalOrigin('https://example.com', 'https://www.example.com/')).toBe('https://www.example.com')
    expect(acceptCanonicalOrigin('https://www.example.com', 'https://example.com/home')).toBe('https://example.com')
  })

  it('accepts http to https, with or without www', () => {
    expect(acceptCanonicalOrigin('http://example.com', 'https://example.com/')).toBe('https://example.com')
    expect(acceptCanonicalOrigin('http://example.com', 'https://www.example.com/')).toBe('https://www.example.com')
  })

  it('returns null when the origin did not move', () => {
    expect(acceptCanonicalOrigin('https://example.com', 'https://example.com/en')).toBeNull()
  })

  it('rejects https to http, other hosts, subdomains and port changes', () => {
    expect(acceptCanonicalOrigin('https://example.com', 'http://www.example.com/')).toBeNull()
    expect(acceptCanonicalOrigin('https://example.com', 'https://other.com/')).toBeNull()
    expect(acceptCanonicalOrigin('https://example.com', 'https://app.example.com/')).toBeNull()
    expect(acceptCanonicalOrigin('https://example.com', 'https://example.com.evil.io/')).toBeNull()
    expect(acceptCanonicalOrigin('https://example.com', 'https://www.example.com:8443/')).toBeNull()
  })

  it('rejects unparseable input', () => {
    expect(acceptCanonicalOrigin('nope', 'https://example.com/')).toBeNull()
    expect(acceptCanonicalOrigin('https://example.com', 'nope')).toBeNull()
  })
})

describe('runCrawl hopsUsed', () => {
  it('counts hops already spent against the budget', async () => {
    const out = await runCrawl({
      origin: ORIGIN,
      maxPages: 10,
      hopBudget: CRAWL_MAX_HOPS_PER_FETCH,
      hopsUsed: 1,
      fetchPage: async () => { throw new Error('should not fetch') },
    })
    expect(out.paths).toEqual(['/'])
    expect(out.hops).toBe(1)
  })
})

describe('runCrawl deadline', () => {
  it('stops starting fetches once the deadline passes and reports truncated', async () => {
    const pages: Record<string, string[]> = { '/': ['/a', '/b', '/c'], '/a': [], '/b': [], '/c': [] }
    const { fetchPage, state } = fakeSite(pages)
    let clock = 0
    const out = await runCrawl({
      origin: ORIGIN,
      maxPages: 50,
      fetchPage: async (url, countHop) => {
        const page = await fetchPage(url, countHop)
        clock += 10_000
        return page
      },
      concurrency: 1,
      deadlineMs: 25_000,
      now: () => clock,
    })
    // '/' at 0, '/a' at 10s, '/b' at 20s, then 30s is past the deadline so '/c' is never fetched.
    expect(state.fetched).toEqual(['/', '/a', '/b'])
    expect(out.paths).toEqual(['/', '/a', '/b', '/c'])
    expect(out.truncated).toBe(true)
  })

  it('does not report truncated when the crawl finishes before the deadline', async () => {
    const { fetchPage } = fakeSite({ '/': ['/a'], '/a': [] })
    const out = await runCrawl({ origin: ORIGIN, maxPages: 50, fetchPage, now: () => 0 })
    expect(out.truncated).toBe(false)
  })
})
