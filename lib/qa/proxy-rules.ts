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

export function scrubResponseHeaders(upstream: Headers, parentOrigin: string): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (!DROP.includes(key.toLowerCase())) out.set(key, value)
  })
  out.set('content-security-policy', `frame-ancestors ${parentOrigin}`)
  out.set('cache-control', 'no-store')
  out.set('x-robots-tag', 'noindex')
  out.set('referrer-policy', 'no-referrer')
  out.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=()')
  return out
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
