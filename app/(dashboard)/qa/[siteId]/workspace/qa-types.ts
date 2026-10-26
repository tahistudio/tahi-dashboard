import type { QaIssue, QaPageStatus, QaScanResult, QaTarget, QaViewportKey, QaLinkResult } from '@/lib/qa/types'
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
}

export interface QaRoundRow {
  id: string
  siteId: string
  name: string
  target: QaTarget
  status: 'open' | 'closed'
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
  scans: Partial<Record<QaViewportKey, QaScanResult>>
  links: QaLinkResult[]
  issues: QaIssue[]
}

/** One entry in the rounds list on the site page (GET /api/admin/qa/sites/<id>). */
export interface QaRoundSummary {
  id: string
  name: string
  target: QaTarget
  status: 'open' | 'closed'
  createdAt: string
  closedAt: string | null
}

/** Per-viewport scan state for one frame. */
export type QaScanState = 'loading' | 'scanned' | 'no_scan' | 'failed'

/** Ticks for one round page keyed by viewport. */
export type QaTickMap = Record<QaViewportKey, boolean>

export function ticksFor(row: QaRoundPageRow): QaTickMap {
  return {
    xl: row.vpXl === 1,
    desktop: row.vpDesktop === 1,
    tablet: row.vpTablet === 1,
    mobile_l: row.vpMobileL === 1,
    mobile_p: row.vpMobileP === 1,
  }
}

export function tickCount(row: QaRoundPageRow): number {
  return [row.vpXl, row.vpDesktop, row.vpTablet, row.vpMobileL, row.vpMobileP].filter(v => v === 1).length
}

/** Sum of the eight count columns, treating unscanned nulls as 0. */
export function issueTotal(row: QaRoundPageRow): number {
  return (row.a11yCritical ?? 0) + (row.a11ySerious ?? 0) + (row.a11yModerate ?? 0) + (row.a11yMinor ?? 0)
    + (row.brokenLinks ?? 0) + (row.seoIssues ?? 0) + (row.launchIssues ?? 0) + (row.perfIssues ?? 0)
}
