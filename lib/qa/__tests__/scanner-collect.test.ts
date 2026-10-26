// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://qa-view.example.com/about"}
import { describe, it, expect, beforeAll } from 'vitest'
import {
  collectContent,
  collectLayout,
  collectLinks,
  collectPerf,
  collectSeo,
  cssPath,
} from '../../../workers/qa-view/src/scanner/collect'

/*
 * The scanner collectors run inside the proxied page. The workers/ tree is
 * excluded from the root vitest run, so they are exercised from here against
 * a jsdom document. jsdom has no layout engine: collectLayout and collectPerf
 * only get the assertions jsdom can support (no crash, empty overflow, no
 * decoded images). Real layout and image sizing are covered by the e2e spec.
 */

const PROXY_BASE = 'https://qa-view.example.com'
const UPSTREAM = 'https://www.tahi.studio'
const PAGE_PATH = '/about'

const HEAD = `
  <title>  About Tahi  </title>
  <meta name="description" content="We build Webflow sites.">
  <meta name="robots" content="noindex, nofollow">
  <link rel="canonical" href="https://www.tahi.studio/about">
  <link rel="icon" href="/favicon.png">
  <meta property="og:title" content="About OG">
  <meta property="og:description" content="OG description">
  <meta property="og:image" content="https://www.tahi.studio/og.png">
  <meta property="og:url" content="https://www.tahi.studio/about">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
  <script type="application/ld+json">{ this is not json </script>
`

const BODY = `
  <h1>Main heading</h1>
  <h2>Section</h2>
  <h4>Skipped to four</h4>
  <h1>Second h1</h1>
  <p>Lorem ipsum dolor sit amet</p>
  <img id="with-alt" src="/a.png" alt="A thing">
  <img id="empty-alt" src="/decor.png" alt="">
  <img id="no-alt" src="/b.png">
  <img role="presentation" src="/c.png">
  <img src="https://cdn.website-files.com/abc/placeholder.60.svg" alt="x">
  <a href="https://client-site.webflow.io/pricing">Staging link</a>
  <a href="#exists">Jump to exists</a>
  <a href="#missing">Jump to missing</a>
  <a href="${PROXY_BASE}${PAGE_PATH}#missing">Absolute missing</a>
  <a href="${PROXY_BASE}${PAGE_PATH}#exists">Absolute exists</a>
  <a href="${PROXY_BASE}/contact#form">Proxy contact</a>
  <a href="https://other.example.org/x?y=1#frag">External</a>
  <a href="mailto:hi@tahi.studio">Mail</a>
  <div id="exists">Target</div>
  <form action="/submit" method="POST">
    <input type="hidden" name="token" value="1">
    <input type="text" name="name">
    <textarea name="msg"></textarea>
    <select name="topic"><option>a</option></select>
  </form>
  <form><input type="email" name="e"></form>
`

let doc: Document
let win: Window

beforeAll(() => {
  // The jsdom URL in the pragma above is the proxy URL of the page, as the worker serves it.
  document.head.innerHTML = HEAD
  document.body.innerHTML = BODY
  doc = document
  win = window
})

describe('collectSeo', () => {
  it('reads title, description, canonical, robots and og tags', () => {
    const seo = collectSeo(doc)
    expect(seo.title).toBe('About Tahi')
    expect(seo.metaDescription).toBe('We build Webflow sites.')
    expect(seo.canonical).toBe('https://www.tahi.studio/about')
    expect(seo.robotsMeta).toBe('noindex, nofollow')
    expect(seo.og).toEqual({
      title: 'About OG',
      description: 'OG description',
      image: 'https://www.tahi.studio/og.png',
      url: 'https://www.tahi.studio/about',
    })
    expect(seo.favicon).toBe('/favicon.png')
  })

  it('counts two h1s and reports the heading skip', () => {
    const seo = collectSeo(doc)
    expect(seo.h1Count).toBe(2)
    expect(seo.headingOutline.map(h => h.level)).toEqual([1, 2, 4, 1])
    expect(seo.headingSkips).toEqual([{ from: 2, to: 4, text: 'Skipped to four' }])
  })

  it('counts a valid and an invalid JSON-LD block', () => {
    expect(collectSeo(doc).jsonLd).toEqual({ count: 2, parseErrors: 1 })
  })

  it('reports a missing lang as null and a present one as its value', () => {
    expect(collectSeo(doc).lang).toBeNull()
    doc.documentElement.setAttribute('lang', 'en')
    expect(collectSeo(doc).lang).toBe('en')
    doc.documentElement.removeAttribute('lang')
  })
})

describe('collectLinks', () => {
  it('flags missing in-page anchors, including the proxy-absolute form', () => {
    const { missingAnchors } = collectLinks(doc, PROXY_BASE, UPSTREAM)
    expect(missingAnchors.map(m => m.href).sort()).toEqual(
      ['#missing', `${PROXY_BASE}${PAGE_PATH}#missing`].sort(),
    )
    for (const m of missingAnchors) expect(m.selector).toContain('a')
  })

  it('does not flag anchors that exist', () => {
    const { missingAnchors } = collectLinks(doc, PROXY_BASE, UPSTREAM)
    expect(missingAnchors.some(m => m.href.endsWith('#exists'))).toBe(false)
  })

  it('maps proxy links back to the upstream origin and strips the fragment', () => {
    const { links } = collectLinks(doc, PROXY_BASE, UPSTREAM)
    expect(links.find(l => l.text === 'Proxy contact')?.url).toBe(`${UPSTREAM}/contact`)
  })

  it('keeps cross-origin and webflow.io links as they are, minus the fragment', () => {
    const { links } = collectLinks(doc, PROXY_BASE, UPSTREAM)
    expect(links.find(l => l.text === 'External')?.url).toBe('https://other.example.org/x?y=1')
    expect(links.find(l => l.text === 'Staging link')?.url).toBe('https://client-site.webflow.io/pricing')
  })

  it('skips mailto links and in-page anchors from the link list', () => {
    const { links } = collectLinks(doc, PROXY_BASE, UPSTREAM)
    expect(links.some(l => l.text === 'Mail')).toBe(false)
    expect(links.some(l => l.text.startsWith('Jump to'))).toBe(false)
    expect(links.some(l => l.text.startsWith('Absolute'))).toBe(false)
  })
})

describe('collectContent', () => {
  it('lists images missing alt but not empty alt or role=presentation', () => {
    const { imagesMissingAlt } = collectContent(doc)
    expect(imagesMissingAlt).toEqual([{ selector: '#no-alt', src: '/b.png' }])
  })

  it('finds lorem ipsum, webflow.io and placeholder images', () => {
    const { stagingLeftovers } = collectContent(doc)
    const kinds = stagingLeftovers.map(s => s.kind)
    expect(kinds).toContain('lorem_ipsum')
    expect(kinds).toContain('webflow_io')
    expect(kinds).toContain('placeholder_image')
    expect(stagingLeftovers.find(s => s.kind === 'lorem_ipsum')?.sample).toContain('Lorem ipsum')
    expect(stagingLeftovers.find(s => s.kind === 'webflow_io')?.sample).toBe('https://client-site.webflow.io/pricing')
    expect(stagingLeftovers.find(s => s.kind === 'placeholder_image')?.sample).toContain('website-files.com')
  })

  it('counts only visible fields on forms and defaults the method', () => {
    const { forms } = collectContent(doc)
    expect(forms).toHaveLength(2)
    expect(forms[0]).toMatchObject({ action: '/submit', method: 'post', fieldCount: 3 })
    expect(forms[1]).toMatchObject({ action: null, method: 'get', fieldCount: 1 })
  })
})

describe('collectLayout (jsdom has no layout)', () => {
  it('does not crash and reports no overflow', () => {
    const layout = collectLayout(doc, win)
    expect(layout.horizontalOverflow).toBe(false)
    expect(layout.overflowingElements).toEqual([])
  })
})

describe('collectPerf (jsdom has no image decoding)', () => {
  it('does not crash and finds no decoded images', () => {
    const perf = collectPerf(doc, win)
    expect(perf.images).toEqual([])
    expect(perf.totalTransferSize).toBe(0)
  })
})

describe('cssPath', () => {
  it('uses the id when there is one', () => {
    expect(cssPath(doc.getElementById('exists') as Element)).toBe('#exists')
  })

  it('numbers same-tag siblings with nth-of-type', () => {
    const second = doc.querySelectorAll('h1')[1]
    expect(cssPath(second)).toBe('html > body > h1:nth-of-type(2)')
  })
})
