'use client'

// ─── Hot Leads Deck (AHEAD / SALES zone, amber) ──────────────────────────────
//
// AI-scored unworked leads, swipeable as a CardDeck (Liam's Crextio peek-stack).
// Domain is SALES (amber): the card identity, IconChip, and CountPill all wear
// var(--domain-sales). The per-lead SCORE chip is deliberately NOT amber - its
// colour is SEMANTIC by band (>=80 success, 60-79 brand, 40-59 warning, <40
// subtle) so the amber card identity and the warning-amber score band never
// share a scale (the spec's "sales amber at block scale, warning amber at pill
// scale, never both in one card" guardrail — here resolved by keeping amber off
// the score entirely).
//
// Dynamics (resting-budget-safe): the score chips count up ONCE on mount; a soft
// pulse dot sits on any 80+ lead still "new"; the card header shows a count-up of
// new-this-week. At rest nothing moves (the pulse is the single ambient loop this
// card owns, and it is reduced-motion-gated by CSS).
//
// Source: /api/admin/leads?status=new  (route returns { leads: [...] }).
// Fields used: id, name, company, source, estimatedValue, currency, aiScore,
// aiScoreReason, createdAt, status.

import { useEffect, useMemo, useState } from 'react'
import { Flame } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { DomainCard, CountPill } from '@/components/tahi/overview/domain-card'
import { CardDeck } from '@/components/tahi/card-deck'
import { CountUp } from '@/components/tahi/count-up'

// ── Lead shape (subset of /api/admin/leads rows) ─────────────────────────────

interface Lead {
  id: string
  name: string | null
  company: string | null
  source: string | null
  estimatedValue: number | null
  currency: string | null
  aiScore: number | null
  aiScoreReason: string | null
  status: string | null
  createdAt: string | null
}

// ── Semantic score bands (NOT domain amber) ──────────────────────────────────
//
// CSS var references only. Each band is a tint background + a readable ink so a
// score chip reads as a lozenge, never a flat fill. color-mix darkens the
// semantic hue toward ink for AA-safe text on its own tint (the success +
// warning tokens are bright indicator hues, too light to use as text raw).

interface ScoreBand {
  bg: string
  ink: string
  label: string
}

function scoreBand(score: number): ScoreBand {
  if (score >= 80) {
    return {
      bg: 'color-mix(in oklab, var(--color-success) 16%, var(--color-bg))',
      ink: 'var(--color-on-track-text)',
      label: 'hot',
    }
  }
  if (score >= 60) {
    return {
      bg: 'var(--color-brand-50)',
      ink: 'var(--color-brand-dark)',
      label: 'warm',
    }
  }
  if (score >= 40) {
    return {
      bg: 'color-mix(in oklab, var(--color-warning) 16%, var(--color-bg))',
      ink: 'var(--color-due-soon-text)',
      label: 'cool',
    }
  }
  return {
    bg: 'var(--color-bg-secondary)',
    ink: 'var(--color-text-subtle)',
    label: 'cold',
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, company: string | null): string {
  const source = (name || company || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const SOURCE_LABELS: Record<string, string> = {
  webflow: 'Webflow',
  website: 'Website',
  email: 'Email',
  referral: 'Referral',
  affiliate: 'Affiliate',
  event: 'Event',
  cold_outreach: 'Cold outreach',
  manual: 'Manual',
  other: 'Other',
}

function sourceLabel(source: string | null): string {
  if (!source) return 'Lead'
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ')
}

function isThisWeek(iso: string | null): boolean {
  if (!iso) return false
  const created = new Date(iso).getTime()
  if (Number.isNaN(created)) return false
  return Date.now() - created <= 7 * 24 * 60 * 60 * 1000
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function HotLeads({ className }: { className?: string }) {
  const { formatNative } = useDisplayCurrency()

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(apiPath('/api/admin/leads?status=new'))
      .then(r => (r.ok ? (r.json() as Promise<{ leads: Lead[] }>) : { leads: [] }))
      .then(data => {
        if (cancelled) return
        const rows = data.leads ?? []
        // Highest AI score first so the swipeable stack leads with the hottest.
        rows.sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0))
        setLeads(rows)
      })
      .catch(() => {
        if (!cancelled) setLeads([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const newThisWeek = useMemo(() => leads.filter(l => isThisWeek(l.createdAt)).length, [leads])

  if (loading) {
    return (
      <DomainCard domain="sales" title="Hot leads" icon={<Flame size={15} aria-hidden="true" />} className={className}>
        <div className="tahi-shimmer" style={{ height: '8.5rem', borderRadius: 'var(--radius-md)' }} />
      </DomainCard>
    )
  }

  return (
    <DomainCard
      domain="sales"
      title="Hot leads"
      icon={<Flame size={15} aria-hidden="true" />}
      viewHref="/leads"
      viewLabel="All leads"
      className={className}
    >
      {/* Header count-up: new this week */}
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <CountPill domain="sales">
          <CountUp value={newThisWeek} durationMs={650} format={n => String(Math.round(n))} /> new this week
        </CountPill>
        <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)' }}>
          unworked · AI-scored
        </span>
      </div>

      <CardDeck<Lead>
        items={leads}
        ariaLabel="Hot leads"
        minHeight="8.5rem"
        accentColor="var(--domain-sales)"
        autoplayMs={8000}
        getKey={(l) => l.id}
        emptyState={
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            No fresh leads in the queue. New enquiries land here AI-scored and ready to work.
          </p>
        }
        renderCard={(lead, isActive) => <LeadCard lead={lead} isActive={isActive} formatNative={formatNative} />}
      />
    </DomainCard>
  )
}

// ── Lead card ─────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  isActive,
  formatNative,
}: {
  lead: Lead
  isActive: boolean
  formatNative: (amount: number, currency: string) => string
}) {
  const score = lead.aiScore ?? 0
  const band = scoreBand(score)
  const isHotNew = score >= 80 && lead.status === 'new'

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
        minHeight: '8.5rem',
      }}
    >
      {/* Top row: avatar + name/company, then the big score chip */}
      <div className="flex items-start justify-between" style={{ gap: 'var(--space-3)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2-5)', minWidth: 0 }}>
          <span
            aria-hidden="true"
            className="flex items-center justify-center flex-shrink-0 tabular-nums"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--domain-sales-tint)',
              color: 'var(--domain-sales)',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}
          >
            {initials(lead.name, lead.company)}
          </span>
          <div style={{ minWidth: 0 }}>
            <p
              data-private
              className="truncate"
              style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.25 }}
            >
              {lead.name || lead.company || 'Unnamed lead'}
            </p>
            {lead.company && lead.name && (
              <p
                data-private
                className="truncate"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', lineHeight: 1.3 }}
              >
                {lead.company}
              </p>
            )}
          </div>
        </div>

        {/* BIG semantic score chip + optional pulse dot */}
        <div className="flex items-center flex-shrink-0" style={{ gap: 'var(--space-1-5)' }}>
          {isHotNew && (
            <span
              aria-hidden="true"
              className="hot-leads-pulse"
              style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-success)',
                flexShrink: 0,
              }}
            />
          )}
          <span
            className="flex items-baseline tabular-nums"
            style={{
              gap: '0.125rem',
              padding: '0.1875rem 0.5rem',
              borderRadius: 'var(--radius-md)',
              background: band.bg,
              color: band.ink,
            }}
            aria-label={`AI score ${score} of 100, ${band.label}`}
          >
            <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.01em' }}>
              {isActive ? (
                <CountUp value={score} durationMs={700} format={n => String(Math.round(n))} />
              ) : (
                Math.round(score)
              )}
            </span>
            <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, opacity: 0.7 }}>/100</span>
          </span>
        </div>
      </div>

      {/* Reason line (if AI provided one) */}
      {lead.aiScoreReason && (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {lead.aiScoreReason}
        </p>
      )}

      {/* Footer row: source chip + estimated value */}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', marginTop: 'auto' }}>
        <span
          className="flex items-center truncate"
          style={{
            gap: 'var(--space-1)',
            padding: '0.0625rem 0.4375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            maxWidth: '60%',
          }}
        >
          {sourceLabel(lead.source)}
        </span>
        {lead.estimatedValue != null && lead.estimatedValue > 0 && (
          <span
            data-private
            className="tabular-nums flex-shrink-0"
            style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text)' }}
          >
            {formatNative(lead.estimatedValue, lead.currency || 'NZD')}
          </span>
        )}
      </div>
    </div>
  )
}
