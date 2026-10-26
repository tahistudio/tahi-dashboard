import { describe, it, expect, vi } from 'vitest'
import { fetchText } from '@/lib/qa/server'
import type { FetchLike } from '@/lib/qa/link-check'

describe('fetchText', () => {
  it('returns the body of a 200', async () => {
    const f: FetchLike = async () => new Response('<urlset/>', { status: 200 })
    expect(await fetchText('https://a.com/sitemap.xml', f)).toEqual({ status: 200, text: '<urlset/>', truncated: false })
  })
  it('returns null on a non-2xx answer', async () => {
    const f: FetchLike = async () => new Response('no', { status: 500 })
    expect(await fetchText('https://a.com/sitemap.xml', f)).toBeNull()
  })
  it('follows redirects manually and sends the QA user agent on every hop', async () => {
    const seen: { url: string; ua: string | null; redirect?: string }[] = []
    const f: FetchLike = async (url, init) => {
      seen.push({ url, ua: new Headers(init.headers).get('user-agent'), redirect: init.redirect })
      if (url === 'https://a.com/sitemap.xml') return new Response(null, { status: 301, headers: { location: 'https://www.a.com/sitemap.xml' } })
      return new Response('ok', { status: 200 })
    }
    const out = await fetchText('https://a.com/sitemap.xml', f)
    expect(out?.text).toBe('ok')
    expect(seen.map(s => s.url)).toEqual(['https://a.com/sitemap.xml', 'https://www.a.com/sitemap.xml'])
    expect(seen.every(s => s.ua === 'TahiQA/1.0 (+https://tahi.studio)' && s.redirect === 'manual')).toBe(true)
  })
  it('refuses a redirect to a private address without fetching it', async () => {
    const fetched: string[] = []
    const f: FetchLike = async url => {
      fetched.push(url)
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } })
    }
    expect(await fetchText('https://a.com/sitemap.xml', f)).toBeNull()
    expect(fetched).toEqual(['https://a.com/sitemap.xml'])
  })
  it('stops after 5 redirects', async () => {
    const f = vi.fn<FetchLike>(async () => new Response(null, { status: 302, headers: { location: 'https://a.com/again' } }))
    expect(await fetchText('https://a.com/start', f)).toBeNull()
    expect(f).toHaveBeenCalledTimes(6)
  })
  it('caps the body at 5 MB and reports truncation', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) { controller.close(); return }
        sent++
        controller.enqueue(chunk)
      },
    })
    const f: FetchLike = async () => new Response(body, { status: 200 })
    const out = await fetchText('https://a.com/big.xml', f)
    expect(out?.truncated).toBe(true)
    expect(out?.text.length).toBe(5 * 1024 * 1024)
    expect(sent).toBeLessThan(8)
  })
  it('returns null when the request aborts', async () => {
    const f: FetchLike = async () => { throw new DOMException('aborted', 'AbortError') }
    expect(await fetchText('https://a.com/sitemap.xml', f)).toBeNull()
  })
})
