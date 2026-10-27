/**
 * Turns scan and link results into QaIssue lists and the integer counts
 * stored on qa_round_pages. Pure. Rules are listed in the SQA spec.
 */
import type {
  QaBrowserKey, QaContent, QaIssue, QaLinkResult, QaPageCounts, QaPerf, QaScanResult, QaSeo, QaTarget, QaViewportKey, QaA11yViolation,
} from './types'
import { QA_BROWSER_KEYS, QA_PRIMARY_VIEWPORT } from './types'
import { mergeBrowserIssues } from './browsers'

const LEGACY_FORMATS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp'])
const HEAVY_IMAGE_BYTES = 500_000

export function seoIssues(seo: QaSeo, target: QaTarget, targetHost: string): QaIssue[] {
  const out: QaIssue[] = []
  const add = (code: string, severity: QaIssue['severity'], message: string) => out.push({ category: 'seo', code, severity, message })

  if (!seo.title) add('title_missing', 'fail', 'Page has no <title>.')
  else if (seo.title.length > 60 || seo.title.length < 15) add('title_length', 'warn', `Title is ${seo.title.length} characters (aim for 15 to 60).`)

  if (!seo.metaDescription) add('description_missing', 'fail', 'Page has no meta description.')
  else if (seo.metaDescription.length > 160 || seo.metaDescription.length < 50) add('description_length', 'warn', `Meta description is ${seo.metaDescription.length} characters (aim for 50 to 160).`)

  if (!seo.canonical) add('canonical_missing', 'warn', 'No canonical link.')
  else {
    let host = ''
    try { host = new URL(seo.canonical).hostname } catch { host = '' }
    if (host && host !== targetHost) add('canonical_host', 'fail', `Canonical points at ${host}, not ${targetHost}.`)
  }

  const noindex = (seo.robotsMeta ?? '').toLowerCase().includes('noindex')
  if (target === 'live' && noindex) add('live_noindex', 'fail', 'Live page is set to noindex.')
  if (target === 'staging' && !noindex) add('staging_indexable', 'warn', 'Staging page is indexable (no noindex).')

  if (!seo.og.title) add('og_title_missing', 'warn', 'No og:title.')
  if (!seo.og.image) add('og_image_missing', 'warn', 'No og:image, so shared links have no preview image.')
  if (seo.h1Count !== 1) add('h1_count', 'fail', `Page has ${seo.h1Count} H1 headings (should be exactly 1).`)
  for (const skip of seo.headingSkips) add('heading_skip', 'warn', `Heading jumps from H${skip.from} to H${skip.to} at "${skip.text}".`)
  if (seo.jsonLd.parseErrors > 0) add('jsonld_invalid', 'fail', `${seo.jsonLd.parseErrors} JSON-LD block(s) fail to parse.`)
  if (!seo.lang) add('lang_missing', 'warn', 'The <html> element has no lang attribute.')
  return out
}

export function launchIssues(scans: Partial<Record<QaViewportKey, QaScanResult>>): QaIssue[] {
  const out: QaIssue[] = []
  const primary = scans[QA_PRIMARY_VIEWPORT] ?? Object.values(scans)[0]
  if (primary) {
    const c: QaContent = primary.content
    for (const l of c.stagingLeftovers) out.push({ category: 'launch', code: 'staging_leftover', severity: 'fail', message: `Leftover ${l.kind.replace('_', ' ')}: "${l.sample}"`, selector: l.selector })
    for (const img of c.imagesMissingAlt) out.push({ category: 'launch', code: 'image_alt_missing', severity: 'fail', message: `Image has no alt text (${img.src}).`, selector: img.selector })
    for (const f of c.forms) out.push({ category: 'launch', code: 'form_present', severity: 'info', message: `Form with ${f.fieldCount} fields: send a test submission and tick when it arrives.`, selector: f.selector })
  }
  for (const [vp, s] of Object.entries(scans) as [QaViewportKey, QaScanResult][]) {
    if (s.layout.horizontalOverflow) {
      const first = s.layout.overflowingElements[0]
      out.push({ category: 'launch', code: 'horizontal_overflow', severity: 'fail', message: `Page scrolls sideways${first ? ` (widest: ${first.selector}, ${first.width}px)` : ''}.`, selector: first?.selector, viewport: vp })
    }
  }
  return out
}

export function perfIssues(perf: QaPerf, viewport: QaViewportKey): QaIssue[] {
  const out: QaIssue[] = []
  for (const img of perf.images) {
    if (img.format === 'svg') continue
    if (img.transferSize > HEAVY_IMAGE_BYTES) out.push({ category: 'perf', code: 'image_heavy', severity: 'fail', message: `Image is ${Math.round(img.transferSize / 1000)} KB (${img.src}).`, viewport, url: img.src })
    if (img.oversized) out.push({ category: 'perf', code: 'image_oversized', severity: 'warn', message: `Image is ${img.naturalWidth}px wide but shown at ${img.renderedWidth}px (${img.src}).`, viewport, url: img.src })
    if (LEGACY_FORMATS.has(img.format)) out.push({ category: 'perf', code: 'image_format', severity: 'warn', message: `Image is ${img.format.toUpperCase()}, not WebP or AVIF (${img.src}).`, viewport, url: img.src })
  }
  return out
}

export function a11yIssues(violations: QaA11yViolation[]): QaIssue[] {
  return violations.map(v => ({
    category: 'a11y' as const,
    code: `axe_${v.impact ?? 'minor'}`,
    severity: v.impact === 'critical' || v.impact === 'serious' ? 'fail' as const : 'warn' as const,
    message: `${v.help} (${v.id}, ${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})`,
    selector: v.nodes[0]?.selector,
    url: v.helpUrl,
  }))
}

export function linkIssues(primary: QaScanResult, results: Map<string, QaLinkResult>): QaIssue[] {
  const out: QaIssue[] = []
  const seen = new Set<string>()
  for (const link of primary.links) {
    if (seen.has(link.url)) continue
    seen.add(link.url)
    const r = results.get(link.url)
    if (!r) continue
    if (r.broken) out.push({ category: 'links', code: 'link_broken', severity: 'fail', message: `Broken link "${link.text}" (${r.status ?? r.error ?? 'no response'}): ${link.url}`, selector: link.selector, url: link.url })
    else if (r.redirectChain) out.push({ category: 'links', code: 'redirect_chain', severity: 'warn', message: `Link redirects ${r.hops.length} times: ${link.url}`, selector: link.selector, url: link.url })
    if (r.stagingOnLive) out.push({ category: 'links', code: 'staging_link', severity: 'fail', message: `Live page links to staging: ${link.url}`, selector: link.selector, url: link.url })
  }
  for (const a of primary.missingAnchors) out.push({ category: 'links', code: 'anchor_missing', severity: 'fail', message: `In-page link ${a.href} points at an id that does not exist.`, selector: a.selector })
  return out
}

export function pageIssues(
  scans: Partial<Record<QaViewportKey, QaScanResult>>,
  target: QaTarget,
  targetHost: string,
  linkResults: Map<string, QaLinkResult>,
): QaIssue[] {
  const primary = scans[QA_PRIMARY_VIEWPORT] ?? Object.values(scans)[0]
  if (!primary) return []
  const perf = (Object.entries(scans) as [QaViewportKey, QaScanResult][]).flatMap(([vp, s]) => perfIssues(s.perf, vp))
  // An image flagged at several widths is one problem: keep the first per code + url.
  const perfSeen = new Set<string>()
  const perfDeduped = perf.filter(i => {
    const k = `${i.code}|${i.url}`
    if (perfSeen.has(k)) return false
    perfSeen.add(k)
    return true
  })
  return [
    ...a11yIssues(primary.a11y),
    ...linkIssues(primary, linkResults),
    ...seoIssues(primary.seo, target, targetHost),
    ...launchIssues(scans),
    ...perfDeduped,
  ]
}

/** Stored scans of one page: browser, then viewport. */
export type QaScansByBrowser = Partial<Record<QaBrowserKey, Partial<Record<QaViewportKey, QaScanResult>>>>

/**
 * Issues for a page scanned in one or more browsers. Each browser's scans run
 * through pageIssues on their own (its desktop scan is that browser's primary),
 * then identical issues merge across browsers (see mergeBrowserIssues), so the
 * page counts do not grow with the number of browsers.
 */
export function browserPageIssues(
  scansByBrowser: QaScansByBrowser,
  target: QaTarget,
  targetHost: string,
  linkResults: Map<string, QaLinkResult>,
): QaIssue[] {
  const perBrowser: (readonly [QaBrowserKey, QaIssue[]])[] = []
  for (const browser of QA_BROWSER_KEYS) {
    const scans = scansByBrowser[browser]
    if (!scans || Object.keys(scans).length === 0) continue
    perBrowser.push([browser, pageIssues(scans, target, targetHost, linkResults)])
  }
  return mergeBrowserIssues(perBrowser)
}

export function countIssues(issues: QaIssue[]): QaPageCounts {
  const c: QaPageCounts = { a11yCritical: 0, a11ySerious: 0, a11yModerate: 0, a11yMinor: 0, brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0 }
  for (const i of issues) {
    if (i.category === 'a11y') {
      if (i.code === 'axe_critical') c.a11yCritical++
      else if (i.code === 'axe_serious') c.a11ySerious++
      else if (i.code === 'axe_moderate') c.a11yModerate++
      else c.a11yMinor++
    } else if (i.category === 'links') c.brokenLinks++
    else if (i.category === 'seo' && i.severity !== 'info') c.seoIssues++
    else if (i.category === 'launch' && i.severity !== 'info') c.launchIssues++
    else if (i.category === 'perf') c.perfIssues++
  }
  return c
}

export function duplicateMetaIssues(pages: { path: string; title: string | null; description: string | null }[]): Map<string, QaIssue[]> {
  const byTitle = new Map<string, string[]>()
  const byDesc = new Map<string, string[]>()
  for (const p of pages) {
    if (p.title) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p.path])
    if (p.description) byDesc.set(p.description, [...(byDesc.get(p.description) ?? []), p.path])
  }
  const out = new Map<string, QaIssue[]>()
  const push = (path: string, issue: QaIssue) => out.set(path, [...(out.get(path) ?? []), issue])
  for (const [title, paths] of byTitle) if (paths.length > 1) for (const p of paths) push(p, { category: 'seo', code: 'title_duplicate', severity: 'warn', message: `Title "${title}" is also used on ${paths.length - 1} other page(s).` })
  for (const [, paths] of byDesc) if (paths.length > 1) for (const p of paths) push(p, { category: 'seo', code: 'description_duplicate', severity: 'warn', message: `Meta description is also used on ${paths.length - 1} other page(s).` })
  return out
}
