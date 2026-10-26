import type { QaContent, QaLayout, QaLink, QaMissingAnchor, QaPerf, QaPerfImage, QaSeo } from '../../../../lib/qa/types'
import { fromProxyUrl } from '../../../../lib/qa/proxy-rules'

export function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.nodeType === 1 && parts.length < 8) {
    let part = node.tagName.toLowerCase()
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift(`#${node.id}`); break }
    const parent: Element | null = node.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter(c => c.tagName === node!.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(' > ')
}

const text = (el: Element | null, max = 120) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const meta = (doc: Document, sel: string) => doc.querySelector(sel)?.getAttribute('content') ?? null

export function collectSeo(doc: Document): QaSeo {
  const headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))
  const outline = headings.slice(0, 50).map(h => ({ level: Number(h.tagName[1]), text: text(h, 80) }))
  const skips: QaSeo['headingSkips'] = []
  for (let i = 1; i < outline.length; i++) {
    if (outline[i].level > outline[i - 1].level + 1) skips.push({ from: outline[i - 1].level, to: outline[i].level, text: outline[i].text })
  }
  const ld = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
  let parseErrors = 0
  for (const s of ld) { try { JSON.parse(s.textContent ?? '') } catch { parseErrors++ } }
  return {
    title: doc.title.trim() || null,
    metaDescription: meta(doc, 'meta[name="description"]'),
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
    robotsMeta: meta(doc, 'meta[name="robots"]'),
    og: {
      title: meta(doc, 'meta[property="og:title"]'),
      description: meta(doc, 'meta[property="og:description"]'),
      image: meta(doc, 'meta[property="og:image"]'),
      url: meta(doc, 'meta[property="og:url"]'),
    },
    h1Count: doc.querySelectorAll('h1').length,
    headingOutline: outline,
    headingSkips: skips,
    jsonLd: { count: ld.length, parseErrors },
    lang: doc.documentElement.getAttribute('lang'),
    favicon: doc.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null,
  }
}

export function collectLinks(doc: Document, proxyBase: string, upstreamOrigin: string): { links: QaLink[]; missingAnchors: QaMissingAnchor[] } {
  const links: QaLink[] = []
  const missingAnchors: QaMissingAnchor[] = []
  const currentPage = (doc.defaultView?.location.href ?? '').split('#')[0]
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const raw = a.getAttribute('href') ?? ''
    const abs = (a as HTMLAnchorElement).href
    const hashAt = abs.indexOf('#')
    // The worker rewrites '#x' to the absolute proxy URL of this page plus '#x'.
    if (raw.startsWith('#') || (hashAt >= 0 && abs.slice(0, hashAt) === currentPage)) {
      const frag = raw.startsWith('#') ? raw.slice(1) : abs.slice(hashAt + 1)
      let id = frag
      try { id = decodeURIComponent(frag) } catch { /* keep the raw fragment */ }
      if (id && !doc.getElementById(id)) missingAnchors.push({ href: raw, selector: cssPath(a) })
      continue
    }
    if (!/^https?:/i.test(abs)) continue
    links.push({ url: fromProxyUrl(abs, proxyBase, upstreamOrigin).split('#')[0], text: text(a) || (a.getAttribute('aria-label') ?? ''), selector: cssPath(a) })
  }
  return { links, missingAnchors }
}

export function collectContent(doc: Document): QaContent {
  const imagesMissingAlt = Array.from(doc.querySelectorAll('img'))
    .filter(img => !img.hasAttribute('alt') && img.getAttribute('role') !== 'presentation')
    .slice(0, 50)
    .map(img => ({ selector: cssPath(img), src: img.getAttribute('src') ?? '' }))
  const stagingLeftovers: QaContent['stagingLeftovers'] = []
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode()) && stagingLeftovers.length < 30) {
    const t = n.textContent ?? ''
    if (/lorem ipsum/i.test(t)) stagingLeftovers.push({ kind: 'lorem_ipsum', sample: t.trim().slice(0, 80), selector: n.parentElement ? cssPath(n.parentElement) : 'body' })
  }
  for (const el of Array.from(doc.querySelectorAll('a[href*="webflow.io"], img[src*="webflow.io"]'))) {
    stagingLeftovers.push({ kind: 'webflow_io', sample: el.getAttribute('href') ?? el.getAttribute('src') ?? '', selector: cssPath(el) })
  }
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (/placeholder/i.test(src) && /(webflow\.com|website-files\.com)/i.test(src)) stagingLeftovers.push({ kind: 'placeholder_image', sample: src, selector: cssPath(img) })
  }
  const forms = Array.from(doc.querySelectorAll('form')).map(f => ({
    action: f.getAttribute('action'),
    method: (f.getAttribute('method') ?? 'get').toLowerCase(),
    fieldCount: f.querySelectorAll('input:not([type=hidden]),select,textarea').length,
    selector: cssPath(f),
  }))
  return { imagesMissingAlt, stagingLeftovers, forms }
}

export function collectLayout(doc: Document, win: Window): QaLayout {
  const vw = win.innerWidth
  const horizontalOverflow = doc.documentElement.scrollWidth > vw + 1
  const overflowingElements: QaLayout['overflowingElements'] = []
  if (horizontalOverflow) {
    for (const el of Array.from(doc.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 && r.width > 0) overflowingElements.push({ selector: cssPath(el), width: Math.round(r.right) })
    }
    overflowingElements.sort((a, b) => b.width - a.width)
  }
  return { horizontalOverflow, overflowingElements: overflowingElements.slice(0, 5) }
}

export function collectPerf(doc: Document, win: Window): QaPerf {
  const entries = new Map<string, number>()
  for (const e of win.performance.getEntriesByType('resource') as PerformanceResourceTiming[]) entries.set(e.name, e.transferSize || e.encodedBodySize || 0)
  const dpr = win.devicePixelRatio || 1
  const images: QaPerfImage[] = Array.from(doc.querySelectorAll('img'))
    .filter(img => img.complete && img.naturalWidth > 0)
    .slice(0, 100)
    .map(img => {
      const src = img.currentSrc || img.src
      const ext = (src.split('?')[0].split('.').pop() ?? '').toLowerCase()
      const r = img.getBoundingClientRect()
      return {
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: Math.round(r.width),
        renderedHeight: Math.round(r.height),
        oversized: r.width > 0 && img.naturalWidth > 2 * r.width * dpr,
        format: ext.length <= 5 ? ext : '',
        transferSize: entries.get(src) ?? 0,
      }
    })
  let total = 0
  for (const v of entries.values()) total += v
  return { images, totalTransferSize: total }
}
