import { describe, it, expect } from 'vitest'
import { parseSitemap, normalisePath } from '@/lib/qa/sitemap'

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://acme.com/</loc></url>
      <url><loc> https://acme.com/about </loc></url>
      <url><loc>https://acme.com/search?a=1&amp;b=2</loc></url></urlset>`
    expect(parseSitemap(xml)).toEqual({ kind: 'urlset', locs: ['https://acme.com/', 'https://acme.com/about', 'https://acme.com/search?a=1&b=2'] })
  })
  it('detects an index', () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/sitemap-1.xml</loc></sitemap></sitemapindex>`
    expect(parseSitemap(xml)).toEqual({ kind: 'index', locs: ['https://acme.com/sitemap-1.xml'] })
  })
  it('returns empty for junk', () => {
    expect(parseSitemap('<html>nope</html>')).toEqual({ kind: 'urlset', locs: [] })
  })
})

describe('normalisePath', () => {
  it('takes the pathname and strips trailing slashes except root', () => {
    expect(normalisePath('https://acme.com/')).toBe('/')
    expect(normalisePath('https://acme.com/about/')).toBe('/about')
    expect(normalisePath('https://other-host.com/blog/a')).toBe('/blog/a')
    expect(normalisePath('/team')).toBe('/team')
    expect(normalisePath('team/')).toBe('/team')
  })
  it('returns null for unusable input', () => {
    expect(normalisePath('')).toBeNull()
    expect(normalisePath('mailto:x@y.z')).toBeNull()
  })
})
