/**
 * Tests for the in-house tech stack sniffer pattern matching.
 *
 * We don't make actual HTTP calls in these tests — instead we exercise
 * the matchesPattern logic indirectly by stubbing fetch. Pure unit
 * tests against the exported parts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sniffTechStack } from '../tech-stack-sniffer'

describe('sniffTechStack', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  function mockFetch(html: string, headers: Record<string, string> = {}) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve(html),
      headers: {
        forEach: (cb: (value: string, key: string) => void) => {
          for (const [k, v] of Object.entries(headers)) cb(v, k)
        },
      },
    } as unknown as Response)
  }

  it('detects Webflow from body markers', async () => {
    mockFetch('<html data-wf-page="abc"><body></body></html>')
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'Webflow')).toBe(true)
  })

  it('detects WordPress + WooCommerce together', async () => {
    mockFetch('<html><body><link href="/wp-content/themes/x.css"><script src="/wp-content/plugins/woocommerce/script.js"></script></body></html>')
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'WordPress')).toBe(true)
    expect(r.tech.some(t => t.name === 'WooCommerce')).toBe(true)
  })

  it('detects Shopify from headers', async () => {
    mockFetch('<html></html>', { 'x-shopify-stage': 'production' })
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'Shopify')).toBe(true)
  })

  it('detects Vercel from server header', async () => {
    mockFetch('<html></html>', { server: 'Vercel' })
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'Vercel')).toBe(true)
  })

  it('detects Framer from body', async () => {
    mockFetch('<html><body><img src="https://framerusercontent.com/x.jpg"/></body></html>')
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'Framer')).toBe(true)
  })

  it('detects Google Analytics from gtag script', async () => {
    mockFetch('<html><head><script src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script></head></html>')
    const r = await sniffTechStack('example.com')
    expect(r.tech.some(t => t.name === 'Google Analytics')).toBe(true)
  })

  it('marks Cloudflare as medium confidence (frequent false positive)', async () => {
    mockFetch('<html></html>', { 'cf-ray': '12345abc-AKL' })
    const r = await sniffTechStack('example.com')
    const cf = r.tech.find(t => t.name === 'Cloudflare')
    expect(cf?.confidence).toBe('medium')
  })

  it('returns empty when fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const r = await sniffTechStack('example.com')
    expect(r.tech).toEqual([])
    expect(r.error).toBeTruthy()
  })

  it('normalises URLs that lack protocol', async () => {
    mockFetch('<html></html>')
    const r = await sniffTechStack('example.com')
    expect(r.fetchedUrl).toBe('https://example.com')
  })

  it('returns empty for empty input', async () => {
    const r = await sniffTechStack('')
    expect(r.tech).toEqual([])
    expect(r.error).toBe('no url provided')
  })
})
