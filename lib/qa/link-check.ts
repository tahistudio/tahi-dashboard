/**
 * Server-side link checking with an injected fetch (testable, and the route
 * passes globalThis.fetch). HEAD first, GET on 405/501, manual redirects up
 * to 5 hops, 8s timeout per request, concurrency 6.
 */
import type { QaLinkResult, QaTarget } from './types'
import { isSafePublicUrl } from './ssrf'

export type FetchLike = (url: string, init: RequestInit & { method: string }) => Promise<Response>

export interface LinkCheckOptions { fetch: FetchLike; target: QaTarget; timeoutMs?: number; maxHops?: number }

const MAX_HOPS = 5
const TIMEOUT_MS = 8000
const CONCURRENCY = 6

async function request(f: FetchLike, url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await f(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'TahiQA/1.0 (+https://tahi.studio)' } })
  } finally {
    clearTimeout(timer)
  }
}

function isStaging(url: string): boolean {
  try { return new URL(url).hostname.endsWith('.webflow.io') } catch { return false }
}

export async function checkLink(url: string, opts: LinkCheckOptions): Promise<QaLinkResult> {
  const base: QaLinkResult = { url, finalUrl: null, status: null, hops: [], broken: false, redirectChain: false, stagingOnLive: opts.target === 'live' && isStaging(url), error: null }
  if (!/^https?:\/\//i.test(url)) return { ...base, error: 'skipped_scheme' }
  if (!isSafePublicUrl(url)) return { ...base, error: 'skipped_unsafe' }
  const maxHops = opts.maxHops ?? MAX_HOPS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  let current = url
  const hops: QaLinkResult['hops'] = []
  try {
    for (let i = 0; i <= maxHops; i++) {
      let res = await request(opts.fetch, current, 'HEAD', timeoutMs)
      if (res.status === 405 || res.status === 501) res = await request(opts.fetch, current, 'GET', timeoutMs)
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        hops.push({ url: current, status: res.status })
        current = new URL(location, current).toString()
        if (!isSafePublicUrl(current)) return { ...base, hops, error: 'skipped_unsafe' }
        continue
      }
      return { ...base, finalUrl: current, status: res.status, hops, broken: res.status >= 400, redirectChain: hops.length >= 2 }
    }
    return { ...base, hops, broken: true, error: 'too_many_redirects' }
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'error'
    return { ...base, hops, broken: true, error: message }
  }
}

export async function checkLinks(urls: string[], opts: LinkCheckOptions): Promise<QaLinkResult[]> {
  const unique = [...new Set(urls)]
  const results: QaLinkResult[] = new Array(unique.length)
  let next = 0
  async function worker() {
    while (next < unique.length) {
      const i = next++
      results[i] = await checkLink(unique[i], opts)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))
  return results
}
