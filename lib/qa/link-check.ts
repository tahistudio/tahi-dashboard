/**
 * Server-side link checking with an injected fetch (testable, and the route
 * passes serverFetch). HEAD first, GET on 405/501, manual redirects up to 5
 * hops, 8s timeout per request, concurrency 6.
 *
 * A Worker invocation may make about 1000 subrequests, so every fetch spends
 * from a shared budget. URLs the budget cannot cover are returned in
 * `unchecked` so the caller can continue in another request.
 */
import type { QaLinkResult, QaTarget } from './types'
import { isSafePublicUrl } from './ssrf'

export type FetchLike = (url: string, init: RequestInit & { method: string }) => Promise<Response>

export interface FetchBudget { remaining: number }

export interface LinkCheckOptions {
  fetch: FetchLike
  target: QaTarget
  timeoutMs?: number
  maxHops?: number
  /** Shared fetch budget. checkLinks creates one (DEFAULT_FETCH_BUDGET) when absent; checkLink is unlimited when absent. */
  budget?: FetchBudget
}

export interface CheckLinksOutcome { results: QaLinkResult[]; unchecked: string[] }

const MAX_HOPS = 5
const TIMEOUT_MS = 8000
const CONCURRENCY = 6
export const DEFAULT_FETCH_BUDGET = 400
export const QA_USER_AGENT = 'TahiQA/1.0 (+https://tahi.studio)'
export const MAX_BODY_BYTES = 5 * 1024 * 1024

/** Thrown when the shared fetch budget is spent. checkLinks turns it into an `unchecked` entry. */
export class FetchBudgetExhausted extends Error {
  constructor() {
    super('fetch budget exhausted')
    this.name = 'FetchBudgetExhausted'
  }
}

async function request(f: FetchLike, url: string, method: 'HEAD' | 'GET', timeoutMs: number, budget?: FetchBudget): Promise<Response> {
  if (budget) {
    if (budget.remaining <= 0) throw new FetchBudgetExhausted()
    budget.remaining--
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await f(url, { method, redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': QA_USER_AGENT } })
  } finally {
    clearTimeout(timer)
  }
}

/** Releases an unread response body so the connection is not held open. */
export async function discardBody(res: Response): Promise<void> {
  try { await res.body?.cancel() } catch { /* body already closed */ }
}

/** Reads a response body as text, stopping once maxBytes have arrived. */
export async function readCappedText(res: Response, maxBytes: number = MAX_BODY_BYTES): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      truncated = true
      const keep = value.byteLength - (received - maxBytes)
      if (keep > 0) text += decoder.decode(value.subarray(0, keep), { stream: true })
      await reader.cancel().catch(() => undefined)
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return { text, truncated }
}

function isStaging(url: string): boolean {
  try { return new URL(url).hostname.endsWith('.webflow.io') } catch { return false }
}

/**
 * Checks one URL. Makes at most maxHops + 1 requests in total (a HEAD to GET
 * fallback counts as a request, and once a host answers 405 or 501 the rest of
 * the chain uses GET). Throws FetchBudgetExhausted when a shared budget runs out.
 */
export async function checkLink(url: string, opts: LinkCheckOptions): Promise<QaLinkResult> {
  const base: QaLinkResult = { url, finalUrl: null, status: null, hops: [], broken: false, redirectChain: false, stagingOnLive: opts.target === 'live' && isStaging(url), error: null }
  if (!/^https?:\/\//i.test(url)) return { ...base, error: 'skipped_scheme' }
  if (!isSafePublicUrl(url)) return { ...base, error: 'skipped_unsafe' }
  const maxHops = opts.maxHops ?? MAX_HOPS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const maxRequests = maxHops + 1
  let used = 0
  let useGet = false
  let current = url
  const hops: QaLinkResult['hops'] = []
  try {
    while (used < maxRequests) {
      used++
      let res = await request(opts.fetch, current, useGet ? 'GET' : 'HEAD', timeoutMs, opts.budget)
      if (!useGet && (res.status === 405 || res.status === 501)) {
        if (used >= maxRequests) break
        await discardBody(res)
        used++
        useGet = true
        res = await request(opts.fetch, current, 'GET', timeoutMs, opts.budget)
      }
      const location = res.headers.get('location')
      await discardBody(res)
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
    if (err instanceof FetchBudgetExhausted) throw err
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'timeout' : err.message) : 'error'
    return { ...base, hops, broken: true, error: message }
  }
}

/**
 * Checks unique URLs with bounded concurrency and a shared fetch budget
 * (default 400). URLs the budget could not cover are returned in `unchecked`,
 * in input order, with no result.
 */
export async function checkLinks(urls: string[], opts: LinkCheckOptions): Promise<CheckLinksOutcome> {
  const unique = [...new Set(urls)]
  const budget = opts.budget ?? { remaining: DEFAULT_FETCH_BUDGET }
  const slots: (QaLinkResult | null)[] = new Array(unique.length).fill(null)
  let next = 0
  async function worker() {
    while (next < unique.length) {
      const i = next++
      if (budget.remaining <= 0) continue
      try {
        slots[i] = await checkLink(unique[i], { ...opts, budget })
      } catch (err) {
        if (!(err instanceof FetchBudgetExhausted)) throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))
  const results: QaLinkResult[] = []
  const unchecked: string[] = []
  slots.forEach((r, i) => { if (r) results.push(r); else unchecked.push(unique[i]) })
  return { results, unchecked }
}
