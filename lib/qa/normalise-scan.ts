/**
 * Coerces an untrusted scan payload into a well-formed QaScanResult. The
 * scanner runs in the client site's frame realm, so page JS can forge
 * qa:scan messages. Everything is clamped to the declared types and size caps
 * so a stored scan can never break the counting or reading code.
 * Pure: no Next.js, D1 or Node APIs.
 */
import type {
  QaA11yViolation, QaContent, QaLayout, QaLink, QaMissingAnchor, QaPerf, QaPerfImage, QaScanResult, QaSeo,
} from './types'

export const SCAN_CAPS = {
  selector: 500, html: 300, text: 200, url: 2000,
  links: 1000, missingAnchors: 500, a11yRules: 100, a11yNodes: 20,
  images: 200, imagesMissingAlt: 200, stagingLeftovers: 200, forms: 100, overflowing: 100,
  headings: 200, headingSkips: 100,
} as const

type Rec = Record<string, unknown>

function rec(v: unknown): Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {}
}

function arr(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : []
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function strOrNull(v: unknown, max: number): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function bool(v: unknown): boolean {
  return v === true
}

const IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const

function impact(v: unknown): QaA11yViolation['impact'] {
  return typeof v === 'string' && (IMPACTS as readonly string[]).includes(v) ? (v as QaA11yViolation['impact']) : null
}

const LEFTOVER_KINDS = ['webflow_io', 'lorem_ipsum', 'placeholder_image'] as const

function normaliseSeo(input: unknown): QaSeo {
  const s = rec(input)
  const og = rec(s.og)
  const jsonLd = rec(s.jsonLd)
  return {
    title: strOrNull(s.title, SCAN_CAPS.text),
    metaDescription: strOrNull(s.metaDescription, SCAN_CAPS.url),
    canonical: strOrNull(s.canonical, SCAN_CAPS.url),
    robotsMeta: strOrNull(s.robotsMeta, SCAN_CAPS.text),
    og: {
      title: strOrNull(og.title, SCAN_CAPS.text),
      description: strOrNull(og.description, SCAN_CAPS.url),
      image: strOrNull(og.image, SCAN_CAPS.url),
      url: strOrNull(og.url, SCAN_CAPS.url),
    },
    h1Count: num(s.h1Count),
    headingOutline: arr(s.headingOutline, SCAN_CAPS.headings).map(h => ({ level: num(rec(h).level), text: str(rec(h).text, SCAN_CAPS.text) })),
    headingSkips: arr(s.headingSkips, SCAN_CAPS.headingSkips).map(h => ({
      from: num(rec(h).from), to: num(rec(h).to), text: str(rec(h).text, SCAN_CAPS.text),
    })),
    jsonLd: { count: num(jsonLd.count), parseErrors: num(jsonLd.parseErrors) },
    lang: strOrNull(s.lang, SCAN_CAPS.text),
    favicon: strOrNull(s.favicon, SCAN_CAPS.url),
  }
}

function normaliseContent(input: unknown): QaContent {
  const c = rec(input)
  return {
    imagesMissingAlt: arr(c.imagesMissingAlt, SCAN_CAPS.imagesMissingAlt).map(i => ({
      selector: str(rec(i).selector, SCAN_CAPS.selector), src: str(rec(i).src, SCAN_CAPS.url),
    })),
    stagingLeftovers: arr(c.stagingLeftovers, SCAN_CAPS.stagingLeftovers).map(l => {
      const kind = rec(l).kind
      return {
        kind: (LEFTOVER_KINDS as readonly unknown[]).includes(kind) ? (kind as (typeof LEFTOVER_KINDS)[number]) : 'placeholder_image',
        sample: str(rec(l).sample, SCAN_CAPS.text),
        selector: str(rec(l).selector, SCAN_CAPS.selector),
      }
    }),
    forms: arr(c.forms, SCAN_CAPS.forms).map(f => ({
      action: strOrNull(rec(f).action, SCAN_CAPS.url),
      method: str(rec(f).method, 20),
      fieldCount: num(rec(f).fieldCount),
      selector: str(rec(f).selector, SCAN_CAPS.selector),
    })),
  }
}

function normaliseLayout(input: unknown): QaLayout {
  const l = rec(input)
  return {
    horizontalOverflow: bool(l.horizontalOverflow),
    overflowingElements: arr(l.overflowingElements, SCAN_CAPS.overflowing).map(e => ({
      selector: str(rec(e).selector, SCAN_CAPS.selector), width: num(rec(e).width),
    })),
  }
}

function normalisePerf(input: unknown): QaPerf {
  const p = rec(input)
  return {
    images: arr(p.images, SCAN_CAPS.images).map((raw): QaPerfImage => {
      const i = rec(raw)
      return {
        src: str(i.src, SCAN_CAPS.url),
        naturalWidth: num(i.naturalWidth), naturalHeight: num(i.naturalHeight),
        renderedWidth: num(i.renderedWidth), renderedHeight: num(i.renderedHeight),
        oversized: bool(i.oversized),
        format: str(i.format, 20),
        transferSize: num(i.transferSize),
      }
    }),
    totalTransferSize: num(p.totalTransferSize),
  }
}

export function normaliseScanResult(input: unknown): QaScanResult {
  const r = rec(input)
  const a11y: QaA11yViolation[] = arr(r.a11y, SCAN_CAPS.a11yRules).map(raw => {
    const v = rec(raw)
    return {
      id: str(v.id, SCAN_CAPS.text),
      impact: impact(v.impact),
      help: str(v.help, SCAN_CAPS.url),
      helpUrl: str(v.helpUrl, SCAN_CAPS.url),
      nodes: arr(v.nodes, SCAN_CAPS.a11yNodes).map(n => ({
        selector: str(rec(n).selector, SCAN_CAPS.selector), html: str(rec(n).html, SCAN_CAPS.html),
      })),
    }
  })
  const links: QaLink[] = arr(r.links, SCAN_CAPS.links).map(l => ({
    url: str(rec(l).url, SCAN_CAPS.url), text: str(rec(l).text, SCAN_CAPS.text), selector: str(rec(l).selector, SCAN_CAPS.selector),
  }))
  const missingAnchors: QaMissingAnchor[] = arr(r.missingAnchors, SCAN_CAPS.missingAnchors).map(m => ({
    href: str(rec(m).href, SCAN_CAPS.url), selector: str(rec(m).selector, SCAN_CAPS.selector),
  }))
  return {
    a11y, links, missingAnchors,
    seo: normaliseSeo(r.seo),
    content: normaliseContent(r.content),
    layout: normaliseLayout(r.layout),
    perf: normalisePerf(r.perf),
  }
}

/** Parses a stored scan row; never throws. Unparseable JSON becomes an empty normalised scan. */
export function parseStoredScan(raw: string): QaScanResult {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  return normaliseScanResult(parsed)
}
