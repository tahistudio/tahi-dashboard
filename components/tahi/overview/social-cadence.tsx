'use client'

// ─── Social Cadence (GROWTH zone, sky) ───────────────────────────────────────
//
// Domain SOCIAL (sky). NOT a hero tile - a plain white card whose only colour is
// the sky identity (IconChip + sparkline stroke/fill + the streak CountPill).
//
// CADENCE + QUEUE ONLY. Buffer's GraphQL API exposes NO reach / likes / comments
// / impressions (those live in their separate Analyze product), so this card
// shows only "is Liam posting, and is there runway in the queue" - never a
// performance metric. See lib/buffer.ts.
//
// Composition:
//   - a 30-day posting-cadence bar Sparkline (domain social) of posts-per-day,
//     with the most-recent day's marker pulsing ONCE on mount.
//   - a posting-streak CountPill (consecutive days with a post), count-up.
//   - a queue-depth chip that turns warning-amber when the scheduled queue < 3.
//   - the connected channels as a small people-stack of service avatars.
//   - a footer reveal: a 7-day scheduled-posts dot matrix (hollow dots = empty
//     days), so you can see the runway shape at a glance.
//
// Sources (read each route.ts for the exact shape):
//   GET /api/admin/integrations/buffer/status            -> { channels[]:
//        {id,name,displayName,service,avatarUrl,isQueuePaused}, connected,
//        configured }
//   GET /api/admin/integrations/buffer/posts?status=sent  -> { posts[]:
//        {id,channelId,text,status,sentAt,scheduledAt,createdAt} }
//        used: sentAt (30-day cadence + streak).
//   GET /api/admin/integrations/buffer/posts?status=scheduled -> same shape;
//        used: scheduledAt (queue depth + 7-day dot matrix).
//
// Reduced-motion safe: the sparkline paints at final state under reduced motion
// (Sparkline uses useReveal); the most-recent-day pulse + streak count-up are
// one-shot / motion-safe only; the dot matrix is static.

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Megaphone } from 'lucide-react'
import { DomainCard, IconChip, CountPill, Sparkline } from '@/components/tahi/overview/domain-card'
import { CountUp } from '@/components/tahi/count-up'

// ── Shapes (subsets of the Buffer routes) ────────────────────────────────────

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

const CADENCE_DAYS = 30
const QUEUE_LOW_THRESHOLD = 3
const MATRIX_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

const SHELL: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
}

// Start of local day for an ISO timestamp, as ms. Empty / unparseable => null.
function dayStartMs(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function todayStartMs(): number {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function SocialCadence({ className }: { className?: string }) {
  const { data: statusData, isLoading: statusLoading } = useSWR<{ channels: BufferChannel[]; configured: boolean }>('/api/admin/integrations/buffer/status')
  const { data: sentData, isLoading: sentLoading } = useSWR<{ posts: BufferPost[] }>('/api/admin/integrations/buffer/posts?status=sent&count=100')
  const { data: scheduledData, isLoading: scheduledLoading } = useSWR<{ posts: BufferPost[] }>('/api/admin/integrations/buffer/posts?status=scheduled&count=100')
  const loading = statusLoading || sentLoading || scheduledLoading
  const channels = statusData?.channels ?? []
  const configured = statusData?.configured ?? true
  const sentPosts = sentData?.posts ?? []
  const scheduledPosts = scheduledData?.posts ?? []

  // 30-day cadence: posts-per-day buckets (index 0 = 29 days ago, last = today).
  const cadence = useMemo(() => {
    const today = todayStartMs()
    const buckets = new Array<number>(CADENCE_DAYS).fill(0)
    for (const p of sentPosts) {
      const day = dayStartMs(p.sentAt ?? p.createdAt)
      if (day === null) continue
      const daysAgo = Math.round((today - day) / DAY_MS)
      if (daysAgo < 0 || daysAgo >= CADENCE_DAYS) continue
      buckets[CADENCE_DAYS - 1 - daysAgo] += 1
    }
    return buckets
  }, [sentPosts])

  // Posting streak: consecutive days ending today (or yesterday) that have >= 1
  // sent post. A gap before today breaks the streak.
  const streak = useMemo(() => {
    const today = todayStartMs()
    const postedDays = new Set<number>()
    for (const p of sentPosts) {
      const day = dayStartMs(p.sentAt ?? p.createdAt)
      if (day !== null) postedDays.add(day)
    }
    // Allow the streak to anchor on today OR yesterday (Liam may not have posted
    // yet today without breaking a run).
    let cursor = postedDays.has(today) ? today : today - DAY_MS
    if (!postedDays.has(cursor)) return 0
    let count = 0
    while (postedDays.has(cursor)) {
      count += 1
      cursor -= DAY_MS
    }
    return count
  }, [sentPosts])

  // Queue depth: scheduled posts dated today or later.
  const queueDepth = useMemo(() => {
    const today = todayStartMs()
    return scheduledPosts.filter(p => {
      const day = dayStartMs(p.scheduledAt)
      return day !== null && day >= today
    }).length
  }, [scheduledPosts])

  if (loading) {
    return (
      <section aria-label="Social cadence" className={className} style={SHELL}>
        <Header />
        <div className="tahi-shimmer" style={{ height: '3rem', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '1.25rem', width: '60%' }} />
      </section>
    )
  }

  // Not connected: calm connect prompt (no alarm), still using the shell.
  if (!configured || channels.length === 0) {
    return (
      <DomainCard
        domain="social"
        title="Social cadence"
        icon={<Megaphone size={15} aria-hidden="true" />}
        viewHref="/settings"
        viewLabel="Connect"
        className={className}
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          Connect Buffer to track your posting cadence and queue runway. Reach and engagement live in Buffer Analyze, not here.
        </p>
      </DomainCard>
    )
  }

  const queueLow = queueDepth < QUEUE_LOW_THRESHOLD

  return (
    <DomainCard
      domain="social"
      title="Social cadence"
      icon={<Megaphone size={15} aria-hidden="true" />}
      viewHref="/social"
      className={className}
      footer={<QueueMatrix scheduledPosts={scheduledPosts} />}
    >
      {/* Top row: streak pill + queue-depth chip + channel people-stack */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <CountPill domain="social">
            <CountUp value={streak} durationMs={650} format={n => String(Math.round(n))} />
            {' '}
            day streak
          </CountPill>
          <QueueChip depth={queueDepth} low={queueLow} />
        </div>
        <ChannelStack channels={channels} />
      </div>

      {/* 30-day cadence bars + most-recent-day pulse marker */}
      <CadenceStrip cadence={cadence} />
    </DomainCard>
  )
}

// ── Queue-depth chip (warning-amber when < 3) ─────────────────────────────────

function QueueChip({ depth, low }: { depth: number; low: boolean }) {
  return (
    <span
      className="flex items-center tabular-nums"
      style={{
        display: 'inline-flex',
        gap: 'var(--space-1)',
        padding: '0.0625rem 0.4375rem',
        borderRadius: 'var(--radius-full)',
        background: low
          ? 'color-mix(in oklab, var(--color-warning) 16%, var(--color-bg))'
          : 'var(--color-bg-secondary)',
        color: low
          ? 'var(--color-due-soon-text)'
          : 'var(--color-text-muted)',
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
      aria-label={`${depth} posts queued${low ? ', queue running low' : ''}`}
    >
      {low && (
        <span
          aria-hidden="true"
          className="tahi-warn-dot"
          style={{
            width: '0.375rem',
            height: '0.375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-warning)',
            flexShrink: 0,
          }}
        />
      )}
      {depth} queued
    </span>
  )
}

// ── Channel people-stack ──────────────────────────────────────────────────────
//
// A small overlapping stack of the connected service avatars. No names shown
// (data-private on the title attr only); reads as "which channels are live".

const SERVICE_LABELS: Record<string, string> = {
  twitter: 'X / Twitter',
  x: 'X',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  mastodon: 'Mastodon',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
}

function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service.charAt(0).toUpperCase() + service.slice(1)
}

function ChannelStack({ channels }: { channels: BufferChannel[] }) {
  const MAX = 4
  const shown = channels.slice(0, MAX)
  const overflow = channels.length - shown.length

  return (
    <div className="flex items-center" aria-label={`${channels.length} connected channels`}>
      {shown.map((c, i) => (
        <ChannelAvatar key={c.id} channel={c} offset={i > 0} />
      ))}
      {overflow > 0 && (
        <span
          aria-hidden="true"
          className="flex items-center justify-center tabular-nums"
          style={{
            width: '1.625rem',
            height: '1.625rem',
            marginLeft: '-0.5rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            boxShadow: '0 0 0 2px var(--color-bg), inset 0 0 0 1px var(--color-border-strong)',
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

function ChannelAvatar({ channel, offset }: { channel: BufferChannel; offset: boolean }) {
  const label = serviceLabel(channel.service)
  const fallbackInitial = (channel.service || '?').charAt(0).toUpperCase()
  // The avatar URL is a remote CDN photo (LinkedIn, etc.) that can 404 or expire.
  // Render the service initial underneath and overlay the image; if it fails to
  // load, hide it so the initial shows instead of a broken-image glyph.
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = Boolean(channel.avatarUrl) && !imgFailed

  return (
    <span
      title={label}
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: '1.625rem',
        height: '1.625rem',
        marginLeft: offset ? '-0.5rem' : 0,
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        background: 'var(--domain-social-tint)',
        color: 'var(--domain-social)',
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 700,
        boxShadow: '0 0 0 2px var(--color-bg)',
        position: 'relative',
      }}
    >
      <span aria-hidden="true">{fallbackInitial}</span>
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={channel.avatarUrl as string}
          alt=""
          onError={() => setImgFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </span>
  )
}

// ── 30-day cadence strip ──────────────────────────────────────────────────────
//
// A per-day bar Sparkline (domain social) plus a small ink marker on the most
// recent day that pulses once on mount. Below it, a quiet caption of the window.

function CadenceStrip({ cadence }: { cadence: number[] }) {
  const total = cadence.reduce((s, n) => s + n, 0)
  const lastDayValue = cadence[cadence.length - 1] ?? 0

  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <span style={LABEL_STYLE}>30-day cadence</span>
        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{total}</span> posts
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <Sparkline data={cadence} domain="social" height={44} />
        {/* Most-recent-day marker: pulses once on mount (steady after). Sits at
            the right edge where "today" lives in the sparkline. */}
        <span
          aria-hidden="true"
          className="tahi-pulse-once"
          style={{
            position: 'absolute',
            right: 0,
            bottom: lastDayValue > 0 ? '40%' : '2px',
            width: '0.4375rem',
            height: '0.4375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--domain-social)',
            boxShadow: '0 0 0 2px var(--color-bg)',
          }}
        />
      </div>
    </div>
  )
}

// ── Footer: 7-day scheduled-posts dot matrix ──────────────────────────────────
//
// One filled dot per scheduled post over the next 7 days, grouped by day.
// Hollow dots mark empty days so a thin queue reads as a row of empties.

function QueueMatrix({ scheduledPosts }: { scheduledPosts: BufferPost[] }) {
  // Count scheduled posts per upcoming day (index 0 = today ... 6 = +6 days).
  const perDay = useMemo(() => {
    const today = todayStartMs()
    const arr = new Array<number>(MATRIX_DAYS).fill(0)
    for (const p of scheduledPosts) {
      const day = dayStartMs(p.scheduledAt)
      if (day === null) continue
      const offset = Math.round((day - today) / DAY_MS)
      if (offset < 0 || offset >= MATRIX_DAYS) continue
      arr[offset] += 1
    }
    return arr
  }, [scheduledPosts])

  const dayLabels = useMemo(() => {
    const today = todayStartMs()
    const fmt = new Intl.DateTimeFormat('en-NZ', { weekday: 'short' })
    return Array.from({ length: MATRIX_DAYS }, (_, i) => fmt.format(new Date(today + i * DAY_MS)))
  }, [])

  const maxDots = Math.max(1, ...perDay)
  const totalQueued = perDay.reduce((s, n) => s + n, 0)

  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2-5)' }}>
        <span style={LABEL_STYLE}>Next 7 days</span>
        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{totalQueued}</span> scheduled
        </span>
      </div>

      <div
        className="flex items-end justify-between"
        style={{ gap: 'var(--space-2)' }}
        role="img"
        aria-label={`${totalQueued} posts scheduled across the next 7 days`}
      >
        {perDay.map((count, i) => (
          <div key={i} className="flex flex-col items-center" style={{ gap: 'var(--space-1-5)', flex: 1, minWidth: 0 }}>
            {/* Dots: one per post; if empty, a single hollow placeholder dot. */}
            <div className="flex flex-col-reverse items-center" style={{ gap: '0.1875rem', minHeight: `${maxDots * 0.5}rem`, justifyContent: 'flex-start' }}>
              {count === 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.375rem',
                    height: '0.375rem',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--color-border-strong)',
                    background: 'transparent',
                  }}
                />
              ) : (
                Array.from({ length: count }, (_, d) => (
                  <span
                    key={d}
                    aria-hidden="true"
                    style={{
                      width: '0.375rem',
                      height: '0.375rem',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--domain-social)',
                    }}
                  />
                ))
              )}
            </div>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 600, color: 'var(--color-text-subtle)', letterSpacing: '0.02em' }}>
              {dayLabels[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Letterpress header (loading state) ────────────────────────────────────────

function Header() {
  return (
    <div className="flex items-center" style={{ gap: 'var(--space-2-5)', marginBottom: 'var(--space-5)' }}>
      <IconChip domain="social"><Megaphone size={15} aria-hidden="true" /></IconChip>
      <h2 style={LABEL_STYLE}>Social cadence</h2>
    </div>
  )
}
