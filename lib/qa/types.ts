/**
 * Shared Site QA (SQA) types. Pure: imported by the dashboard AND by
 * workers/qa-view, so nothing here may import Next.js, D1 or Node APIs.
 */

export const QA_VIEWPORTS = [
  { key: 'xl', label: 'XL', width: 1920, height: 1080 },
  { key: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { key: 'tablet', label: 'Tablet', width: 768, height: 1024 },
  { key: 'mobile_l', label: 'Mobile L', width: 425, height: 860 },
  { key: 'mobile_p', label: 'Mobile P', width: 375, height: 812 },
] as const

export type QaViewportKey = (typeof QA_VIEWPORTS)[number]['key']
export const QA_VIEWPORT_KEYS: readonly QaViewportKey[] = QA_VIEWPORTS.map(v => v.key)
/** The viewport whose scan supplies the non-layout results (SEO, links, a11y). */
export const QA_PRIMARY_VIEWPORT: QaViewportKey = 'desktop'

export type QaTarget = 'staging' | 'live'
export type QaPageStatus = 'untested' | 'pass' | 'fail'

export interface QaA11yNode { selector: string; html: string }
export interface QaA11yViolation {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  help: string
  helpUrl: string
  nodes: QaA11yNode[]
}

export interface QaLink { url: string; text: string; selector: string }
export interface QaMissingAnchor { href: string; selector: string }

export interface QaSeo {
  title: string | null
  metaDescription: string | null
  canonical: string | null
  robotsMeta: string | null
  og: { title: string | null; description: string | null; image: string | null; url: string | null }
  h1Count: number
  headingOutline: { level: number; text: string }[]
  headingSkips: { from: number; to: number; text: string }[]
  jsonLd: { count: number; parseErrors: number }
  lang: string | null
  favicon: string | null
}

export interface QaContent {
  imagesMissingAlt: { selector: string; src: string }[]
  stagingLeftovers: { kind: 'webflow_io' | 'lorem_ipsum' | 'placeholder_image'; sample: string; selector: string }[]
  forms: { action: string | null; method: string; fieldCount: number; selector: string }[]
}

export interface QaLayout {
  horizontalOverflow: boolean
  overflowingElements: { selector: string; width: number }[]
}

export interface QaPerfImage {
  src: string
  naturalWidth: number
  naturalHeight: number
  renderedWidth: number
  renderedHeight: number
  /** natural width > 2 x rendered width x devicePixelRatio */
  oversized: boolean
  format: string
  /** bytes from the resource timing API, 0 when unknown (cross-origin without Timing-Allow-Origin) */
  transferSize: number
}

export interface QaPerf { images: QaPerfImage[]; totalTransferSize: number }

export interface QaScanResult {
  a11y: QaA11yViolation[]
  links: QaLink[]
  missingAnchors: QaMissingAnchor[]
  seo: QaSeo
  content: QaContent
  layout: QaLayout
  perf: QaPerf
}

export interface QaScanMessage {
  type: 'qa:scan'
  version: 1
  url: string
  viewportWidth: number
  result: QaScanResult
}

export interface QaHighlightMessage { type: 'qa:highlight'; selector: string }
export interface QaRescanMessage { type: 'qa:rescan' }

export type QaIssueCategory = 'a11y' | 'links' | 'seo' | 'launch' | 'perf'
export type QaIssueSeverity = 'fail' | 'warn' | 'info'

export interface QaIssue {
  category: QaIssueCategory
  code: string
  severity: QaIssueSeverity
  message: string
  selector?: string
  viewport?: QaViewportKey
  url?: string
}

export interface QaLinkResult {
  url: string
  finalUrl: string | null
  status: number | null
  hops: { url: string; status: number }[]
  broken: boolean
  redirectChain: boolean
  stagingOnLive: boolean
  error: string | null
}

export interface QaPageCounts {
  a11yCritical: number
  a11ySerious: number
  a11yModerate: number
  a11yMinor: number
  brokenLinks: number
  seoIssues: number
  launchIssues: number
  perfIssues: number
}

export interface QaViewTokenPayload {
  /** upstream origin, e.g. https://acme.webflow.io */
  o: string
  /** parent (dashboard) origin allowed to frame and receive messages */
  p: string
  /** expiry, unix seconds */
  exp: number
}

export function viewportByWidth(width: number): QaViewportKey | null {
  const hit = QA_VIEWPORTS.find(v => v.width === width)
  return hit ? hit.key : null
}
