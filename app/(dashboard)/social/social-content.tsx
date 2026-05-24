'use client'

/**
 * /social — high-level social page (Marketing nav group).
 *
 * Pulls from Buffer's GraphQL API. Surfaces:
 *   - Connected channel(s) — usually just Liam's personal LinkedIn
 *   - Posting cadence over the last 30 days (sparkline)
 *   - Scheduled queue (what's going out soon)
 *   - Recent sent posts (text + date + channel)
 *
 * Per-post engagement (likes/comments/shares) is NOT shown — Buffer's
 * API doesn't expose it even on Essentials. For deep analytics, the
 * page links out to publish.buffer.com.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Share2, RefreshCw, ExternalLink, Calendar, Sparkles } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'

interface BufferChannel {
  id: string
  name: string | null
  displayName: string | null
  service: string
  avatarUrl: string | null
  isQueuePaused: boolean
}

interface BufferPost {
  id: string
  channelId: string
  text: string
  status: string
  sentAt: string | null
  scheduledAt: string | null
  createdAt: string | null
}

interface BufferStatus {
  configured: boolean
  connected: boolean
  organizationId: string | null
  organizationName: string | null
  channels: BufferChannel[]
  errorMessage: string | null
}

interface BufferPostsPayload {
  posts: BufferPost[]
  channels: BufferChannel[]
  totals: { posts: number; byService: Record<string, number> }
  hasNextPage?: boolean
  endCursor?: string | null
}

export function SocialContent() {
  const [status, setStatus] = useState<BufferStatus | null>(null)
  const [sentPosts, setSentPosts] = useState<BufferPost[]>([])
  const [scheduledPosts, setScheduledPosts] = useState<BufferPost[]>([])
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoadingStatus(true)
    setError(null)
    try {
      const statusRes = await fetch(apiPath('/api/admin/integrations/buffer/status'))
      if (!statusRes.ok) throw new Error('Status fetch failed')
      const statusData = await statusRes.json() as BufferStatus
      setStatus(statusData)

      if (statusData.connected) {
        setLoadingPosts(true)
        const [sentRes, scheduledRes] = await Promise.all([
          fetch(apiPath('/api/admin/integrations/buffer/posts?status=sent&count=50')),
          fetch(apiPath('/api/admin/integrations/buffer/posts?status=scheduled&count=20')),
        ])
        if (sentRes.ok) {
          const data = await sentRes.json() as BufferPostsPayload
          setSentPosts(data.posts)
        }
        if (scheduledRes.ok) {
          const data = await scheduledRes.json() as BufferPostsPayload
          setScheduledPosts(data.posts)
        }
        setLoadingPosts(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // Build 30-day cadence histogram from sent posts.
  const cadence = useMemo(() => {
    const days: Array<{ date: string; label: string; count: number }> = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setUTCHours(0, 0, 0, 0)
      d.setUTCDate(d.getUTCDate() - i)
      const isoDate = d.toISOString().slice(0, 10)
      const label = i === 0
        ? 'Today'
        : i === 1
          ? 'Yesterday'
          : d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
      days.push({ date: isoDate, label, count: 0 })
    }
    for (const p of sentPosts) {
      if (!p.sentAt) continue
      const day = p.sentAt.slice(0, 10)
      const slot = days.find(d => d.date === day)
      if (slot) slot.count++
    }
    return days
  }, [sentPosts])

  const totalLast30 = cadence.reduce((s, d) => s + d.count, 0)
  const daysWithPost = cadence.filter(d => d.count > 0).length
  const maxCount = Math.max(1, ...cadence.map(d => d.count))

  const channelById = useMemo(() => {
    const m = new Map<string, BufferChannel>()
    for (const c of status?.channels ?? []) m.set(c.id, c)
    return m
  }, [status?.channels])

  return (
    <div style={{ padding: '1.5rem 0', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '72rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            margin: 0, fontSize: '1.5rem', fontWeight: 700,
            color: 'var(--color-text)', letterSpacing: '-0.015em',
            display: 'flex', alignItems: 'center', gap: '0.625rem',
          }}>
            <Share2 className="w-6 h-6" style={{ color: 'var(--color-brand)' }} />
            Social
          </h1>
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55, maxWidth: '38rem' }}>
            High-level view of Liam&apos;s personal social via Buffer. For per-post analytics + composing new posts, open Buffer directly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => { void fetchAll() }}
            disabled={loadingStatus || loadingPosts}
            iconLeft={loadingStatus || loadingPosts
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh
          </TahiButton>
          <a
            href="https://publish.buffer.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <TahiButton size="sm" iconLeft={<ExternalLink className="w-3.5 h-3.5" />}>
              Open Buffer
            </TahiButton>
          </a>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '0.625rem 0.875rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          color: 'var(--color-danger)',
        }}>{error}</div>
      )}

      {loadingStatus && <LoadingSkeleton rows={2} />}

      {!loadingStatus && status && !status.configured && (
        <div style={{
          padding: '0.875rem 1rem',
          background: 'var(--color-warning-bg)',
          border: '1px solid var(--color-warning)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          color: 'var(--color-text)',
        }}>
          Buffer not configured. Add BUFFER_API_KEY in Webflow Cloud env vars. Token comes from{' '}
          <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-brand)', textDecoration: 'underline' }}>
            publish.buffer.com/settings/api
          </a>.
        </div>
      )}

      {!loadingStatus && status && status.configured && !status.connected && (
        <div style={{
          padding: '0.875rem 1rem',
          background: 'var(--color-danger-bg)',
          border: '1px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          color: 'var(--color-text)',
        }}>
          {status.errorMessage ?? 'Buffer connected but no channels found.'}
        </div>
      )}

      {status?.connected && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: '0.75rem' }}>
            <KpiCard label="Channels" value={String(status.channels.length)} sub={status.organizationName ?? ''} />
            <KpiCard label="Posts last 30d" value={String(totalLast30)} sub={`${daysWithPost}/30 active days`} />
            <KpiCard label="Scheduled" value={String(scheduledPosts.length)} sub="in queue" />
            <KpiCard
              label="Cadence"
              value={daysWithPost > 0 ? `${(totalLast30 / 30).toFixed(1)}/day` : '0/day'}
              sub={daysWithPost >= 20 ? 'consistent' : daysWithPost >= 10 ? 'building' : 'getting started'}
            />
          </div>

          {/* Channels card */}
          <SectionCard title="Channels">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {status.channels.map(c => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.375rem 0.75rem',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '9999px',
                  }}
                >
                  <span style={{
                    fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                  }}>
                    {c.service}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                    {c.displayName ?? c.name ?? c.id.slice(0, 8)}
                  </span>
                  {c.isQueuePaused && <Badge tone="warning" variant="soft" size="sm">paused</Badge>}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 30-day cadence bar chart */}
          <SectionCard title="Posting cadence (last 30 days)">
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(30, 1fr)',
              gap: '0.1875rem',
              alignItems: 'end',
              height: '4rem',
            }}>
              {cadence.map(day => {
                const h = day.count === 0 ? 6 : Math.max(8, (day.count / maxCount) * 100)
                return (
                  <div
                    key={day.date}
                    title={`${day.label}: ${day.count} post${day.count === 1 ? '' : 's'}`}
                    style={{
                      height: `${h}%`,
                      background: day.count === 0 ? 'var(--color-border-subtle)' : 'var(--color-brand)',
                      borderRadius: '2px',
                      cursor: 'default',
                      transition: 'opacity 150ms ease',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0.75' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }}
                  />
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
              <span>30 days ago</span>
              <span>Today</span>
            </div>
          </SectionCard>

          {/* Scheduled queue */}
          {scheduledPosts.length > 0 && (
            <SectionCard
              title={`Scheduled queue (${scheduledPosts.length})`}
              icon={<Calendar size={14} style={{ color: 'var(--color-text-muted)' }} />}
            >
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {scheduledPosts.slice(0, 5).map(p => {
                  const ch = channelById.get(p.channelId)
                  return (
                    <PostRow
                      key={p.id}
                      service={ch?.service ?? 'unknown'}
                      channelLabel={ch?.displayName ?? ch?.name ?? p.channelId.slice(0, 8)}
                      timestamp={p.scheduledAt}
                      timestampPrefix="Scheduled "
                      text={p.text}
                    />
                  )
                })}
              </ul>
            </SectionCard>
          )}

          {/* Recent posts */}
          <SectionCard
            title={`Recent posts (${sentPosts.length})`}
            icon={<Sparkles size={14} style={{ color: 'var(--color-text-muted)' }} />}
          >
            {loadingPosts && <LoadingSkeleton rows={3} />}
            {!loadingPosts && sentPosts.length === 0 && (
              <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                No sent posts yet.
              </p>
            )}
            {!loadingPosts && sentPosts.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sentPosts.slice(0, 10).map(p => {
                  const ch = channelById.get(p.channelId)
                  return (
                    <PostRow
                      key={p.id}
                      service={ch?.service ?? 'unknown'}
                      channelLabel={ch?.displayName ?? ch?.name ?? p.channelId.slice(0, 8)}
                      timestamp={p.sentAt}
                      text={p.text}
                    />
                  )
                })}
              </ul>
            )}
            {sentPosts.length > 10 && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.6875rem', color: 'var(--color-text-subtle)', textAlign: 'center' }}>
                Showing 10 of {sentPosts.length}. Open Buffer for the full history.
              </p>
            )}
          </SectionCard>

          <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)', textAlign: 'center', fontStyle: 'italic' }}>
            Buffer&apos;s API doesn&apos;t expose per-post engagement (likes / comments / shares). For those metrics, open Buffer&apos;s in-app analytics.
          </p>
        </>
      )}
    </div>
  )
}

function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{
      padding: '1rem 1.125rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.4375rem', marginBottom: '0.75rem',
      }}>
        {icon}
        <h2 style={{
          margin: 0, fontSize: '0.875rem', fontWeight: 600,
          color: 'var(--color-text)',
        }}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      padding: '0.875rem 1rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
    }}>
      <p style={{
        margin: 0, fontSize: '0.625rem', color: 'var(--color-text-subtle)',
        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</p>
      <p style={{
        margin: '0.25rem 0 0', fontSize: '1.5rem', fontWeight: 700,
        color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>{value}</p>
      {sub && (
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{sub}</p>
      )}
    </div>
  )
}

function PostRow({
  service, channelLabel, timestamp, timestampPrefix = '', text,
}: {
  service: string
  channelLabel: string
  timestamp: string | null
  timestampPrefix?: string
  text: string
}) {
  return (
    <li style={{
      padding: '0.75rem 0.875rem',
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.375rem',
      }}>
        <span style={{
          fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {service} · {channelLabel}
        </span>
        {timestamp && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            {timestampPrefix}{new Date(timestamp).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      <p style={{
        margin: 0, fontSize: '0.8125rem', color: 'var(--color-text)',
        lineHeight: 1.55, whiteSpace: 'pre-wrap',
        display: '-webkit-box',
        WebkitLineClamp: 4,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{text}</p>
    </li>
  )
}
