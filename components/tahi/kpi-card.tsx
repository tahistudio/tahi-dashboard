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

function deltaColour(direction: DeltaDirection, onLime: boolean): string {
  if (onLime) {
    // On lime, all three need to be near-black with weight differences
    // so the surface stays calm and the lime stays the hero.
    return direction === 'up' ? '#176B3D' : direction === 'down' ? '#B42318' : '#3F6235'
  }
  return direction === 'up' ? '#176B3D' : direction === 'down' ? '#B42318' : 'var(--color-text-muted)'
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

  // Featured variant uses the same soft lime gradient as FeatureCard
  // so the two primitives feel like a family.
  const featuredBg =
    'radial-gradient(circle at 0% 0%, rgba(255, 255, 255, 0.32), transparent 60%), ' +
    'linear-gradient(135deg, var(--color-brand-bright), var(--color-brand-light) 85%)'

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.875rem',
    padding: '1.25rem 1.375rem',
    borderRadius: 'var(--radius-leaf)',
    background: featured ? featuredBg : 'var(--color-bg)',
    color: featured ? 'var(--color-brand-deepest)' : 'var(--color-text)',
    border: featured ? '1px solid rgba(255, 255, 255, 0.40)' : '1px solid var(--color-border-strong)',
    cursor: interactive ? 'pointer' : undefined,
    transition:
      'transform var(--motion-base, 320ms) var(--ease-out), ' +
      'box-shadow var(--motion-base, 320ms) var(--ease-out), ' +
      'border-color var(--motion-base, 320ms) var(--ease-out)',
    transform: interactive && hovered ? 'translateY(-1px)' : 'translateY(0)',
    // Compose the highlight ring (mode-aware) + optional hover lift.
    // The highlight ring is invisible in light mode (alpha 0) and
    // brightens in dark mode to make the card pop against dark surfaces.
    boxShadow: [
      featured
        ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.20)'
        : 'inset 0 0 0 1px var(--card-highlight-ring, transparent)',
      interactive && hovered ? 'var(--shadow-leaf)' : null,
    ].filter(Boolean).join(', ') || undefined,
    ...style,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: featured ? 'rgba(30, 48, 25, 0.78)' : 'var(--color-text-muted)',
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

  const deltaStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: delta ? deltaColour(delta.direction, featured) : undefined,
    fontVariantNumeric: 'tabular-nums',
  }

  const trailingStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: featured ? 'rgba(30, 48, 25, 0.62)' : 'var(--color-text-subtle)',
  }

  const innerContent = (
    <>
      {/* Top row: label left, optional icon right. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={labelStyle}>{label}</span>
        {icon && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '1.75rem',
              height: '1.75rem',
              borderRadius: 'var(--radius-leaf-sm)',
              flexShrink: 0,
              background: featured ? 'rgba(30, 48, 25, 0.08)' : 'var(--color-brand-50)',
              color: featured ? 'var(--color-brand-deepest)' : 'var(--color-brand)',
            }}
          >
            {icon}
          </span>
        )}
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
