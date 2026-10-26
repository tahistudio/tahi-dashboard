import { describe, it, expect } from 'vitest'
import { checkLink, checkLinks, type FetchLike } from '@/lib/qa/link-check'

function fakeFetch(routes: Record<string, { status: number; location?: string } | 'throw'>): FetchLike {
  return async (url, init) => {
    const r = routes[url]
    if (!r || r === 'throw') throw new Error('network')
    if (init.method === 'HEAD' && r.status === 405) return new Response(null, { status: 405 })
    const headers = new Headers()
    if (r.location) headers.set('location', r.location)
    return new Response(null, { status: r.status, headers })
  }
}

describe('checkLink', () => {
  it('ok on 200', async () => {
    const r = await checkLink('https://a.com/', { fetch: fakeFetch({ 'https://a.com/': { status: 200 } }), target: 'live' })
    expect(r).toMatchObject({ status: 200, broken: false, redirectChain: false, finalUrl: 'https://a.com/' })
  })
  it('broken on 404 and on network error', async () => {
    expect((await checkLink('https://a.com/x', { fetch: fakeFetch({ 'https://a.com/x': { status: 404 } }), target: 'live' })).broken).toBe(true)
    const err = await checkLink('https://a.com/y', { fetch: fakeFetch({}), target: 'live' })
    expect(err.broken).toBe(true)
    expect(err.error).toBe('network')
  })
  it('follows redirects and flags chains of 2+ hops', async () => {
    const f = fakeFetch({
      'https://a.com/1': { status: 301, location: '/2' },
      'https://a.com/2': { status: 302, location: 'https://a.com/3' },
      'https://a.com/3': { status: 200 },
    })
    const r = await checkLink('https://a.com/1', { fetch: f, target: 'live' })
    expect(r.finalUrl).toBe('https://a.com/3')
    expect(r.hops).toHaveLength(2)
    expect(r.redirectChain).toBe(true)
  })
  it('flags staging links on a live round', async () => {
    const r = await checkLink('https://acme.webflow.io/', { fetch: fakeFetch({ 'https://acme.webflow.io/': { status: 200 } }), target: 'live' })
    expect(r.stagingOnLive).toBe(true)
  })
  it('refuses unsafe URLs without fetching', async () => {
    const r = await checkLink('http://127.0.0.1/', { fetch: fakeFetch({}), target: 'live' })
    expect(r).toMatchObject({ broken: false, error: 'skipped_unsafe' })
  })
  it('refuses a redirect hop to an unsafe URL without fetching it', async () => {
    const fetched: string[] = []
    const inner = fakeFetch({ 'https://a.com/r': { status: 302, location: 'http://169.254.169.254/latest' } })
    const tracking: FetchLike = (url, init) => { fetched.push(url); return inner(url, init) }
    const r = await checkLink('https://a.com/r', { fetch: tracking, target: 'live' })
    expect(r.error).toBe('skipped_unsafe')
    expect(fetched).not.toContain('http://169.254.169.254/latest')
  })
  it('skips non-http links', async () => {
    const r = await checkLink('mailto:a@b.com', { fetch: fakeFetch({}), target: 'live' })
    expect(r.error).toBe('skipped_scheme')
  })
})

describe('checkLinks', () => {
  it('dedupes and returns one result per unique URL', async () => {
    const f = fakeFetch({ 'https://a.com/': { status: 200 } })
    const out = await checkLinks(['https://a.com/', 'https://a.com/'], { fetch: f, target: 'staging' })
    expect(out).toHaveLength(1)
  })
})
