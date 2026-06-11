'use client'

// ─── Retainer Health Deck (CLIENTS zone) ─────────────────────────────────────
//
// Domain CLIENTS (orchid). A CardDeck with the RISKIEST retainer client on top:
// each card shows a churn dial scored on the SEMANTIC health system
// (green / amber / red mapped from healthStatus + churnRiskScore), the client
// name + MRR (both data-private), and an upsell badge in brand-light when the
// endpoint flags upsellSignal so opportunity reads visibly DIFFERENT from
// danger. Orchid is the card's identity only (the IconChip + the deck's peek
// edges via accentColor); it never colours a dial, a number, or a name.
//
// The DomainCard footer reveals a client-concentration share bar: top client /
// top three / the rest as animated segments, with the top-client share counting
// up on reveal. viewHref -> /clients.
//
// Source: /api/admin/reports/retainer-health (route returns clients sorted by
// churnRiskScore desc). Fields used: orgId, orgName, mrrNzd, churnRiskScore,
// upsellSignal, utilizationPct, requestsLast30d, healthStatus.
//
// Reduced-motion safe: the red-dial breathe + the share-bar grow + count-up all
// live behind prefers-reduced-motion (CSS) or useReveal (which returns inView
// immediately under reduced motion, so figures paint at their final value).

import { useEffect, useRef, useState } from 'react'
import { HeartPulse } from 'lucide-react'
import { DomainCard, IconChip, CountPill } from './domain-card'
import { CardDeck } from '@/components/tahi/card-deck'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { useReveal } from '@/lib/use-homepage-motion'
import { apiPath } from '@/lib/api'

interface RetainerClient {
  orgId: string
  orgName: string
  mrrNzd: number
  churnRiskScore: number
  upsellSignal: boolean
  utilizationPct: number | null
  requestsLast30d: number
  healthStatus: string | null
}

// ── Semantic health mapping ───────────────────────────────────────────────────
//
// Green / amber / red is the system-wide health language (NOT orchid). We blend
// the explicit healthStatus with the churn score so a high score always reads
// hot even when an org's healthStatus is stale or unset.
interface HealthTone {
  /** Semantic ink for SVG graphic arcs (3:1 graphic threshold is sufficient). */
  color: string
  /** AA-passing ink for readable text (numeral + verdict) on white. */
  textColor: string
  /** A soft tint for the dial track. */
  track: string
  /** One-word verdict under the dial. */
  verdict: string
  /** Whether the dial should breathe (danger only). */
  pulse: boolean
}

function healthTone(client: RetainerClient): HealthTone {
  const status = client.healthStatus
  const score = client.churnRiskScore
  // Red: explicit red health OR a high churn score.
  if (status === 'red' || score >= 60) {
    return {
      color: 'var(--color-danger)',
      textColor: 'color-mix(in oklab, var(--color-danger) 62%, var(--color-text))',
      track: 'var(--color-danger-bg)',
      verdict: 'at risk',
      pulse: true,
    }
  }
  // Amber: explicit amber OR a moderate score.
  if (status === 'amber' || score >= 35) {
    return {
      color: 'var(--color-warning)',
      textColor: 'color-mix(in oklab, var(--color-warning) 62%, var(--color-text))',
      track: 'var(--color-warning-bg)',
      verdict: 'watch',
      pulse: false,
    }
  }
  // Green: healthy.
  return {
    color: 'var(--color-success)',
    textColor: 'color-mix(in oklab, var(--color-success) 55%, var(--color-text))',
    track: 'var(--color-success-bg)',
    verdict: 'healthy',
    pulse: false,
  }
}

const SHELL: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 'var(--space-6)',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

export function RetainerHealth({ className }: { className?: string }) {
  const { format } = useDisplayCurrency()
  const [clients, setClients] = useState<RetainerClient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(apiPath('/api/admin/reports/retainer-health'))
      .then(r => (r.ok ? (r.json() as Promise<{ clients: RetainerClient[] }>) : { clients: [] }))
      .then(data => {
        if (cancelled) return
        setClients(data.clients ?? [])
      })
      .catch(() => {
        if (!cancelled) setClients([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Loading: shimmer the shell so the card holds its place in the grid.
  if (loading) {
    return (
      <section aria-label="Retainer health" className={className} style={SHELL}>
        <Header />
        <div className="tahi-shimmer" style={{ height: '8rem', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '1.25rem', width: '50%' }} />
      </section>
    )
  }

  // Empty: calm single line, no alarm.
  if (clients.length === 0) {
    return (
      <section aria-label="Retainer health" className={className} style={SHELL}>
        <Header />
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          No retainer clients to watch yet. Health and churn signals show up here once retainers are live.
        </p>
      </section>
    )
  }

  // Endpoint already sorts riskiest-first; keep that order so the top card is
  // the one to act on. Defensive re-sort in case the payload shape changes.
  const sorted = [...clients].sort((a, b) => b.churnRiskScore - a.churnRiskScore)

  return (
    <DomainCard
      domain="clients"
      title="Retainer health"
      icon={<HeartPulse size={15} />}
      viewHref="/clients"
      className={className}
      footer={<ConcentrationBar clients={sorted} />}
    >
      <CardDeck
        items={sorted}
        getKey={(c) => c.orgId}
        ariaLabel="Retainer clients by churn risk"
        minHeight="9.5rem"
        autoplayMs={8000}
        accentColor="var(--domain-clients)"
        renderCard={(client) => <ClientCard client={client} format={format} />}
      />
    </DomainCard>
  )
}

// ── A single client card inside the deck ──────────────────────────────────────

function ClientCard({
  client,
  format,
}: {
  client: RetainerClient
  format: (nzd: number) => string
}) {
  const tone = healthTone(client)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minWidth: 0 }}>
      <ChurnDial score={client.churnRiskScore} tone={tone} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span
            data-private
            className="truncate"
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--color-text)',
              letterSpacing: '-0.01em',
              minWidth: 0,
            }}
          >
            {client.orgName}
          </span>
          {client.upsellSignal && (
            <span
              className="flex items-center"
              style={{
                gap: 'var(--space-1)',
                padding: '0.0625rem 0.4375rem',
                borderRadius: 'var(--radius-full)',
                background: 'color-mix(in oklab, var(--color-brand-light) 18%, var(--surface, transparent))',
                color: 'var(--color-brand-dark)',
                fontSize: 'var(--text-2xs, 0.6875rem)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: '0.375rem', height: '0.375rem', borderRadius: 'var(--radius-full)', background: 'var(--color-brand-light)' }}
              />
              Upsell
            </span>
          )}
        </div>

        <p data-private className="tabular-nums" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
          {format(client.mrrNzd)}<span style={{ color: 'var(--color-text-subtle)' }}>/mo</span>
        </p>

        {/* Quiet signal line: requests in the last 30d + utilisation. */}
        <div className="flex items-center" style={{ gap: 'var(--space-1-5)', marginTop: 'var(--space-2-5)', flexWrap: 'wrap' }}>
          <CountPill>
            {client.requestsLast30d} req / 30d
          </CountPill>
          {client.utilizationPct !== null && (
            <CountPill>
              {Math.round(client.utilizationPct)}% used
            </CountPill>
          )}
          <span className="tabular-nums" style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, color: tone.textColor }}>
            {tone.verdict}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Churn dial ────────────────────────────────────────────────────────────────
//
// A small radial gauge: a track ring + a coloured arc sized to the churn score
// (0..100). The arc + centre figure use the SEMANTIC tone (green / amber / red),
// never orchid. Red dials breathe via .tahi-dial-pulse (motion-safe only).
// SVG, no animation library; the arc is a stroke-dashoffset on a circle.

function ChurnDial({ score, tone }: { score: number; tone: HealthTone }) {
  const clamped = Math.max(0, Math.min(100, score))
  const size = 64
  const stroke = 6
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  // Leave a small gap at the bottom for a cleaner gauge read (300deg sweep).
  const sweep = 0.83 // fraction of the full circle the gauge spans
  const arcLen = circumference * sweep
  const filled = arcLen * (clamped / 100)

  return (
    <div
      className={tone.pulse ? 'tahi-dial-pulse' : undefined}
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
      role="img"
      aria-label={`Churn risk ${Math.round(clamped)} out of 100, ${tone.verdict}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(126deg)' }} aria-hidden="true">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.track}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${circumference}`}
        />
        {/* Score arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          className="tabular-nums"
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 700,
            lineHeight: 1,
            color: tone.textColor,
            letterSpacing: '-0.02em',
          }}
        >
          {Math.round(clamped)}
        </span>
        <span style={{ fontSize: '0.5625rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>
          risk
        </span>
      </div>
    </div>
  )
}

// ── Concentration share bar (footer reveal) ───────────────────────────────────
//
// Top client / top three / the rest as three animated segments of one bar,
// with the top-client share counting up on reveal. Reads MRR concentration:
// "how much of our retainer revenue rides on the top client". Segments use
// neutral inks (a sanctioned non-domain use), so colour stays the orchid
// identity chip + deck edges only.

function ConcentrationBar({ clients }: { clients: RetainerClient[] }) {
  const { ref, inView } = useReveal<HTMLDivElement>()

  // Sort by MRR desc for the concentration read (independent of churn order).
  const byMrr = [...clients].sort((a, b) => b.mrrNzd - a.mrrNzd)
  const total = byMrr.reduce((sum, c) => sum + Math.max(0, c.mrrNzd), 0)

  const topMrr = byMrr[0]?.mrrNzd ?? 0
  const top3Mrr = byMrr.slice(0, 3).reduce((sum, c) => sum + Math.max(0, c.mrrNzd), 0)
  const next2Mrr = Math.max(0, top3Mrr - topMrr)
  const restMrr = Math.max(0, total - top3Mrr)

  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  const topPct = pct(topMrr)
  const next2Pct = pct(next2Mrr)
  const restPct = pct(restMrr)

  const topShare = useCountUp(Math.round(topPct), inView)

  if (total <= 0) {
    return (
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
        Concentration shows once retainer MRR is set.
      </p>
    )
  }

  return (
    <div ref={ref}>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2-5)' }}>
        <span style={LABEL_STYLE}>Revenue concentration</span>
        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          <span data-private style={{ fontWeight: 700, color: 'var(--color-text)' }}>{topShare}%</span> on top client
        </span>
      </div>

      {/* Three-segment bar. Widths grow from 0 on reveal (.tahi-segment-fill). */}
      <div
        style={{
          display: 'flex',
          height: '0.5rem',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          background: 'var(--color-bg-tertiary)',
        }}
        role="img"
        aria-label={`Top client ${Math.round(topPct)} percent, next two ${Math.round(next2Pct)} percent, the rest ${Math.round(restPct)} percent`}
      >
        <Segment width={inView ? topPct : 0} colour="var(--color-text)" />
        <Segment width={inView ? next2Pct : 0} colour="var(--color-text-muted)" />
        <Segment width={inView ? restPct : 0} colour="var(--color-border-strong)" />
      </div>

      {/* Legend */}
      <div className="flex items-center" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-2-5)', flexWrap: 'wrap' }}>
        <LegendDot colour="var(--color-text)" label="Top" pct={Math.round(topPct)} />
        <LegendDot colour="var(--color-text-muted)" label="Next 2" pct={Math.round(next2Pct)} />
        <LegendDot colour="var(--color-border-strong)" label="Rest" pct={Math.round(restPct)} />
      </div>
    </div>
  )
}

function Segment({ width, colour }: { width: number; colour: string }) {
  return (
    <div
      className="tahi-segment-fill"
      style={{
        width: `${width}%`,
        height: '100%',
        background: colour,
        flexShrink: 0,
      }}
    />
  )
}

function LegendDot({ colour, label, pct }: { colour: string; label: string; pct: number }) {
  return (
    <span className="flex items-center" style={{ gap: 'var(--space-1-5)', fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-muted)' }}>
      <span aria-hidden="true" style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: '0.125rem', background: colour, flexShrink: 0 }} />
      {label}
      <span className="tabular-nums" style={{ color: 'var(--color-text-subtle)' }}>{pct}%</span>
    </span>
  )
}

// ── Count-up helper ───────────────────────────────────────────────────────────
//
// Eases an integer from 0 to target once `active` flips true. Under reduced
// motion useReveal returns inView immediately, but we also short-circuit to the
// final value so there is no animation. Page-local (the value is small + this
// only runs while the footer is revealed).

function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    if (typeof window === 'undefined') {
      setValue(target)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }
    const duration = 600
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) {
        frame.current = window.requestAnimationFrame(tick)
      }
    }
    frame.current = window.requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current)
    }
  }, [target, active])

  return value
}

// ── Letterpress zone header (loading + empty states) ──────────────────────────

function Header() {
  return (
    <div className="flex items-center" style={{ gap: 'var(--space-2-5)', marginBottom: 'var(--space-5)' }}>
      <IconChip domain="clients"><HeartPulse size={15} /></IconChip>
      <h2 style={LABEL_STYLE}>Retainer health</h2>
    </div>
  )
}
