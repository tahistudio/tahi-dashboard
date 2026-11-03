/**
 * Pure rewrite decisions for workers/qa-view. The worker wires these into
 * HTMLRewriter; keeping them here makes them unit-testable from the root
 * vitest run (which excludes workers/**).
 *
 * proxyBase is `${proxyOrigin}/v/${token}` with no trailing slash.
 */

export function baseHrefFor(upstreamOrigin: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const dir = p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1)
  return `${upstreamOrigin}${dir}`
}

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|sms:)/i

/**
 * Rewrites a link or form action so it stays inside the proxy. Because the
 * worker injects <base href=upstream dir>, in-page `#frag` and empty hrefs
 * would otherwise resolve against the real site and leave the proxy, so they
 * become the current proxy URL (plus the fragment).
 */
export function rewriteHref(href: string, pageUrl: string, upstreamOrigin: string, proxyBase: string): string | null {
  const trimmed = href.trim()
  if (SKIP_SCHEMES.test(trimmed)) return null
  if (!trimmed || trimmed.startsWith('#')) {
    let page: URL
    try {
      page = new URL(pageUrl)
    } catch {
      return null
    }
    return `${proxyBase}${page.pathname}${page.search}${trimmed}`
  }
  let resolved: URL
  try {
    resolved = new URL(trimmed, pageUrl)
  } catch {
    return null
  }
  if (resolved.origin !== upstreamOrigin) return null
  return `${proxyBase}${resolved.pathname}${resolved.search}${resolved.hash}`
}

export function fromProxyUrl(href: string, proxyBase: string, upstreamOrigin: string): string {
  if (!href.startsWith(`${proxyBase}/`) && href !== proxyBase) return href
  const rest = href.slice(proxyBase.length) || '/'
  return `${upstreamOrigin}${rest}`
}

/** Query parameter the dashboard adds to reload a frame past caches. It never reaches the client site. */
export const QA_RELOAD_PARAM = '_qa_reload'

/** The query string without the reload parameter (and without a bare leading "?" when nothing is left). */
export function stripReloadParam(search: string): string {
  if (!search || search === '?') return ''
  const kept = search.replace(/^[?]/, '').split('&').filter(part => part !== '' && part.split('=')[0] !== QA_RELOAD_PARAM)
  return kept.length > 0 ? `?${kept.join('&')}` : ''
}

export function upstreamUrlFor(upstreamOrigin: string, path: string, search: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${upstreamOrigin}${p}${stripReloadParam(search)}`
}

const DROP = [
  'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'set-cookie', 'strict-transport-security',
  'content-length', 'content-encoding', 'transfer-encoding',
  'referrer-policy', 'cross-origin-embedder-policy', 'cross-origin-opener-policy',
  'service-worker-allowed', 'permissions-policy',
]

/**
 * The sandbox the dashboard puts on every QA frame. Shared so the worker can give a top-level tab
 * exactly the same one through a CSP `sandbox` directive. allow-popups-to-escape-sandbox is
 * deliberately absent: popups the page opens inherit the sandbox. No allow-modals, allow-downloads
 * or allow-top-navigation either.
 */
export const QA_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

/**
 * True when a request is a top-level page load (`Sec-Fetch-Dest: document`), for example the
 * "View at 100%" tab. An iframe sends `iframe`; a missing header (older browsers) counts as the
 * framed path, so those keep the exact behaviour they had before.
 */
export function isTopLevelDocument(secFetchDest: string | null): boolean {
  return secFetchDest !== null && secFetchDest.trim().toLowerCase() === 'document'
}

/**
 * Response headers for a proxied page. The upstream CSP is dropped (replaced by ours), so the
 * policy is just `frame-ancestors <dashboard>`. A top-level load adds `; sandbox <QA_FRAME_SANDBOX>`
 * so the tab is sandboxed like the iframe; the framed path is byte for byte what it was.
 */
export function scrubResponseHeaders(upstream: Headers, parentOrigin: string, topLevel: boolean = false): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (!DROP.includes(key.toLowerCase())) out.set(key, value)
  })
  out.set('content-security-policy', topLevel ? `frame-ancestors ${parentOrigin}; sandbox ${QA_FRAME_SANDBOX}` : `frame-ancestors ${parentOrigin}`)
  out.set('cache-control', 'no-store')
  out.set('x-robots-tag', 'noindex')
  out.set('referrer-policy', 'no-referrer')
  out.set('x-content-type-options', 'nosniff')
  out.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=()')
  return out
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/**
 * CSP for the worker's own static pages (errors, "This link leaves the site"). They need no script,
 * image or frame, only their inline style attribute. default-src 'none' blocks every script. There is
 * deliberately NO sandbox directive: a CSP sandbox on this page would be inherited by the popup the
 * external link opens (from inside the framed viewer too), so the external site would load with
 * scripts off. The page holds only escaped text and an http(s) anchor.
 */
export const STATIC_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'"

/** Headers for the worker's own static pages, on top of the status and content type. */
export function staticPageHeaders(): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    'content-security-policy': STATIC_PAGE_CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }
}

/** True only for an absolute http or https URL. javascript:, data: and anything unparseable are false. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Body text of the "This link leaves the site" page. The Location becomes a link only when it is an
 * http(s) URL; any other scheme (javascript:, data:, a broken URL) is shown as escaped text with no anchor.
 */
export function leavesSiteBody(location: string): string {
  const safe = escapeHtml(location)
  if (!isHttpUrl(location)) return `It redirects to ${safe}.`
  return `It redirects to <a href="${safe}" target="_blank" rel="noopener">${safe}</a>.`
}

/** True for the name of a `<meta name="referrer">` tag, which could override our no-referrer policy. */
export function isReferrerMetaName(name: string | null): boolean {
  return (name ?? '').trim().toLowerCase() === 'referrer'
}

export type RedirectDecision = { kind: 'internal'; location: string } | { kind: 'external'; location: string }

export function classifyRedirect(location: string, requestUrl: string, upstreamOrigin: string, proxyBase: string): RedirectDecision {
  let resolved: URL
  try {
    resolved = new URL(location, requestUrl)
  } catch {
    return { kind: 'external', location }
  }
  if (resolved.origin === upstreamOrigin) {
    return { kind: 'internal', location: `${proxyBase}${resolved.pathname}${resolved.search}${resolved.hash}` }
  }
  return { kind: 'external', location: resolved.toString() }
}
