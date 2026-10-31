import { describe, it, expect } from 'vitest'
import {
  baseHrefFor, rewriteHref, fromProxyUrl, upstreamUrlFor, scrubResponseHeaders, classifyRedirect,
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
