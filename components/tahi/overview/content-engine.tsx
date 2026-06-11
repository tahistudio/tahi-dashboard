'use client'

// ─── Content Engine Deck (GROWTH zone, violet HERO tile) ─────────────────────
//
// Domain CONTENT (violet). This is one of the at-most-two tinted hero tiles per
// viewport (the other is Pipeline amber) - the DomainCard `heroTile` prop washes
// the card surface in the capped violet tint. Violet is the card identity only:
// the IconChip, the deck accent edges, the stage bar's in-flight segments, and
// the "ideas await" CountPill. Titles, scores, and the publish-cadence ramp stay
// off violet (the ramp is brand-green = the published/done signal).
//
// Composition:
//   - a CardDeck (8s autoplay, violet accent) of the FURTHEST-ALONG drafts:
//     title + cluster chip + content-score lozenge.
//   - a stage-segment progress bar (queued -> ready) whose segments grow their
//     width on reveal; `ready` paints success-green, `failed` danger-red, the
//     rest neutral / violet.
//   - an "N ideas await you" CountPill that breathes once on mount when N > 0.
//   - a footer reveal (DomainCard footer prop) with a 12-week publish-cadence
//     heatmap strip (brand-green ramp) + a next-slot countdown driven by the
//     page-shared 1s tick.
//
// Sources (read each route.ts for the exact shape):
//   GET /api/admin/content/drafts          -> { drafts[], counts:{queued,
//        researching,drafting,reviewing,finalising,ready,failed,total} }
//        draft fields used: id, status, title, contentScore, clusterName,
//        clusterSlug, ideaTitle.
//   GET /api/admin/content/ideas?status=all -> { ideas[], counts:{...,total} }
//        used: counts.total (the "ideas await you" count).
//   GET /api/admin/content/schedule        -> { readyDrafts[]:{autoSlot:
//        {scheduledFor}}, scheduledDrafts[], publishHistory[]:{publishedAt,
//        title, clusterSlug} }. used: publishHistory[].publishedAt (12-week
//        cadence), readyDrafts[].autoSlot.scheduledFor (next-slot countdown).
//
// Reduced-motion safe throughout: the stage bar grows via .tahi-segment-fill
// (motion-safe only) gated on useReveal (which returns inView immediately under
// reduced motion, so bars paint at final width); the ideas pulse + sparkline
// pulse are .tahi-pulse-once (one play, motion-safe only); the countdown is the
// page-shared tick (information, not decoration).

import { useEffect, useMemo, useState } from 'react'
import { PenTool } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { DomainCard, IconChip, CountPill } from '@/components/tahi/overview/domain-card'
import { CardDeck } from '@/components/tahi/card-deck'
import { CountUp } from '@/components/tahi/count-up'
import { useReveal, useSharedTick } from '@/lib/use-homepage-motion'

// ── Shapes (subsets of the three content routes) ─────────────────────────────

interface Draft {
  id: string
  status: string | null
  title: string | null
  contentScore: number | null
  clusterName: string | null
  clusterSlug: string | null
  ideaTitle: string | null
}

interface StageCounts {
  queued: number
  researching: number
  drafting: number
  reviewing: number
  finalising: number
  ready: number
  failed: number
  total: number
}

interface PublishHistoryRow {
  publishedAt: string
  title: string | null
  clusterSlug: string | null
}

interface ScheduleReadyDraft {
  id: string
  autoSlot: { scheduledFor: string | null } | null
}

const EMPTY_COUNTS: StageCounts = {
  queued: 0, researching: 0, drafting: 0, reviewing: 0,
  finalising: 0, ready: 0, failed: 0, total: 0,
}

// Stage order from earliest to furthest-along. The deck leads with the
// furthest-along drafts, so this also ranks which draft sits on top.
const STAGE_ORDER = ['queued', 'researching', 'drafting', 'reviewing', 'finalising', 'ready'] as const

function stageRank(status: string | null): number {
  const i = (STAGE_ORDER as readonly string[]).indexOf(status ?? '')
  return i === -1 ? -1 : i
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

const SHELL_HERO: React.CSSProperties = {
  background: 'var(--domain-content-tint)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function ContentEngine({ className }: { className?: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [counts, setCounts] = useState<StageCounts>(EMPTY_COUNTS)
  const [ideaCount, setIdeaCount] = useState(0)
  const [history, setHistory] = useState<PublishHistoryRow[]>([])
  const [nextSlotIso, setNextSlotIso] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const draftsP = fetch(apiPath('/api/admin/content/drafts'))
      .then(r => (r.ok ? (r.json() as Promise<{ drafts: Draft[]; counts: StageCounts }>) : { drafts: [], counts: EMPTY_COUNTS }))
      .catch(() => ({ drafts: [] as Draft[], counts: EMPTY_COUNTS }))

    const ideasP = fetch(apiPath('/api/admin/content/ideas?status=all'))
      .then(r => (r.ok ? (r.json() as Promise<{ counts: { total: number } }>) : { counts: { total: 0 } }))
      .catch(() => ({ counts: { total: 0 } }))

    const scheduleP = fetch(apiPath('/api/admin/content/schedule'))
      .then(r => (r.ok ? (r.json() as Promise<{ publishHistory: PublishHistoryRow[]; readyDrafts: ScheduleReadyDraft[] }>) : { publishHistory: [], readyDrafts: [] }))
      .catch(() => ({ publishHistory: [] as PublishHistoryRow[], readyDrafts: [] as ScheduleReadyDraft[] }))

    Promise.all([draftsP, ideasP, scheduleP])
      .then(([d, i, s]) => {
        if (cancelled) return
        setDrafts(d.drafts ?? [])
        setCounts(d.counts ?? EMPTY_COUNTS)
        setIdeaCount(i.counts?.total ?? 0)
        setHistory(s.publishHistory ?? [])
        // Earliest auto-slot among ready drafts = the next thing that goes out.
        const slots = (s.readyDrafts ?? [])
          .map(r => r.autoSlot?.scheduledFor ?? null)
          .filter((v): v is string => !!v && !Number.isNaN(Date.parse(v)))
          .sort((a, b) => Date.parse(a) - Date.parse(b))
        setNextSlotIso(slots[0] ?? null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Deck leads with the furthest-along drafts (finalising/ready first), capped
  // so the stack stays a peek-deck, not a backlog dump.
  const deckDrafts = useMemo(() => {
    return [...drafts]
      .sort((a, b) => stageRank(b.status) - stageRank(a.status) || (b.contentScore ?? 0) - (a.contentScore ?? 0))
      .slice(0, 6)
  }, [drafts])

  if (loading) {
    return (
      <section aria-label="Content engine" className={className} style={SHELL_HERO}>
        <Header />
        <div className="tahi-shimmer" style={{ height: '8.5rem', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '0.875rem', width: '70%' }} />
      </section>
    )
  }

  const inFlight = counts.total - counts.ready - counts.failed

  return (
    <DomainCard
      domain="content"
      title="Content engine"
      icon={<PenTool size={15} aria-hidden="true" />}
      heroTile
      viewHref="/content-studio"
      viewLabel="Studio"
      className={className}
      footer={<PublishFooter history={history} nextSlotIso={nextSlotIso} />}
    >
      {/* Header chips: ideas await + in-flight count */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <IdeasAwaitPill count={ideaCount} />
        <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
          {inFlight > 0 ? `${inFlight} in flight` : 'pipeline clear'}
        </span>
      </div>

      <CardDeck<Draft>
        items={deckDrafts}
        ariaLabel="Drafts furthest along the pipeline"
        minHeight="7rem"
        accentColor="var(--domain-content)"
        autoplayMs={8000}
        getKey={(d) => d.id}
        emptyState={
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            No drafts in the pipeline yet. Approved ideas turn into drafts and surface here as they move toward ready.
          </p>
        }
        renderCard={(draft) => <DraftCard draft={draft} />}
      />

      {/* Stage progress bar: where the whole pipeline sits right now. */}
      <StageBar counts={counts} />
    </DomainCard>
  )
}

// ── Ideas-await pill (one-shot pulse when N > 0) ──────────────────────────────

function IdeasAwaitPill({ count }: { count: number }) {
  if (count <= 0) {
    return <CountPill>No ideas waiting</CountPill>
  }
  return (
    <span className="flex items-center" style={{ gap: 'var(--space-1-5)' }}>
      <span
        aria-hidden="true"
        className="tahi-pulse-once"
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: 'var(--radius-full)',
          background: 'var(--domain-content)',
          flexShrink: 0,
        }}
      />
      <CountPill domain="content">
        <CountUp value={count} durationMs={650} format={n => String(Math.round(n))} />
        {' '}
        {count === 1 ? 'idea awaits you' : 'ideas await you'}
      </CountPill>
    </span>
  )
}

// ── A single draft card inside the deck ───────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  researching: 'Researching',
  drafting: 'Drafting',
  reviewing: 'Reviewing',
  finalising: 'Finalising',
  ready: 'Ready',
  ready_for_publish: 'Ready',
  failed: 'Failed',
}

function stageLabel(status: string | null): string {
  if (!status) return 'In pipeline'
  return STAGE_LABELS[status] ?? status.replace(/_/g, ' ')
}

function DraftCard({ draft }: { draft: Draft }) {
  const title = draft.title || draft.ideaTitle || 'Untitled draft'
  const score = draft.contentScore
  const isReady = draft.status === 'ready' || draft.status === 'ready_for_publish'
  const isFailed = draft.status === 'failed'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        minHeight: '7rem',
      }}
    >
      {/* Stage + score row */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)' }}>
        <span
          className="flex items-center"
          style={{
            gap: 'var(--space-1)',
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: isFailed ? 'var(--color-danger)' : isReady ? 'var(--color-success)' : 'var(--domain-content)',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '0.4375rem',
              height: '0.4375rem',
              borderRadius: 'var(--radius-full)',
              background: isFailed ? 'var(--color-danger)' : isReady ? 'var(--color-success)' : 'var(--domain-content)',
              flexShrink: 0,
            }}
          />
          {stageLabel(draft.status)}
        </span>
        {score != null && score > 0 && (
          <span
            className="flex items-baseline tabular-nums flex-shrink-0"
            style={{
              gap: '0.125rem',
              padding: '0.125rem 0.4375rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text)',
            }}
            aria-label={`Content score ${Math.round(score)} of 100`}
          >
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, lineHeight: 1 }}>{Math.round(score)}</span>
            <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, color: 'var(--color-text-subtle)' }}>/100</span>
          </span>
        )}
      </div>

      {/* Title */}
      <p
        data-private
        style={{
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          color: 'var(--color-text)',
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </p>

      {/* Cluster chip */}
      <div style={{ marginTop: 'auto' }}>
        {draft.clusterName ? (
          <span
            className="flex items-center truncate"
            style={{
              display: 'inline-flex',
              gap: 'var(--space-1)',
              padding: '0.0625rem 0.4375rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--domain-content-tint)',
              color: 'var(--domain-content)',
              fontSize: 'var(--text-2xs, 0.6875rem)',
              fontWeight: 600,
              maxWidth: '100%',
            }}
          >
            {draft.clusterName}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>No cluster</span>
        )}
      </div>
    </div>
  )
}

// ── Stage progress bar ────────────────────────────────────────────────────────
//
// One bar across the whole pipeline: each non-empty stage is a segment sized to
// its share of all drafts. In-flight stages wear neutral / violet, `ready` is
// success-green, `failed` is danger-red. Segments grow their width on reveal
// (.tahi-segment-fill); under reduced motion useReveal returns inView immediately
// so the bar paints at its final width.

interface StageDef {
  key: keyof StageCounts
  label: string
  colour: string
}

const STAGE_DEFS: StageDef[] = [
  { key: 'queued', label: 'Queued', colour: 'var(--color-border-strong)' },
  { key: 'researching', label: 'Researching', colour: 'color-mix(in oklab, var(--domain-content) 35%, var(--color-border-strong))' },
  { key: 'drafting', label: 'Drafting', colour: 'color-mix(in oklab, var(--domain-content) 60%, var(--color-bg))' },
  { key: 'reviewing', label: 'Reviewing', colour: 'color-mix(in oklab, var(--domain-content) 80%, var(--color-bg))' },
  { key: 'finalising', label: 'Finalising', colour: 'var(--domain-content)' },
  { key: 'ready', label: 'Ready', colour: 'var(--color-success)' },
  { key: 'failed', label: 'Failed', colour: 'var(--color-danger)' },
]

function StageBar({ counts }: { counts: StageCounts }) {
  const { ref, inView } = useReveal<HTMLDivElement>()
  const total = STAGE_DEFS.reduce((sum, d) => sum + (counts[d.key] || 0), 0)

  if (total <= 0) {
    return (
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-4)' }}>
        Stage breakdown shows once drafts are moving.
      </p>
    )
  }

  const segments = STAGE_DEFS
    .map(d => ({ ...d, value: counts[d.key] || 0 }))
    .filter(s => s.value > 0)

  return (
    <div ref={ref} style={{ marginTop: 'var(--space-4)' }}>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <span style={LABEL_STYLE}>Pipeline stages</span>
        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span style={{ fontWeight: 700, color: 'var(--color-success)' }}>{counts.ready}</span> ready
          {counts.failed > 0 && (
            <>
              <span style={{ color: 'var(--color-text-subtle)' }}> &middot; </span>
              <span style={{ fontWeight: 700, color: 'var(--color-danger)' }}>{counts.failed}</span> failed
            </>
          )}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          height: '0.5rem',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          background: 'var(--color-bg-tertiary)',
        }}
        role="img"
        aria-label={`${total} drafts across ${segments.length} stages, ${counts.ready} ready`}
      >
        {segments.map(s => (
          <div
            key={s.key}
            className="tahi-segment-fill"
            style={{
              width: `${inView ? (s.value / total) * 100 : 0}%`,
              height: '100%',
              background: s.colour,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Footer: 12-week publish cadence + next-slot countdown ─────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const HEATMAP_WEEKS = 12

function PublishFooter({ history, nextSlotIso }: { history: PublishHistoryRow[]; nextSlotIso: string | null }) {
  // Bucket published posts into the last 12 ISO-ish weeks (rolling, not calendar
  // ISO weeks - good enough for a cadence read). Index 0 = oldest, last = this
  // week. Only count rows already published (publishedAt <= now).
  const buckets = useMemo(() => {
    const now = Date.now()
    const arr = new Array<number>(HEATMAP_WEEKS).fill(0)
    for (const row of history) {
      const t = Date.parse(row.publishedAt)
      if (Number.isNaN(t) || t > now) continue
      const weeksAgo = Math.floor((now - t) / WEEK_MS)
      if (weeksAgo < 0 || weeksAgo >= HEATMAP_WEEKS) continue
      arr[HEATMAP_WEEKS - 1 - weeksAgo] += 1
    }
    return arr
  }, [history])

  const max = Math.max(1, ...buckets)
  const totalPublished = buckets.reduce((s, n) => s + n, 0)

  return (
    <div>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2-5)' }}>
        <span style={LABEL_STYLE}>12-week cadence</span>
        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{totalPublished}</span> published
        </span>
      </div>

      {/* Brand-green ramp heatmap strip: one cell per week, darker = more posts. */}
      <div
        className="flex items-end"
        style={{ gap: 'var(--space-1)' }}
        role="img"
        aria-label={`Publishing cadence over ${HEATMAP_WEEKS} weeks, ${totalPublished} posts total`}
      >
        {buckets.map((value, i) => {
          const ratio = value / max
          // Brand-green ramp: empty weeks read as a faint track; busier weeks
          // mix more brand green in. Cell height also ramps slightly for a
          // dual cadence read at a glance.
          const bg = value === 0
            ? 'var(--color-bg-tertiary)'
            : `color-mix(in oklab, var(--color-brand) ${Math.round(30 + ratio * 70)}%, var(--color-bg-tertiary))`
          return (
            <span
              key={i}
              title={`${value} post${value === 1 ? '' : 's'}`}
              style={{
                flex: 1,
                minWidth: '0.375rem',
                height: `${0.625 + ratio * 0.75}rem`,
                borderRadius: 'var(--radius-xs, 0.25rem)',
                background: bg,
              }}
            />
          )
        })}
      </div>

      {/* Next-slot countdown (page-shared 1s tick). */}
      <NextSlotCountdown nextSlotIso={nextSlotIso} />
    </div>
  )
}

function NextSlotCountdown({ nextSlotIso }: { nextSlotIso: string | null }) {
  // Subscribe to the page-wide 1s tick so the countdown ticks without spinning
  // up a per-card timer. The tick value is unused directly - it just forces a
  // re-render each visible second.
  useSharedTick(1000)

  if (!nextSlotIso) {
    return (
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-3)' }}>
        No publish slot queued. Ready drafts get an auto-slot here.
      </p>
    )
  }

  const target = Date.parse(nextSlotIso)
  if (Number.isNaN(target)) {
    return null
  }

  const remaining = target - Date.now()

  return (
    <p
      className="tabular-nums"
      style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}
    >
      {remaining <= 0 ? (
        <>Next slot <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>due now</span></>
      ) : (
        <>Next slot in <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{formatCountdown(remaining)}</span></>
      )}
    </p>
  )
}

// Human countdown: "2d 4h", "4h 12m", "12m 30s". Largest two units.
function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${seconds}s`
}

// ── Letterpress header (loading state) ────────────────────────────────────────

function Header() {
  return (
    <div className="flex items-center" style={{ gap: 'var(--space-2-5)', marginBottom: 'var(--space-5)' }}>
      <IconChip domain="content"><PenTool size={15} aria-hidden="true" /></IconChip>
      <h2 style={LABEL_STYLE}>Content engine</h2>
    </div>
  )
}
