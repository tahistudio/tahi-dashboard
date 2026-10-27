'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Accessibility, CheckCircle2, Check, Gauge, Link2Off, ListChecks, Minus, Printer, Rocket, Search, XCircle } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataState } from '@/components/tahi/data-state'
import { EmptyState } from '@/components/tahi/empty-state'
import { KPICell, KPIStrip } from '@/components/tahi/kpi-strip'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import {
  QA_VIEWPORTS,
  browserLabel,
  type QaBrowserKey,
  type QaLinkResult,
  type QaPageCounts,
  type QaPageStatus,
  type QaViewportKey,
} from '@/lib/qa/types'

// Print-only rules. Everything outside the report root is hidden (dashboard
// sidebar, top nav, feedback ball), buttons drop out, rows never split across
// pages and backgrounds are removed so the page does not waste ink.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .qa-report-root, .qa-report-root * { visibility: visible !important; }
  .qa-report-root { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; padding: 0 !important; }
  .qa-report-root * { background: transparent !important; box-shadow: none !important; }
  .qa-report-root th, .qa-report-root td { border: 1px solid var(--color-border) !important; }
  .qa-report-no-print { display: none !important; }
  .qa-report-root tr, .qa-report-root li { break-inside: avoid; page-break-inside: avoid; }
  .qa-report-root a { text-decoration: none !important; }
}
`

const SITE_CHECK_LABELS: Record<string, string> = {
  robots: 'robots.txt',
  sitemap: 'sitemap.xml',
  https_redirect: 'HTTPS redirect',
  www_canonical: 'www canonical',
  favicon: 'Favicon',
}

const TICK_LABELS: Record<QaViewportKey, string> = {
  xl: 'XL',
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile_l: 'Mobile L',
  mobile_p: 'Mobile P',
}

const RESULT_TONE: Record<string, BadgeTone> = {
  pass: 'positive',
  warn: 'warning',
  fail: 'danger',
}

const RESULT_LABEL: Record<string, string> = {
  pass: 'Pass',
  warn: 'Warn',
  fail: 'Fail',
}

const PAGE_STATUS_TONE: Record<QaPageStatus, BadgeTone> = {
  pass: 'positive',
  fail: 'danger',
  untested: 'neutral',
}

const PAGE_STATUS_LABEL: Record<QaPageStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  untested: 'Untested',
}

interface ReportPage {
  id: string
  path: string
  status: QaPageStatus
  ticks: Record<QaViewportKey, boolean>
  /** Ticks per browser of the round. Absent in older responses, which carry only the Chrome ticks. */
  browserTicks?: Partial<Record<QaBrowserKey, Record<QaViewportKey, boolean>>>
  counts: QaPageCounts | null
  note: string | null
  requestIds: string[]
}

interface ReportSiteCheck {
  code: string
  result: 'pass' | 'warn' | 'fail'
  detail: string
}

interface ReportRedirectEntry extends QaLinkResult {
  oldUrl: string
  mappedUrl: string | null
}

/** One element comment on a round page. Optional on ReportData so older responses still render. */
export interface ReportComment {
  roundPageId: string
  path: string
  viewport: QaViewportKey
  browser?: QaBrowserKey
  browserLabel?: string
  n: number
  body: string
  status: 'open' | 'resolved'
  elementTag: string | null
  elementText: string | null
  authorName: string | null
  createdAt: string
}

interface ReportCommentCounts {
  open: number
  resolved: number
}

interface ReportData {
  comments?: ReportComment[]
  commentCounts?: ReportCommentCounts
  round: {
    id: string
    siteId: string
    name: string
    target: 'staging' | 'live'
    status: 'open' | 'closed'
    browsers?: QaBrowserKey[]
    createdAt: string
    closedAt: string | null
    siteChecksAt: string | null
    redirectMapAt: string | null
  }
  site: {
    id: string
    name: string
    orgId: string
    stagingUrl: string | null
    liveUrl: string | null
  }
  orgName: string | null
  totals: {
    pages: number
    ticksDone: number
    ticksTotal: number
    pass: number
    fail: number
    untested: number
    a11yCritical: number
    a11ySerious: number
    brokenLinks: number
    seoIssues: number
    launchIssues: number
    perfIssues: number
  }
  pages: ReportPage[]
  siteChecks: unknown[] | null
  redirectMap: unknown[] | null
}

function isSiteCheck(value: unknown): value is ReportSiteCheck {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.code === 'string' && typeof v.detail === 'string' && typeof v.result === 'string'
}

function isRedirectEntry(value: unknown): value is ReportRedirectEntry {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.oldUrl === 'string' && (typeof v.mappedUrl === 'string' || v.mappedUrl === null) && typeof v.broken === 'boolean'
}

function isReportComment(value: unknown): value is ReportComment {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.path === 'string' && typeof v.body === 'string' && typeof v.n === 'number' && (v.status === 'open' || v.status === 'resolved')
}

/** Groups comments by page path, keeping first-seen path order. Open comments come before resolved ones. */
function groupCommentsByPath(comments: ReportComment[]): { path: string; items: ReportComment[] }[] {
  const byPath = new Map<string, ReportComment[]>()
  for (const comment of comments) {
    const list = byPath.get(comment.path)
    if (list) list.push(comment)
    else byPath.set(comment.path, [comment])
  }
  return [...byPath.entries()].map(([path, items]) => ({
    path,
    items: [...items].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1
      return a.n - b.n
    }),
  }))
}

/** The browsers a report covers. Older responses name none, which means Chrome. */
function reportBrowsers(data: ReportData): QaBrowserKey[] {
  const named = data.round.browsers
  return named && named.length > 0 ? named : ['chromium']
}

/** One page's ticks for one browser. */
function ticksOf(page: ReportPage, browser: QaBrowserKey): Record<QaViewportKey, boolean> {
  return page.browserTicks?.[browser] ?? (browser === 'chromium' ? page.ticks : { xl: false, desktop: false, tablet: false, mobile_l: false, mobile_p: false })
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function targetLabel(target: string): string {
  return target === 'live' ? 'Live' : 'Staging'
}

function countsLine(counts: QaPageCounts | null): string {
  if (!counts) return 'Not scanned'
  return [
    `A11y ${counts.a11yCritical + counts.a11ySerious} serious or critical`,
    `Links ${counts.brokenLinks}`,
    `SEO ${counts.seoIssues}`,
    `Launch ${counts.launchIssues}`,
    `Perf ${counts.perfIssues}`,
  ].join(' | ')
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padding="md" className="flex flex-col" style={{ gap: '0.75rem', minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>{title}</h2>
      {children}
    </Card>
  )
}

const TH_STYLE: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.625rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--color-text-muted)',
  background: 'var(--color-bg-tertiary)',
  whiteSpace: 'nowrap',
}

const TD_STYLE: React.CSSProperties = {
  padding: '0.5rem 0.625rem',
  fontSize: '0.8125rem',
  color: 'var(--color-text)',
  verticalAlign: 'top',
}

/** Zebra striping separates table rows without single-side borders. */
function rowBackground(index: number): React.CSSProperties {
  return { background: index % 2 === 1 ? 'var(--color-bg-secondary)' : 'transparent' }
}

export function ReportContent({ roundId }: { roundId: string }) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${encodeURIComponent(roundId)}/report`))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ReportData
      setData(json)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [roundId])

  useEffect(() => {
    void load()
  }, [load])

  const siteChecks = (data?.siteChecks ?? []).filter(isSiteCheck)
  const redirectEntries = (data?.redirectMap ?? []).filter(isRedirectEntry)
  const reportComments = (data?.comments ?? []).filter(isReportComment)
  const commentGroups = groupCommentsByPath(reportComments)

  return (
    <div className="qa-report-root flex flex-col" style={{ gap: '1rem', minWidth: 0 }}>
      <style>{PRINT_CSS}</style>

      <DataState
        loading={loading}
        hasData={data !== null}
        error={error ? 'failed' : undefined}
        onRetry={() => void load()}
        errorTitle="The round report could not be loaded."
        skeleton={<LoadingSkeleton rows={6} height={48} />}
      >
        {data && (
          <>
            <PageHeader
              title={data.site.name}
              subtitle={[
                data.orgName,
                data.round.name,
                `${targetLabel(data.round.target)} target`,
                reportBrowsers(data).map(browserLabel).join(', '),
                data.round.closedAt
                  ? `Closed ${formatDate(data.round.closedAt)}`
                  : `Started ${formatDate(data.round.createdAt)}`,
              ]
                .filter(Boolean)
                .join(' | ')}
            >
              <TahiButton
                variant="secondary"
                size="sm"
                className="qa-report-no-print"
                iconLeft={<Printer className="w-3.5 h-3.5" aria-hidden="true" />}
                onClick={() => window.print()}
              >
                Print
              </TahiButton>
            </PageHeader>

            <KPIStrip desktopCols={4}>
              <KPICell
                icon={CheckCircle2}
                label="Pages passed"
                value={`${data.totals.pass} / ${data.totals.pages}`}
                sub={`${data.totals.fail} failing, ${data.totals.untested} untested`}
                tone={data.totals.fail > 0 ? 'warning' : 'positive'}
              />
              <KPICell
                icon={ListChecks}
                label="Ticks done"
                value={`${data.totals.ticksDone} / ${data.totals.ticksTotal}`}
                sub={reportBrowsers(data).length > 1 ? 'Page by viewport by browser' : 'Page by viewport'}
              />
              <KPICell
                icon={XCircle}
                label="Failing pages"
                value={data.totals.fail}
                tone={data.totals.fail > 0 ? 'danger' : 'neutral'}
              />
              <KPICell
                icon={Accessibility}
                label="A11y serious and critical"
                value={data.totals.a11yCritical + data.totals.a11ySerious}
                tone={data.totals.a11yCritical + data.totals.a11ySerious > 0 ? 'danger' : 'neutral'}
              />
              <KPICell
                icon={Link2Off}
                label="Broken links"
                value={data.totals.brokenLinks}
                tone={data.totals.brokenLinks > 0 ? 'danger' : 'neutral'}
              />
              <KPICell
                icon={Search}
                label="SEO issues"
                value={data.totals.seoIssues}
                tone={data.totals.seoIssues > 0 ? 'warning' : 'neutral'}
              />
              <KPICell
                icon={Rocket}
                label="Launch issues"
                value={data.totals.launchIssues}
                tone={data.totals.launchIssues > 0 ? 'warning' : 'neutral'}
              />
              <KPICell
                icon={Gauge}
                label="Performance issues"
                value={data.totals.perfIssues}
                tone={data.totals.perfIssues > 0 ? 'warning' : 'neutral'}
              />
            </KPIStrip>

            <SectionCard title="Site checks">
              {data.siteChecks === null || siteChecks.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  Site checks have not been run for this round.
                </p>
              ) : (
                <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.25rem' }}>
                  {siteChecks.map(check => (
                    <li
                      key={check.code}
                      className="flex flex-wrap items-center"
                      style={{
                        gap: '0.5rem 0.75rem',
                        padding: '0.5rem 0.75rem',
                        border: '1px solid var(--color-border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', minWidth: '8rem' }}>
                        {SITE_CHECK_LABELS[check.code] ?? check.code}
                      </span>
                      <Badge tone={RESULT_TONE[check.result] ?? 'neutral'} size="sm">
                        {RESULT_LABEL[check.result] ?? check.result}
                      </Badge>
                      <span style={{ flex: 1, minWidth: '10rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                        {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {redirectEntries.length > 0 && (
              <SectionCard title="Redirect map">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '36rem' }}>
                    <thead>
                      <tr>
                        <th scope="col" style={TH_STYLE}>Old URL</th>
                        <th scope="col" style={TH_STYLE}>Mapped URL</th>
                        <th scope="col" style={TH_STYLE}>Status</th>
                        <th scope="col" style={TH_STYLE}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {redirectEntries.map((entry, index) => {
                        const invalid = entry.mappedUrl === null
                        const notChecked = entry.error === 'not_checked'
                        return (
                        <tr key={entry.oldUrl} style={rowBackground(index)}>
                          <td style={{ ...TD_STYLE, wordBreak: 'break-all' }}>{entry.oldUrl}</td>
                          <td style={{ ...TD_STYLE, wordBreak: 'break-all' }}>{entry.mappedUrl ?? 'Invalid URL'}</td>
                          <td style={TD_STYLE} className="tabular-nums">
                            {invalid || notChecked ? '' : (entry.status ?? 'No response')}
                          </td>
                          <td style={TD_STYLE}>
                            {invalid ? (
                              <Badge tone="danger" size="sm">Invalid URL</Badge>
                            ) : notChecked ? (
                              <Badge tone="neutral" size="sm">Not checked</Badge>
                            ) : (
                              <Badge tone={entry.broken ? 'danger' : 'positive'} size="sm">
                                {entry.broken ? 'Broken' : 'OK'}
                              </Badge>
                            )}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}

            <SectionCard title="Pages">
              {data.pages.length === 0 ? (
                <EmptyState
                  variant="inline"
                  icon={<ListChecks className="w-8 h-8" />}
                  title="No pages in this round"
                  description="Add pages to the site, then start a new round."
                />
              ) : (
                <div style={{ overflowX: 'auto', position: 'relative' /* containing block for the header's sr-only labels, so they scroll with the table */ }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${48 + Math.max(0, reportBrowsers(data).length - 1) * 22}rem` }}>
                    <thead>
                      <tr>
                        <th scope="col" rowSpan={reportBrowsers(data).length > 1 ? 2 : 1} style={{ ...TH_STYLE, minWidth: '10rem' }}>Path</th>
                        <th scope="col" rowSpan={reportBrowsers(data).length > 1 ? 2 : 1} style={TH_STYLE}>Status</th>
                        {reportBrowsers(data).length > 1
                          ? reportBrowsers(data).map(browser => (
                            <th key={browser} scope="colgroup" colSpan={QA_VIEWPORTS.length} style={{ ...TH_STYLE, textAlign: 'center' }}>
                              {browserLabel(browser)}
                            </th>
                          ))
                          : QA_VIEWPORTS.map(vp => (
                            <th key={vp.key} scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>
                              {TICK_LABELS[vp.key]}
                            </th>
                          ))}
                        <th scope="col" rowSpan={reportBrowsers(data).length > 1 ? 2 : 1} style={TH_STYLE}>Counts</th>
                        <th scope="col" rowSpan={reportBrowsers(data).length > 1 ? 2 : 1} style={TH_STYLE}>Note</th>
                        <th scope="col" rowSpan={reportBrowsers(data).length > 1 ? 2 : 1} style={TH_STYLE}>Requests</th>
                      </tr>
                      {reportBrowsers(data).length > 1 ? (
                        <tr>
                          {reportBrowsers(data).flatMap(browser => QA_VIEWPORTS.map(vp => (
                            <th key={`${browser}-${vp.key}`} scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>
                              <span className="sr-only">{browserLabel(browser)} </span>
                              {TICK_LABELS[vp.key]}
                            </th>
                          )))}
                        </tr>
                      ) : null}
                    </thead>
                    <tbody>
                      {data.pages.map((page, pageIndex) => (
                        <tr key={page.id} style={rowBackground(pageIndex)}>
                          <td style={{ ...TD_STYLE, fontWeight: 600, wordBreak: 'break-all', minWidth: '10rem' }}>{page.path}</td>
                          <td style={TD_STYLE}>
                            <Badge tone={PAGE_STATUS_TONE[page.status]} size="sm">
                              {PAGE_STATUS_LABEL[page.status]}
                            </Badge>
                          </td>
                          {reportBrowsers(data).flatMap(browser => QA_VIEWPORTS.map(vp => {
                            const done = ticksOf(page, browser)[vp.key]
                            const name = `${browserLabel(browser)} ${TICK_LABELS[vp.key]}`
                            return (
                              <td key={`${browser}-${vp.key}`} style={{ ...TD_STYLE, textAlign: 'center' }}>
                                {done ? (
                                  <Check className="w-4 h-4 inline-block" role="img" aria-label={`${name} done`} style={{ color: 'var(--color-brand)' }} />
                                ) : (
                                  <Minus className="w-4 h-4 inline-block" role="img" aria-label={`${name} not done`} style={{ color: 'var(--color-text-subtle)' }} />
                                )}
                              </td>
                            )
                          }))}
                          <td style={{ ...TD_STYLE, fontSize: '0.75rem', color: 'var(--color-text-muted)', minWidth: '12rem' }}>
                            {countsLine(page.counts)}
                          </td>
                          <td style={{ ...TD_STYLE, minWidth: '10rem' }}>{page.note ?? ''}</td>
                          <td style={TD_STYLE}>
                            {page.requestIds.length === 0 ? (
                              ''
                            ) : (
                              <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.25rem' }}>
                                {page.requestIds.map((requestId, index) => (
                                  <li key={requestId}>
                                    <Link
                                      href={`/requests/${requestId}`}
                                      className="tahi-focus-ring inline-flex items-center"
                                      style={{
                                        minHeight: '2.75rem',
                                        fontSize: '0.8125rem',
                                        fontWeight: 600,
                                        color: 'var(--color-brand)',
                                        textDecoration: 'underline',
                                      }}
                                    >
                                      Request {index + 1}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            {data.commentCounts ? (
              <SectionCard title="Comments">
                <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  {`${data.commentCounts.open} open, ${data.commentCounts.resolved} resolved`}
                </p>
                {commentGroups.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                    No comments on this round.
                  </p>
                ) : (
                  commentGroups.map(group => (
                    <div key={group.path} className="flex flex-col" style={{ gap: '0.5rem' }}>
                      <h3 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)', wordBreak: 'break-all' }}>
                        {group.path}
                      </h3>
                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {group.items.map(comment => (
                          <li
                            key={`${comment.roundPageId}-${comment.n}-${comment.viewport}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.25rem',
                              padding: '0.5rem 0.75rem',
                              border: '1px solid var(--color-border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                              <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{`#${comment.n}`}</span>
                              <span>{TICK_LABELS[comment.viewport] ?? comment.viewport}</span>
                              {comment.browser ? <span>{comment.browserLabel ?? browserLabel(comment.browser)}</span> : null}
                              <Badge tone={comment.status === 'open' ? 'warning' : 'positive'} size="sm">
                                {comment.status === 'open' ? 'Open' : 'Resolved'}
                              </Badge>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {comment.body}
                            </p>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                              {`<${comment.elementTag ?? 'element'}>`}
                              {comment.elementText ? ` ${comment.elementText}` : ''}
                              {` | ${comment.authorName ?? 'Unknown author'}`}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </SectionCard>
            ) : null}

          </>
        )}
      </DataState>
    </div>
  )
}
