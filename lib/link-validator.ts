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

/** Extract every external href from a draft body's HTML. Filters
 *  tahi.studio + non-http(s) + anchors. Used by the Citations reviewer
 *  in Slice 9 to pull every outbound link before validation. */
export function extractOutboundLinks(bodyHtml: string): string[] {
  const seen = new Set<string>()
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(bodyHtml)) !== null) {
    const raw = m[1].trim()
    if (!raw) continue
    if (!/^https?:\/\//i.test(raw)) continue
    if (isTahiDomain(raw)) continue
    seen.add(raw)
  }
  return Array.from(seen)
}

/** Convenience for the Slice 9 pipeline: extract every outbound link
 *  from a draft body and validate them in one call. */
export async function validateDraftLinks(bodyHtml: string): Promise<ValidationResult> {
  const urls = extractOutboundLinks(bodyHtml)
  return validateExternalLinks(urls)
}

const TAHI_ORIGIN = 'https://www.tahi.studio'

export interface AllLinksResult {
  total: number
  okCount: number
  deadCount: number
  ok: ValidatedLink[]
  dead: InvalidLink[]    // 404 / 401 / 403 / 3xx / timeout / network
}

/** FINAL link gate. Extracts EVERY link from the body — internal
 *  (relative /slug or absolute tahi.studio) AND external — resolves
 *  relative links to absolute, and HTTP-checks each for a strict 200.
 *  Anything else (404/401/403/redirect/timeout) is flagged dead.
 *
 *  This is the "no dead links ship" guarantee Liam asked for. Runs on the
 *  FINAL body right before ready_for_publish. */
export async function validateAllLinks(bodyHtml: string): Promise<AllLinksResult> {
  const seen = new Set<string>()
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi
  const urls: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(bodyHtml)) !== null) {
    let raw = m[1].trim()
    if (!raw) continue
    if (raw.startsWith('#') || /^(mailto:|tel:)/i.test(raw)) continue
    // Resolve relative internal links to absolute against tahi.studio.
    if (raw.startsWith('/')) raw = `${TAHI_ORIGIN}${raw.replace(/\/+$/, '')}`
    if (!/^https?:\/\//i.test(raw)) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    urls.push(raw)
  }

  const ok: ValidatedLink[] = []
  const dead: InvalidLink[] = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(checkOne))
    for (const r of results) {
      if ('reason' in r) dead.push(r)
      else ok.push(r)
    }
  }

  return { total: urls.length, okCount: ok.length, deadCount: dead.length, ok, dead }
}
