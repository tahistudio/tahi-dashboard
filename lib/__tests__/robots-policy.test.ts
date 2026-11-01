import { describe, it, expect, vi } from 'vitest'
import robots from '@/app/robots'
import { AI_CRAWLER_USER_AGENTS, NOINDEX_HEADER_VALUE } from '@/lib/robots-policy'

describe('robots.txt (T1.7)', () => {
  const rules = robots().rules
  const list = Array.isArray(rules) ? rules : [rules]

  it('disallows everything for the wildcard agent except the share prefixes', () => {
    expect(list).toContainEqual({ userAgent: '*', allow: ['/p/', '/review/', '/tahi-logo.png'],
      disallow: '/',
    })
  })

  it('allows every og and twitter image path used by the public viewer metadata', async () => {
    const { toMetadata } = await import('@/lib/public-viewer-metadata')
    const meta = toMetadata({ title: 't', description: 'd', path: '/p/proposal/x' })
    const urls = [...meta.openGraph.images.map((i) => i.url), ...meta.twitter.images]
    const wildcard = list.find((r) => r.userAgent === '*')
    const allowed = new Set(wildcard?.allow)
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(allowed.has(new URL(u).pathname)).toBe(true)
  })

  it('names the common AI crawlers explicitly', () => {
    for (const name of [
      'GPTBot',
      'ClaudeBot',
      'anthropic-ai',
      'CCBot',
      'Google-Extended',
      'PerplexityBot',
      'Bytespider',
      'Applebot-Extended',
    ]) {
      expect(AI_CRAWLER_USER_AGENTS).toContain(name)
      expect(list).toContainEqual({ userAgent: name, disallow: '/' })
    }
  })

  it('allows nothing for any AI crawler', () => {
    const ai = list.filter((r) => r.userAgent !== '*')
    expect(ai).toHaveLength(AI_CRAWLER_USER_AGENTS.length)
    expect(ai.every((r) => r.disallow === '/' && !r.allow)).toBe(true)
  })
})

describe('X-Robots-Tag header (T1.7)', () => {
  it('is sent on every route by next.config headers()', async () => {
    vi.stubEnv('CI', '1')
    const mod = await import('../../next.config')
    const rules = (await mod.default.headers?.()) ?? []
    const all = rules.find((r) => r.source === '/:path*')
    expect(all?.headers).toContainEqual({ key: 'X-Robots-Tag', value: NOINDEX_HEADER_VALUE })
    expect(NOINDEX_HEADER_VALUE).toBe('noindex, nofollow, noarchive')
    vi.unstubAllEnvs()
  })
})
