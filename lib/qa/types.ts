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

/**
 * Element comments (SQA.2). The dashboard turns comment mode on in a frame;
 * the scanner lets the user pick an element and reports it with a qa:pick.
 * The dashboard stores the comment and sends the frame its pins to draw.
 */
export interface QaCommentModeMessage { type: 'qa:comment-mode'; on: boolean }

/** One pin to draw in a frame. ox and oy are fractions (0 to 1) of the element box. */
export interface QaPin { id: string; n: number; selector: string; ox: number; oy: number; resolved: boolean }
export interface QaPinsMessage { type: 'qa:pins'; pins: QaPin[] }
export interface QaFocusPinMessage { type: 'qa:focus-pin'; id: string }

/** Frame to dashboard: comment mode was turned off inside the frame (Esc), so the toggle can follow. */
export interface QaCommentModeChangedMessage { type: 'qa:comment-mode-changed'; version: 1; on: boolean }

/** Frame to dashboard: Esc was pressed inside the frame while comment mode was off, so the dashboard can peel its own layers. */
export interface QaEscapeMessage { type: 'qa:escape'; version: 1 }

/** Limits for QaElementContext, enforced by the scanner and again by the API. */
export const QA_CONTEXT_MAX_CLASSES = 20
export const QA_CONTEXT_CLASS_MAX = 100
export const QA_CONTEXT_MAX_ANCESTORS = 8
export const QA_CONTEXT_HTML_MAX = 600
export const QA_CONTEXT_MAX_BYTES = 8192

export interface QaContextAncestor { tag: string; id: string | null; classes: string[] }

/**
 * Where a picked element sits, captured in the frame at pick time so another
 * tool can find and fix it without seeing the screen. The box is in page
 * coordinates at the frame's width (client rect plus scroll), rounded.
 */
export interface QaElementContext {
  id: string | null
  classes: string[]
  /** nearest first, stopping at the first section, header, footer, main, article, nav or body child */
  ancestors: QaContextAncestor[]
  /** outerHTML, truncated */
  html: string
  box: { x: number; y: number; width: number; height: number }
  scrollY: number
  pageHeight: number
  viewportWidth: number
  viewportHeight: number
}

/** Frame to dashboard: the user clicked an element in comment mode. */
export interface QaPickMessage {
  type: 'qa:pick'
  version: 1
  /** upstream page URL, same shape as QaScanMessage.url */
  url: string
  selector: string
  ox: number
  oy: number
  /** tag name, lower case, e.g. 'button' */
  tag: string
  /** first 120 characters of the element's visible text, trimmed */
  text: string
  /** absent from older scanners */
  context?: QaElementContext
}

/** Frame to dashboard: the user clicked a pin. */
export interface QaPinClickMessage { type: 'qa:pin-click'; version: 1; id: string }

export type QaCommentStatus = 'open' | 'resolved'

/** One row of qa_comments as the API returns it. */
export interface QaComment {
  id: string
  roundPageId: string
  viewport: QaViewportKey
  selector: string
  ox: number
  oy: number
  elementTag: string | null
  elementText: string | null
  body: string
  status: QaCommentStatus
  /** request created from this comment, if any */
  requestId: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  /** absent for comments made before element context existed */
  elementContext: QaElementContext | null
}

/** Webflow breakpoint guidance for a viewport, so an editor knows which breakpoint to open. */
export interface QaViewportInfo {
  key: QaViewportKey
  label: string
  width: number
  height: number
  webflowBreakpoint: string
}

/** A comment with everything needed to find and fix it without seeing the screen. */
export type QaCommentDetail = QaComment & {
  /** pin number on its page */
  n: number
  path: string
  /** the round target's site origin plus path, null when the site has no URL for the target */
  pageUrl: string | null
  target: QaTarget
  viewportInfo: QaViewportInfo
  roundId: string
  roundName: string
  siteName: string
}

export const QA_COMMENT_BODY_MAX = 4000

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
