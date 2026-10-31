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

/**
 * The rendering engines a round can cover. A page always renders with the engine of the browser it
 * is open in, so every tick, scan and comment is recorded against one of these. Chromium ticks stay
 * in the qa_round_pages.vp_* columns; the other engines live in qa_browser_ticks.
 */
export const QA_BROWSERS = [
  { key: 'chromium', label: 'Chrome', shortLabel: 'Chr' },
  { key: 'firefox', label: 'Firefox', shortLabel: 'Fx' },
  { key: 'webkit', label: 'Safari', shortLabel: 'Saf' },
] as const

export type QaBrowserKey = (typeof QA_BROWSERS)[number]['key']
export const QA_BROWSER_KEYS: readonly QaBrowserKey[] = QA_BROWSERS.map(b => b.key)
export const QA_DEFAULT_BROWSER: QaBrowserKey = 'chromium'

export function isQaBrowserKey(value: unknown): value is QaBrowserKey {
  return typeof value === 'string' && (QA_BROWSER_KEYS as readonly string[]).includes(value)
}

export function browserLabel(key: QaBrowserKey): string {
  return QA_BROWSERS.find(b => b.key === key)?.label ?? key
}

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

/**
 * Synced scrolling. A frame reports only scrolls its user caused, and only while the
 * dashboard has turned reporting on with qa:scroll-sync. The anchor is the section-like element
 * under a probe line near the top of the frame, with frac the fraction of that element already
 * above the line, so frames of different widths land on the same content. ratio is the whole
 * page fraction, the fallback when the anchor does not resolve.
 */
export interface QaScrollAnchor { selector: string; frac: number }
export interface QaScrollMessage { type: 'qa:scroll'; version: 1; url: string; anchor: QaScrollAnchor | null; ratio: number }

/** Dashboard to frame: scroll to this place. Never reported back as a user scroll. */
export interface QaScrollToMessage { type: 'qa:scroll-to'; anchor: QaScrollAnchor | null; ratio: number }

/** Dashboard to frame: whether the frame should report user scrolls at all. Off until told otherwise. */
export interface QaScrollSyncMessage { type: 'qa:scroll-sync'; on: boolean }

/** Frame to dashboard: the user clicked a pin. */
export interface QaPinClickMessage { type: 'qa:pin-click'; version: 1; id: string }

export type QaCommentStatus = 'open' | 'resolved'

/** Where a note was written: the dashboard, a person's assistant through MCP, or the shared service token with no person. */
export type QaNoteSource = 'dashboard' | 'mcp' | 'service'

/** One note in the thread under a comment. */
export interface QaCommentNote {
  id: string
  commentId: string
  body: string
  authorId: string | null
  authorName: string | null
  source: QaNoteSource
  createdAt: string
}

/** One row of qa_comments as the API returns it. */
export interface QaComment {
  id: string
  roundPageId: string
  viewport: QaViewportKey
  /** the engine the comment was made in */
  browser: QaBrowserKey
  browserLabel: string
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
  /** the note thread, oldest first */
  notes: QaCommentNote[]
  noteCount: number
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
export const QA_NOTE_BODY_MAX = 4000
/** Most notes one comment thread holds. */
export const QA_NOTES_PER_COMMENT_MAX = 100

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
  /** the first browser that showed this issue; absent when the issue is not tied to a scan */
  browser?: QaBrowserKey
  /** every browser that showed the identical issue (see issueDedupeKey in lib/qa/browsers.ts) */
  browsers?: QaBrowserKey[]
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
