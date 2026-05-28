'use client'

/**
 * /content-studio. Slice 0: Health tab populated, other tabs stubbed.
 *
 * Surfaces the indexing health of every URL on the Tahi sitemap so Liam
 * can spot blog posts Google has dropped or never picked up. Future
 * slices fill the Ideas / Drafts / Schedule tabs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RefreshCw, AlertTriangle, FileSearch, CheckCircle2, XCircle, HelpCircle,
  Lightbulb, FileEdit, Calendar, ExternalLink, ChevronDown, ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type IndexStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL' | 'UNKNOWN' | null

interface HealthRow {
  url: string
  lastCheckedAt: string
  indexStatus: IndexStatus
  coverageState: string | null
  pageFetchState: string | null
  robotsTxtState: string | null
  indexingState: string | null
  userCanonical: string | null
  googleCanonical: string | null
  inboundInternalLinks: number
  wordCount: number | null
  source: string
}

interface HealthAggregate {
  total: number
  indexed: number
  notIndexed: number
  partial: number
  unknown: number
  lastScanAt: string | null
}

interface HealthResponse {
  rows: HealthRow[]
  aggregate: HealthAggregate
}

interface ScanResponse {
  scanned: number
  completed: number
  indexed: number
  notIndexed: number
  errors: number
  errorDetails: Array<{ url: string; error: string }>
  completedAt: string
  continueFromIndex?: number
}

type TabId = 'health' | 'ideas' | 'drafts' | 'schedule'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
  slice: number
  comingDescription: string
}

const TABS: readonly TabDef[] = [
  {
    id: 'health',
    label: 'Health',
    icon: FileSearch,
    slice: 0,
    comingDescription: '',
  },
  {
    id: 'ideas',
    label: 'Ideas',
    icon: Lightbulb,
    slice: 1,
    comingDescription: 'Capture topic ideas, AI-generate angles, and rank them by search demand before they hit Drafts.',
  },
  {
    id: 'drafts',
    label: 'Drafts',
    icon: FileEdit,
    slice: 2,
    comingDescription: 'Write and edit posts in the same surface, with AI assistance and structured briefs.',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: Calendar,
    slice: 3,
    comingDescription: 'Plan publishing cadence across the blog, glossary and case studies.',
  },
] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

// Maps the raw indexStatus → Badge tone. Null collapses into UNKNOWN.
function indexStatusTone(status: IndexStatus): BadgeTone {
  switch (status) {
    case 'PASS':    return 'positive'
    case 'FAIL':    return 'danger'
    case 'PARTIAL': return 'warning'
    case 'NEUTRAL': return 'neutral'
    case 'UNKNOWN':
    case null:
    default:        return 'neutral'
  }
}

function indexStatusLabel(status: IndexStatus): string {
  switch (status) {
    case 'PASS':    return 'Indexed'
    case 'FAIL':    return 'Not indexed'
    case 'PARTIAL': return 'Partial'
    case 'NEUTRAL': return 'Neutral'
    case 'UNKNOWN':
    case null:
    default:        return 'Unknown'
  }
}

// Sort key so FAIL → PARTIAL/NEUTRAL → UNKNOWN → PASS lands the most
// actionable rows up top by default.
function indexStatusSortKey(status: IndexStatus): number {
  switch (status) {
    case 'FAIL':    return 0
    case 'PARTIAL': return 1
    case 'NEUTRAL': return 2
    case 'UNKNOWN':
    case null:      return 3
    case 'PASS':    return 4
    default:        return 5
  }
}

// Classify a URL into a top-level surface so Liam can scan blog-only,
// glossary-only etc. without crossing the streams. Mirrors the Tahi
// sitemap structure.
function pathType(url: string): string {
  try {
    const path = new URL(url).pathname
    if (path.startsWith('/blog/'))                  return 'Blog'
    if (path.startsWith('/resources/glossary/'))    return 'Glossary'
    if (path.startsWith('/resources/categories/'))  return 'Category'
    if (path.startsWith('/case-studies/'))          return 'Case study'
    if (path.startsWith('/resources/'))             return 'Resource'
    return 'Page'
  } catch {
    return 'Other'
  }
}

// Page-fetch tone. SUCCESSFUL = positive, anything else = warning/danger.
function pageFetchTone(state: string | null): { tone: BadgeTone; label: string } {
  if (!state) return { tone: 'neutral', label: '-' }
  const upper = state.toUpperCase()
  if (upper === 'SUCCESSFUL')                  return { tone: 'positive', label: 'Successful' }
  if (upper.includes('SOFT_404'))              return { tone: 'danger',   label: 'Soft 404' }
  if (upper.includes('NOT_FOUND'))             return { tone: 'danger',   label: 'Not found' }
  if (upper.includes('ACCESS_DENIED'))         return { tone: 'danger',   label: 'Access denied' }
  if (upper.includes('REDIRECT'))              return { tone: 'warning',  label: 'Redirect' }
  if (upper.includes('SERVER_ERROR'))          return { tone: 'danger',   label: 'Server error' }
  if (upper.includes('BLOCKED'))               return { tone: 'warning',  label: 'Blocked' }
  // Fallback: present the raw token in title case so unfamiliar GSC
  // values still surface rather than disappearing.
  return { tone: 'neutral', label: state.replace(/_/g, ' ').toLowerCase() }
}

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const parsed = new Date(iso)
  if (isNaN(parsed.getTime())) return 'unknown'
  const diff = Date.now() - parsed.getTime()
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

// Strip the protocol + leading "www." for the visible URL column so the
// table column reads cleanly. Hover keeps the full URL via title.
function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host.replace(/^www\./, '')}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ContentStudioContent() {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>('health')

  return (
    <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <PageHeader
        title="Content studio"
        subtitle="Tahi's blog engine. Health, ideas, drafts and schedule in one surface."
      />

      {/* Tab nav. State-driven so each tab renders its own content
          instead of jumping to anchors. Matches the client-detail tab
          pattern: bordered bottom, brand pill for the active tab,
          horizontal scroll on mobile. */}
      <nav
        className="flex gap-0 overflow-x-auto scrollbar-hide"
        style={{
          WebkitOverflowScrolling: 'touch',
          borderBottom: '1px solid var(--color-border)',
        }}
        aria-label="Content studio tabs"
        role="tablist"
      >
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`content-studio-panel-${tab.id}`}
              id={`content-studio-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center whitespace-nowrap flex-shrink-0"
              style={{
                gap: '0.4375rem',
                padding: '0.625rem 1rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: isActive ? 'var(--color-brand)' : 'var(--color-text-muted)',
                background: isActive ? 'var(--color-brand-50)' : 'transparent',
                border: 'none',
                borderBottom: isActive
                  ? '2px solid var(--color-brand)'
                  : '2px solid transparent',
                marginBottom: '-1px',
                cursor: 'pointer',
                minHeight: '2.75rem',
                transition: 'color 150ms ease, background-color 150ms ease, border-color 150ms ease',
              }}
              onMouseEnter={e => {
                if (isActive) return
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                if (isActive) return
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              <Icon size={14} aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Tab content. Only the active panel renders, keeping the DOM
          light when other tabs are stubbed. */}
      <div
        id={`content-studio-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`content-studio-tab-${activeTab}`}
      >
        {activeTab === 'health' && <HealthTab onToast={showToast} />}
        {activeTab !== 'health' && (
          <ComingSoonTab tab={TABS.find(t => t.id === activeTab)!} />
        )}
      </div>
    </div>
  )
}

// ── Health tab ────────────────────────────────────────────────────────────────

interface HealthTabProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function HealthTab({ onToast }: HealthTabProps) {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  // Captured from the most recent scan. Surfaces under the table when
  // the latest run reported errors so Liam can see what failed without
  // tailing logs.
  const [lastScanErrors, setLastScanErrors] = useState<Array<{ url: string; error: string }>>([])
  const [errorsExpanded, setErrorsExpanded] = useState(false)

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/health'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as HealthResponse
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchHealth() }, [fetchHealth])

  // Drives the "Scan now" button. Issues a POST with no body so the
  // server pulls the full sitemap, then loops on continueFromIndex
  // until all URLs are processed (the API page-sizes long scans to
  // avoid worker timeouts).
  const runScan = useCallback(async () => {
    setScanning(true)
    let totalScanned = 0
    let totalErrors = 0
    const aggregatedErrors: Array<{ url: string; error: string }> = []
    try {
      let continueFromIndex: number | undefined = undefined
      // Safety cap. The sitemap is ~201 URLs today; 10 batches at 25/req
      // is plenty of headroom. Bail out cleanly if it ever exceeds.
      let iterations = 0
      while (true) {
        if (iterations++ > 50) {
          onToast('Scan took too many batches; stopping', 'warning')
          break
        }
        const res = await fetch(apiPath('/api/admin/content/health/scan'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(continueFromIndex != null ? { continueFromIndex } : {}),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `Scan failed (${res.status})`)
        }
        const json = await res.json() as ScanResponse
        totalScanned += json.scanned
        totalErrors += json.errors
        if (json.errorDetails?.length) aggregatedErrors.push(...json.errorDetails)
        if (json.continueFromIndex == null) break
        continueFromIndex = json.continueFromIndex
      }
      setLastScanErrors(aggregatedErrors)
      if (totalErrors === 0) {
        onToast(`Scan complete. ${totalScanned} URLs checked.`, 'success')
      } else {
        onToast(`Scan complete with ${totalErrors} errors. ${totalScanned} URLs checked.`, 'warning')
      }
      await fetchHealth()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      onToast(`Scan failed: ${message}`, 'error')
    } finally {
      setScanning(false)
    }
  }, [fetchHealth, onToast])

  const aggregate: HealthAggregate = data?.aggregate ?? {
    total: 0,
    indexed: 0,
    notIndexed: 0,
    partial: 0,
    unknown: 0,
    lastScanAt: null,
  }
  const rows = data?.rows ?? []

  // ── Column defs. URL truncates to fit, lastCheckedAt sorts on the
  // raw ISO string. Default sort prioritises FAIL → PASS so the
  // actionable rows surface at the top.
  const columns: DataTableColumn<HealthRow>[] = useMemo(() => ([
    {
      key: 'url',
      header: 'URL',
      sortable: true,
      sortValue: r => r.url.toLowerCase(),
      minWidth: '22rem',
      render: r => (
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          title={r.url}
          onClick={e => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            color: 'var(--color-text)',
            textDecoration: 'none',
            maxWidth: '32rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
        >
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.8125rem',
          }}>
            {shortUrl(r.url)}
          </span>
          <ExternalLink size={11} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />
        </a>
      ),
    },
    {
      key: 'pathType',
      header: 'Type',
      sortable: true,
      sortValue: r => pathType(r.url),
      minWidth: '7rem',
      render: r => (
        <Badge tone="neutral" variant="soft" size="sm" leader={false}>
          {pathType(r.url)}
        </Badge>
      ),
    },
    {
      key: 'indexStatus',
      header: 'Status',
      sortable: true,
      // Negative number so default 'asc' surfaces FAIL first; flipping
      // the header to desc reveals PASS first. Keeps the most actionable
      // rows visible without an extra click.
      sortValue: r => indexStatusSortKey(r.indexStatus),
      minWidth: '7.5rem',
      render: r => (
        <Badge tone={indexStatusTone(r.indexStatus)} variant="soft" size="sm" leader="dot">
          {indexStatusLabel(r.indexStatus)}
        </Badge>
      ),
    },
    {
      key: 'coverageState',
      header: 'Coverage',
      sortable: true,
      sortValue: r => (r.coverageState ?? '').toLowerCase(),
      minWidth: '14rem',
      render: r => (
        <span style={{
          fontSize: '0.8125rem',
          color: r.coverageState ? 'var(--color-text)' : 'var(--color-text-subtle)',
        }}>
          {r.coverageState ?? '-'}
        </span>
      ),
    },
    {
      key: 'lastCheckedAt',
      header: 'Last checked',
      sortable: true,
      sortValue: r => r.lastCheckedAt,
      minWidth: '9rem',
      render: r => (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {fmtRelative(r.lastCheckedAt)}
        </span>
      ),
    },
    {
      key: 'pageFetchState',
      header: 'Page fetch',
      sortable: true,
      sortValue: r => (r.pageFetchState ?? '').toLowerCase(),
      minWidth: '8.5rem',
      render: r => {
        const { tone, label } = pageFetchTone(r.pageFetchState)
        return (
          <Badge tone={tone} variant="soft" size="sm" leader={false}>
            {label}
          </Badge>
        )
      },
    },
  ]), [])

  // ── First-time empty state. Distinct from "no matches" because there
  // is no scan yet, so the call to action is "run the first scan".
  const hasEverScanned = aggregate.lastScanAt != null
  const isEmpty = !loading && rows.length === 0 && !hasEverScanned

  if (isEmpty) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={<FileSearch className="w-6 h-6" />}
          title="Run your first scan"
          description="This pulls every URL from the Tahi sitemap (~201 URLs) and checks Google Search Console for the index status of each. Takes around 60 to 90 seconds."
          action={
            <TahiButton
              size="sm"
              loading={scanning}
              onClick={() => void runScan()}
              iconLeft={!scanning ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
            >
              {scanning ? 'Scanning...' : 'Scan now'}
            </TahiButton>
          }
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Scan strip. Last scan timestamp on the left, scan CTA on the
          right. Sits above the KPI strip so the "is this data fresh?"
          question reads first. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
            Last scan
          </span>
          <Badge tone={hasEverScanned ? 'neutral' : 'warning'} variant="soft" size="sm" leader={false}>
            {hasEverScanned ? `scanned ${fmtRelative(aggregate.lastScanAt)}` : 'never scanned'}
          </Badge>
        </div>
        <TahiButton
          size="sm"
          loading={scanning}
          onClick={() => void runScan()}
          iconLeft={!scanning ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
        >
          {scanning ? 'Scanning...' : 'Scan now'}
        </TahiButton>
      </div>

      {/* KPI strip. 4 cells: Indexed (PASS), Not indexed (FAIL),
          Partial/Neutral, Unknown. Loading replaces with skeleton tiles
          via the same grouped Card shell so the layout doesn't jump. */}
      {loading ? (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))',
            gap: '0.75rem',
          }}
        >
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: '6.5rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-card)',
              }}
            />
          ))}
        </div>
      ) : (
        <KPIStrip>
          <KPICell
            icon={CheckCircle2}
            tone="positive"
            label="Indexed"
            value={aggregate.indexed.toLocaleString()}
            sub={aggregate.total > 0 ? `${Math.round((aggregate.indexed / aggregate.total) * 100)}% of ${aggregate.total}` : 'no URLs'}
          />
          <KPICell
            icon={XCircle}
            tone="danger"
            label="Not indexed"
            value={aggregate.notIndexed.toLocaleString()}
            sub={aggregate.notIndexed > 0 ? 'Needs attention' : 'All green'}
          />
          <KPICell
            icon={AlertTriangle}
            tone="warning"
            label="Partial / Neutral"
            value={aggregate.partial.toLocaleString()}
            sub="Indexed but flagged"
          />
          <KPICell
            icon={HelpCircle}
            tone="neutral"
            label="Unknown"
            value={aggregate.unknown.toLocaleString()}
            sub="Not yet checked"
          />
        </KPIStrip>
      )}

      {/* Error banner. Only renders when the most recent scan reported
          errors. Collapsible details so the row list stays compact by
          default but Liam can drill in without leaving the page. */}
      {lastScanErrors.length > 0 && (
        <Card padding="none" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-bg)' }}>
          <div style={{ padding: '0.75rem 1rem' }}>
            <button
              type="button"
              onClick={() => setErrorsExpanded(v => !v)}
              className="flex items-center"
              style={{
                gap: '0.5rem',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--color-warning-text, #8A5A12)',
                width: '100%',
                textAlign: 'left',
              }}
              aria-expanded={errorsExpanded}
            >
              {errorsExpanded
                ? <ChevronDown size={14} aria-hidden="true" />
                : <ChevronRight size={14} aria-hidden="true" />}
              <AlertTriangle size={14} aria-hidden="true" />
              <span>Last scan had {lastScanErrors.length} error{lastScanErrors.length === 1 ? '' : 's'}</span>
              <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.25rem' }}>
                · click to {errorsExpanded ? 'hide' : 'see'} details
              </span>
            </button>
            {errorsExpanded && (
              <ul
                style={{
                  margin: '0.625rem 0 0',
                  padding: '0.625rem 0 0',
                  listStyle: 'none',
                  borderTop: '1px solid var(--color-border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.375rem',
                  maxHeight: '14rem',
                  overflowY: 'auto',
                }}
              >
                {lastScanErrors.map((err, i) => (
                  <li
                    key={`${err.url}-${i}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.125rem',
                      fontSize: '0.75rem',
                    }}
                  >
                    <span style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {shortUrl(err.url)}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{err.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {/* Health table */}
      <Card padding="none">
        <DataTable<HealthRow>
          ariaLabel="Content health"
          columns={columns}
          rows={rows}
          getRowId={r => r.url}
          defaultSort={{ key: 'indexStatus', dir: 'asc' }}
          loading={loading}
          empty={
            <EmptyState
              icon={<FileSearch className="w-6 h-6" />}
              title="No URLs in this snapshot"
              description="The last scan returned no rows. Try running a fresh scan to repopulate."
              action={
                <TahiButton
                  size="sm"
                  loading={scanning}
                  onClick={() => void runScan()}
                  iconLeft={!scanning ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
                >
                  {scanning ? 'Scanning...' : 'Scan now'}
                </TahiButton>
              }
            />
          }
        />
      </Card>
    </div>
  )
}

// ── Coming-soon tab ───────────────────────────────────────────────────────────

function ComingSoonTab({ tab }: { tab: TabDef }) {
  const Icon = tab.icon
  return (
    <Card padding="lg">
      <EmptyState
        icon={<Icon className="w-6 h-6" />}
        title={`Coming in Slice ${tab.slice}`}
        description={tab.comingDescription}
      />
    </Card>
  )
}
