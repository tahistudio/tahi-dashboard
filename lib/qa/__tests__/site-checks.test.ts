import { describe, it, expect } from 'vitest'
import { runSiteChecks } from '@/lib/qa/site-checks'
import type { FetchLike } from '@/lib/qa/link-check'

function f(map: Record<string, { status: number; body?: string; location?: string }>): FetchLike {
  return async url => {
    const r = map[url]
    if (!r) return new Response(null, { status: 404 })
    const h = new Headers()
    if (r.location) h.set('location', r.location)
    return new Response(r.body ?? null, { status: r.status, headers: h })
  }
}

describe('runSiteChecks', () => {
  it('passes a healthy live site', async () => {
    const checks = await runSiteChecks('https://www.acme.com', 'live', f({
      'https://www.acme.com/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
      'https://www.acme.com/sitemap.xml': { status: 200, body: '<urlset></urlset>' },
      'http://www.acme.com/': { status: 301, location: 'https://www.acme.com/' },
      'https://acme.com/': { status: 301, location: 'https://www.acme.com/' },
      'https://www.acme.com/favicon.ico': { status: 200 },
    }))
    expect(checks.map(c => [c.code, c.result])).toEqual([
      ['robots', 'pass'], ['sitemap', 'pass'], ['https_redirect', 'pass'], ['www_canonical', 'pass'], ['favicon', 'pass'],
    ])
  })
  it('fails robots that block everything and skips live-only checks on staging', async () => {
    const checks = await runSiteChecks('https://acme.webflow.io', 'staging', f({
      'https://acme.webflow.io/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' },
    }))
    expect(checks.find(c => c.code === 'robots')?.result).toBe('warn')
    expect(checks.find(c => c.code === 'sitemap')?.result).toBe('fail')
    expect(checks.some(c => c.code === 'https_redirect')).toBe(false)
  })
})
