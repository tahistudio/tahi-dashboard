import scannerJs from './generated/scanner.bundle.js'
import { verifyViewToken } from '../../../lib/qa/token'
import { isSafePublicUrl } from '../../../lib/qa/ssrf'
import { baseHrefFor, classifyRedirect, rewriteHref, scrubResponseHeaders, upstreamUrlFor } from '../../../lib/qa/proxy-rules'

interface Env { QA_VIEW_SECRET: string }

/** How long the proxy waits for the client site before showing an error page in the frame. */
const UPSTREAM_TIMEOUT_MS = 20_000

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:14px/1.5 system-ui;padding:2rem;color:#121A0F"><h1 style="font-size:1rem">${title}</h1><p>${body}</p></body>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const worker = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/__qa/scanner.js') {
      return new Response(scannerJs, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' } })
    }
    if (req.headers.get('service-worker') === 'script') return page(403, 'Blocked', 'Service workers are not allowed on the QA viewer.')
    const m = url.pathname.match(/^\/v\/([^/]+)(\/.*)?$/)
    if (!m) return page(404, 'Not found', 'This is the Tahi QA viewer.')
    if (req.method !== 'GET' && req.method !== 'HEAD') return page(405, 'Read only', 'The QA viewer only loads pages.')

    if (!env.QA_VIEW_SECRET) return page(503, 'QA viewer not configured', 'The QA viewer has no signing secret set.')
    const token = m[1]
    const payload = await verifyViewToken(token, env.QA_VIEW_SECRET)
    if (!payload) return page(403, 'Link expired', 'Reload the QA page in the dashboard to get a fresh view link.')
    if (!isSafePublicUrl(payload.o)) return page(403, 'Blocked', 'That address is not allowed.')

    const path = m[2] ?? '/'
    const proxyBase = `${url.origin}/v/${token}`
    const upstreamUrl = upstreamUrlFor(payload.o, path, url.search)

    let upstream: Response
    try {
      // Bounded: a slow or stalled client site must not hold the frame open indefinitely.
      upstream = await fetch(upstreamUrl, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), headers: { 'user-agent': 'TahiQA/1.0 (+https://tahi.studio)', accept: req.headers.get('accept') ?? 'text/html' } })
    } catch {
      return page(502, 'Could not load the page', `The site did not respond within ${UPSTREAM_TIMEOUT_MS / 1000} seconds: ${escapeHtml(upstreamUrl)}`)
    }

    const location = upstream.headers.get('location')
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      const d = classifyRedirect(location, upstreamUrl, payload.o, proxyBase)
      if (d.kind === 'internal') return new Response(null, { status: 302, headers: { location: d.location, 'cache-control': 'no-store' } })
      return page(200, 'This link leaves the site', `It redirects to <a href="${escapeHtml(d.location)}" target="_blank" rel="noopener">${escapeHtml(d.location)}</a>.`)
    }

    const headers = scrubResponseHeaders(upstream.headers, payload.p)
    const type = upstream.headers.get('content-type') ?? ''
    if (!type.includes('text/html')) return new Response(upstream.body, { status: upstream.status, headers })

    const baseTag = `<base href="${escapeHtml(baseHrefFor(payload.o, path))}">`
    const scannerTag = `<script src="${url.origin}/__qa/scanner.js?t=${token}" defer></script>`
    let headSeen = false
    const rewriter = new HTMLRewriter()
      .on('head', { element(el) { headSeen = true; el.prepend(baseTag, { html: true }) } })
      .on('head', { element(el) { el.append(scannerTag, { html: true }) } })
      // Fallback for documents with no <head>: inject at the start of <body>.
      .on('body', { element(el) { if (!headSeen) { headSeen = true; el.prepend(baseTag + scannerTag, { html: true }) } } })
      .on('meta[http-equiv]', { element(el) { if ((el.getAttribute('http-equiv') ?? '').toLowerCase() === 'content-security-policy') el.remove() } })
      .on('a[href]', { element(el) {
        const next = rewriteHref(el.getAttribute('href') ?? '', upstreamUrl, payload.o, proxyBase)
        if (next) el.setAttribute('href', next)
      } })
      .on('form[action]', { element(el) {
        const next = rewriteHref(el.getAttribute('action') ?? '', upstreamUrl, payload.o, proxyBase)
        if (next) el.setAttribute('action', next)
      } })
    return rewriter.transform(new Response(upstream.body, { status: upstream.status, headers }))
  },
}

export default worker
