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

const SKIP_SCHEMES = /^(#|mailto:|tel:|javascript:|data:|sms:)/i

export function rewriteHref(href: string, pageUrl: string, upstreamOrigin: string, proxyBase: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || SKIP_SCHEMES.test(trimmed)) return null
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

export function upstreamUrlFor(upstreamOrigin: string, path: string, search: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${upstreamOrigin}${p}${search}`
}

const DROP = ['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'set-cookie', 'strict-transport-security', 'content-length', 'content-encoding', 'transfer-encoding']

export function scrubResponseHeaders(upstream: Headers, parentOrigin: string): Headers {
  const out = new Headers()
  upstream.forEach((value, key) => {
    if (!DROP.includes(key.toLowerCase())) out.set(key, value)
  })
  out.set('content-security-policy', `frame-ancestors ${parentOrigin}`)
  out.set('cache-control', 'no-store')
  out.set('x-robots-tag', 'noindex')
  return out
}

export type RedirectDecision = { kind: 'internal'; location: string } | { kind: 'external'; location: string }

export function classifyRedirect(location: string, requestUrl: string, upstreamOrigin: string, proxyBase: string): RedirectDecision {
  const resolved = new URL(location, requestUrl)
  if (resolved.origin === upstreamOrigin) {
    return { kind: 'internal', location: `${proxyBase}${resolved.pathname}${resolved.search}${resolved.hash}` }
  }
  return { kind: 'external', location: resolved.toString() }
}
