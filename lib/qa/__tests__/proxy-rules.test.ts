import { describe, it, expect } from 'vitest'
import {
  baseHrefFor, rewriteHref, fromProxyUrl, upstreamUrlFor, scrubResponseHeaders, classifyRedirect,
  isTopLevelDocument, QA_FRAME_SANDBOX,
  staticPageHeaders, leavesSiteBody, isHttpUrl, isReferrerMetaName,
} from '@/lib/qa/proxy-rules'

const UP = 'https://acme.webflow.io'
const PB = 'https://qa-view.example.workers.dev/v/TOKEN'

describe('baseHrefFor', () => {
  it('uses the directory of the path', () => {
    expect(baseHrefFor(UP, '/')).toBe('https://acme.webflow.io/')
    expect(baseHrefFor(UP, '/about')).toBe('https://acme.webflow.io/')
    expect(baseHrefFor(UP, '/blog/post-a')).toBe('https://acme.webflow.io/blog/')
    expect(baseHrefFor(UP, '/blog/')).toBe('https://acme.webflow.io/blog/')
  })
})

describe('rewriteHref', () => {
  const page = 'https://acme.webflow.io/blog/post-a'
  it('rewrites same-origin links to proxy URLs keeping query and hash', () => {
    expect(rewriteHref('/about', page, UP, PB)).toBe(`${PB}/about`)
    expect(rewriteHref('other?x=1#top', page, UP, PB)).toBe(`${PB}/blog/other?x=1#top`)
    expect(rewriteHref('https://acme.webflow.io/', page, UP, PB)).toBe(`${PB}/`)
  })
  it('leaves other origins and special schemes alone', () => {
    expect(rewriteHref('https://google.com', page, UP, PB)).toBeNull()
    expect(rewriteHref('mailto:a@b.com', page, UP, PB)).toBeNull()
    expect(rewriteHref('tel:123', page, UP, PB)).toBeNull()
    expect(rewriteHref('javascript:void(0)', page, UP, PB)).toBeNull()
  })
})

describe('rewriteHref in-page and empty hrefs', () => {
  const page = 'https://acme.webflow.io/blog/post-a?x=1'
  it('turns #frag into the current proxy URL plus the fragment', () => {
    expect(rewriteHref('#section', page, UP, PB)).toBe(`${PB}/blog/post-a?x=1#section`)
    expect(rewriteHref('#', page, UP, PB)).toBe(`${PB}/blog/post-a?x=1#`)
  })
  it('turns empty href into the current proxy URL', () => {
    expect(rewriteHref('', page, UP, PB)).toBe(`${PB}/blog/post-a?x=1`)
    expect(rewriteHref('   ', page, UP, PB)).toBe(`${PB}/blog/post-a?x=1`)
  })
  it('rewrites relative form actions like links and leaves off-site ones', () => {
    expect(rewriteHref('/search', page, UP, PB)).toBe(`${PB}/search`)
    expect(rewriteHref('https://other.com/s', page, UP, PB)).toBeNull()
  })
  it('returns null for an unparseable page URL', () => {
    expect(rewriteHref('#a', 'not a url', UP, PB)).toBeNull()
  })
})

describe('fromProxyUrl', () => {
  it('maps a proxy URL back to the upstream form', () => {
    expect(fromProxyUrl(`${PB}/about?x=1#h`, PB, UP)).toBe('https://acme.webflow.io/about?x=1#h')
    expect(fromProxyUrl('https://google.com/', PB, UP)).toBe('https://google.com/')
  })
})

describe('upstreamUrlFor', () => {
  it('joins origin, path and search', () => {
    expect(upstreamUrlFor(UP, '/a/b', '?q=1')).toBe('https://acme.webflow.io/a/b?q=1')
    expect(upstreamUrlFor(UP, '', '')).toBe('https://acme.webflow.io/')
  })
  it('strips the dashboard reload parameter so the client site never sees it', () => {
    expect(upstreamUrlFor(UP, '/a', '?_qa_reload=3')).toBe('https://acme.webflow.io/a')
    expect(upstreamUrlFor(UP, '/a', '?q=1&_qa_reload=3')).toBe('https://acme.webflow.io/a?q=1')
    expect(upstreamUrlFor(UP, '/a', '?_qa_reload=3&q=1&r=2')).toBe('https://acme.webflow.io/a?q=1&r=2')
    expect(upstreamUrlFor(UP, '/a', '?_qa_reloaded=1')).toBe('https://acme.webflow.io/a?_qa_reloaded=1')
  })
})

describe('scrubResponseHeaders', () => {
  it('drops framing, cookie and HSTS headers and sets ours', () => {
    const h = new Headers({
      'content-type': 'text/html',
      'content-security-policy': "default-src 'self'",
      'x-frame-options': 'DENY',
      'set-cookie': 'a=b',
      'strict-transport-security': 'max-age=1',
      'content-length': '123',
      'content-encoding': 'gzip',
      'service-worker-allowed': '/',
      'permissions-policy': 'camera=*',
    })
    const out = scrubResponseHeaders(h, 'https://portal.tahi.studio')
    expect(out.get('content-type')).toBe('text/html')
    expect(out.get('x-frame-options')).toBeNull()
    expect(out.get('set-cookie')).toBeNull()
    expect(out.get('strict-transport-security')).toBeNull()
    expect(out.get('content-length')).toBeNull()
    expect(out.get('content-encoding')).toBeNull()
    expect(out.get('content-security-policy')).toBe('frame-ancestors https://portal.tahi.studio')
    expect(out.get('cache-control')).toBe('no-store')
    expect(out.get('x-robots-tag')).toBe('noindex')
    expect(out.get('referrer-policy')).toBe('no-referrer')
    expect(out.get('service-worker-allowed')).toBeNull()
    expect(out.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), midi=()')
  })
  it('drops upstream referrer and cross-origin isolation policies', () => {
    const h = new Headers({
      'referrer-policy': 'unsafe-url',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-opener-policy': 'same-origin',
    })
    const out = scrubResponseHeaders(h, 'https://portal.tahi.studio')
    expect(out.get('referrer-policy')).toBe('no-referrer')
    expect(out.get('cross-origin-embedder-policy')).toBeNull()
    expect(out.get('cross-origin-opener-policy')).toBeNull()
  })
})

describe('isTopLevelDocument', () => {
  it('is true only for Sec-Fetch-Dest: document', () => {
    expect(isTopLevelDocument('document')).toBe(true)
    expect(isTopLevelDocument(' Document ')).toBe(true)
  })
  it('treats iframe, other destinations and a missing header as framed', () => {
    expect(isTopLevelDocument('iframe')).toBe(false)
    expect(isTopLevelDocument('frame')).toBe(false)
    expect(isTopLevelDocument('empty')).toBe(false)
    expect(isTopLevelDocument('')).toBe(false)
    expect(isTopLevelDocument(null)).toBe(false)
  })
})

describe('scrubResponseHeaders by load type', () => {
  const portal = 'https://portal.tahi.studio'
  const upstream = () => new Headers({
    'content-type': 'text/html',
    'content-security-policy': "default-src 'self'; sandbox",
    'content-security-policy-report-only': "default-src 'none'",
  })

  it('shares the iframe sandbox value, without escape or extra permissions', () => {
    expect(QA_FRAME_SANDBOX).toBe('allow-scripts allow-same-origin allow-forms allow-popups')
    expect(QA_FRAME_SANDBOX).not.toContain('allow-popups-to-escape-sandbox')
    expect(QA_FRAME_SANDBOX).not.toContain('allow-modals')
    expect(QA_FRAME_SANDBOX).not.toContain('allow-downloads')
    expect(QA_FRAME_SANDBOX).not.toContain('allow-top-navigation')
  })

  it('framed load: CSP is frame-ancestors only, exactly as before', () => {
    const out = scrubResponseHeaders(upstream(), portal, false)
    expect(out.get('content-security-policy')).toBe(`frame-ancestors ${portal}`)
    expect(out.get('content-security-policy-report-only')).toBeNull()
  })

  it('default (no third argument) is the framed path', () => {
    expect(scrubResponseHeaders(upstream(), portal).get('content-security-policy')).toBe(`frame-ancestors ${portal}`)
  })

  it('top-level load: adds the sandbox directive to our CSP and drops the upstream one', () => {
    const out = scrubResponseHeaders(upstream(), portal, true)
    expect(out.get('content-security-policy')).toBe(`frame-ancestors ${portal}; sandbox ${QA_FRAME_SANDBOX}`)
    expect(out.get('content-security-policy-report-only')).toBeNull()
  })

  it('other headers match between the two paths', () => {
    const framed = scrubResponseHeaders(upstream(), portal, false)
    const top = scrubResponseHeaders(upstream(), portal, true)
    for (const name of ['cache-control', 'x-robots-tag', 'referrer-policy', 'permissions-policy', 'content-type', 'x-frame-options', 'set-cookie']) {
      expect(top.get(name)).toBe(framed.get(name))
    }
  })
})

describe('static page headers', () => {
  it('lock the worker pages down: no sources, sandboxed, no referrer, no sniffing', () => {
    const h = staticPageHeaders()
    expect(h['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox allow-popups allow-popups-to-escape-sandbox")
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['x-content-type-options']).toBe('nosniff')
  })
  it('lets the external link open but never allows a script', () => {
    const csp = staticPageHeaders()['content-security-policy']
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('allow-popups')
    expect(csp).not.toContain('allow-scripts')
    expect(csp).not.toContain('allow-same-origin')
  })
  it('keep what the pages already sent', () => {
    const h = staticPageHeaders()
    expect(h['content-type']).toBe('text/html; charset=utf-8')
    expect(h['cache-control']).toBe('no-store')
    expect(h['x-robots-tag']).toBe('noindex')
  })
})

describe('leavesSiteBody', () => {
  it('links an http or https Location', () => {
    expect(leavesSiteBody('https://other.com/x?a=1&b=2')).toBe(
      'It redirects to <a href="https://other.com/x?a=1&amp;b=2" target="_blank" rel="noopener">https://other.com/x?a=1&amp;b=2</a>.',
    )
    expect(leavesSiteBody('http://other.com/')).toContain('<a href="http://other.com/"')
  })
  it('shows a javascript: Location as escaped text with no anchor', () => {
    const out = leavesSiteBody('javascript:alert(1)')
    expect(out).toBe('It redirects to javascript:alert(1).')
    expect(out).not.toContain('<a')
    expect(out).not.toContain('href')
  })
  it('shows data:, vbscript: and unparseable Locations with no anchor, escaped', () => {
    for (const bad of ['data:text/html,<script>alert(1)</script>', 'vbscript:x', 'http://[bad', '//other.com/x', '']) {
      const out = leavesSiteBody(bad)
      expect(out).not.toContain('<a')
      expect(out).not.toContain('<script>')
    }
    expect(leavesSiteBody('data:text/html,<b>"hi"</b>')).toBe('It redirects to data:text/html,&lt;b&gt;&quot;hi&quot;&lt;/b&gt;.')
  })
  it('is not fooled by a scheme in odd case or with leading space', () => {
    expect(leavesSiteBody('JaVaScRiPt:alert(1)')).not.toContain('<a')
    expect(leavesSiteBody(' javascript:alert(1)')).not.toContain('<a')
  })
  it('isHttpUrl accepts only absolute http(s) URLs', () => {
    expect(isHttpUrl('https://a.com')).toBe(true)
    expect(isHttpUrl('HTTP://a.com')).toBe(true)
    expect(isHttpUrl('ftp://a.com')).toBe(false)
    expect(isHttpUrl('/relative')).toBe(false)
  })
})

describe('isReferrerMetaName', () => {
  it('matches a referrer meta in any case', () => {
    expect(isReferrerMetaName('referrer')).toBe(true)
    expect(isReferrerMetaName('Referrer')).toBe(true)
    expect(isReferrerMetaName(' REFERRER ')).toBe(true)
  })
  it('leaves other metas and a missing name alone', () => {
    expect(isReferrerMetaName('description')).toBe(false)
    expect(isReferrerMetaName('referrer-policy')).toBe(false)
    expect(isReferrerMetaName(null)).toBe(false)
  })
})

describe('proxied responses carry nosniff', () => {
  it('on the framed and the top-level path, with the framed CSP unchanged', () => {
    const framed = scrubResponseHeaders(new Headers({ 'content-type': 'text/html' }), 'https://portal.tahi.studio', false)
    const top = scrubResponseHeaders(new Headers({ 'content-type': 'text/html' }), 'https://portal.tahi.studio', true)
    expect(framed.get('x-content-type-options')).toBe('nosniff')
    expect(top.get('x-content-type-options')).toBe('nosniff')
    expect(framed.get('content-security-policy')).toBe('frame-ancestors https://portal.tahi.studio')
  })
})

describe('classifyRedirect', () => {
  it('keeps same-origin redirects inside the proxy', () => {
    expect(classifyRedirect('/new', 'https://acme.webflow.io/old', UP, PB)).toEqual({ kind: 'internal', location: `${PB}/new` })
  })
  it('flags off-site redirects', () => {
    expect(classifyRedirect('https://other.com/x', 'https://acme.webflow.io/old', UP, PB)).toEqual({ kind: 'external', location: 'https://other.com/x' })
  })
  it('does not throw on a malformed Location header', () => {
    expect(classifyRedirect('http://[bad', 'https://acme.webflow.io/old', UP, PB)).toEqual({ kind: 'external', location: 'http://[bad' })
  })
})
