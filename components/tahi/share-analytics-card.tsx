/**
 * <ShareAnalyticsCard> — admin-only view of who has been looking at a
 * shared resource (schedule / proposal / contract).
 *
 * Stats: total views, unique viewers, average duration, last viewed.
 * Below: a recent-events list with country, duration, and relative time.
 *
 * Generic across resource types so phase 2 (proposals) and phase 3
 * (contracts) reuse the same component.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { Eye, Users, Clock, RefreshCw, Globe } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { AnalyticsHeatmap } from '@/components/tahi/analytics-heatmap'

interface SectionAgg {
  sectionId: string
  views: number
  uniqueSessions: number
  totalDwellMs: number
  avgDwellMs: number
  maxDwellMs: number
}

interface SectionsResponse {
  totalSessions: number
  totalEvents: number
  returnVisits: number
  sections: SectionAgg[]
}

interface ShareViewEvent {
  id: string
  sessionId: string
  viewerName: string | null
  viewerEmail: string | null
  viewerCountry: string | null
  viewerUa: string | null
  referrer: string | null
  pagesViewed: string | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
}

interface AnalyticsStats {
  totalViews: number
  uniqueSessions: number
  uniqueCountries: number
  totalDurationMs: number
  avgDurationMs: number
  maxDurationMs: number
  firstViewedAt: string | null
  lastViewedAt: string | null
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSeconds = seconds % 60
  if (minutes < 60) return `${minutes}m ${remSeconds}s`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${remMinutes}m`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function ShareAnalyticsCard({
  resourceType,
  resourceId,
}: {
  resourceType: 'schedule' | 'proposal' | 'contract'
  resourceId: string
}) {
  const [stats, setStats] = useState<AnalyticsStats | null>(null)
  const [events, setEvents] = useState<ShareViewEvent[]>([])
  const [sectionData, setSectionData] = useState<SectionsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAnalytics = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    try {
      const [vRes, sRes] = await Promise.all([
        fetch(apiPath(`/api/admin/views?resourceType=${resourceType}&resourceId=${resourceId}&limit=15`)),
        fetch(apiPath(`/api/admin/views/sections?resourceType=${resourceType}&resourceId=${resourceId}`)),
      ])
      if (vRes.ok) {
        const data = await vRes.json() as { stats: AnalyticsStats; events: ShareViewEvent[] }
        setStats(data.stats)
        setEvents(data.events ?? [])
      }
      if (sRes.ok) {
        const data = await sRes.json() as SectionsResponse
        setSectionData(data)
      }
    } catch {
      // Keep previous data; silent.
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [resourceType, resourceId])

  useEffect(() => { void fetchAnalytics() }, [fetchAnalytics])

  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
            Share analytics
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0 0' }}>
            Anonymous tracking of who&apos;s opened the public link.
          </p>
        </div>
        <button
          onClick={() => fetchAnalytics(true)}
          disabled={refreshing}
          aria-label="Refresh analytics"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2rem',
            height: '2rem',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }} />
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse" style={{ height: '5rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }} />
      ) : !stats || stats.totalViews === 0 ? (
        <div
          style={{
            padding: '1.25rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'center',
            fontSize: '0.8125rem',
            color: 'var(--color-text-muted)',
          }}
        >
          Nobody&apos;s opened this link yet. Share it and pop back here to see who&apos;s viewing.
        </div>
      ) : (
        <>
          {/* Stats strip */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <StatTile
              icon={<Eye size={14} />}
              label="Views"
              value={String(stats.totalViews)}
              sub={stats.lastViewedAt ? `last ${formatRelative(stats.lastViewedAt)}` : null}
            />
            <StatTile
              icon={<Users size={14} />}
              label="Unique viewers"
              value={String(stats.uniqueSessions)}
              sub={stats.uniqueCountries > 0 ? `${stats.uniqueCountries} ${stats.uniqueCountries === 1 ? 'country' : 'countries'}` : null}
            />
            <StatTile
              icon={<Clock size={14} />}
              label="Avg time"
              value={formatDuration(stats.avgDurationMs)}
              sub={stats.maxDurationMs > 0 ? `longest ${formatDuration(stats.maxDurationMs)}` : null}
            />
            <StatTile
              icon={<Globe size={14} />}
              label="Total time"
              value={formatDuration(stats.totalDurationMs)}
              sub={null}
            />
          </div>

          {/* Section heatmap — only renders when section-level dwell
              events are available. Until viewers scroll through a viewer
              instrumented with useSectionDwellTracking, sectionData will
              be null/empty and the heatmap stays hidden. */}
          {sectionData && sectionData.sections.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Heatmap by section
                </p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                  {sectionData.returnVisits > 0 && <>{sectionData.returnVisits} return visit{sectionData.returnVisits === 1 ? '' : 's'} · </>}
                  {sectionData.totalEvents} section view{sectionData.totalEvents === 1 ? '' : 's'}
                </p>
              </div>
              <AnalyticsHeatmap
                sections={sectionData.sections}
                totalUniqueSessions={sectionData.totalSessions}
              />
            </div>
          )}

          {/* Recent events */}
          <div>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.5rem' }}>
              Recent activity
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {events.map(ev => {
                const pages = ev.pagesViewed ? safeParseArr(ev.pagesViewed) : []
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto auto',
                      gap: '0.75rem',
                      alignItems: 'center',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.75rem',
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <span style={{ color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.viewerName ?? ev.viewerEmail ?? `Viewer ${ev.sessionId.slice(0, 6)}`}
                      {pages.length > 0 && (
                        <span style={{ color: 'var(--color-text-subtle)', fontWeight: 400, marginLeft: '0.375rem' }}>
                          · {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--color-text-subtle)' }}>
                      {ev.viewerCountry ?? '—'}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {ev.durationMs != null ? formatDuration(ev.durationMs) : '—'}
                    </span>
                    <span style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }} title={new Date(ev.startedAt).toLocaleString()}>
                      {formatRelative(ev.startedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.75rem', lineHeight: 1.5 }}>
            Privacy: IPs are hashed, never stored as plaintext. Country comes from Cloudflare. Viewer
            counts dedupe by browser session — same person on the same device counts once across visits.
          </p>
        </>
      )}
    </div>
  )
}

function safeParseArr(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

function StatTile({
  icon, label, value, sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub: string | null
}) {
  return (
    <div
      style={{
        padding: '0.625rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div className="flex items-center" style={{ gap: '0.375rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
        {icon}
        <span style={{ fontSize: '0.6875rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <div className="tabular-nums" style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
