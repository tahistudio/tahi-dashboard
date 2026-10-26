/** Whole-site checks for a round. Pure with an injected fetch. */
import type { QaTarget } from './types'
import type { FetchLike } from './link-check'

export interface QaSiteCheck { code: 'robots' | 'sitemap' | 'https_redirect' | 'www_canonical' | 'favicon'; result: 'pass' | 'warn' | 'fail'; detail: string }

async function get(f: FetchLike, url: string): Promise<Response | null> {
  try { return await f(url, { method: 'GET', redirect: 'manual' }) } catch { return null }
}

export async function runSiteChecks(origin: string, target: QaTarget, f: FetchLike): Promise<QaSiteCheck[]> {
  const out: QaSiteCheck[] = []
  const u = new URL(origin)

  const robots = await get(f, `${origin}/robots.txt`)
  if (!robots || robots.status !== 200) out.push({ code: 'robots', result: 'warn', detail: 'No robots.txt.' })
  else {
    const body = await robots.text()
    const blocksAll = /^\s*disallow:\s*\/\s*$/im.test(body)
    out.push(blocksAll
      ? { code: 'robots', result: target === 'live' ? 'fail' : 'warn', detail: 'robots.txt blocks the whole site.' }
      : { code: 'robots', result: 'pass', detail: 'robots.txt present.' })
  }

  const sitemap = await get(f, `${origin}/sitemap.xml`)
  out.push(sitemap && sitemap.status === 200
    ? { code: 'sitemap', result: 'pass', detail: 'sitemap.xml present.' }
    : { code: 'sitemap', result: 'fail', detail: 'No sitemap.xml.' })

  if (target === 'live') {
    const http = await get(f, `http://${u.host}/`)
    const loc = http?.headers.get('location') ?? ''
    out.push(http && http.status >= 300 && http.status < 400 && loc.startsWith('https://')
      ? { code: 'https_redirect', result: 'pass', detail: 'http redirects to https.' }
      : { code: 'https_redirect', result: 'fail', detail: 'http does not redirect to https.' })

    const otherHost = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`
    const other = await get(f, `https://${otherHost}/`)
    const otherLoc = other?.headers.get('location') ?? ''
    let pointsHome = false
    try { pointsHome = new URL(otherLoc, `https://${otherHost}/`).hostname === u.hostname } catch { pointsHome = false }
    out.push(other && other.status >= 300 && other.status < 400 && pointsHome
      ? { code: 'www_canonical', result: 'pass', detail: `${otherHost} redirects to ${u.hostname}.` }
      : { code: 'www_canonical', result: 'warn', detail: `${otherHost} does not redirect to ${u.hostname}.` })
  }

  const fav = await get(f, `${origin}/favicon.ico`)
  out.push(fav && fav.status === 200
    ? { code: 'favicon', result: 'pass', detail: 'favicon.ico reachable.' }
    : { code: 'favicon', result: 'warn', detail: 'No /favicon.ico (fine if the page declares an icon link; check the SEO tab).' })
  return out
}
