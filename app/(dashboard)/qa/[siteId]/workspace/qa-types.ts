import { QA_BROWSER_KEYS, QA_VIEWPORT_KEYS, browserLabel, type QaBrowserKey, type QaIssue, type QaPageStatus, type QaScanResult, type QaTarget, type QaViewportKey, type QaLinkResult } from '@/lib/qa/types'
import type { QaSiteCheck } from '@/lib/qa/site-checks'

/** One row of qa_round_pages as returned by GET /api/admin/qa/rounds/<id>. */
export interface QaRoundPageRow {
  id: string
  roundId: string
  pageId: string
  path: string
  groupKey: string | null
  sortOrder: number
  vpXl: number
  vpDesktop: number
  vpTablet: number
  vpMobileL: number
  vpMobileP: number
  status: QaPageStatus
  note: string | null
  requestIds: string | null
  a11yCritical: number | null
  a11ySerious: number | null
  a11yModerate: number | null
  a11yMinor: number | null
  brokenLinks: number | null
  seoIssues: number | null
  launchIssues: number | null
  perfIssues: number | null
  scannedAt: string | null
  pagespeed: string | null
  pagespeedAt: string | null
  /** Ticks per browser of the round, as GET /api/admin/qa/rounds/<id> returns them. */
  browserTicks?: Partial<Record<QaBrowserKey, QaTickMap>>
}

export interface QaRoundRow {
  id: string
  siteId: string
  name: string
  target: QaTarget
  status: 'open' | 'closed'
  /** The browsers this round covers, never empty. */
  browsers: QaBrowserKey[]
  siteChecks: QaSiteCheck[] | null
  siteChecksAt: string | null
  redirectMap: unknown
  redirectMapAt: string | null
  createdAt: string
  closedAt: string | null
}

export interface QaSiteRow {
  id: string
  orgId: string
  name: string
  stagingUrl: string | null
  liveUrl: string | null
  notes: string | null
  orgName?: string | null
}

export interface QaGroupSummary {
  groupKey: string
  totalPages: number
  sampled: number
}

/** GET /api/admin/qa/rounds/<id> */
export interface QaRoundResponse {
  round: QaRoundRow
  site: QaSiteRow
  pages: QaRoundPageRow[]
  groups: QaGroupSummary[]
}

/** GET /api/admin/qa/round-pages/<id> */
export interface QaRoundPageDetail {
  roundPage: QaRoundPageRow
  browsers?: QaBrowserKey[]
  /** Scans keyed by browser, then viewport. */
  scans: Partial<Record<QaBrowserKey, Partial<Record<QaViewportKey, QaScanResult>>>>
  links: QaLinkResult[]
  issues: QaIssue[]
}

/** The detail the issue panel reads: the scans of one browser, flat by viewport. */
export type QaIssuePanelDetail = Omit<QaRoundPageDetail, 'scans'> & {
  scans: Partial<Record<QaViewportKey, QaScanResult>>
}

/** True when a viewport map holds at least one scan. */
function hasScans(scans: Partial<Record<QaViewportKey, QaScanResult>> | undefined): scans is Partial<Record<QaViewportKey, QaScanResult>> {
  return scans !== undefined && Object.keys(scans).length > 0
}

/** The scans of one browser. With fallback, a browser with none yields the first browser that has some. */
export function scansForBrowser(
  scans: QaRoundPageDetail['scans'],
  browser: QaBrowserKey,
  fallback = false,
): Partial<Record<QaViewportKey, QaScanResult>> {
  const own = scans[browser]
  if (hasScans(own)) return own
  if (!fallback) return {}
  for (const key of QA_BROWSER_KEYS) {
    const other = scans[key]
    if (hasScans(other)) return other
  }
  return {}
}

/** One entry in the rounds list on the site page (GET /api/admin/qa/sites/<id>). */
export interface QaRoundSummary {
  id: string
  name: string
  target: QaTarget
  status: 'open' | 'closed'
  browsers?: QaBrowserKey[]
  createdAt: string
  closedAt: string | null
}

/** Per-viewport scan state for one frame. */
export type QaScanState = 'loading' | 'scanned' | 'no_scan' | 'failed'

/** Ticks for one round page keyed by viewport. */
export type QaTickMap = Record<QaViewportKey, boolean>

export function emptyTicks(): QaTickMap {
  return { xl: false, desktop: false, tablet: false, mobile_l: false, mobile_p: false }
}

/** Ticks for one browser. Chrome reads the vp_* columns when the row carries no browserTicks. */
export function ticksFor(row: QaRoundPageRow, browser: QaBrowserKey = 'chromium'): QaTickMap {
  const stored = row.browserTicks?.[browser]
  if (stored) return stored
  if (browser !== 'chromium') return emptyTicks()
  return {
    xl: row.vpXl === 1,
    desktop: row.vpDesktop === 1,
    tablet: row.vpTablet === 1,
    mobile_l: row.vpMobileL === 1,
    mobile_p: row.vpMobileP === 1,
  }
}

/** Ticks done across the given browsers (default Chrome only). */
export function tickCount(row: QaRoundPageRow, browsers: readonly QaBrowserKey[] = ['chromium']): number {
  let n = 0
  for (const b of browsers) {
    const ticks = ticksFor(row, b)
    n += QA_VIEWPORT_KEYS.filter(v => ticks[v]).length
  }
  return n
}

export interface QaBrowserBreakdown {
  browser: QaBrowserKey
  label: string
  done: number
  total: number
}

/** x / y per browser for one page, in the round's browser order. */
export function browserBreakdown(row: QaRoundPageRow, browsers: readonly QaBrowserKey[]): QaBrowserBreakdown[] {
  return browsers.map(browser => ({
    browser,
    label: browserLabel(browser),
    done: tickCount(row, [browser]),
    total: QA_VIEWPORT_KEYS.length,
  }))
}

/** Tooltip text for a page row, e.g. "/pricing. Chrome 3/5, Firefox 0/5". One browser adds nothing. */
export function pageRowTitle(row: QaRoundPageRow, browsers: readonly QaBrowserKey[]): string {
  if (browsers.length < 2) return row.path
  return `${row.path}. ${browserBreakdown(row, browsers).map(b => `${b.label} ${b.done}/${b.total}`).join(', ')}`
}

/** Sum of the eight count columns, treating unscanned nulls as 0. */
export function issueTotal(row: QaRoundPageRow): number {
  return (row.a11yCritical ?? 0) + (row.a11ySerious ?? 0) + (row.a11yModerate ?? 0) + (row.a11yMinor ?? 0)
    + (row.brokenLinks ?? 0) + (row.seoIssues ?? 0) + (row.launchIssues ?? 0) + (row.perfIssues ?? 0)
}
