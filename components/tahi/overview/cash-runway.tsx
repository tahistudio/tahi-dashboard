'use client'

// ─── Cash & Runway ────────────────────────────────────────────────────────────
//
// The BOOKS-zone left card (homepage Studio Ledger Slice 5). Runway is THE
// answer (Okisuka size-contrast hierarchy): one large mood-coloured figure plus
// a one-word verdict carries the whole card. Below it, a runway HORIZON strip
// (12 evenly-spaced month ticks along a hairline, filled in brand green up to
// runwayMonths, the line ending in the seasonal leaf glyph adapted from the
// masthead). A caption names the cash-out month, and a quiet tabular footer
// states cash and burn. Always mounted; null cash collapses to a calm Xero
// prompt. See SPECS/homepage-studio-ledger.md (the five signature moves, BOOKS).

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useDisplayCurrency } from '@/lib/display-currency-context'

export interface CashData {
  totalNzd: number
  runwayMonths: number | null
  burnNzd: number
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// The horizon strip spans a fixed twelve-month window. Anything beyond reads as
// "full" (a long runway should feel calm, not pinned to an arbitrary max lie).
const HORIZON_MONTHS = 12

// Runway mood. Green is signal only: comfortable = brand green (the readable
// forest accent, the page's single healthy colour). Amber = watch, red = tight.
// Null = no burn data, rendered muted (no alarm).
function runwayMood(runway: number | null): { color: string; verdict: string } {
  if (runway === null) return { color: 'var(--color-text-subtle)', verdict: 'add burn data' }
  if (runway >= 6) return { color: 'var(--color-brand)', verdict: 'comfortable' }
  if (runway >= 3) return { color: 'var(--color-warning)', verdict: 'watch' }
  return { color: 'var(--color-danger)', verdict: 'tight' }
}

// now + runwayMonths -> "Mon YYYY". Fractional months round to whole months for
// the human-readable cash-out date.
function cashOutLabel(runway: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + Math.round(runway), 1)
  return new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric' }).format(d)
}

export function CashRunway({ cash, className }: { cash: CashData | null; className?: string }) {
  const { format } = useDisplayCurrency()
  const runway = cash?.runwayMonths ?? null
  const mood = runwayMood(runway)

  return (
    <section
      aria-label="Cash and runway"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Letterpress zone header */}
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h2 style={LABEL_STYLE}>Cash &amp; Runway</h2>
      </div>

      {!cash ? (
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-subtle)', lineHeight: 1.55 }}>
          Connect Xero to see runway
        </p>
      ) : (
        <>
          {/* The answer: large mood-coloured runway figure + one-word verdict */}
          <div className="flex items-baseline" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: '-0.02em',
                color: mood.color,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {runway === null ? <span style={{ fontSize: 'var(--text-2xl)' }}>&middot;</span> : `${runway.toFixed(1)} mo`}
            </span>
            <span style={{ ...LABEL_STYLE, color: mood.color, paddingBottom: '0.25rem' }}>
              {mood.verdict}
            </span>
          </div>

          {/* Runway horizon strip: 12 month ticks on a hairline, filled to runway */}
          <HorizonStrip runway={runway} />

          {/* Cash-out caption */}
          {runway !== null && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-3)' }}>
              runs to ~{cashOutLabel(runway)}
            </p>
          )}

          {/* Quiet tabular footer */}
          <div
            data-private
            className="tabular-nums"
            style={{
              marginTop: 'var(--space-5)',
              paddingTop: 'var(--space-3)',
              borderTop: '1px solid var(--color-border-subtle)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            Cash {format(cash.totalNzd)}
            <span style={{ color: 'var(--color-text-subtle)' }}> &middot; </span>
            Burn {format(cash.burnNzd)}/mo
          </div>

          {/* Footer link */}
          <Link
            href="/financial-reports"
            className="view-link flex items-center"
            style={{ gap: 'var(--space-1)', marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-link)', textDecoration: 'none' }}
          >
            View reports <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
          </Link>
        </>
      )}
    </section>
  )
}

// ─── Horizon strip ──────────────────────────────────────────────────────────────
//
// Twelve evenly-spaced month ticks along a single hairline. The line fills in
// brand green from the left up to runwayMonths (capped at the 12-month window),
// and ends in the seasonal leaf glyph. The leaf sits at the filled head, so a
// longer runway grows the leaf further along the horizon.

function HorizonStrip({ runway }: { runway: number | null }) {
  const clamped = runway === null ? 0 : Math.max(0, Math.min(runway, HORIZON_MONTHS))
  const pct = (clamped / HORIZON_MONTHS) * 100

  return (
    <div style={{ marginTop: 'var(--space-5)', position: 'relative' }} aria-hidden="true">
      {/* Hairline + green fill */}
      <div style={{ position: 'relative', height: 2, borderRadius: '9999px', background: 'var(--color-border-subtle)' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: 'var(--color-brand)',
            borderRadius: '9999px',
          }}
        />
        {/* Seasonal leaf at the head of the filled line */}
        {runway !== null && (
          <span
            style={{
              position: 'absolute',
              left: `${pct}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <SeasonalLeaf />
          </span>
        )}
      </div>

      {/* Month ticks */}
      <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-2)' }}>
        {Array.from({ length: HORIZON_MONTHS }, (_, i) => {
          const filled = i < Math.round(clamped)
          return (
            <span
              key={i}
              style={{
                width: i === 0 || i === HORIZON_MONTHS - 1 ? '0.1875rem' : '0.125rem',
                height: i === 0 || i === HORIZON_MONTHS - 1 ? '0.4375rem' : '0.3125rem',
                borderRadius: '9999px',
                background: filled ? 'var(--color-brand)' : 'var(--color-border-strong)',
                opacity: filled ? 1 : 0.5,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// Self-drawing single-stroke leaf glyph, adapted from the masthead LeafGlyph.
// One of the Growing Leaf's three load-bearing homes: it measures the runway by
// sitting at the head of the filled horizon. Guarded for reduced motion.
function SeasonalLeaf() {
  const ref = useRef<SVGPathElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 400ms var(--ease-productive)'
    el.style.strokeDashoffset = '0'
  }, [])
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        ref={ref}
        d="M3 13C3 8 6 3.5 13 3C12.5 10 8 13 3 13ZM3 13C5.5 11 7.5 8.5 9.5 6"
        stroke="var(--color-brand)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
