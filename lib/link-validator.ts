/**
 * Link validator — Phase I · Slice 2.
 *
 * Pure utility. Given a list of candidate citation URLs (from the
 * researcher's web-search pass), returns only the ones that respond with
 * a strict 200 OK. Anything else — 3xx redirects, 4xx, 5xx, timeouts,
 * DNS failures — is rejected and surfaced separately so we can debug.
 *
 * Why strict 200 only:
 *   - 3xx links rot, get hijacked, or end up pointing at the wrong page
 *     after a CMS migration. The audit said no 301/302/403/404 — so we
 *     hold that line.
 *   - tahi.studio links are not "citations" — those are internal links
 *     handled by the internal-linker engine in Slice 6. We filter them
 *     out here so the writer doesn't accidentally cite ourselves as an
 *     external authority.
 *
 * Parallelism: batches of 8 with a 10s per-request timeout. AbortController
 * + fetch is the Cloudflare Workers idiom; no top-level signal.timeout()
 * which isn't reliable in the worker runtime.
 */

const BATCH_SIZE = 8
const REQUEST_TIMEOUT_MS = 10_000

export interface ValidatedLink {
  url: string
  status: number
}

export interface InvalidLink {
  url: string
  status: number | null
  reason: string
}

export interface ValidationResult {
  valid: ValidatedLink[]
  invalid: InvalidLink[]
}

/** True when the URL is on tahi.studio (any subdomain). Filter these
 *  out of the citation list — they're internal links, not citations. */
function isTahiDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'tahi.studio' || host.endsWith('.tahi.studio')
  } catch {
    return false
  }
}

async function checkOne(url: string): Promise<ValidatedLink | InvalidLink> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // HEAD first — cheaper, no body. Some sites 405 HEAD, so we fall
    // through to a GET on the non-200 path to give them a fair shake.
    let res: Response
    try {
      res = await fetch(url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      })
    } catch {
      // HEAD failed outright (rare). Try GET before giving up.
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      })
    }

    // If HEAD returned 405 / 501 (method not allowed), retry with GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
      })
    }

    if (res.status === 200) {
      return { url, status: 200 }
    }
    return {
      url,
      status: res.status,
      reason: `HTTP ${res.status}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isAbort = message.toLowerCase().includes('abort')
    return {
      url,
      status: null,
      reason: isAbort ? 'Timeout (>10s)' : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Validate a batch of external citation URLs. Returns 200-only valid
 * + a separate list of failures with the reason each one was rejected.
 *
 * Deduplicates inputs first (case-sensitive — URLs are case-sensitive
 * after the host). Filters out tahi.studio.
 */
export async function validateExternalLinks(urls: string[]): Promise<ValidationResult> {
  // Pre-filter: drop tahi.studio, drop non-http(s), dedupe.
  const seen = new Set<string>()
  const queue: string[] = []
  for (const raw of urls) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (!/^https?:\/\//i.test(trimmed)) continue
    if (isTahiDomain(trimmed)) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    queue.push(trimmed)
  }

  const valid: ValidatedLink[] = []
  const invalid: InvalidLink[] = []

  // Process in fixed-size batches so we don't fire 200 requests at once
  // when the researcher dumps a big list.
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(checkOne))
    for (const r of results) {
      if ('reason' in r) invalid.push(r)
      else valid.push(r)
    }
  }

  return { valid, invalid }
}
