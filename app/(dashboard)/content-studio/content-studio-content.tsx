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
  Check, X, Eye, Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { SlideOver } from '@/components/tahi/slide-over'
import { Textarea } from '@/components/tahi/input'
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
  // Initial tab honours ?tab=ideas etc so links from notifications land
  // on the right tab. Falls back to 'health' when the param is missing
  // or unknown.
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === 'undefined') return 'health'
    const param = new URLSearchParams(window.location.search).get('tab')
    if (param && TABS.some(t => t.id === param)) return param as TabId
    return 'health'
  })

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
        {activeTab === 'ideas' && <IdeasTab onToast={showToast} />}
        {activeTab !== 'health' && activeTab !== 'ideas' && (
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

// ── Ideas tab (Phase I Slice 1) ──────────────────────────────────────────────

interface IdeaRow {
  id: string
  clusterId: string | null
  title: string
  angle: string | null
  targetKeyword: string | null
  sourceSignal: string | null
  signalSources: string | null
  recommendedWordCount: number | null
  rationale: string | null
  brand: string | null
  score: number | null
  status: string
  weekLabel: string | null
  liamOpinion: string | null
  liamAnswers: string | null
  createdAt: string
  updatedAt: string
  clusterName: string | null
  clusterSlug: string | null
}

interface ClusterRow {
  id: string
  name: string
  slug: string
  description: string | null
  status: string
}

interface IdeasResponse {
  ideas: IdeaRow[]
  week: string
  counts: Record<string, number>
}

// Per-cluster colour. Stable across reloads via cluster slug → palette index.
const CLUSTER_PALETTE = [
  { bg: '#dcefd8', fg: '#425F39' },   // brand-100 / brand-dark
  { bg: '#dbeafe', fg: '#1e40af' },   // blue
  { bg: '#fef3c7', fg: '#92400e' },   // amber
  { bg: '#fce7f3', fg: '#9d174d' },   // pink
  { bg: '#e0e7ff', fg: '#3730a3' },   // indigo
  { bg: '#d1fae5', fg: '#065f46' },   // emerald
  { bg: '#fed7aa', fg: '#9a3412' },   // orange
  { bg: '#e9d5ff', fg: '#6b21a8' },   // purple
]

function clusterColour(slug: string | null): { bg: string; fg: string } {
  if (!slug) return CLUSTER_PALETTE[0]
  // Simple deterministic hash → palette index.
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i)
    hash |= 0
  }
  return CLUSTER_PALETTE[Math.abs(hash) % CLUSTER_PALETTE.length]
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'approved':  return 'positive'
    case 'rejected':  return 'danger'
    case 'drafted':   return 'info'
    case 'scheduled': return 'teal'
    case 'published': return 'brand'
    default:          return 'neutral'
  }
}

// Targeted questions Liam can answer per idea. Definition + comparison
// posts skip the questions; opinion / how-to / personal-milestone get
// the full set (per Phase I spec).
function questionsForIdea(idea: IdeaRow): string[] {
  const wc = idea.recommendedWordCount ?? 0
  // Definition (1,100-1,300) and comparison (2,400-3,000) — skip Qs.
  if ((wc >= 1100 && wc <= 1300) || (wc >= 2400 && wc <= 3000)) {
    return []
  }
  return [
    'What is the personal milestone or number this opens with?',
    'What is the one opinion / argument you want this to land?',
    'Any specific story, client, or moment you want referenced?',
  ]
}

interface IdeasTabProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function IdeasTab({ onToast }: IdeasTabProps) {
  const [data, setData] = useState<IdeasResponse | null>(null)
  const [clusters, setClusters] = useState<ClusterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [selectedClusters, setSelectedClusters] = useState<Set<string>>(new Set())
  const [drawerIdea, setDrawerIdea] = useState<IdeaRow | null>(null)
  const [drawerOpinion, setDrawerOpinion] = useState('')
  const [drawerAnswers, setDrawerAnswers] = useState<string[]>([])
  const [drawerSaving, setDrawerSaving] = useState(false)
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [ideasRes, clustersRes] = await Promise.all([
        fetch(apiPath('/api/admin/content/ideas?status=all&week=current')),
        fetch(apiPath('/api/admin/content/clusters')),
      ])
      if (ideasRes.ok) {
        const json = await ideasRes.json() as IdeasResponse
        setData(json)
      } else {
        setData(null)
      }
      if (clustersRes.ok) {
        const json = await clustersRes.json() as { clusters: ClusterRow[] }
        setClusters(json.clusters ?? [])
      } else {
        setClusters([])
      }
    } catch {
      setData(null)
      setClusters([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function runIdeationNow() {
    setRunning(true)
    try {
      const res = await fetch(apiPath('/api/admin/cron/ideation?force=1'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json() as { inserted?: number; error?: string; skipped?: string }
      if (!res.ok) {
        onToast(json.error ?? 'Ideation run failed', 'error')
        return
      }
      if (json.skipped) {
        onToast(`Ideation skipped: ${json.skipped}`, 'warning')
      } else {
        onToast(`${json.inserted ?? 0} fresh ideas added`, 'success')
      }
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Run failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  async function seedClusters() {
    setSeeding(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/clusters/seed'), { method: 'POST' })
      const json = await res.json() as { inserted?: number; error?: string }
      if (!res.ok) {
        onToast(json.error ?? 'Seed failed', 'error')
        return
      }
      onToast(`Seeded ${json.inserted ?? 0} clusters`, 'success')
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Seed failed', 'error')
    } finally {
      setSeeding(false)
    }
  }

  async function patchIdea(id: string, body: Record<string, unknown>) {
    const res = await fetch(apiPath(`/api/admin/content/ideas/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(json.error ?? 'Update failed')
    }
    return await res.json() as { idea: IdeaRow }
  }

  async function approveIdea(id: string) {
    setActionInFlight(id)
    try {
      await patchIdea(id, { action: 'approve' })
      onToast('Approved — drafting will pick this up next slice', 'success')
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Approve failed', 'error')
    } finally {
      setActionInFlight(null)
    }
  }

  async function rejectIdea(id: string) {
    setActionInFlight(id)
    try {
      await patchIdea(id, { action: 'reject' })
      onToast('Rejected', 'info')
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Reject failed', 'error')
    } finally {
      setActionInFlight(null)
    }
  }

  function openDrawer(idea: IdeaRow) {
    setDrawerIdea(idea)
    setDrawerOpinion(idea.liamOpinion ?? '')
    const qs = questionsForIdea(idea)
    let preset: string[] = qs.map(() => '')
    if (idea.liamAnswers) {
      try {
        const parsed = JSON.parse(idea.liamAnswers) as Array<{ q: string; a: string }>
        if (Array.isArray(parsed)) {
          preset = qs.map((q, i) => parsed[i]?.a ?? '')
        }
      } catch {
        // ignore
      }
    }
    setDrawerAnswers(preset)
  }

  async function saveDrawer() {
    if (!drawerIdea) return
    setDrawerSaving(true)
    try {
      const qs = questionsForIdea(drawerIdea)
      const answers = qs.map((q, i) => ({ q, a: drawerAnswers[i] ?? '' }))
      await patchIdea(drawerIdea.id, {
        liamOpinion: drawerOpinion.trim() || null,
        liamAnswers: answers.length > 0 ? answers : null,
      })
      onToast('Notes saved', 'success')
      setDrawerIdea(null)
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setDrawerSaving(false)
    }
  }

  function toggleClusterChip(slug: string) {
    setSelectedClusters(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const counts = data?.counts ?? { proposed: 0, approved: 0, rejected: 0, total: 0 }
  const week = data?.week ?? '—'
  const allIdeas = data?.ideas ?? []
  const visibleIdeas = selectedClusters.size > 0
    ? allIdeas.filter(i => i.clusterSlug && selectedClusters.has(i.clusterSlug))
    : allIdeas

  // First-time empty state: no clusters seeded.
  if (!loading && clusters.length === 0) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={<Lightbulb className="w-6 h-6" />}
          title="Seed the cluster map first"
          description="Content ideas need to map to one of the 8 topical pillars. Seed the defaults to get going — you can edit cluster names later."
          action={
            <TahiButton
              size="sm"
              loading={seeding}
              onClick={() => { void seedClusters() }}
              iconLeft={!seeding ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
            >
              {seeding ? 'Seeding...' : 'Seed default clusters'}
            </TahiButton>
          }
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header strip — week + counts + Run-now */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
            Week {week}
          </span>
          <span style={{ color: 'var(--color-text-subtle)' }}>·</span>
          <Badge tone="neutral" variant="soft" size="sm" leader={false}>
            {counts.proposed ?? 0} proposed
          </Badge>
          <Badge tone="positive" variant="soft" size="sm" leader={false}>
            {counts.approved ?? 0} approved
          </Badge>
          <Badge tone="danger" variant="soft" size="sm" leader={false}>
            {counts.rejected ?? 0} rejected
          </Badge>
        </div>
        <TahiButton
          size="sm"
          loading={running}
          onClick={() => { void runIdeationNow() }}
          iconLeft={!running ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
        >
          {running ? 'Generating...' : 'Run ideation now'}
        </TahiButton>
      </div>

      {/* Cluster filter chips. Multi-select. */}
      {clusters.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.375rem',
            paddingBottom: '0.125rem',
          }}
        >
          {clusters.map(c => {
            const active = selectedClusters.has(c.slug)
            const colour = clusterColour(c.slug)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleClusterChip(c.slug)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.3125rem 0.625rem',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  borderRadius: '999px',
                  background: active ? colour.bg : 'var(--color-bg)',
                  color: active ? colour.fg : 'var(--color-text-muted)',
                  border: `1px solid ${active ? colour.fg : 'var(--color-border-subtle)'}`,
                  cursor: 'pointer',
                  transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
                }}
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.background = 'var(--color-bg-secondary)'
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.background = 'var(--color-bg)'
                }}
              >
                {c.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))',
            gap: '0.875rem',
          }}
        >
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: '14rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-card)',
              }}
            />
          ))}
        </div>
      ) : visibleIdeas.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Lightbulb className="w-6 h-6" />}
            title={selectedClusters.size > 0 ? 'No ideas in those clusters this week' : 'No ideas yet for this week'}
            description={selectedClusters.size > 0
              ? 'Clear the cluster filters to see everything, or run ideation to generate fresh ideas.'
              : 'Run ideation now to generate the first slate, or wait for Monday\'s cron if you\'ve enabled it in Settings.'}
            action={
              <TahiButton
                size="sm"
                loading={running}
                onClick={() => { void runIdeationNow() }}
                iconLeft={!running ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
              >
                {running ? 'Generating...' : 'Run ideation now'}
              </TahiButton>
            }
          />
        </Card>
      ) : (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
            gap: '0.875rem',
          }}
        >
          {visibleIdeas.map(idea => {
            const colour = clusterColour(idea.clusterSlug)
            const busy = actionInFlight === idea.id
            const isApproved = idea.status === 'approved'
            const isRejected = idea.status === 'rejected'
            return (
              <Card key={idea.id} padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {/* Cluster + status row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.1875rem 0.5rem',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      borderRadius: '999px',
                      background: colour.bg,
                      color: colour.fg,
                      letterSpacing: '0.01em',
                    }}
                  >
                    {idea.clusterName ?? 'Unclustered'}
                  </span>
                  <Badge tone={statusTone(idea.status)} variant="soft" size="sm" leader={false}>
                    {idea.status === 'drafted' ? 'Drafting...' : idea.status}
                  </Badge>
                </div>

                {/* Title */}
                <h3
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    margin: 0,
                  }}
                  title={idea.title}
                >
                  {idea.title}
                </h3>

                {/* Meta row */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                  {idea.targetKeyword && (
                    <span
                      style={{
                        background: 'var(--color-bg-secondary)',
                        padding: '0.125rem 0.4375rem',
                        borderRadius: '4px',
                      }}
                      title="Target keyword"
                    >
                      {idea.targetKeyword}
                    </span>
                  )}
                  {idea.recommendedWordCount != null && (
                    <span
                      style={{
                        background: 'var(--color-bg-secondary)',
                        padding: '0.125rem 0.4375rem',
                        borderRadius: '4px',
                      }}
                      title="Recommended word count"
                    >
                      {idea.recommendedWordCount.toLocaleString()} words
                    </span>
                  )}
                  {idea.brand && (
                    <span
                      style={{
                        background: idea.brand === 'Staci' ? '#fce7f3' : '#dcefd8',
                        color: idea.brand === 'Staci' ? '#9d174d' : '#425F39',
                        padding: '0.125rem 0.4375rem',
                        borderRadius: '4px',
                        fontWeight: 600,
                      }}
                    >
                      {idea.brand}
                    </span>
                  )}
                </div>

                {/* Source signal */}
                {idea.sourceSignal && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.75rem',
                      color: 'var(--color-text-subtle)',
                      fontStyle: 'italic',
                      lineHeight: 1.45,
                    }}
                  >
                    {idea.sourceSignal}
                  </p>
                )}

                {/* Rationale (clamp 3 lines) */}
                {idea.rationale && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: '0.8125rem',
                      color: 'var(--color-text)',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {idea.rationale}
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.375rem', marginTop: 'auto', paddingTop: '0.375rem', flexWrap: 'wrap' }}>
                  {isApproved ? (
                    <TahiButton size="sm" variant="secondary" disabled style={{ flex: '1 1 auto' }}>
                      Drafting next
                    </TahiButton>
                  ) : isRejected ? (
                    <TahiButton
                      size="sm"
                      variant="secondary"
                      onClick={() => { void approveIdea(idea.id) }}
                      disabled={busy}
                      style={{ flex: '1 1 auto' }}
                    >
                      Restore
                    </TahiButton>
                  ) : (
                    <>
                      <TahiButton
                        size="sm"
                        onClick={() => { void approveIdea(idea.id) }}
                        loading={busy}
                        iconLeft={!busy ? <Check className="w-3.5 h-3.5" /> : undefined}
                        style={{ flex: '1 1 auto' }}
                      >
                        Approve
                      </TahiButton>
                      <TahiButton
                        size="sm"
                        variant="secondary"
                        onClick={() => { void rejectIdea(idea.id) }}
                        disabled={busy}
                        iconLeft={<X className="w-3.5 h-3.5" />}
                      >
                        Reject
                      </TahiButton>
                    </>
                  )}
                  <TahiButton
                    size="sm"
                    variant="secondary"
                    onClick={() => openDrawer(idea)}
                    iconLeft={<Eye className="w-3.5 h-3.5" />}
                    aria-label="Open details"
                  >
                    Details
                  </TahiButton>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Idea detail drawer */}
      {drawerIdea && (
        <SlideOver
          open={!!drawerIdea}
          onClose={() => setDrawerIdea(null)}
          title={drawerIdea.title}
          subtitle={drawerIdea.clusterName ?? 'Unclustered'}
          icon={<Lightbulb size={15} />}
          maxWidth="36rem"
        >
          <SlideOver.Body>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {drawerIdea.angle && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.25rem' }}>
                    Angle
                  </p>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
                    {drawerIdea.angle}
                  </p>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))', gap: '0.5rem' }}>
                {drawerIdea.targetKeyword && (
                  <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Keyword</p>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0', fontFamily: 'var(--font-mono, monospace)' }}>
                      {drawerIdea.targetKeyword}
                    </p>
                  </div>
                )}
                {drawerIdea.recommendedWordCount != null && (
                  <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Word count</p>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0' }}>
                      {drawerIdea.recommendedWordCount.toLocaleString()}
                    </p>
                  </div>
                )}
                {drawerIdea.brand && (
                  <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                    <p style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: 0 }}>Author</p>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text)', margin: '0.125rem 0 0', fontWeight: 600 }}>
                      {drawerIdea.brand}
                    </p>
                  </div>
                )}
              </div>

              {drawerIdea.sourceSignal && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.25rem' }}>
                    Signal
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    {drawerIdea.sourceSignal}
                  </p>
                </div>
              )}

              {drawerIdea.rationale && (
                <div>
                  <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.25rem' }}>
                    Rationale
                  </p>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.55 }}>
                    {drawerIdea.rationale}
                  </p>
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '1rem' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem' }}>
                  Your opinion (free-form)
                </p>
                <Textarea
                  rows={3}
                  value={drawerOpinion}
                  onChange={e => setDrawerOpinion(e.target.value)}
                  placeholder="The one thing you want this post to land. Story, hot take, hill you'll die on."
                />
              </div>

              {questionsForIdea(drawerIdea).map((q, i) => (
                <div key={i}>
                  <p style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                    {q}
                  </p>
                  <Textarea
                    rows={2}
                    value={drawerAnswers[i] ?? ''}
                    onChange={e => {
                      const next = [...drawerAnswers]
                      next[i] = e.target.value
                      setDrawerAnswers(next)
                    }}
                  />
                </div>
              ))}
            </div>
          </SlideOver.Body>
          <SlideOver.Footer>
            <TahiButton variant="secondary" size="sm" onClick={() => setDrawerIdea(null)}>
              Close
            </TahiButton>
            <div style={{ flex: 1 }} />
            <TahiButton
              size="sm"
              variant="secondary"
              disabled={drawerSaving || actionInFlight === drawerIdea.id}
              onClick={() => { void rejectIdea(drawerIdea.id).then(() => setDrawerIdea(null)) }}
              iconLeft={<X className="w-3.5 h-3.5" />}
            >
              Reject
            </TahiButton>
            <TahiButton
              size="sm"
              loading={drawerSaving}
              onClick={() => { void saveDrawer() }}
            >
              Save notes
            </TahiButton>
            <TahiButton
              size="sm"
              disabled={drawerSaving || actionInFlight === drawerIdea.id}
              onClick={() => { void approveIdea(drawerIdea.id).then(() => setDrawerIdea(null)) }}
              iconLeft={<Check className="w-3.5 h-3.5" />}
            >
              Approve
            </TahiButton>
          </SlideOver.Footer>
        </SlideOver>
      )}
    </div>
  )
}
