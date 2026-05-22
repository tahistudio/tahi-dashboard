'use client'

/**
 * <KPICard>. A single big-number tile. Use inside a KPI strip, on the
 * Overview page, anywhere a metric needs to read at a glance.
 *
 * Composition:
 *
 *   <KPICard
 *     label="Total revenue"
 *     value="$689,372"
 *     icon={<DollarSign />}
 *     delta={{ value: '+15%', direction: 'up' }}
 *     trailing="vs last month"
 *   >
 *     <Sparkline data={...} />
 *   </KPICard>
 *
 * Variants:
 *
 *   default   White card with strong border. Calm, used for most tiles.
 *   featured  Lime fill (--color-accent), near-black text. Marks the
 *             single most important metric in a strip. One per strip.
 *
 * Delta direction colours follow the design pack:
 *   up    -> positive green (#176B3D)
 *   down  -> danger red (#B42318)
 *   flat  -> muted gray
 *
 * Mode-aware via tokens. Works in light + dark without changes.
 */

import * as React from 'react'

type Variant = 'default' | 'featured'
type DeltaDirection = 'up' | 'down' | 'flat'

interface Delta {
  value: string
  direction: DeltaDirection
}

interface KPICardProps {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  delta?: Delta
  /** Small trailing text after the delta. e.g. "vs last month". */
  trailing?: string
  variant?: Variant
  /** Optional area below the value for a sparkline or extra detail. */
  children?: React.ReactNode
  /** Make the whole tile a button / link. */
  onClick?: () => void
  href?: string
  className?: string
  style?: React.CSSProperties
}

interface DeltaPalette {
  fg: string
  bg: string | null
}

function deltaPalette(direction: DeltaDirection, onDarkFeatured: boolean): DeltaPalette {
  if (onDarkFeatured) {
    // Forest gradient surface. Lighter chip + light text inside.
    if (direction === 'up')   return { fg: '#8FD9A8', bg: 'rgba(143, 217, 168, 0.16)' }
    if (direction === 'down') return { fg: '#F4A0A0', bg: 'rgba(244, 160, 160, 0.16)' }
    return { fg: 'var(--color-text-dim-on-dark)', bg: 'rgba(220, 232, 217, 0.10)' }
  }
  // Default (white) surface. No chip background. Inline coloured text.
  return {
    fg: direction === 'up' ? '#176B3D' : direction === 'down' ? '#B42318' : 'var(--color-text-muted)',
    bg: null,
  }
}

function deltaGlyph(direction: DeltaDirection): React.ReactNode {
  if (direction === 'flat') return null
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up'
        ? <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>
        : <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>}
    </svg>
  )
}

export function KPICard({
  label,
  value,
  icon,
  delta,
  trailing,
  variant = 'default',
  children,
  onClick,
  href,
  className,
  style,
}: KPICardProps) {
  const featured = variant === 'featured'
  const [hovered, setHovered] = React.useState(false)
  const interactive = !!href || !!onClick

  // Featured variant uses the deep forest gradient. Reads premium on
  // both light and dark mode, with the inset brand-light highlight ring
  // catching the eye against the dark surface.
  const featuredBg =
    'radial-gradient(ellipse at 5% 0%, rgba(151, 186, 140, 0.32), transparent 55%), ' +
    'linear-gradient(135deg, var(--color-brand-darker), var(--color-brand-deepest))'

  // Hover state: prefer border darkening + small shadow (matches the
  // Card primitive). The previous shadow-leaf felt too intense.
  const hoverBorderColour = featured ? 'rgba(151, 186, 140, 0.45)' : 'var(--color-brand-light)'
  const restBorderColour = featured ? 'var(--color-brand-darker)' : 'var(--color-border-strong)'

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.875rem',
    padding: '1.25rem 1.375rem',
    borderRadius: 'var(--radius-lg)',
    background: featured ? featuredBg : 'var(--color-bg)',
    color: featured ? 'var(--color-text-on-dark)' : 'var(--color-text)',
    border: `1px solid ${interactive && hovered ? hoverBorderColour : restBorderColour}`,
    cursor: interactive ? 'pointer' : undefined,
    transition:
      'transform var(--motion-base, 320ms) var(--ease-out), ' +
      'box-shadow var(--motion-base, 320ms) var(--ease-out), ' +
      'border-color var(--motion-base, 320ms) var(--ease-out)',
    transform: interactive && hovered ? 'translateY(-1px)' : 'translateY(0)',
    // Compose the static highlight ring (brand-light on dark cards,
    // mode-aware on default cards) + a calm shadow-sm on hover.
    boxShadow: [
      featured
        ? 'inset 0 0 0 1px rgba(151, 186, 140, 0.18)'
        : 'inset 0 0 0 1px var(--card-highlight-ring, transparent)',
      interactive && hovered ? 'var(--shadow-sm)' : null,
    ].filter(Boolean).join(', ') || undefined,
    ...style,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: featured ? 'var(--color-text-dim-on-dark)' : 'var(--color-text-muted)',
    letterSpacing: '0.005em',
    margin: 0,
  }

  const valueStyle: React.CSSProperties = {
    fontSize: '2rem',
    fontWeight: 700,
    letterSpacing: '-0.025em',
    lineHeight: 1,
    color: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  }

  const deltaP = delta ? deltaPalette(delta.direction, featured) : null
  const deltaStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: deltaP?.fg,
    fontVariantNumeric: 'tabular-nums',
    padding: deltaP?.bg ? '0.125rem 0.4375rem' : 0,
    borderRadius: deltaP?.bg ? '9999px' : 0,
    background: deltaP?.bg ?? undefined,
  }

  const trailingStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: featured ? 'rgba(220, 232, 217, 0.62)' : 'var(--color-text-subtle)',
  }

  // Top-right slot. Clickable cards take precedence and show an
  // arrow-up-right indicator that translates on hover. Static cards
  // show the optional icon as a plain glyph (no background tile).
  const indicatorColor = featured ? 'rgba(30, 48, 25, 0.72)' : 'var(--color-text-muted)'
  const indicatorHoverColor = featured ? 'var(--color-brand-deepest)' : 'var(--color-brand-dark)'
  const indicatorStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '1.25rem',
    height: '1.25rem',
    color: hovered ? indicatorHoverColor : indicatorColor,
    transform: interactive && hovered ? 'translate(2px, -2px)' : 'translate(0, 0)',
    transition:
      'transform var(--motion-base, 320ms) var(--ease-out), ' +
      'color var(--motion-quick, 220ms) var(--ease-out)',
  }
  const arrowUpRight = (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  )

  const innerContent = (
    <>
      {/* Top row: label left, indicator right (arrow when clickable,
          plain icon when static, nothing when neither). */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={labelStyle}>{label}</span>
        {interactive ? (
          <span style={indicatorStyle} aria-hidden="true">{arrowUpRight}</span>
        ) : icon ? (
          <span style={{ ...indicatorStyle, transform: 'translate(0, 0)' }} aria-hidden="true">{icon}</span>
        ) : null}
      </div>

      {/* Big value on its own line. */}
      <div style={valueStyle}>{value}</div>

      {/* Delta + trailing share a row below the value. */}
      {(delta || trailing) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {delta && (
            <span style={deltaStyle}>
              {deltaGlyph(delta.direction)}
              {delta.value}
            </span>
          )}
          {trailing && <span style={trailingStyle}>{trailing}</span>}
        </div>
      )}

      {children && <div style={{ marginTop: '0.25rem' }}>{children}</div>}
    </>
  )

  const handleEnter = () => interactive && setHovered(true)
  const handleLeave = () => interactive && setHovered(false)

  if (href) {
    // Use plain <a> to avoid coupling to next/link here. Caller can
    // wrap in next/link if they want client-side routing.
    return (
      <a
        href={href}
        className={className}
        style={{ ...baseStyle, textDecoration: 'none' }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        aria-label={`${label}, ${typeof value === 'string' ? value : ''}${delta ? `, ${delta.value}` : ''}`}
      >
        {innerContent}
      </a>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        style={{ ...baseStyle, textAlign: 'left', font: 'inherit' }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {innerContent}
      </button>
    )
  }
  return (
    <div className={className} style={baseStyle}>
      {innerContent}
    </div>
  )
}
