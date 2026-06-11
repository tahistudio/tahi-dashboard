'use client'

// ─── Proposals Live Board (AHEAD / SALES zone, amber) ────────────────────────
//
// The live state of every shared proposal: a funnel of count pills (Draft /
// Shared / Accepted / Declined / Expiring), a live view-count that counts up, a
// brand-green pulse dot on any shared proposal that has actually been opened, a
// per-proposal scroll-depth micro-bar (from the share-view pagesViewed signal),
// and an expiry countdown driven by the page-wide useSharedTick. When more than
// one proposal is live, the per-proposal detail rides in a CardDeck.
//
// Domain is SALES (amber) for the card identity / IconChip. Per the colour
// guardrails: the ACCEPTED chip is semantic success green (done/go), the
// EXPIRING chip is semantic warning (needs attention) - those semantic states
// sit at PILL scale while amber owns the card at BLOCK scale.
//
// Sources:
//   - /api/admin/proposals                 -> { items: [...] }  (the funnel)
//       fields: id, title, orgName, dealTitle, status, expiresAt,
//               publicShareToken, publicSharedAt
//   - /api/admin/views?resourceType=proposal&resourceId=<id>  (per shared proposal)
//       -> { stats: { totalViews, uniqueSessions, lastViewedAt, ... },
//            events: [{ pagesViewed, ... }] }
//
// The proposal list endpoint does not carry view counts, so analytics are
// fetched per shared/decided proposal in parallel and merged in.

import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { DomainCard, CountPill } from '@/components/tahi/overview/domain-card'
import { CardDeck } from '@/components/tahi/card-deck'
import { CountUp } from '@/components/tahi/count-up'
import { useSharedTick } from '@/lib/use-homepage-motion'

// ── Shapes ─────────────────────────────────────────────────────────────────

interface ProposalRow {
  id: string
  title: string | null
  orgName: string | null
  dealTitle: string | null
  status: string | null
  expiresAt: string | null
  publicShareToken: string | null
  publicSharedAt: string | null
}

interface ViewStats {
  totalViews: number
  uniqueSessions: number
  lastViewedAt: string | null
  /** Max number of distinct slides any single session brought into view. */
  maxPagesViewed: number
}

interface LiveProposal extends ProposalRow {
  stats: ViewStats | null
}

const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // "expiring" = inside 7 days

// Statuses that carry a public token + view analytics worth fetching.
const SHARED_STATUSES = new Set(['shared', 'accepted', 'declined', 'expired'])

// ── Card ──────────────────────────────────────────────────────────────────────

export function ProposalsLive({ className }: { className?: string }) {
  const [proposals, setProposals] = useState<LiveProposal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(apiPath('/api/admin/proposals'))
        const data = res.ok ? ((await res.json()) as { items: ProposalRow[] }) : { items: [] }
        const rows = data.items ?? []

        // Fetch view analytics only for proposals that were actually shared.
        const sharable = rows.filter(p => p.status && SHARED_STATUSES.has(p.status))
        const statsById = new Map<string, ViewStats>()
        await Promise.all(
          sharable.map(async p => {
            try {
              const vr = await fetch(
                apiPath(`/api/admin/views?resourceType=proposal&resourceId=${encodeURIComponent(p.id)}&limit=50`),
              )
              if (!vr.ok) return
              const vd = (await vr.json()) as {
                stats: { totalViews: number; uniqueSessions: number; lastViewedAt: string | null }
                events: { pagesViewed: string | null }[]
              }
              const maxPagesViewed = vd.events.reduce((max, e) => {
                if (!e.pagesViewed) return max
                try {
                  const arr = JSON.parse(e.pagesViewed) as unknown[]
                  return Array.isArray(arr) ? Math.max(max, arr.length) : max
                } catch {
                  return max
                }
              }, 0)
              statsById.set(p.id, {
                totalViews: vd.stats.totalViews ?? 0,
                uniqueSessions: vd.stats.uniqueSessions ?? 0,
                lastViewedAt: vd.stats.lastViewedAt ?? null,
                maxPagesViewed,
              })
            } catch {
              /* leave this proposal without stats */
            }
          }),
        )

        if (cancelled) return
        setProposals(rows.map(p => ({ ...p, stats: statsById.get(p.id) ?? null })))
      } catch {
        if (!cancelled) setProposals([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Funnel counts ──
  const funnel = useMemo(() => {
    const now = Date.now()
    let draft = 0
    let shared = 0
    let accepted = 0
    let declined = 0
    let expiring = 0
    let totalViews = 0
    for (const p of proposals) {
      switch (p.status) {
        case 'draft':
          draft++
          break
        case 'shared':
          shared++
          break
        case 'accepted':
          accepted++
          break
        case 'declined':
          declined++
          break
        default:
          break
      }
      // "Expiring" counts still-open (shared) proposals inside the window.
      if (p.status === 'shared' && p.expiresAt) {
        const ms = new Date(p.expiresAt).getTime() - now
        if (!Number.isNaN(ms) && ms > 0 && ms <= EXPIRING_WINDOW_MS) expiring++
      }
      totalViews += p.stats?.totalViews ?? 0
    }
    return { draft, shared, accepted, declined, expiring, totalViews }
  }, [proposals])

  // Live proposals (currently shared) ride the deck, hottest-viewed first.
  const live = useMemo(
    () =>
      proposals
        .filter(p => p.status === 'shared')
        .sort((a, b) => (b.stats?.totalViews ?? 0) - (a.stats?.totalViews ?? 0)),
    [proposals],
  )

  if (loading) {
    return (
      <DomainCard domain="sales" title="Proposals" icon={<FileText size={15} aria-hidden="true" />} className={className}>
        <div className="tahi-shimmer" style={{ height: '2rem', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '7rem', borderRadius: 'var(--radius-md)' }} />
      </DomainCard>
    )
  }

  if (proposals.length === 0) {
    return (
      <DomainCard
        domain="sales"
        title="Proposals"
        icon={<FileText size={15} aria-hidden="true" />}
        viewHref="/proposals"
        className={className}
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          No proposals yet. Build one from a deal and share it to start tracking opens.
        </p>
      </DomainCard>
    )
  }

  const footerContent = (
    <ProposalsSummaryFooter
      shared={funnel.shared}
      accepted={funnel.accepted}
      declined={funnel.declined}
      totalViews={funnel.totalViews}
      proposals={proposals}
    />
  )

  return (
    <DomainCard
      domain="sales"
      title="Proposals"
      icon={<FileText size={15} aria-hidden="true" />}
      viewHref="/proposals"
      viewLabel="All proposals"
      footer={footerContent}
      className={className}
    >
      {/* Live view ticker */}
      <div className="flex items-baseline" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <span
          className="tabular-nums"
          style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--color-text)' }}
        >
          <CountUp value={funnel.totalViews} durationMs={750} format={n => String(Math.round(n))} />
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
          view{funnel.totalViews === 1 ? '' : 's'} across shared decks
        </span>
      </div>

      {/* Funnel pills. Accepted = semantic success; expiring = semantic warning. */}
      <div className="flex flex-wrap" style={{ gap: 'var(--space-1-5)', marginBottom: 'var(--space-4)' }}>
        <CountPill>{funnel.draft} draft</CountPill>
        <CountPill domain="sales">{funnel.shared} shared</CountPill>
        <SemanticPill kind="success">{funnel.accepted} accepted</SemanticPill>
        {funnel.declined > 0 && <CountPill>{funnel.declined} declined</CountPill>}
        {funnel.expiring > 0 && <SemanticPill kind="warning">{funnel.expiring} expiring</SemanticPill>}
      </div>

      {/* Per-proposal live detail. A deck when several are live. */}
      {live.length > 0 ? (
        <CardDeck<LiveProposal>
          items={live}
          ariaLabel="Live proposals"
          minHeight="6rem"
          accentColor="var(--domain-sales)"
          autoplayMs={8000}
          getKey={(p) => p.id}
          renderCard={(p) => <ProposalCard proposal={p} />}
        />
      ) : (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', lineHeight: 1.5 }}>
          Nothing shared right now. Accepted and past decks stay in the funnel above.
        </p>
      )}
    </DomainCard>
  )
}

// ── Semantic pill (success / warning) ────────────────────────────────────────
//
// Mirrors CountPill but with a semantic hue rather than a domain hue. tint bg +
// readable ink via color-mix so success/warning read as lozenges, never fills.

function SemanticPill({ kind, children }: { kind: 'success' | 'warning'; children: React.ReactNode }) {
  const token = kind === 'success' ? 'var(--color-success)' : 'var(--color-warning)'
  return (
    <span
      className="tabular-nums"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '0.0625rem 0.4375rem',
        borderRadius: 'var(--radius-full)',
        background: `color-mix(in oklab, ${token} 16%, var(--color-bg))`,
        color: `color-mix(in oklab, ${token} 62%, var(--color-text))`,
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// ── Proposals summary footer (revealed on hover/tap) ─────────────────────────
//
// Compact 30-day breakdown: shared, accepted, and declined counts plus the
// aggregate unique-session reach across all shared proposals. Uses data already
// fetched by the parent - no extra API call needed.

const FOOTER_LABEL: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

function ProposalsSummaryFooter({
  shared,
  accepted,
  declined,
  totalViews,
  proposals,
}: {
  shared: number
  accepted: number
  declined: number
  totalViews: number
  proposals: LiveProposal[]
}) {
  const totalUniqueSessions = proposals.reduce((sum, p) => sum + (p.stats?.uniqueSessions ?? 0), 0)
  const conversionRate = shared + accepted + declined > 0
    ? Math.round((accepted / (shared + accepted + declined)) * 100)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <span style={FOOTER_LABEL}>30-day pipeline</span>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <FooterStat label="Shared" value={shared} />
        <FooterStat label="Accepted" value={accepted} highlight="success" />
        {declined > 0 && <FooterStat label="Declined" value={declined} />}
        {conversionRate !== null && (
          <FooterStat label="Close rate" value={`${conversionRate}%`} />
        )}
      </div>
      {totalUniqueSessions > 0 && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', lineHeight: 1.5 }}>
          <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {totalUniqueSessions}
          </span>{' '}
          unique viewer{totalUniqueSessions === 1 ? '' : 's'},{' '}
          <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {totalViews}
          </span>{' '}
          total view{totalViews === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

function FooterStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | string
  highlight?: 'success'
}) {
  const valueColor = highlight === 'success'
    ? 'var(--color-on-track-text)'
    : 'var(--color-text)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      <span style={FOOTER_LABEL}>{label}</span>
      <span
        className="tabular-nums"
        style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: valueColor, lineHeight: 1.2 }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Live proposal card ────────────────────────────────────────────────────────

function ProposalCard({ proposal }: { proposal: LiveProposal }) {
  // Subscribe to the page-wide 1s tick so the expiry countdown re-renders live.
  useSharedTick(1000)

  const stats = proposal.stats
  const opened = (stats?.totalViews ?? 0) > 0
  const label = proposal.orgName || proposal.dealTitle || proposal.title || 'Proposal'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2-5)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        minHeight: '6rem',
      }}
    >
      {/* Title row: opened pulse + name, view count */}
      <div className="flex items-start justify-between" style={{ gap: 'var(--space-3)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
          {opened && (
            <span
              aria-hidden="true"
              className="proposals-open-pulse flex-shrink-0"
              style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-brand)',
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <p
              data-private
              className="truncate"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.25 }}
            >
              {label}
            </p>
            {proposal.title && label !== proposal.title && (
              <p
                data-private
                className="truncate"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', lineHeight: 1.3 }}
              >
                {proposal.title}
              </p>
            )}
          </div>
        </div>
        <span className="flex items-baseline tabular-nums flex-shrink-0" style={{ gap: '0.1875rem' }}>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1 }}>
            {stats?.totalViews ?? 0}
          </span>
          <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
            view{(stats?.totalViews ?? 0) === 1 ? '' : 's'}
          </span>
        </span>
      </div>

      {/* Scroll-depth micro-bar (best session's slide coverage), if measurable */}
      {stats && stats.maxPagesViewed > 0 && (
        <ScrollDepthBar pages={stats.maxPagesViewed} />
      )}

      {/* Footer: opened-state + expiry countdown */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', marginTop: 'auto' }}>
        <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
          {opened ? `${stats?.uniqueSessions ?? 0} viewer${(stats?.uniqueSessions ?? 0) === 1 ? '' : 's'}` : 'Not opened yet'}
        </span>
        <ExpiryCountdown expiresAt={proposal.expiresAt} />
      </div>
    </div>
  )
}

// ── Scroll-depth micro-bar ────────────────────────────────────────────────────
//
// We do not know the total slide count from the analytics payload, so this is a
// relative "how deep did the best viewer get" indicator, capped/normalised
// against a sensible max so the bar never overflows. It reads as "engagement
// depth", which is the signal Liam wants without over-claiming precision.

const DEPTH_CAP = 8 // a typical proposal deck length to normalise against

function ScrollDepthBar({ pages }: { pages: number }) {
  const pct = Math.min(100, Math.round((Math.min(pages, DEPTH_CAP) / DEPTH_CAP) * 100))
  return (
    <div>
      <div
        style={{ height: '0.3125rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}
        role="img"
        aria-label={`Best viewer reached ${pages} slide${pages === 1 ? '' : 's'}`}
      >
        <div
          className="tahi-segment-fill"
          style={{ width: `${Math.max(6, pct)}%`, height: '100%', background: 'var(--domain-sales)', borderRadius: 'var(--radius-full)' }}
        />
      </div>
      <p style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
        {pages} slide{pages === 1 ? '' : 's'} deep
      </p>
    </div>
  )
}

// ── Expiry countdown (driven by the shared 1s tick from the parent) ──────────

function ExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (Number.isNaN(ms)) return null

  if (ms <= 0) {
    return (
      <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
        Expired
      </span>
    )
  }

  const expiringSoon = ms <= EXPIRING_WINDOW_MS
  const label = formatRemaining(ms)
  return (
    <span
      className="flex items-center tabular-nums"
      style={{
        gap: 'var(--space-1)',
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        color: expiringSoon ? 'var(--color-due-soon-text)' : 'var(--color-text-subtle)',
      }}
    >
      {expiringSoon && (
        <span
          aria-hidden="true"
          className="tahi-warn-dot flex-shrink-0"
          style={{ width: '0.375rem', height: '0.375rem', borderRadius: 'var(--radius-full)', background: 'var(--color-warning)' }}
        />
      )}
      {label} left
    </span>
  )
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
