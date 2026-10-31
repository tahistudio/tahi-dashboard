/**
 * Per-category summaries for the QA payloads (pure, no I/O). The issue panel shows five categories
 * with a count each; the MCP page and report routes expose the same numbers through these helpers.
 */
import type { PsiSummary } from '@/lib/qa/pagespeed'
import type { QaIssue, QaIssueCategory, QaIssueSeverity, QaPageCounts } from '@/lib/qa/types'

export const QA_ISSUE_CATEGORIES: readonly QaIssueCategory[] = ['a11y', 'links', 'seo', 'launch', 'perf']

export interface QaCategorySummary {
  total: number
  fail: number
  warn: number
  info: number
}

export type QaCategorySummaries = Record<QaIssueCategory, QaCategorySummary>

/** Issues counted per category and severity. total matches the count on the issue panel tab. */
export function categorySummaries(issues: readonly Pick<QaIssue, 'category' | 'severity'>[]): QaCategorySummaries {
  const empty = (): QaCategorySummary => ({ total: 0, fail: 0, warn: 0, info: 0 })
  const out: QaCategorySummaries = { a11y: empty(), links: empty(), seo: empty(), launch: empty(), perf: empty() }
  for (const issue of issues) {
    const bucket = out[issue.category]
    if (!bucket) continue
    const severity: QaIssueSeverity = issue.severity
    bucket.total += 1
    bucket[severity] += 1
  }
  return out
}

export interface QaStoredPageSpeed {
  mobile?: PsiSummary
  desktop?: PsiSummary
}

/** The qa_round_pages.pagespeed column as an object, or null when empty or unreadable. */
export function parseStoredPageSpeed(raw: string | null | undefined): QaStoredPageSpeed | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const source = parsed as Record<string, unknown>
    const out: QaStoredPageSpeed = {}
    if (source.mobile && typeof source.mobile === 'object') out.mobile = source.mobile as PsiSummary
    if (source.desktop && typeof source.desktop === 'object') out.desktop = source.desktop as PsiSummary
    return out.mobile || out.desktop ? out : null
  } catch {
    return null
  }
}

export interface QaReportCategoryTotals {
  a11y: { critical: number; serious: number; moderate: number; minor: number; total: number }
  links: number
  seo: number
  launch: number
  performance: number
}

/** Round totals per category, from the per-page counts (pages not scanned yet count as zero). */
export function reportCategoryTotals(counts: readonly (QaPageCounts | null)[]): QaReportCategoryTotals {
  const sum = (pick: (c: QaPageCounts) => number) => counts.reduce((total, c) => total + (c ? pick(c) : 0), 0)
  const critical = sum(c => c.a11yCritical)
  const serious = sum(c => c.a11ySerious)
  const moderate = sum(c => c.a11yModerate)
  const minor = sum(c => c.a11yMinor)
  return {
    a11y: { critical, serious, moderate, minor, total: critical + serious + moderate + minor },
    links: sum(c => c.brokenLinks),
    seo: sum(c => c.seoIssues),
    launch: sum(c => c.launchIssues),
    performance: sum(c => c.perfIssues),
  }
}
