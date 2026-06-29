'use client'

// ─── Take-Home vs Target gauges ───────────────────────────────────────────────
//
// A BOOKS-zone MONEY card for "The Studio Ledger, lit" (SPECS/homepage-lit.md,
// new card #8). Twin mini radial gauges, one per founder (Liam + Staci), each
// reading their current annual take-home against the shared $74k target. The
// filled arc is brand green (the ONE green-allowed domain); the gap-to-target
// is a calm muted amber (not alarm); a notch marks the target value on the
// track; a small leaf marker sits at the fill head; and the annual figure
// counts up under each gauge.
//
// One green per founder, no rainbow. Colour lands only in the IconChip, the
// green fill arc, and the muted-amber gap. Money + names stay ink and carry
// data-private at the call site (the figures here).
//
// Data: GET /api/admin/financial-reports/summary -> takeHome {
//   liamAnnual, staciAnnual, combinedAnnual, combinedMonthly, targetEach,
//   gapEach, gapCombined
// }. We read liamAnnual / staciAnnual / targetEach and compute each founder's
// own fill + gap (the endpoint's gapEach is Liam-only, so we derive per person).
// When takeHome is absent or targetEach is unset, we render a calm "set your
// take-home target in settings" empty state rather than fake numbers.
//
// Reduced-motion safe: the arc draws once on useReveal inView, the leaf draw is
// guarded, and the count-up is gated on inView (which returns true immediately
// under reduced motion, so the figure paints at its final state).

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Wallet } from 'lucide-react'
import { DomainCard } from './domain-card'
import { useReveal } from '@/lib/use-homepage-motion'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { CountUp } from '@/components/tahi/count-up'

// ── Endpoint shape (only the take-home slice we consume) ──────────────────────

interface TakeHome {
  liamAnnual: number
  staciAnnual: number
  targetEach: number
}

interface SummaryResponse {
  takeHome?: TakeHome | null
}

interface Founder {
  name: string
  annual: number
}

// ── Geometry of the 240-degree gauge arc ──────────────────────────────────────
//
// A 240-degree sweep (a friendly open dial, gap at the bottom). Angles measured
// clockwise from the start. 0 = empty, 1 = full target reached.

const GAUGE = {
  size: 96,
  stroke: 9,
  startDeg: 150, // bottom-left
  sweepDeg: 240, // up and over to bottom-right
}

const RADIUS = GAUGE.size / 2 - GAUGE.stroke / 2 - 1

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

// SVG arc path between two fractions (0..1) along the gauge sweep.
function arcPath(fromFrac: number, toFrac: number): string {
  const cx = GAUGE.size / 2
  const cy = GAUGE.size / 2
  const a0 = GAUGE.startDeg + GAUGE.sweepDeg * Math.max(0, Math.min(1, fromFrac))
  const a1 = GAUGE.startDeg + GAUGE.sweepDeg * Math.max(0, Math.min(1, toFrac))
  const start = polar(cx, cy, RADIUS, a0)
  const end = polar(cx, cy, RADIUS, a1)
  const largeArc = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// ── Single gauge ──────────────────────────────────────────────────────────────

function FounderGauge({ founder, target, inView }: { founder: Founder; target: number; inView: boolean }) {
  const { format } = useDisplayCurrency()
  const pathRef = useRef<SVGPathElement | null>(null)

  const frac = target > 0 ? Math.max(0, Math.min(1, founder.annual / target)) : 0
  const reached = frac >= 1
  // The target notch sits at the full sweep end (100% of target).
  const notch = polar(GAUGE.size / 2, GAUGE.size / 2, RADIUS, GAUGE.startDeg + GAUGE.sweepDeg)
  const head = polar(GAUGE.size / 2, GAUGE.size / 2, RADIUS, GAUGE.startDeg + GAUGE.sweepDeg * frac)

  // Draw the green fill arc once when it scrolls into view (stroke-dash reveal).
  useEffect(() => {
    const el = pathRef.current
    if (!el) return
    if (!inView) return
    if (prefersReducedMotion()) return
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 700ms var(--ease-productive)'
    el.style.strokeDashoffset = '0'
  }, [inView, frac])

  return (
    <div className="flex flex-col items-center" style={{ gap: 'var(--space-2)', minWidth: 0 }}>
      <div style={{ position: 'relative', width: GAUGE.size, height: GAUGE.size }}>
        <svg
          width={GAUGE.size}
          height={GAUGE.size}
          viewBox={`0 0 ${GAUGE.size} ${GAUGE.size}`}
          aria-hidden="true"
          style={{ display: 'block' }}
        >
          {/* Track (full sweep) on warm sand */}
          <path
            d={arcPath(0, 1)}
            fill="none"
            stroke="var(--color-bg-tertiary)"
            strokeWidth={GAUGE.stroke}
            strokeLinecap="round"
          />
          {/* Gap-to-target: calm muted amber, from the fill head to the target */}
          {!reached && frac < 1 && (
            <path
              d={arcPath(frac, 1)}
              fill="none"
              stroke="color-mix(in oklab, var(--color-warning) 55%, transparent)"
              strokeWidth={GAUGE.stroke}
              strokeLinecap="round"
            />
          )}
          {/* Filled portion: brand green (the one green moment) */}
          {frac > 0 && (
            <path
              ref={pathRef}
              d={arcPath(0, frac)}
              fill="none"
              stroke="var(--domain-money)"
              strokeWidth={GAUGE.stroke}
              strokeLinecap="round"
            />
          )}
          {/* Target notch on the track */}
          <circle cx={notch.x} cy={notch.y} r={2.4} fill="var(--color-text-subtle)" />
          {/* Leaf marker at the fill head */}
          {frac > 0.02 && (
            <g transform={`translate(${head.x - 7}, ${head.y - 7})`}>
              <LeafMarker draw={inView} />
            </g>
          )}
        </svg>
        {/* Centre percentage of target */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            className="tabular-nums"
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              color: reached ? 'var(--domain-money)' : 'var(--color-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(frac * 100)}%
          </span>
        </div>
      </div>

      <div className="flex flex-col items-center" style={{ gap: '0.125rem', minWidth: 0 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
          {founder.name}
        </span>
        <span
          data-private
          className="tabular-nums"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {inView ? (
            <CountUp value={Math.round(founder.annual)} format={n => format(Math.round(n))} />
          ) : (
            format(Math.round(founder.annual))
          )}
        </span>
      </div>
    </div>
  )
}

// Small single-stroke leaf, adapted from the masthead/runway glyph. Sits at the
// head of the filled arc and draws once when the card reveals.
function LeafMarker({ draw }: { draw: boolean }) {
  const ref = useRef<SVGPathElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!draw) return
    if (prefersReducedMotion()) return
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 500ms var(--ease-productive) 200ms'
    el.style.strokeDashoffset = '0'
  }, [draw])
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <path
        ref={ref}
        d="M3 13C3 8 6 3.5 13 3C12.5 10 8 13 3 13ZM3 13C5.5 11 7.5 8.5 9.5 6"
        stroke="var(--domain-money)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────────

export function TakeHomeGauges({ className }: { className?: string }) {
  const { format } = useDisplayCurrency()
  const { ref, inView } = useReveal<HTMLDivElement>()
  const { data: summaryData, isLoading: loading, error } = useSWR<SummaryResponse>('/api/admin/financial-reports/summary')
  const takeHome = summaryData?.takeHome ?? null
  const failed = !!error

  const hasTarget = !!takeHome && takeHome.targetEach > 0
  const founders: Founder[] = takeHome
    ? [
        { name: 'Liam', annual: takeHome.liamAnnual },
        { name: 'Staci', annual: takeHome.staciAnnual },
      ]
    : []

  return (
    <DomainCard
      domain="money"
      title="Take-Home vs Target"
      icon={<Wallet size={15} />}
      viewHref="/financial-reports"
      className={className}
    >
      <div ref={ref}>
        {loading ? (
          <GaugesSkeleton />
        ) : !hasTarget || failed ? (
          <EmptyState />
        ) : (
          <>
            <div
              className="flex items-start justify-center"
              style={{ gap: 'var(--space-6)', flexWrap: 'wrap' }}
            >
              {founders.map(f => (
                <FounderGauge key={f.name} founder={f} target={takeHome!.targetEach} inView={inView} />
              ))}
            </div>

            {/* Quiet target caption */}
            <p
              data-private
              className="tabular-nums"
              style={{
                marginTop: 'var(--space-4)',
                textAlign: 'center',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              Target {format(Math.round(takeHome!.targetEach))} each
            </p>
          </>
        )}
      </div>
    </DomainCard>
  )
}

// ── Loading + empty states ─────────────────────────────────────────────────────

function GaugesSkeleton() {
  return (
    <div className="flex items-start justify-center" style={{ gap: 'var(--space-6)' }} aria-hidden="true">
      {[0, 1].map(i => (
        <div key={i} className="flex flex-col items-center" style={{ gap: 'var(--space-2)' }}>
          <div
            className="tahi-shimmer"
            style={{
              width: GAUGE.size,
              height: GAUGE.size,
              borderRadius: '9999px',
            }}
          />
          <div
            className="tahi-shimmer"
            style={{ width: '3.5rem', height: '0.75rem', borderRadius: '9999px' }}
          />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center" style={{ gap: 'var(--space-2)', textAlign: 'center', padding: 'var(--space-4) 0' }}>
      <span style={{ ...LABEL_STYLE, color: 'var(--color-text-muted)' }}>No target set</span>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)', lineHeight: 1.5, maxWidth: '20rem' }}>
        Set your take-home target in settings to track founder pay against it.
      </p>
    </div>
  )
}
