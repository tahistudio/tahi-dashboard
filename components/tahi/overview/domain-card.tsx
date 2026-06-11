'use client'

// ─── Domain card primitives ───────────────────────────────────────────────────
//
// Shared shell + small parts for "The Studio Ledger, lit" (SPECS/homepage-lit.md).
// Every new homepage card composes from these so colour lands in exactly the five
// sanctioned places: leaf-radius icon chips, hero-tile tints, sparkline
// stroke/fill, count pills, and (the deck's) peek edges. One hue per card.
//
//   <DomainCard domain="content" title="Content engine" icon={<PenTool />} heroTile
//     viewHref="/content" footer={<PublishHeatmap />}>
//     ...body...
//   </DomainCard>
//
//   <IconChip domain="sales"><Flame size={15} /></IconChip>
//   <CountPill domain="sales">12 new</CountPill>
//   <Sparkline data={[3, 5, 4, 8, 6, 9]} domain="delivery" />
//
// The card chrome matches cash-runway.tsx: var(--color-bg) surface, a 1px
// var(--color-border-subtle) hairline (borders not shadows), radius-lg, and
// space-6 padding. Money + names + figures stay ink (never domain colour) and
// carry data-private at the call site. Reduced-motion safe throughout: the
// footer reveal collapses to instant and the sparkline paints at its final
// state (see globals.css .domain-card-footer + useReveal).

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts'
import { useReveal } from '@/lib/use-homepage-motion'

// ── Domain token lookup ───────────────────────────────────────────────────────
//
// CSS var STRINGS only (never runtime-built class names): each domain maps to
// its ink token + tint token, both defined in globals.css :root/.dark. This is
// the single place the union type is enumerated.

export type Domain =
  | 'money'
  | 'delivery'
  | 'sales'
  | 'content'
  | 'social'
  | 'seo'
  | 'clients'
  | 'ops'

interface DomainTokens {
  ink: string
  tint: string
}

const DOMAIN: Record<Domain, DomainTokens> = {
  money: { ink: 'var(--domain-money)', tint: 'var(--domain-money-tint)' },
  delivery: { ink: 'var(--domain-delivery)', tint: 'var(--domain-delivery-tint)' },
  sales: { ink: 'var(--domain-sales)', tint: 'var(--domain-sales-tint)' },
  content: { ink: 'var(--domain-content)', tint: 'var(--domain-content-tint)' },
  social: { ink: 'var(--domain-social)', tint: 'var(--domain-social-tint)' },
  seo: { ink: 'var(--domain-seo)', tint: 'var(--domain-seo-tint)' },
  clients: { ink: 'var(--domain-clients)', tint: 'var(--domain-clients-tint)' },
  ops: { ink: 'var(--domain-ops)', tint: 'var(--domain-ops-tint)' },
}

/**
 * TITLE_STYLE. The single canonical letterpress card-title treatment: 2xs
 * uppercase, 0.08em tracking, semibold, muted ink. Exported so every homepage
 * card (and any hand-rolled loading/empty header) renders the IDENTICAL label
 * instead of re-declaring its own copy.
 */
export const TITLE_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
}

// ── IconChip ──────────────────────────────────────────────────────────────────

/**
 * IconChip. A leaf-radius-sm square with the domain tint background and domain
 * ink icon. The one place a domain hue introduces itself on a card.
 */
export function IconChip({ domain, children }: { domain: Domain; children: ReactNode }) {
  const t = DOMAIN[domain]
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center"
      style={{
        width: '1.75rem',
        height: '1.75rem',
        flexShrink: 0,
        borderRadius: 'var(--radius-leaf-sm)',
        background: t.tint,
        color: t.ink,
      }}
    >
      {children}
    </span>
  )
}

// ── CountPill ─────────────────────────────────────────────────────────────────

/**
 * CountPill. A small tabular pill: tint background + domain (or neutral) ink
 * text. For counts/badges like "12 new" or "3 awaiting". Neutral (no domain)
 * falls back to the muted ink + secondary surface.
 */
export function CountPill({ domain, children }: { domain?: Domain; children: ReactNode }) {
  const t = domain ? DOMAIN[domain] : null
  return (
    <span
      className="tabular-nums"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '0.0625rem 0.4375rem',
        borderRadius: 'var(--radius-full)',
        background: t ? t.tint : 'var(--color-bg-secondary)',
        color: t ? t.ink : 'var(--color-text-muted)',
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        lineHeight: 1.5,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

interface SparklineProps {
  data: number[]
  domain?: Domain
  height?: number
}

/**
 * Sparkline. A tiny Recharts area chart that annotates a number (always under
 * 56px tall): domain ink stroke + a 10% alpha fill of the same ink, no axes,
 * grid, tooltip, or second series. Draws ONCE when it scrolls into view
 * (useReveal); under reduced motion useReveal returns inView immediately and
 * isAnimationActive is off, so it paints at its final state with no draw.
 */
export function Sparkline({ data, domain, height = 40 }: SparklineProps) {
  const { ref, inView } = useReveal<HTMLDivElement>()
  const ink = domain ? DOMAIN[domain].ink : 'var(--color-brand)'
  const points = data.map((value, index) => ({ index, value }))

  return (
    <div ref={ref} aria-hidden="true" style={{ width: '100%', height }}>
      {inView && points.length > 1 && (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <Area
              type="monotone"
              dataKey="value"
              stroke={ink}
              strokeWidth={1.5}
              fill={ink}
              fillOpacity={0.1}
              isAnimationActive={inView && !prefersReducedMotion()}
              animationDuration={500}
              dot={false}
              activeDot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ── DomainCard ────────────────────────────────────────────────────────────────

interface DomainCardProps {
  domain: Domain
  title: string
  icon: ReactNode
  /**
   * When true, the WHOLE card surface wears the capped domain tint (a hero
   * tile). This full-surface wash is the single canonical hero treatment: at
   * most two per viewport (Content violet, Pipeline amber). Both hero cards must
   * pass `heroTile` to this shell so they render identically.
   */
  heroTile?: boolean
  viewHref?: string
  viewLabel?: string
  /** Extra info row revealed on hover / focus / tap (0fr -> 1fr). */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * DomainCard. The standard card shell for the homepage expansion: hairline
 * border (no shadow), radius-lg, space-6 padding, a leaf-radius IconChip in the
 * domain colour beside a letterpress title. When `heroTile`, the whole card
 * surface wears the capped domain tint (one of the at-most-two tinted hero tiles
 * per viewport) - this is the single canonical hero treatment, so every hero
 * card shares the same wash, header, radius, and padding. When `footer` is
 * provided it renders in a hover/tap reveal row; on touch an accessible toggle
 * button opens it (data-open drives the CSS expand).
 */
export function DomainCard({
  domain,
  title,
  icon,
  heroTile,
  viewHref,
  viewLabel = 'View',
  footer,
  className,
  children,
}: DomainCardProps) {
  const [open, setOpen] = useState(false)
  const t = DOMAIN[domain]

  return (
    <section
      aria-label={title}
      className={`domain-card${className ? ` ${className}` : ''}`}
      data-open={open ? 'true' : undefined}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
        // Hero tiles wear a light domain tint body UNDER a bold solid-gradient
        // header band (rendered below). overflow:hidden clips the band's bleed to
        // the rounded card corners. This is the one canonical hero look every
        // heroTile card shares (Content violet, Pipeline amber).
        ...(heroTile ? { background: t.tint, overflow: 'hidden' } : null),
      }}
    >
      {/* Header: a bold solid-gradient band for hero tiles, a light row otherwise */}
      {heroTile ? (
        <div
          className="flex items-center justify-between"
          style={{
            gap: 'var(--space-3)',
            // Bleed the band to the card edges over the space-6 padding.
            margin: 'calc(var(--space-6) * -1) calc(var(--space-6) * -1) var(--space-5)',
            padding: 'var(--space-3-5) var(--space-6)',
            background: `linear-gradient(135deg, ${t.ink} 0%, color-mix(in oklab, ${t.ink} 60%, #0b0b12) 100%)`,
            color: '#ffffff',
          }}
        >
          <div className="flex items-center" style={{ gap: 'var(--space-2-5)', minWidth: 0 }}>
            <span
              aria-hidden="true"
              className="flex items-center justify-center"
              style={{ width: '1.75rem', height: '1.75rem', flexShrink: 0, borderRadius: 'var(--radius-leaf-sm)', background: 'rgba(255, 255, 255, 0.2)', color: '#ffffff' }}
            >
              {icon}
            </span>
            <h2 style={{ ...TITLE_STYLE, color: 'rgba(255, 255, 255, 0.92)' }}>{title}</h2>
          </div>
          {viewHref && (
            <Link
              href={viewHref}
              className="view-link flex items-center"
              style={{ gap: 'var(--space-1)', fontSize: 'var(--text-xs)', fontWeight: 500, color: '#ffffff', opacity: 0.92, textDecoration: 'none', flexShrink: 0 }}
            >
              {viewLabel} <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
            </Link>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          <div className="flex items-center" style={{ gap: 'var(--space-2-5)', minWidth: 0 }}>
            <IconChip domain={domain}>{icon}</IconChip>
            <h2 style={TITLE_STYLE}>{title}</h2>
          </div>
          {viewHref && (
            <Link
              href={viewHref}
              className="view-link flex items-center"
              style={{ gap: 'var(--space-1)', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-link)', textDecoration: 'none', flexShrink: 0 }}
            >
              {viewLabel} <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
            </Link>
          )}
        </div>
      )}

      {/* Body */}
      <div style={{ minWidth: 0 }}>{children}</div>

      {/* Hover / tap reveal footer */}
      {footer && (
        <>
          {/* Touch toggle: opens the reveal where hover is unavailable. Hidden
              from pointer users by the CSS hover already showing the footer; we
              keep it focusable for keyboard + screen readers. */}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-label={open ? `Show less for ${title}` : `Show more for ${title}`}
            className="domain-card-footer-toggle flex items-center"
            style={{
              gap: 'var(--space-1)',
              marginTop: 'var(--space-4)',
              padding: 'var(--space-1) 0',
              minHeight: '2.75rem',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              fontSize: 'var(--text-2xs, 0.6875rem)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {open ? 'Less' : 'More'}
            <ArrowRight
              size={12}
              aria-hidden="true"
              style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform var(--dur-2) var(--ease-productive)' }}
            />
          </button>
          <div className="domain-card-footer">
            <div>
              <div style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)', marginTop: 'var(--space-1)' }}>
                {footer}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
