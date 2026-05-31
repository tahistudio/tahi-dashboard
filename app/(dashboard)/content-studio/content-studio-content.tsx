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
  Check, X, Eye, Sparkles, Link2, Trash2, Send, Loader2, Clock,
  Layers, History, Plus, Database, Search,
  type LucideIcon,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { SiteIndexContent } from './site-index/site-index-content'
import { AuditsContent } from './audits/audits-content'
import { BackfillContent } from './backfill/backfill-content'
import { EmptyState } from '@/components/tahi/empty-state'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Textarea } from '@/components/tahi/input'
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
  lastError?: string | null
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
  siteUrlUsed?: string
  connectedAs?: string | null
}

interface ScanError412 {
  error: string
  detail?: string
  connectedAs?: string | null
  availableProperties?: Array<{ siteUrl: string; permissionLevel: string }>
}

type TabId = 'health' | 'backfill' | 'ideas' | 'drafts' | 'links' | 'schedule' | 'site-index' | 'audits'

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
    id: 'backfill',
    label: 'Backfill',
    icon: Sparkles,
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
    id: 'links',
    label: 'Links',
    icon: Link2,
    slice: 6,
    comingDescription: 'Patch suggestions for adding inbound internal links to fresh posts. Each is a diff you approve before it touches Webflow.',
  },
  {
    id: 'schedule',
    label: 'Schedule',
    icon: Calendar,
    slice: 5,
    comingDescription: 'Plan publishing cadence across the blog, glossary and case studies.',
  },
  {
    id: 'site-index',
    label: 'Site index',
    icon: Database,
    slice: 3,
    comingDescription: 'Every live URL on tahi.studio with a Haiku one-line summary + embedding. Feeds the writer\'s internal-linking context, glossary auto-link, related-posts at publish, and back-link discovery.',
  },
  {
    id: 'audits',
    label: 'Audits',
    icon: Search,
    slice: 3,
    comingDescription: 'Run the 23-reviewer round-table on existing published posts to score them + see critiques. Nothing in Webflow is changed until you choose to apply improvements.',
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

      <SpendStrip />

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
        {activeTab === 'drafts' && <DraftsTab onToast={showToast} />}
        {activeTab === 'links' && <LinksTab onToast={showToast} />}
        {activeTab === 'schedule' && <ScheduleTab onToast={showToast} />}
        {activeTab === 'site-index' && <SiteIndexContent />}
        {activeTab === 'audits' && <AuditsContent />}
        {activeTab === 'backfill' && <BackfillContent />}
        {activeTab !== 'health' && activeTab !== 'ideas' && activeTab !== 'drafts' && activeTab !== 'links' && activeTab !== 'schedule' && activeTab !== 'site-index' && activeTab !== 'audits' && (
          <ComingSoonTab tab={TABS.find(t => t.id === activeTab)!} />
        )}
      </div>
    </div>
  )
}

// ── Spend strip (top of page) ────────────────────────────────────────────────

interface SpendData {
  totals: { day: number; week: number; month: number; allTime: number }
  byProvider: Record<string, number>
}

function SpendStrip() {
  const [data, setData] = useState<SpendData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(apiPath('/api/admin/content/spend'))
      .then(r => r.ok ? r.json() as Promise<SpendData> : null)
      .then(j => { if (!cancelled) setData(j) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data) return null

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const providers = Object.entries(data.byProvider).filter(([, v]) => v > 0)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.625rem',
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: '0.5rem',
        fontSize: '0.75rem',
      }}
    >
      <span style={{ color: 'var(--color-text-subtle)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6875rem' }}>
        AI spend
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>
        Today <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data.totals.day)}</strong>
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>
        Week <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data.totals.week)}</strong>
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>
        Month <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{fmt(data.totals.month)}</strong>
      </span>
      {providers.length > 0 && (
        <span style={{ color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>
          {providers.map(([p, v]) => `${p} ${fmt(v)}`).join(' · ')}
        </span>
      )}
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
          // 412 is the structured "Search Console not connected / wrong
          // property" response from the scan route. Pull the diagnostic
          // out so the toast tells Liam exactly what to fix in GSC
          // instead of a raw error blob.
          if (res.status === 412) {
            const body = (await res.json().catch(() => null)) as ScanError412 | null
            const detail = body?.detail ?? body?.error ?? 'Search Console property not found'
            const visible = body?.availableProperties?.length
              ? ` Visible properties on ${body.connectedAs ?? 'the connected account'}: ${body.availableProperties.map(p => `${p.siteUrl} (${p.permissionLevel})`).join(', ')}.`
              : ''
            throw new Error(`${detail}${visible}`)
          }
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
  // Persistent diagnostic. Surfaces when a scan has run but produced
  // zero indexed rows AND we have an error message captured from the
  // most-recent error row's `raw`. Survives page refresh, unlike
  // lastScanErrors which is in-session only.
  const persistentDiagnostic = aggregate.lastScanAt && aggregate.indexed === 0 && aggregate.unknown > 0
    ? (data?.lastError ?? 'Scan ran but every URL failed. Check Settings → Integrations and confirm the connected Google account has Owner or Full User access to a Search Console property covering tahi.studio.')
    : null

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

      {/* Persistent diagnostic. Survives refresh — surfaces when the
          most recent stored snapshot has zero indexed rows, pulling the
          captured error message from the GET response so Liam knows
          what to fix without re-running the scan. */}
      {persistentDiagnostic && (
        <Card
          padding="md"
          style={{
            borderColor: 'var(--color-warning)',
            background: 'var(--color-warning-bg)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
            <AlertTriangle
              size={16}
              aria-hidden="true"
              style={{ color: 'var(--color-warning-text, #8A5A12)', flexShrink: 0, marginTop: '0.125rem' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
              <span style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--color-warning-text, #8A5A12)',
              }}>
                Search Console connection isn&apos;t returning data
              </span>
              <span style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text-muted)',
                lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                {persistentDiagnostic}
              </span>
            </div>
          </div>
        </Card>
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

      {/* Backfill card — Phase I · Slice 6.5. Sits under the health
          DataTable because the two surfaces are closely related (both
          touch the live blog post inventory). Staged edits only — the
          card is explicit about that so Liam knows to batch-publish from
          the Webflow Editor after spot-checking. */}
      <BackfillCard onToast={onToast} />
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
  const [roundTableInFlight, setRoundTableInFlight] = useState<string | null>(null)
  // Manual idea drawer state
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualAngle, setManualAngle] = useState('')
  const [manualKeyword, setManualKeyword] = useState('')
  const [manualCluster, setManualCluster] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [manualSaving, setManualSaving] = useState(false)
  const [manualDuplicates, setManualDuplicates] = useState<Array<{
    source: 'existing_idea' | 'published_post'
    title: string
    slug?: string
    similarity: number
  }>>([])

  function resetManualForm() {
    setManualTitle(''); setManualAngle(''); setManualKeyword(''); setManualCluster('')
    setManualNotes(''); setManualDuplicates([])
  }

  async function runRoundTable(ideaId: string) {
    setRoundTableInFlight(ideaId)
    try {
      const res = await fetch(apiPath(`/api/admin/content/ideas/${ideaId}/round-table`), {
        method: 'POST',
      })
      const json = await res.json() as { draftId?: string; status?: string; error?: string }
      if (!res.ok) {
        onToast(json.error ?? 'Round table failed to start', 'error')
        return
      }
      onToast(`Round table started — pipeline at ${json.status}. Opening detail...`, 'success')
      // Navigate to the round-table detail page
      if (typeof window !== 'undefined' && json.draftId) {
        window.location.href = `/dashboard/content-studio/drafts/${json.draftId}/round-table`
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setRoundTableInFlight(null)
    }
  }

  async function saveManualIdea(force: boolean) {
    setManualSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/ideas/manual'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: manualTitle.trim(),
          angle: manualAngle.trim() || undefined,
          targetKeyword: manualKeyword.trim() || undefined,
          clusterId: manualCluster || undefined,
          rationale: manualNotes.trim() || undefined,
          force,
        }),
      })
      const json = await res.json() as {
        idea?: { id: string; title: string }
        duplicates?: typeof manualDuplicates
        message?: string
        error?: string
      }
      if (!res.ok) {
        onToast(json.error ?? 'Failed to create idea', 'error')
        return
      }
      if (json.duplicates && json.duplicates.length > 0 && !json.idea) {
        setManualDuplicates(json.duplicates)
        onToast(`${json.duplicates.length} potential duplicate(s) found — review below`, 'warning')
        return
      }
      onToast(`Idea created: ${json.idea?.title ?? manualTitle.trim()}`, 'success')
      setManualOpen(false)
      resetManualForm()
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed', 'error')
    } finally {
      setManualSaving(false)
    }
  }

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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={() => { resetManualForm(); setManualOpen(true) }}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
          >
            New idea
          </TahiButton>
          <TahiButton
            size="sm"
            loading={running}
            onClick={() => { void runIdeationNow() }}
            iconLeft={!running ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
          >
            {running ? 'Generating...' : 'Run ideation now'}
          </TahiButton>
        </div>
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
                    <TahiButton
                      size="sm"
                      onClick={() => { void runRoundTable(idea.id) }}
                      loading={roundTableInFlight === idea.id}
                      iconLeft={roundTableInFlight !== idea.id ? <Layers className="w-3.5 h-3.5" /> : undefined}
                      style={{ flex: '1 1 auto' }}
                    >
                      {roundTableInFlight === idea.id ? 'Starting...' : 'Run round table'}
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

      {/* Manual idea creation drawer */}
      {manualOpen && (
        <SlideOver
          open={manualOpen}
          onClose={() => { setManualOpen(false); resetManualForm() }}
          title="New idea"
          subtitle="Add your own — runs through the round table just like cron-generated ideas"
          icon={<Plus size={15} />}
          maxWidth="34rem"
        >
          <SlideOver.Body>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                  Working title
                </p>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={e => setManualTitle(e.target.value)}
                  placeholder="e.g. Why your Webflow site keeps breaking on launch day"
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem', borderRadius: '0.375rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                  }}
                />
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.25rem 0 0' }}>
                  The Headline Lab will polish this later — don&apos;t overthink it.
                </p>
              </div>

              <div>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                  Angle (optional)
                </p>
                <Textarea
                  rows={2}
                  value={manualAngle}
                  onChange={e => setManualAngle(e.target.value)}
                  placeholder="What's the unique take? What's the hill you'd die on with this post?"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                    Target keyword
                  </p>
                  <input
                    type="text"
                    value={manualKeyword}
                    onChange={e => setManualKeyword(e.target.value)}
                    placeholder="webflow site speed"
                    style={{
                      width: '100%', padding: '0.5rem 0.75rem',
                      fontSize: '0.875rem', borderRadius: '0.375rem',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                    }}
                  />
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                    Cluster
                  </p>
                  <select
                    value={manualCluster}
                    onChange={e => setManualCluster(e.target.value)}
                    style={{
                      width: '100%', padding: '0.5rem 0.75rem',
                      fontSize: '0.875rem', borderRadius: '0.375rem',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    <option value="">No cluster</option>
                    {clusters.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.375rem' }}>
                  Notes / rationale (optional)
                </p>
                <Textarea
                  rows={2}
                  value={manualNotes}
                  onChange={e => setManualNotes(e.target.value)}
                  placeholder="Why this matters now. Source signal. Sales context. Anything the Strategist should know."
                />
              </div>

              {manualDuplicates.length > 0 && (
                <Card
                  padding="md"
                  style={{
                    borderColor: 'var(--color-warning)',
                    background: 'var(--color-warning-bg)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem' }}>
                      <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--color-warning-text, #8A5A12)' }} />
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-warning-text, #8A5A12)' }}>
                        {manualDuplicates.length} potential duplicate{manualDuplicates.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <ul style={{ margin: 0, padding: '0 0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {manualDuplicates.map((d, i) => (
                        <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                          <span style={{ fontWeight: 500 }}>{d.title}</span>
                          <span style={{ color: 'var(--color-text-subtle)', marginLeft: '0.375rem' }}>
                            ({Math.round(d.similarity * 100)}% similar · {d.source === 'published_post' ? 'published' : 'existing idea'})
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0' }}>
                      If your idea is genuinely different, click <strong>Create anyway</strong>.
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </SlideOver.Body>
          <SlideOver.Footer>
            <TahiButton
              size="sm"
              variant="secondary"
              onClick={() => { setManualOpen(false); resetManualForm() }}
              disabled={manualSaving}
            >
              Cancel
            </TahiButton>
            {manualDuplicates.length > 0 ? (
              <TahiButton
                size="sm"
                loading={manualSaving}
                onClick={() => { void saveManualIdea(true) }}
                disabled={!manualTitle.trim()}
              >
                Create anyway
              </TahiButton>
            ) : (
              <TahiButton
                size="sm"
                loading={manualSaving}
                onClick={() => { void saveManualIdea(false) }}
                disabled={!manualTitle.trim()}
                iconLeft={<Plus className="w-3.5 h-3.5" />}
              >
                Create idea
              </TahiButton>
            )}
          </SlideOver.Footer>
        </SlideOver>
      )}
    </div>
  )
}

// ── Links tab (Phase I Slice 6) ───────────────────────────────────────────────

interface LinkSuggestionRow {
  id: string
  sourceWebflowId: string
  sourceUrl: string
  sourceTitle: string | null
  matchPhrase: string
  contextBefore: string | null
  contextAfter: string | null
  proposedAnchorText: string
  justification: string | null
  confidence: number
  status: string
  appliedAt: string | null
  createdAt: string
}

interface LinkTargetGroup {
  targetUrl: string
  targetTitle: string | null
  targetPublishedAt: string | null
  inboundLinkCount: number
  suggestions: LinkSuggestionRow[]
}

interface LinkSuggestionsResponse {
  targets: LinkTargetGroup[]
  totals: { pending: number; approved: number; applied: number; rejected: number }
}

function confidenceBadgeTone(score: number): BadgeTone {
  if (score >= 70) return 'positive'
  if (score >= 40) return 'warning'
  return 'danger'
}

function shortenForDiff(s: string | null, max = 120): string {
  if (!s) return ''
  const collapsed = s.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `...${collapsed.slice(-max)}`
}

function shortenAfterForDiff(s: string | null, max = 120): string {
  if (!s) return ''
  const collapsed = s.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max)}...`
}

interface LinksTabProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function LinksTab({ onToast }: LinksTabProps) {
  const [data, setData] = useState<LinkSuggestionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [actionInFlight, setActionInFlight] = useState<string | null>(null)
  const [expandedTargets, setExpandedTargets] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/links/suggestions'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as LinkSuggestionsResponse
      setData(json)
      // Expand the first target by default so Liam doesn't land on a
      // collapsed list with nothing visible.
      if (json.targets.length > 0) {
        setExpandedTargets(prev => prev.size === 0 ? new Set([json.targets[0].targetUrl]) : prev)
      }
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function runScan() {
    setScanning(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/links/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json() as {
        targetsScanned?: number
        suggestionsCreated?: number
        error?: string
        detail?: string
      }
      if (!res.ok) {
        onToast(json.error ?? json.detail ?? 'Scan failed', 'error')
        return
      }
      onToast(
        `${json.suggestionsCreated ?? 0} suggestion${json.suggestionsCreated === 1 ? '' : 's'} from ${json.targetsScanned ?? 0} target${json.targetsScanned === 1 ? '' : 's'}`,
        'success',
      )
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Scan failed', 'error')
    } finally {
      setScanning(false)
    }
  }

  async function applyOne(id: string) {
    setActionInFlight(id)
    try {
      const res = await fetch(apiPath(`/api/admin/content/links/${id}/apply`), {
        method: 'POST',
      })
      const json = await res.json() as { error?: string; detail?: string }
      if (!res.ok) {
        if (res.status === 409) {
          onToast(json.detail ?? 'Source body has drifted, re-scan to refresh', 'warning')
        } else {
          onToast(json.error ?? json.detail ?? 'Apply failed', 'error')
        }
        return
      }
      onToast('Patch staged in Webflow', 'success')
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Apply failed', 'error')
    } finally {
      setActionInFlight(null)
    }
  }

  async function rejectOne(id: string) {
    setActionInFlight(id)
    try {
      const res = await fetch(apiPath(`/api/admin/content/links/${id}/reject`), {
        method: 'POST',
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) {
        onToast(json.error ?? 'Reject failed', 'error')
        return
      }
      onToast('Rejected', 'info')
      await fetchAll()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Reject failed', 'error')
    } finally {
      setActionInFlight(null)
    }
  }

  function toggleTarget(url: string) {
    setExpandedTargets(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const targets = data?.targets ?? []
  const totals = data?.totals ?? { pending: 0, approved: 0, applied: 0, rejected: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: '52rem', lineHeight: 1.5 }}>
            Patches suggested for posts published in the last 14 days. Each is a diff you approve before it touches Webflow. Applied edits land as staged Webflow changes, never auto-publish.
          </span>
        </div>
        <TahiButton
          size="sm"
          loading={scanning}
          onClick={() => { void runScan() }}
          iconLeft={!scanning ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
        >
          {scanning ? 'Scanning...' : 'Scan now'}
        </TahiButton>
      </div>

      {/* Totals row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
        <Badge tone="neutral" variant="soft" size="sm" leader={false}>
          {totals.pending} pending
        </Badge>
        <Badge tone="positive" variant="soft" size="sm" leader={false}>
          {totals.applied} applied
        </Badge>
        <Badge tone="danger" variant="soft" size="sm" leader={false}>
          {totals.rejected} rejected
        </Badge>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: '8rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-card)',
              }}
            />
          ))}
        </div>
      ) : targets.length === 0 ? (
        <Card padding="lg">
          <EmptyState
            icon={<Link2 className="w-6 h-6" />}
            title="No link patches yet"
            description="Scan to look for posts published in the last 14 days that could use more inbound links. Each suggestion shows the exact diff before anything is patched."
            action={
              <TahiButton
                size="sm"
                loading={scanning}
                onClick={() => { void runScan() }}
                iconLeft={!scanning ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
              >
                {scanning ? 'Scanning...' : 'Scan now'}
              </TahiButton>
            }
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {targets.map(group => {
            const expanded = expandedTargets.has(group.targetUrl)
            return (
              <Card key={group.targetUrl} padding="none">
                {/* Target header */}
                <button
                  type="button"
                  onClick={() => toggleTarget(group.targetUrl)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    width: '100%',
                    padding: '0.875rem 1rem',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  aria-expanded={expanded}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                    {expanded
                      ? <ChevronDown size={14} aria-hidden="true" />
                      : <ChevronRight size={14} aria-hidden="true" />}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
                      <span style={{
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {group.targetTitle ?? shortUrl(group.targetUrl)}
                      </span>
                      <a
                        href={group.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.6875rem',
                          color: 'var(--color-text-subtle)',
                          textDecoration: 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {shortUrl(group.targetUrl)}
                        <ExternalLink size={10} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
                    <Badge tone="neutral" variant="soft" size="sm" leader={false}>
                      {group.inboundLinkCount} inbound
                    </Badge>
                    <Badge tone="brand" variant="soft" size="sm" leader={false}>
                      {group.suggestions.length} suggestion{group.suggestions.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                </button>

                {/* Suggestion list */}
                {expanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {group.suggestions.map((s, idx) => {
                      const busy = actionInFlight === s.id
                      const isPending = s.status === 'pending'
                      return (
                        <div
                          key={s.id}
                          style={{
                            padding: '0.875rem 1rem',
                            borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-subtle)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem',
                          }}
                        >
                          {/* Source row */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
                              <span style={{
                                fontSize: '0.8125rem',
                                fontWeight: 500,
                                color: 'var(--color-text)',
                              }}>
                                {s.sourceTitle ?? shortUrl(s.sourceUrl)}
                              </span>
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  color: 'var(--color-text-subtle)',
                                  textDecoration: 'none',
                                }}
                                aria-label="Open source post"
                              >
                                <ExternalLink size={11} aria-hidden="true" />
                              </a>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                              <Badge tone={confidenceBadgeTone(s.confidence)} variant="soft" size="sm" leader="dot">
                                {s.confidence}/100
                              </Badge>
                              {!isPending && (
                                <Badge
                                  tone={s.status === 'applied' ? 'positive' : s.status === 'rejected' ? 'danger' : 'neutral'}
                                  variant="soft"
                                  size="sm"
                                  leader={false}
                                >
                                  {s.status}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Diff preview */}
                          <div
                            style={{
                              background: 'var(--color-bg-secondary)',
                              borderRadius: '0.5rem',
                              padding: '0.625rem 0.75rem',
                              fontSize: '0.75rem',
                              lineHeight: 1.5,
                              fontFamily: 'var(--font-mono, monospace)',
                              color: 'var(--color-text-muted)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.375rem',
                            }}
                          >
                            <div>
                              <span style={{ color: 'var(--color-text-subtle)' }}>Currently:</span>{' '}
                              {shortenForDiff(s.contextBefore)}
                              <span style={{
                                background: 'var(--color-bg)',
                                color: 'var(--color-text)',
                                padding: '0.0625rem 0.25rem',
                                borderRadius: '3px',
                                fontWeight: 600,
                              }}>
                                {s.matchPhrase}
                              </span>
                              {shortenAfterForDiff(s.contextAfter)}
                            </div>
                            <div>
                              <span style={{ color: 'var(--color-text-subtle)' }}>Proposed:</span>{' '}
                              {shortenForDiff(s.contextBefore)}
                              <span style={{
                                background: 'var(--color-brand-100)',
                                color: 'var(--color-brand-dark)',
                                padding: '0.0625rem 0.25rem',
                                borderRadius: '3px',
                                fontWeight: 600,
                              }}>
                                &lt;a&gt;{s.proposedAnchorText}&lt;/a&gt;
                              </span>
                              {shortenAfterForDiff(s.contextAfter)}
                            </div>
                          </div>

                          {/* Justification */}
                          {s.justification && (
                            <p style={{
                              margin: 0,
                              fontSize: '0.75rem',
                              color: 'var(--color-text-subtle)',
                              fontStyle: 'italic',
                            }}>
                              {s.justification}
                            </p>
                          )}

                          {/* Actions */}
                          {isPending && (
                            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                              <TahiButton
                                size="sm"
                                onClick={() => { void applyOne(s.id) }}
                                loading={busy}
                                iconLeft={!busy ? <Check className="w-3.5 h-3.5" /> : undefined}
                              >
                                Apply
                              </TahiButton>
                              <TahiButton
                                size="sm"
                                variant="secondary"
                                onClick={() => { void rejectOne(s.id) }}
                                disabled={busy}
                                iconLeft={<X className="w-3.5 h-3.5" />}
                              >
                                Reject
                              </TahiButton>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Drafts tab (Phase I Slice 2) ──────────────────────────────────────────────

interface DraftRow {
  id: string
  ideaId: string
  status: string
  title: string | null
  contentScore: number | null
  scoreBreakdown: string | null
  coverSvgUrl: string | null
  coverTemplate: string | null
  authorSlug: string | null
  mainCategorySlug: string | null
  postType: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  ideaTitle: string | null
  ideaBrand: string | null
  ideaStatus: string | null
  ideaTargetKeyword: string | null
  ideaRecommendedWordCount: number | null
  clusterName: string | null
  clusterSlug: string | null
}

interface DraftsResponse {
  drafts: DraftRow[]
  counts: Record<string, number>
}

interface DraftDetail {
  draft: DraftRow & {
    researchSummary: string | null
    validatedCitations: string | null
    bodyMarkdown: string | null
    bodyHtml: string | null
    metaTitle: string | null
    metaDescription: string | null
    postExcerpt: string | null
    shortenedName: string | null
    summary: string | null
    keyTakeaways: string | null
    faqsJson: string | null
    otherCategorySlugs: string | null
    salesNotes: string | null
    readabilityNotes: string | null
    schemaJsonLd: string | null
    hreflangBlock: string | null
  }
  idea: IdeaRow | null
  cluster: ClusterRow | null
}

interface ScoreBreakdownShape {
  aeo: number
  voice: number
  readability: number
  seo: number
  linksOk: boolean
}

// Stage order includes both legacy (Slice 2) and round-table (Slice 9)
// statuses. New round-table statuses sit alongside the legacy ones so
// the progress stepper can render any draft's current position.
const DRAFT_STAGE_ORDER: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'queued', label: 'Queued' },
  { key: 'researching', label: 'Researching' },
  { key: 'strategising', label: 'Strategising' },
  { key: 'headline_lab', label: 'Headline lab' },
  { key: 'drafting', label: 'Drafting' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'editing', label: 'Editing' },
  { key: 'finalising', label: 'Finalising' },
  { key: 'signing_off', label: 'Sign-off' },
  { key: 'covering', label: 'Cover' },
  { key: 'ready', label: 'Ready' },
  { key: 'ready_for_publish', label: 'Ready' },
]

function draftStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ready':              return 'positive'
    case 'ready_for_publish':  return 'positive'
    case 'failed':             return 'danger'
    case 'cost_capped':        return 'danger'
    case 'finalising':         return 'info'
    case 'reviewing':          return 'info'
    case 'editing':            return 'info'
    case 'signing_off':        return 'info'
    case 'covering':           return 'info'
    case 'drafting':           return 'teal'
    case 'strategising':       return 'teal'
    case 'headline_lab':       return 'teal'
    case 'researching':        return 'teal'
    case 'queued':             return 'neutral'
    default:                   return 'neutral'
  }
}

function draftStatusLabel(status: string): string {
  switch (status) {
    case 'queued':             return 'Queued'
    case 'researching':        return 'Researching'
    case 'strategising':       return 'Strategising'
    case 'headline_lab':       return 'Headline lab'
    case 'drafting':           return 'Drafting'
    case 'reviewing':          return 'Reviewing (23)'
    case 'editing':            return 'Editing'
    case 'finalising':         return 'Finalising'
    case 'signing_off':        return 'Sign-off'
    case 'covering':           return 'Cover'
    case 'ready':              return 'Ready'
    case 'ready_for_publish':  return 'Ready'
    case 'failed':             return 'Failed'
    case 'cost_capped':        return 'Cost capped'
    default:                   return status
  }
}

function isInProgress(status: string): boolean {
  return [
    'queued', 'researching', 'drafting', 'reviewing', 'finalising',
    // Round-table (Slice 9) statuses
    'strategising', 'headline_lab', 'editing', 'signing_off', 'covering',
  ].includes(status)
}

/** Map any draft status (legacy + round-table) to one of the 7 UI
 *  buckets the DraftsTab renders. Keeps the existing layout working
 *  even as the pipeline expands. */
function mapToBucket(status: string): 'researching' | 'drafting' | 'reviewing' | 'finalising' | 'queued' | 'ready' | 'failed' {
  switch (status) {
    case 'queued': return 'queued'
    case 'researching': return 'researching'
    case 'strategising': return 'researching'  // still pre-write
    case 'headline_lab': return 'researching'
    case 'drafting': return 'drafting'
    case 'reviewing': return 'reviewing'
    case 'editing': return 'reviewing'
    case 'signing_off': return 'finalising'
    case 'covering': return 'finalising'
    case 'finalising': return 'finalising'
    case 'ready': return 'ready'
    case 'ready_for_publish': return 'ready'
    case 'failed': return 'failed'
    case 'cost_capped': return 'failed'
    default: return 'queued'
  }
}

function parseScoreBreakdown(json: string | null): ScoreBreakdownShape | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    // Round-table pipeline persists bucketScores from per-reviewer
    // aggregation. Older drafts may have the top-level keys (legacy
    // scoring) — read either.
    const b = (parsed.bucketScores && typeof parsed.bucketScores === 'object') ? parsed.bucketScores : parsed
    return {
      aeo: Number(b.aeo ?? 0),
      voice: Number(b.voice ?? 0),
      readability: Number(b.readability ?? 0),
      seo: Number(b.seo ?? 0),
      linksOk: parsed.linksOk === true,
    }
  } catch {
    return null
  }
}

interface DraftsTabProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function DraftsTab({ onToast }: DraftsTabProps) {
  const [data, setData] = useState<DraftsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeDetail, setActiveDetail] = useState<DraftDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/drafts?status=all&limit=100'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as DraftsResponse
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchDrafts() }, [fetchDrafts])

  // Soft poll while anything's in-flight. 6s is gentle on the API + the
  // user's bandwidth, and matches the rough lower-bound of a Sonnet call.
  useEffect(() => {
    if (!data) return
    const anyInProgress = data.drafts.some(d => isInProgress(d.status))
    if (!anyInProgress) return
    const t = setInterval(() => { void fetchDrafts() }, 6000)
    return () => clearInterval(t)
  }, [data, fetchDrafts])

  async function openDetail(draftId: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}`))
      if (!res.ok) throw new Error('Failed to load draft')
      const json = await res.json() as DraftDetail
      setActiveDetail(json)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load draft', 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  async function discardDraft(draftId: string) {
    setDiscarding(true)
    try {
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to discard')
      onToast('Draft discarded. Idea returned to Approved.', 'info')
      setActiveDetail(null)
      await fetchDrafts()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to discard', 'error')
    } finally {
      setDiscarding(false)
    }
  }

  async function retryDraft(ideaId: string) {
    setRetrying(ideaId)
    try {
      const res = await fetch(apiPath(`/api/admin/content/ideas/${ideaId}/draft`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        onToast(json.error ?? 'Re-draft failed', 'error')
        return
      }
      onToast('Re-drafting started', 'success')
      await fetchDrafts()
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Re-draft failed', 'error')
    } finally {
      setRetrying(null)
    }
  }

  const drafts = useMemo(() => data?.drafts ?? [], [data])
  const counts = data?.counts ?? { ready: 0, failed: 0, total: 0 }

  // Group by status. Maps both legacy statuses (researching, drafting,
  // reviewing, finalising, ready) AND new round-table statuses
  // (strategising, headline_lab, editing, signing_off, covering,
  // ready_for_publish, cost_capped) into the same UI buckets so the
  // existing layout keeps working as the pipeline expands.
  const byStatus = useMemo(() => {
    const groups: Record<string, DraftRow[]> = {
      researching: [], drafting: [], reviewing: [], finalising: [],
      queued: [], ready: [], failed: [],
    }
    for (const d of drafts) {
      const key = mapToBucket(d.status)
      groups[key].push(d)
    }
    return groups
  }, [drafts])

  const inProgressDrafts = [
    ...byStatus.queued, ...byStatus.researching, ...byStatus.drafting,
    ...byStatus.reviewing, ...byStatus.finalising,
  ]
  const readyDrafts = byStatus.ready
  const failedDrafts = byStatus.failed

  if (!loading && drafts.length === 0) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={<FileEdit className="w-6 h-6" />}
          title="No drafts yet"
          description="Approve an idea in the Ideas tab to kick off the drafting pipeline. The agent will research, write, review, and score the post — you sign off at the end."
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header strip — count badges */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge tone="positive" variant="soft" size="sm" leader={false}>
            {counts.ready ?? 0} ready
          </Badge>
          <Badge tone="info" variant="soft" size="sm" leader={false}>
            {inProgressDrafts.length} in progress
          </Badge>
          <Badge tone="danger" variant="soft" size="sm" leader={false}>
            {counts.failed ?? 0} failed
          </Badge>
        </div>
        <TahiButton
          size="sm"
          variant="secondary"
          onClick={() => { void fetchDrafts() }}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </div>

      {loading && (
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))',
            gap: '0.875rem',
          }}
        >
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: '12rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-card)',
              }}
            />
          ))}
        </div>
      )}

      {!loading && inProgressDrafts.length > 0 && (
        <DraftsSection
          title="In progress"
          drafts={inProgressDrafts}
          onOpen={d => { void openDetail(d.id) }}
          onRetry={null}
          retryingIdeaId={retrying}
        />
      )}

      {!loading && readyDrafts.length > 0 && (
        <DraftsSection
          title="Ready for review"
          drafts={readyDrafts}
          onOpen={d => { void openDetail(d.id) }}
          onRetry={null}
          retryingIdeaId={retrying}
        />
      )}

      {!loading && failedDrafts.length > 0 && (
        <DraftsSection
          title="Failed"
          drafts={failedDrafts}
          onOpen={d => { void openDetail(d.id) }}
          onRetry={ideaId => { void retryDraft(ideaId) }}
          retryingIdeaId={retrying}
        />
      )}

      {/* Detail drawer */}
      {activeDetail && (
        <DraftDetailDrawer
          detail={activeDetail}
          onClose={() => setActiveDetail(null)}
          onDiscard={() => { void discardDraft(activeDetail.draft.id) }}
          discarding={discarding}
        />
      )}

      {detailLoading && !activeDetail && (
        <Card padding="md">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading draft...
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Drafts section block ─────────────────────────────────────────────────────

interface DraftsSectionProps {
  title: string
  drafts: DraftRow[]
  onOpen: (d: DraftRow) => void
  onRetry: ((ideaId: string) => void) | null
  retryingIdeaId: string | null
}

function DraftsSection({ title, drafts, onOpen, onRetry, retryingIdeaId }: DraftsSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <h2 style={{
        margin: 0,
        fontSize: '0.75rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-text-subtle)',
      }}>
        {title}
      </h2>
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
          gap: '0.875rem',
        }}
      >
        {drafts.map(d => (
          <DraftCard
            key={d.id}
            draft={d}
            onOpen={() => onOpen(d)}
            onRetry={onRetry ? () => onRetry(d.ideaId) : null}
            retrying={retryingIdeaId === d.ideaId}
          />
        ))}
      </div>
    </div>
  )
}

// ── Draft card ───────────────────────────────────────────────────────────────

interface DraftCardProps {
  draft: DraftRow
  onOpen: () => void
  onRetry: (() => void) | null
  retrying: boolean
}

function DraftCard({ draft, onOpen, onRetry, retrying }: DraftCardProps) {
  // 'ready' = legacy Slice-2 drafts; 'ready_for_publish' = round-table
  // (Slice 9) drafts. Both are publishable, both should surface in
  // the Schedule "ready to go" lane.
  const isReady = draft.status === 'ready' || draft.status === 'ready_for_publish'
  const isFailed = draft.status === 'failed'
  const breakdown = parseScoreBreakdown(draft.scoreBreakdown)
  const currentStageIndex = DRAFT_STAGE_ORDER.findIndex(s => s.key === draft.status)

  return (
    <Card padding="md" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      {/* Status + cluster */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0.1875rem 0.5rem',
            fontSize: '0.6875rem',
            fontWeight: 600,
            borderRadius: '999px',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
          }}
        >
          {draft.clusterName ?? 'Unclustered'}
        </span>
        <Badge tone={draftStatusTone(draft.status)} variant="soft" size="sm" leader={isInProgress(draft.status) ? 'dot' : false}>
          {draftStatusLabel(draft.status)}
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
        title={draft.title ?? draft.ideaTitle ?? 'Untitled draft'}
      >
        {draft.title ?? draft.ideaTitle ?? 'Untitled draft'}
      </h3>

      {/* Progress stepper */}
      {!isFailed && !isReady && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
          {DRAFT_STAGE_ORDER.map((stage, i) => {
            const done = i < currentStageIndex
            const active = i === currentStageIndex
            return (
              <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span
                  style={{
                    width: '0.5rem',
                    height: '0.5rem',
                    borderRadius: '50%',
                    background: done ? 'var(--color-brand)' : active ? 'var(--color-brand-light)' : 'var(--color-border)',
                    boxShadow: active ? '0 0 0 3px var(--color-brand-50)' : undefined,
                    transition: 'background 200ms ease',
                  }}
                />
                {i < DRAFT_STAGE_ORDER.length - 1 && (
                  <span style={{
                    width: '0.875rem',
                    height: '1px',
                    background: done ? 'var(--color-brand)' : 'var(--color-border)',
                  }} />
                )}
              </div>
            )
          })}
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginLeft: '0.375rem' }}>
            {DRAFT_STAGE_ORDER[currentStageIndex]?.label ?? draft.status}
          </span>
        </div>
      )}

      {/* Ready: score */}
      {isReady && breakdown && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.625rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.625rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}>
              Score
            </span>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {draft.contentScore ?? 0}
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
            <ScoreBar label="AEO" value={breakdown.aeo} max={25} />
            <ScoreBar label="Voice" value={breakdown.voice} max={25} />
            <ScoreBar label="Read" value={breakdown.readability} max={20} />
            <ScoreBar label="SEO" value={breakdown.seo} max={20} />
          </div>
        </div>
      )}

      {/* Failed: error */}
      {isFailed && draft.errorMessage && (
        <p style={{
          margin: 0,
          fontSize: '0.75rem',
          color: 'var(--color-danger-text, #8B2D2D)',
          background: 'var(--color-danger-bg, #fef2f2)',
          padding: '0.5rem 0.625rem',
          borderRadius: '0.5rem',
          lineHeight: 1.45,
        }}>
          {draft.errorMessage}
        </p>
      )}

      {/* Meta row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
        {draft.ideaTargetKeyword && (
          <span style={{ background: 'var(--color-bg-secondary)', padding: '0.125rem 0.4375rem', borderRadius: '4px' }}>
            {draft.ideaTargetKeyword}
          </span>
        )}
        {draft.ideaBrand && (
          <span
            style={{
              background: draft.ideaBrand === 'Staci' ? '#fce7f3' : '#dcefd8',
              color: draft.ideaBrand === 'Staci' ? '#9d174d' : '#425F39',
              padding: '0.125rem 0.4375rem',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            {draft.ideaBrand}
          </span>
        )}
        {draft.postType && (
          <span style={{ background: 'var(--color-bg-secondary)', padding: '0.125rem 0.4375rem', borderRadius: '4px' }}>
            {draft.postType}
          </span>
        )}
      </div>

      {/* Actions. "Review" / "View" opens the readable round-table page
          (article-styled preview + reviewers + publish). The old SlideOver
          raw-body view is kept behind the small "Raw" button for quick peeks. */}
      <div style={{ display: 'flex', gap: '0.375rem', marginTop: 'auto', paddingTop: '0.375rem', flexWrap: 'wrap' }}>
        <a
          href={`/dashboard/content-studio/drafts/${draft.id}/round-table`}
          style={{ textDecoration: 'none', flex: '1 1 auto' }}
          title="Open the article + reviewers + publish controls"
        >
          <TahiButton
            size="sm"
            iconLeft={<Layers className="w-3.5 h-3.5" />}
            style={{ width: '100%' }}
            variant={isReady ? 'primary' : 'secondary'}
          >
            {isReady ? 'Review' : 'View'}
          </TahiButton>
        </a>
        <TahiButton
          size="sm"
          variant="secondary"
          onClick={onOpen}
          iconLeft={<Eye className="w-3.5 h-3.5" />}
          title="Quick raw preview"
        >
          Raw
        </TahiButton>
        {onRetry && (
          <TahiButton
            size="sm"
            variant="secondary"
            onClick={onRetry}
            loading={retrying}
            iconLeft={!retrying ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
          >
            Retry
          </TahiButton>
        )}
      </div>
    </Card>
  )
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', minWidth: '2rem' }}>
        {label}
      </span>
      <div style={{ flex: 1, height: '0.25rem', background: 'var(--color-border-subtle)', borderRadius: '999px', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--color-brand)',
            transition: 'width 250ms ease',
          }}
        />
      </div>
      <span style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)', minWidth: '2.25rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value}/{max}
      </span>
    </div>
  )
}

// ── Detail drawer ────────────────────────────────────────────────────────────

interface DraftDetailDrawerProps {
  detail: DraftDetail
  onClose: () => void
  onDiscard: () => void
  discarding: boolean
}

function DraftDetailDrawer({ detail, onClose, onDiscard, discarding }: DraftDetailDrawerProps) {
  const { draft, idea, cluster } = detail
  const breakdown = parseScoreBreakdown(draft.scoreBreakdown)
  const [publishOpen, setPublishOpen] = useState(false)
  const faqs = (() => {
    if (!draft.faqsJson) return []
    try {
      const parsed = JSON.parse(draft.faqsJson) as Array<{ q: string; a: string }>
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  const validatedCitations = (() => {
    if (!draft.validatedCitations) return []
    try {
      const parsed = JSON.parse(draft.validatedCitations) as Array<{ url: string }>
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })()

  const [showSchema, setShowSchema] = useState(false)
  const [showSales, setShowSales] = useState(false)
  const [showReadability, setShowReadability] = useState(false)

  // 'ready' = legacy Slice-2 drafts; 'ready_for_publish' = round-table
  // (Slice 9) drafts. Both are publishable, both should surface in
  // the Schedule "ready to go" lane.
  const isReady = draft.status === 'ready' || draft.status === 'ready_for_publish'

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={draft.title ?? draft.ideaTitle ?? 'Draft'}
      subtitle={cluster?.name ?? 'Unclustered'}
      icon={<FileEdit size={15} />}
      maxWidth="56rem"
    >
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Status + score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
            <Badge tone={draftStatusTone(draft.status)} variant="soft" size="md" leader={isInProgress(draft.status) ? 'dot' : false}>
              {draftStatusLabel(draft.status)}
            </Badge>
            {isReady && (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Content score
                <strong style={{ marginLeft: '0.25rem', color: 'var(--color-text)', fontSize: '1rem' }}>
                  {draft.contentScore ?? 0}
                </strong>
                / 100
              </span>
            )}
          </div>

          {/* Score breakdown bars */}
          {isReady && breakdown && (
            <div style={{
              padding: '0.875rem 1rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: '0.625rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              <p style={{ margin: 0, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)' }}>
                Score breakdown
              </p>
              <ScoreBar label="AEO" value={breakdown.aeo} max={25} />
              <ScoreBar label="Voice" value={breakdown.voice} max={25} />
              <ScoreBar label="Readability" value={breakdown.readability} max={20} />
              <ScoreBar label="SEO" value={breakdown.seo} max={20} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                Links integrity:
                {breakdown.linksOk ? (
                  <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Check className="w-3 h-3" />
                    All sourced from allowlists
                  </span>
                ) : (
                  <span style={{ color: 'var(--color-danger)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <X className="w-3 h-3" />
                    Some links may be invented
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Meta strip */}
          {draft.metaTitle && (
            <DraftField label="SEO title">
              {draft.metaTitle}
            </DraftField>
          )}
          {draft.metaDescription && (
            <DraftField label="Meta description">
              {draft.metaDescription}
            </DraftField>
          )}

          {/* Cover */}
          {draft.coverSvgUrl && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.375rem' }}>
                Cover ({draft.coverTemplate ?? 'template'})
              </p>
              { /* SVG cover is served via the dashboard proxy route. next/image
                   doesn't help here (SVG, dashboard origin); raw <img> is fine. */ }
              { /* eslint-disable-next-line @next/next/no-img-element */ }
              <img
                src={draft.coverSvgUrl}
                alt={`${draft.title ?? 'draft'} cover`}
                style={{
                  width: '100%',
                  maxWidth: '32rem',
                  height: 'auto',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--color-border-subtle)',
                  display: 'block',
                }}
              />
            </div>
          )}

          {/* Key takeaways */}
          {draft.keyTakeaways && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.375rem' }}>
                Key takeaways
              </p>
              <div
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--color-text)',
                  lineHeight: 1.55,
                  padding: '0.625rem 0.875rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: '0.5rem',
                }}
                dangerouslySetInnerHTML={{ __html: draft.keyTakeaways }}
              />
            </div>
          )}

          {/* Body preview */}
          {draft.bodyHtml && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.375rem' }}>
                Body preview
              </p>
              <div
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--color-text)',
                  lineHeight: 1.6,
                  padding: '0.875rem 1rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: '0.5rem',
                  maxHeight: '32rem',
                  overflowY: 'auto',
                }}
                dangerouslySetInnerHTML={{ __html: draft.bodyHtml }}
              />
            </div>
          )}

          {/* FAQs */}
          {faqs.length > 0 && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem' }}>
                FAQs ({faqs.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {faqs.map((f, i) => (
                  <div key={i} style={{ padding: '0.625rem 0.875rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem' }}>
                    <p style={{ margin: '0 0 0.25rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {f.q}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                      {f.a}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Citations */}
          {validatedCitations.length > 0 && (
            <div>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.375rem' }}>
                Validated external citations ({validatedCitations.length})
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {validatedCitations.map((c, i) => (
                  <li key={i} style={{ fontSize: '0.75rem' }}>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: 'var(--color-text-muted)',
                        textDecoration: 'none',
                        wordBreak: 'break-all',
                      }}
                    >
                      {c.url}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reviewer notes (collapsed) */}
          {draft.salesNotes && (
            <CollapsibleNote
              label="Sales reviewer notes"
              open={showSales}
              onToggle={() => setShowSales(v => !v)}
              text={draft.salesNotes}
            />
          )}
          {draft.readabilityNotes && (
            <CollapsibleNote
              label="Readability reviewer notes"
              open={showReadability}
              onToggle={() => setShowReadability(v => !v)}
              text={draft.readabilityNotes}
            />
          )}

          {/* JSON-LD schema (collapsed) */}
          {draft.schemaJsonLd && (
            <CollapsibleNote
              label="Schema JSON-LD"
              open={showSchema}
              onToggle={() => setShowSchema(v => !v)}
              text={draft.schemaJsonLd}
              mono
            />
          )}

          {/* Error */}
          {draft.status === 'failed' && draft.errorMessage && (
            <div
              style={{
                padding: '0.625rem 0.875rem',
                background: 'var(--color-danger-bg, #fef2f2)',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
                color: 'var(--color-danger-text, #8B2D2D)',
              }}
            >
              <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>Drafting failed</p>
              <p style={{ margin: 0, lineHeight: 1.5 }}>{draft.errorMessage}</p>
            </div>
          )}

          {/* Linked idea reference at the bottom */}
          {idea && (
            <div style={{
              padding: '0.625rem 0.875rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: '0.5rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
            }}>
              From idea: <strong style={{ color: 'var(--color-text)' }}>{idea.title}</strong>
              {idea.targetKeyword && <span> · target keyword: <code>{idea.targetKeyword}</code></span>}
              {idea.recommendedWordCount && <span> · {idea.recommendedWordCount.toLocaleString()} words</span>}
            </div>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Close
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          variant="secondary"
          onClick={onDiscard}
          loading={discarding}
          iconLeft={!discarding ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
        >
          Discard
        </TahiButton>
        <TahiButton
          size="sm"
          iconLeft={<Send className="w-3.5 h-3.5" />}
          disabled={!isReady}
          onClick={() => setPublishOpen(true)}
          title={isReady ? 'Publish or schedule to Webflow' : 'Draft must be Ready to publish'}
        >
          Schedule
        </TahiButton>
      </SlideOver.Footer>
      {publishOpen && (
        <PublishModal
          draftId={draft.id}
          title={draft.title ?? draft.ideaTitle ?? 'Draft'}
          cluster={cluster?.name ?? null}
          onClose={() => setPublishOpen(false)}
          onPublished={() => {
            setPublishOpen(false)
            onClose()
          }}
        />
      )}
    </SlideOver>
  )
}

function DraftField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-subtle)', margin: '0 0 0.25rem' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  )
}

function CollapsibleNote({ label, open, onToggle, text, mono }: {
  label: string
  open: boolean
  onToggle: () => void
  text: string
  mono?: boolean
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: '0.6875rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-subtle)',
        }}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <pre
          style={{
            margin: '0.375rem 0 0',
            padding: '0.625rem 0.875rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: '0.5rem',
            fontSize: mono ? '0.6875rem' : '0.8125rem',
            color: 'var(--color-text)',
            lineHeight: 1.5,
            fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '20rem',
            overflowY: 'auto',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  )
}

// ── Publish modal + Schedule tab (Phase I Slice 5) ────────────────────────────

interface CooldownConflict {
  title?: string
  publishedAt: string
}

interface AutoSlot {
  scheduledFor: string
  reason: string
  cooldownConflicts?: CooldownConflict[]
}

interface ScheduleReadyDraft {
  id: string
  ideaId: string
  title: string | null
  mainCategorySlug: string | null
  contentScore: number | null
  coverSvgUrl: string | null
  authorSlug: string | null
  shortenedName: string | null
  ideaTitle: string | null
  clusterName: string | null
  clusterSlug: string | null
  autoSlot: AutoSlot
}

interface ScheduleScheduledDraft {
  id: string
  title: string | null
  mainCategorySlug: string | null
  scheduledFor: string | null
  publishUrl: string | null
  publishedWebflowItemId: string | null
  clusterName: string | null
  clusterSlug: string | null
}

interface PublishHistoryRow {
  id: string
  draftId: string | null
  webflowItemId: string
  url: string
  title: string
  clusterSlug: string | null
  publishedAt: string
  createdAt: string
}

interface ScheduleResponse {
  readyDrafts: ScheduleReadyDraft[]
  scheduledDrafts: ScheduleScheduledDraft[]
  publishHistory: PublishHistoryRow[]
  counts: { ready: number; scheduled: number; published: number }
}

interface PublishResponse {
  webflowItemId: string
  publishUrl: string
  scheduledFor: string
  publishedAt: string | null
  reason?: string
  cooldownConflicts?: CooldownConflict[]
  error?: string
  detail?: string
}

function fmtSlot(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  }) + ' UK'
}

// ── Publish modal ────────────────────────────────────────────────────────────

interface PublishModalProps {
  draftId: string
  title: string
  cluster: string | null
  onClose: () => void
  onPublished: (response: PublishResponse) => void
}

function PublishModal({ draftId, title, cluster, onClose, onPublished }: PublishModalProps) {
  const { showToast } = useToast()
  const [mode, setMode] = useState<'now' | 'custom' | 'auto'>('auto')
  const [customDate, setCustomDate] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    if (mode === 'custom' && !customDate) {
      showToast('Pick a date and time first', 'warning')
      return
    }
    setSubmitting(true)
    try {
      const body: { mode: string; customDate?: string } = { mode }
      if (mode === 'custom') {
        // datetime-local has no timezone. Treat as local time and convert.
        body.customDate = new Date(customDate).toISOString()
      }
      const res = await fetch(apiPath(`/api/admin/content/drafts/${draftId}/publish`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as PublishResponse
      if (!res.ok) {
        showToast(json.error ?? json.detail ?? 'Publish failed', 'error')
        return
      }
      if (json.publishedAt) {
        showToast('Published live to Webflow', 'success')
      } else {
        showToast(`Scheduled for ${fmtSlot(json.scheduledFor)}`, 'success')
      }
      onPublished(json)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Publish failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '32rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div style={{
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: 'var(--color-brand-50)',
            color: 'var(--color-brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Send className="w-4 h-4" />
          </div>
          <div style={{ flex: 1 }}>
            <h3 id="publish-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--color-text)' }}>
              Publish to Webflow
            </h3>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              {title}
              {cluster && <span style={{ color: 'var(--color-text-subtle)' }}> · {cluster}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '0.25rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: 'var(--color-text-muted)',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <PublishModeOption
            id="mode-now"
            label="Publish now"
            description="Push live immediately and ping IndexNow."
            checked={mode === 'now'}
            onSelect={() => setMode('now')}
          />
          <PublishModeOption
            id="mode-auto"
            label="Auto schedule"
            description="Next Mon/Wed/Fri 09:00 UK, respecting the 3/week cap."
            checked={mode === 'auto'}
            onSelect={() => setMode('auto')}
          />
          <PublishModeOption
            id="mode-custom"
            label="Custom date"
            description="Pick the exact go-live time. No snapping applied."
            checked={mode === 'custom'}
            onSelect={() => setMode('custom')}
          >
            {mode === 'custom' && (
              <div style={{ marginTop: '0.5rem' }}>
                <Input
                  type="datetime-local"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </div>
            )}
          </PublishModeOption>
        </div>

        <div style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end',
          marginTop: '0.5rem',
        }}>
          <TahiButton variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </TahiButton>
          <TahiButton
            size="sm"
            loading={submitting}
            onClick={() => { void handleConfirm() }}
            iconLeft={!submitting ? <Send className="w-3.5 h-3.5" /> : undefined}
          >
            Confirm
          </TahiButton>
        </div>
      </div>
    </div>
  )
}

function PublishModeOption({
  id, label, description, checked, onSelect, children,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onSelect: () => void
  children?: React.ReactNode
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'block',
        padding: '0.75rem 0.875rem',
        borderRadius: '0.5rem',
        border: checked
          ? '1px solid var(--color-brand)'
          : '1px solid var(--color-border)',
        background: checked ? 'var(--color-brand-50)' : 'var(--color-bg)',
        cursor: 'pointer',
        transition: 'background-color 150ms ease, border-color 150ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <input
          id={id}
          type="radio"
          name="publish-mode"
          checked={checked}
          onChange={onSelect}
          style={{ marginTop: '0.25rem' }}
        />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
            {label}
          </p>
          <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {description}
          </p>
          {children}
        </div>
      </div>
    </label>
  )
}

// ── Schedule tab ─────────────────────────────────────────────────────────────

interface ScheduleTabProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function ScheduleTab({ onToast }: ScheduleTabProps) {
  const [data, setData] = useState<ScheduleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeDraft, setActiveDraft] = useState<ScheduleReadyDraft | null>(null)

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/schedule'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as ScheduleResponse
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchSchedule() }, [fetchSchedule])

  const readyDrafts = data?.readyDrafts ?? []
  const counts = data?.counts ?? { ready: 0, scheduled: 0, published: 0 }

  // Merge scheduled-but-not-yet-published into the history table view so
  // Liam sees them in chronological order. Already-published rows come
  // from publish_history; scheduled-pending rows come from the drafts
  // table. Pulling scheduledDrafts + history out of `data` inside the
  // memo keeps the dep array stable (raw response object) so we avoid a
  // new array on every render.
  const combinedHistory = useMemo(() => {
    const scheduledDrafts = data?.scheduledDrafts ?? []
    const history = data?.publishHistory ?? []
    const rows: Array<{
      key: string
      title: string
      url: string | null
      cluster: string | null
      publishedAt: string
      status: 'scheduled' | 'published'
    }> = []
    const seenWebflowIds = new Set<string>()
    for (const s of scheduledDrafts) {
      if (!s.scheduledFor) continue
      if (s.publishedWebflowItemId) seenWebflowIds.add(s.publishedWebflowItemId)
      rows.push({
        key: `scheduled:${s.id}`,
        title: s.title ?? 'Untitled',
        url: s.publishUrl,
        cluster: s.clusterName ?? s.clusterSlug ?? null,
        publishedAt: s.scheduledFor,
        status: 'scheduled',
      })
    }
    for (const h of history) {
      // Skip rows that duplicate a still-scheduled draft (shouldn't happen
      // in practice but defensive — the scheduled drafts table also has a
      // publish_history row).
      if (seenWebflowIds.has(h.webflowItemId)) continue
      rows.push({
        key: `published:${h.id}`,
        title: h.title,
        url: h.url,
        cluster: h.clusterSlug,
        publishedAt: h.publishedAt,
        status: Date.parse(h.publishedAt) > Date.now() ? 'scheduled' : 'published',
      })
    }
    rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    return rows
  }, [data])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge tone="positive" variant="soft" size="sm" leader={false}>
            {counts.ready} ready
          </Badge>
          <Badge tone="info" variant="soft" size="sm" leader={false}>
            {counts.scheduled} scheduled
          </Badge>
          <Badge tone="neutral" variant="soft" size="sm" leader={false}>
            {counts.published} published
          </Badge>
        </div>
        <TahiButton
          size="sm"
          variant="secondary"
          onClick={() => { void fetchSchedule() }}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </div>

      {/* Ready to publish */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h2 style={{
          margin: 0,
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-subtle)',
        }}>
          Ready to publish
        </h2>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[0, 1].map(i => (
              <div
                key={i}
                className="animate-pulse"
                style={{
                  height: '5rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: 'var(--radius-card)',
                }}
              />
            ))}
          </div>
        )}

        {!loading && readyDrafts.length === 0 && (
          <Card padding="lg">
            <EmptyState
              icon={<FileEdit className="w-6 h-6" />}
              title="No ready drafts"
              description="Get a draft to the Ready stage in the Drafts tab and it'll appear here for scheduling."
            />
          </Card>
        )}

        {!loading && readyDrafts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {readyDrafts.map(d => (
              <ScheduleReadyCard
                key={d.id}
                draft={d}
                onPublishNow={() => publishDraft(d, 'now', undefined, fetchSchedule, onToast)}
                onAuto={() => publishDraft(d, 'auto', undefined, fetchSchedule, onToast)}
                onCustom={() => setActiveDraft(d)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scheduled / Published table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h2 style={{
          margin: 0,
          fontSize: '0.75rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-subtle)',
        }}>
          Scheduled and published
        </h2>

        {!loading && combinedHistory.length === 0 ? (
          <Card padding="lg">
            <EmptyState
              icon={<Calendar className="w-6 h-6" />}
              title="No publishes yet"
              description="Publishing a draft will land it here."
            />
          </Card>
        ) : (
          <Card padding="none">
            <SchedulePublishedTable rows={combinedHistory} />
          </Card>
        )}
      </div>

      {/* Custom date modal */}
      {activeDraft && (
        <PublishModal
          draftId={activeDraft.id}
          title={activeDraft.title ?? activeDraft.ideaTitle ?? 'Draft'}
          cluster={activeDraft.clusterName ?? null}
          onClose={() => setActiveDraft(null)}
          onPublished={() => {
            setActiveDraft(null)
            void fetchSchedule()
          }}
        />
      )}
    </div>
  )
}

async function publishDraft(
  draft: ScheduleReadyDraft,
  mode: 'now' | 'auto',
  customDate: string | undefined,
  refresh: () => Promise<void>,
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void,
) {
  try {
    const body: { mode: string; customDate?: string } = { mode }
    if (customDate) body.customDate = customDate
    const res = await fetch(apiPath(`/api/admin/content/drafts/${draft.id}/publish`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({})) as PublishResponse
    if (!res.ok) {
      onToast(json.error ?? json.detail ?? 'Publish failed', 'error')
      return
    }
    if (json.publishedAt) {
      onToast('Published live to Webflow', 'success')
    } else {
      onToast(`Scheduled for ${fmtSlot(json.scheduledFor)}`, 'success')
    }
    await refresh()
  } catch (err) {
    onToast(err instanceof Error ? err.message : 'Publish failed', 'error')
  }
}

// ── Schedule ready-card ──────────────────────────────────────────────────────

interface ScheduleReadyCardProps {
  draft: ScheduleReadyDraft
  onPublishNow: () => void
  onAuto: () => void
  onCustom: () => void
}

function ScheduleReadyCard({ draft, onPublishNow, onAuto, onCustom }: ScheduleReadyCardProps) {
  const slot = draft.autoSlot
  const conflicts = slot.cooldownConflicts ?? []
  return (
    <Card padding="md">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.1875rem 0.5rem',
              fontSize: '0.6875rem',
              fontWeight: 600,
              borderRadius: '999px',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-muted)',
            }}>
              {draft.clusterName ?? 'Unclustered'}
            </span>
            {typeof draft.contentScore === 'number' && (
              <span style={{
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
                fontWeight: 500,
              }}>
                score {draft.contentScore} / 100
              </span>
            )}
          </div>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.35 }}>
            {draft.title ?? draft.ideaTitle ?? 'Untitled'}
          </h3>
          <p style={{
            margin: '0.375rem 0 0',
            fontSize: '0.75rem',
            color: 'var(--color-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
          }}>
            <Clock className="w-3 h-3" />
            Next auto slot: <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{fmtSlot(slot.scheduledFor)}</strong>
          </p>
          {conflicts.length > 0 && (
            <p style={{
              margin: '0.375rem 0 0',
              fontSize: '0.6875rem',
              color: 'var(--color-warning)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}>
              <AlertTriangle className="w-3 h-3" />
              Cooldown: {conflicts.length} same-cluster post{conflicts.length === 1 ? '' : 's'} in the last 14 days
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          <TahiButton size="sm" variant="secondary" onClick={onPublishNow}>
            Publish now
          </TahiButton>
          <TahiButton size="sm" variant="secondary" onClick={onCustom}>
            Custom date
          </TahiButton>
          <TahiButton size="sm" onClick={onAuto} iconLeft={<Send className="w-3.5 h-3.5" />}>
            Auto
          </TahiButton>
        </div>
      </div>
    </Card>
  )
}

// ── Scheduled / Published table ──────────────────────────────────────────────

interface ScheduleTableRow {
  key: string
  title: string
  url: string | null
  cluster: string | null
  publishedAt: string
  status: 'scheduled' | 'published'
}

function SchedulePublishedTable({ rows }: { rows: ScheduleTableRow[] }) {
  const columns: DataTableColumn<ScheduleTableRow>[] = useMemo(() => ([
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '16rem',
      render: r => (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {r.title}
        </span>
      ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      sortable: true,
      sortValue: r => (r.cluster ?? '').toLowerCase(),
      minWidth: '10rem',
      render: r => (
        <Badge tone="neutral" variant="soft" size="sm" leader={false}>
          {r.cluster ?? 'Unclustered'}
        </Badge>
      ),
    },
    {
      key: 'publishedAt',
      header: 'When',
      sortable: true,
      sortValue: r => r.publishedAt,
      minWidth: '11rem',
      render: r => (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {fmtSlot(r.publishedAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      minWidth: '7rem',
      render: r => (
        <Badge
          tone={r.status === 'published' ? 'positive' : 'info'}
          variant="soft"
          size="sm"
          leader="dot"
        >
          {r.status === 'published' ? 'Published' : 'Scheduled'}
        </Badge>
      ),
    },
    {
      key: 'url',
      header: '',
      minWidth: '3rem',
      render: r => r.url ? (
        <a
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            color: 'var(--color-text-muted)',
            fontSize: '0.75rem',
            textDecoration: 'none',
          }}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : null,
    },
  ]), [])

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={r => r.key}
    />
  )
}

// ── Backfill card (Phase I · Slice 6.5) ───────────────────────────────────────
//
// Adds FAQ + schema + key takeaways + AI prompt to existing Tahi blog
// posts. Staged edits only — Liam batch-publishes from Webflow Editor
// after spot-checking.

interface BackfillRunSummary {
  runId: string
  startedAt: string
  finishedAt: string
  total: number
  succeeded: number
  failed: number
  skipped: number
  totalDurationMs: number
  sampleFailures: Array<{ id: string; url: string; error: string | null }>
}

interface BackfillItemRow {
  id: string
  webflowItemId: string
  postUrl: string
  postTitle: string | null
  status: string
  fieldsWritten: string[]
  errorMessage: string | null
  faqsGenerated: number | null
  takeawaysGenerated: number | null
  schemaCharsWritten: number | null
  durationMs: number | null
  createdAt: string
}

interface BackfillProcessResponse {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  items: Array<{
    id: string
    slug?: string
    status: 'success' | 'failed' | 'skipped'
    error?: string
    fieldsWritten: string[]
  }>
  continueFromIndex?: number
  completed: boolean
}

interface BackfillCardProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
}

function backfillStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'success': return 'positive'
    case 'failed':  return 'danger'
    case 'skipped': return 'neutral'
    default:        return 'neutral'
  }
}

function BackfillCard({ onToast }: BackfillCardProps) {
  const [runs, setRuns] = useState<BackfillRunSummary[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [running, setRunning] = useState(false)
  // Progress state for the live run. Resets between runs.
  const [progressDone, setProgressDone] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [progressLast, setProgressLast] = useState<string>('')
  const [progressErrors, setProgressErrors] = useState(0)
  // Cancel flag — set true to break the batch loop.
  const [cancelRequested, setCancelRequested] = useState(false)
  // Drill-down drawer state.
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailRunId, setDetailRunId] = useState<string | null>(null)
  const [detailItems, setDetailItems] = useState<BackfillItemRow[]>([])

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/backfill/runs'))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { runs: BackfillRunSummary[] }
      setRuns(json.runs ?? [])
    } catch {
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchRuns() }, [fetchRuns])

  const runBackfill = useCallback(async (mode: 'all' | 'missing') => {
    setRunning(true)
    setCancelRequested(false)
    setProgressDone(0)
    setProgressTotal(0)
    setProgressLast('')
    setProgressErrors(0)
    let totalSucceeded = 0
    let totalFailed = 0
    let totalSkipped = 0
    try {
      // 1) Allocate the runId + get the list of webflowIds to walk.
      const startRes = await fetch(apiPath('/api/admin/content/backfill/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!startRes.ok) {
        const json = await startRes.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `Start failed (${startRes.status})`)
      }
      const start = await startRes.json() as {
        runId: string
        totalToProcess: number
        webflowIds: string[]
      }
      setProgressTotal(start.totalToProcess)
      if (start.totalToProcess === 0) {
        onToast(
          mode === 'missing'
            ? 'No posts left to backfill — every post already has FAQ #1.'
            : 'No posts found in the Webflow collection.',
          'info',
        )
        return
      }

      // 2) Walk batches until completed=true or cancelled.
      let continueFromIndex: number | undefined = undefined
      let iterations = 0
      while (true) {
        if (cancelRequested) {
          onToast('Backfill cancelled.', 'warning')
          break
        }
        if (iterations++ > 200) {
          onToast('Backfill hit the batch iteration safety cap; stopping.', 'warning')
          break
        }
        const res = await fetch(apiPath('/api/admin/content/backfill/process'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: start.runId,
            webflowIds: start.webflowIds,
            continueFromIndex,
            batchSize: 5,
          }),
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `Process failed (${res.status})`)
        }
        const json = await res.json() as BackfillProcessResponse
        totalSucceeded += json.succeeded
        totalFailed += json.failed
        totalSkipped += json.skipped
        setProgressDone(prev => prev + json.processed)
        setProgressErrors(prev => prev + json.failed)
        const last = json.items[json.items.length - 1]
        if (last) {
          setProgressLast(last.slug ?? last.id)
        }
        if (json.completed || json.continueFromIndex == null) break
        continueFromIndex = json.continueFromIndex
        // Polite pause between batches — Webflow + Anthropic both prefer
        // us under their per-minute caps.
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      if (!cancelRequested) {
        if (totalFailed === 0) {
          onToast(
            `Backfill complete. ${totalSucceeded} succeeded, ${totalSkipped} skipped.`,
            'success',
          )
        } else {
          onToast(
            `Backfill done with ${totalFailed} errors. ${totalSucceeded} succeeded, ${totalSkipped} skipped.`,
            'warning',
          )
        }
      }
      await fetchRuns()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      onToast(`Backfill failed: ${message}`, 'error')
    } finally {
      setRunning(false)
      setCancelRequested(false)
    }
  }, [cancelRequested, fetchRuns, onToast])

  const openLastRunDetails = useCallback(async () => {
    const latest = runs[0]
    if (!latest) {
      onToast('No backfill runs yet — kick one off first.', 'info')
      return
    }
    setDetailRunId(latest.runId)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailItems([])
    try {
      const res = await fetch(apiPath(`/api/admin/content/backfill/runs/${latest.runId}`))
      if (!res.ok) throw new Error('Failed to load run details')
      const json = await res.json() as { items: BackfillItemRow[] }
      setDetailItems(json.items ?? [])
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Load failed', 'error')
    } finally {
      setDetailLoading(false)
    }
  }, [onToast, runs])

  const latestRun = runs[0]
  const progressPct = progressTotal > 0
    ? Math.min(100, Math.round((progressDone / progressTotal) * 100))
    : 0

  return (
    <>
      <Card padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {/* Heading row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: '1 1 22rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Layers size={16} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
                <h3 style={{
                  fontSize: '0.9375rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  margin: 0,
                }}>
                  Backfill existing posts
                </h3>
              </div>
              <p style={{
                fontSize: '0.8125rem',
                color: 'var(--color-text-muted)',
                margin: 0,
                lineHeight: 1.5,
              }}>
                Add FAQs, key takeaways, AI summary prompt, JSON-LD schema, and hreflang to existing Tahi blog posts. Lands as <strong>staged edits in Webflow</strong> — publish from the Webflow Editor after spot-checking.
              </p>
            </div>
          </div>

          {/* Last run strip — shows when there's a prior run + we're not
              currently mid-run. Hidden during a run so the progress bar
              takes the spotlight. */}
          {!running && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
                padding: '0.625rem 0.75rem',
                borderRadius: '0.5rem',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                <History size={13} aria-hidden="true" />
                {runsLoading ? (
                  <span>Loading last run...</span>
                ) : latestRun ? (
                  <span>
                    Last run: <strong style={{ color: 'var(--color-text)' }}>{latestRun.succeeded}</strong> succeeded
                    {latestRun.failed > 0 && (
                      <> / <strong style={{ color: 'var(--color-danger, #dc2626)' }}>{latestRun.failed}</strong> failed</>
                    )}
                    {latestRun.skipped > 0 && (
                      <> / {latestRun.skipped} skipped</>
                    )}
                    {' '}— {fmtRelative(latestRun.finishedAt)}
                  </span>
                ) : (
                  <span>No backfill runs yet.</span>
                )}
              </div>
              {latestRun && (
                <button
                  type="button"
                  onClick={() => void openLastRunDetails()}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'var(--color-brand)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  View details
                  <ChevronRight size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          )}

          {/* Progress strip — only while running. Shows X / Y + last
              processed slug + error count + cancel. */}
          {running && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                padding: '0.75rem',
                borderRadius: '0.5rem',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                flexWrap: 'wrap',
              }}>
                <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                  {progressDone} of {progressTotal} posts ({progressPct}%)
                </span>
                {progressErrors > 0 && (
                  <span style={{ color: 'var(--color-danger, #dc2626)' }}>
                    {progressErrors} error{progressErrors === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div style={{
                width: '100%',
                height: 6,
                borderRadius: 999,
                background: 'var(--color-bg-tertiary)',
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: '100%',
                    background: 'var(--color-brand)',
                    transition: 'width 250ms ease',
                  }}
                  aria-hidden="true"
                />
              </div>
              {progressLast && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                  Last processed: <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{progressLast}</span>
                </div>
              )}
              <div>
                <TahiButton
                  size="sm"
                  variant="secondary"
                  onClick={() => setCancelRequested(true)}
                  disabled={cancelRequested}
                  iconLeft={<X className="w-3.5 h-3.5" />}
                >
                  {cancelRequested ? 'Cancelling...' : 'Cancel after current batch'}
                </TahiButton>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <TahiButton
              size="sm"
              loading={running}
              onClick={() => void runBackfill('all')}
              iconLeft={!running ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
            >
              {running ? 'Backfilling...' : 'Backfill all posts'}
            </TahiButton>
            <TahiButton
              size="sm"
              variant="secondary"
              disabled={running}
              onClick={() => void runBackfill('missing')}
              iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Backfill missing only
            </TahiButton>
            {!running && latestRun && (
              <TahiButton
                size="sm"
                variant="secondary"
                onClick={() => void openLastRunDetails()}
                iconLeft={<Eye className="w-3.5 h-3.5" />}
              >
                View last run
              </TahiButton>
            )}
          </div>
        </div>
      </Card>

      {/* Per-run drill-down drawer */}
      <SlideOver
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        icon={<Layers className="w-4 h-4" />}
        title="Backfill run details"
        subtitle={detailRunId ? `Run ${detailRunId.slice(0, 8)}` : undefined}
        maxWidth="38rem"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0 1rem 1rem' }}>
          {detailLoading ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', padding: '1rem 0' }}>
              Loading...
            </div>
          ) : detailItems.length === 0 ? (
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', padding: '1rem 0' }}>
              No rows recorded for this run.
            </div>
          ) : (
            <ul style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              {detailItems.map(item => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                    padding: '0.625rem 0.75rem',
                    borderRadius: '0.5rem',
                    background: 'var(--color-bg-secondary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        color: 'var(--color-text)',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.postTitle ?? shortUrl(item.postUrl)}
                      <ExternalLink size={11} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
                    </a>
                    <Badge tone={backfillStatusTone(item.status)} variant="soft" size="sm" leader="dot">
                      {item.status}
                    </Badge>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', flexWrap: 'wrap', gap: '0.625rem' }}>
                    {item.faqsGenerated != null && <span>{item.faqsGenerated} FAQs</span>}
                    {item.takeawaysGenerated != null && item.takeawaysGenerated > 0 && (
                      <span>{item.takeawaysGenerated} takeaways</span>
                    )}
                    {item.schemaCharsWritten != null && item.schemaCharsWritten > 0 && (
                      <span>{Math.round(item.schemaCharsWritten / 100) / 10}k schema chars</span>
                    )}
                    {item.durationMs != null && <span>{Math.round(item.durationMs / 100) / 10}s</span>}
                  </div>
                  {item.errorMessage && (
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-danger, #dc2626)',
                      fontFamily: 'var(--font-mono, monospace)',
                      wordBreak: 'break-word',
                    }}>
                      {item.errorMessage}
                    </div>
                  )}
                  {item.fieldsWritten.length > 0 && (
                    <div style={{
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-subtle)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}>
                      Wrote: {item.fieldsWritten.join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SlideOver>
    </>
  )
}
