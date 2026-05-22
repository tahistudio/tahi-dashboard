'use client'

/**
 * <FeatureCard>. The visually loud card for hero moments. Use sparingly:
 * the one big tile in a KPI strip, the AI briefing card, a launch banner.
 *
 * Variants:
 *
 *   lime      Solid lime (--color-accent) background, near-black text.
 *             Reads as "the most important thing here". Single per strip.
 *
 *   forest    Deep forest gradient (deepest -> darker) with a radial
 *             brand-light tint at top-left. Off-cream text + lime accents.
 *             For AI surfaces and feature callouts.
 *
 *   photo     Photo background with a forest tint overlay and off-cream
 *             text. Pass `imageUrl` and we apply the overlay automatically.
 *             For time tracker, hero panels, brand moments.
 *
 *   cream     Plain bright surface for contrast inside a dark page (or
 *             vice versa). Default `bg` token plus a leaf radius.
 *
 * The Card primitive stays the default for everyday surfaces. Use
 * FeatureCard only where the surface should announce itself.
 */

import * as React from 'react'
import Link from 'next/link'

type Variant = 'lime' | 'forest' | 'photo' | 'cream'
type Padding = 'sm' | 'md' | 'lg'

interface FeatureCardProps {
  variant?: Variant
  padding?: Padding
  /** Required when variant === 'photo'. Public URL of the background image. */
  imageUrl?: string
  /** Add a hover lift (1px translate + shadow). Default true for href / onClick. */
  hover?: boolean
  /** When set, renders as a Next.js Link. */
  href?: string
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

const PADDING_VALUE: Record<Padding, string> = {
  sm: '1rem',
  md: '1.5rem',
  lg: '2rem',
}

function variantStyle(variant: Variant, imageUrl?: string): React.CSSProperties {
  switch (variant) {
    case 'lime':
      // Soft lime gradient so the surface has shape and depth without
      // being a flat slab of saturated lime. Brighter top-left, muted
      // bottom-right. Still dark text for AA contrast.
      return {
        background:
          'radial-gradient(circle at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%), ' +
          'linear-gradient(135deg, var(--color-brand-bright), var(--color-brand-light) 80%)',
        color: 'var(--color-brand-deepest)',
        border: '1px solid rgba(255, 255, 255, 0.40)',
        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.20)',
      }
    case 'forest':
      // Brighter inset highlight ring for more pop. Brand-light at low
      // alpha catches the eye against the dark gradient.
      return {
        background:
          'radial-gradient(ellipse at 5% 0%, rgba(151, 186, 140, 0.35), transparent 55%), ' +
          'linear-gradient(135deg, var(--color-brand-darker), var(--color-brand-deepest))',
        color: 'var(--color-text-on-dark)',
        border: '1px solid var(--color-brand-darker)',
        boxShadow: 'inset 0 0 0 1px rgba(151, 186, 140, 0.18)',
      }
    case 'photo':
      // Same brighter inset ring as forest. Photo overlay handles tone.
      return {
        background: imageUrl
          ? `linear-gradient(135deg, rgba(30, 48, 25, 0.45), rgba(15, 20, 16, 0.78)), url(${imageUrl}) center / cover no-repeat`
          : 'linear-gradient(135deg, var(--color-brand-deep), var(--color-brand-deepest))',
        color: 'var(--color-text-on-dark)',
        border: '1px solid var(--color-brand-darker)',
        boxShadow: 'inset 0 0 0 1px rgba(151, 186, 140, 0.20)',
      }
    case 'cream':
    default:
      return {
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border-strong)',
      }
  }
}

function FeatureCardRoot({
  variant = 'forest',
  padding = 'lg',
  imageUrl,
  hover,
  href,
  onClick,
  className,
  style,
  children,
}: FeatureCardProps) {
  const isInteractive = !!href || !!onClick
  const shouldLift = hover ?? isInteractive
  const [hovered, setHovered] = React.useState(false)

  // Compose the variant's static box-shadow (inset highlight ring) with
  // the optional hover-lift shadow so neither overrides the other.
  const v = variantStyle(variant, imageUrl)
  const variantShadow = (v.boxShadow as string | undefined) ?? ''
  const liftShadow = shouldLift && hovered ? 'var(--shadow-leaf)' : ''
  const composedShadow = [variantShadow, liftShadow].filter(Boolean).join(', ') || undefined

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    padding: PADDING_VALUE[padding],
    borderRadius: 'var(--radius-leaf)',
    cursor: isInteractive ? 'pointer' : undefined,
    transition:
      'transform var(--motion-base, 320ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1)), ' +
      'box-shadow var(--motion-base, 320ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1))',
    transform: shouldLift && hovered ? 'translateY(-1px)' : 'translateY(0)',
    ...v,
    boxShadow: composedShadow,
    ...style,
  }

  const handleEnter = () => isInteractive && setHovered(true)
  const handleLeave = () => isInteractive && setHovered(false)

  if (href) {
    return (
      <Link
        href={href}
        className={className}
        style={{ ...baseStyle, textDecoration: 'none', display: 'block' }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        style={{ ...baseStyle, textAlign: 'left', width: '100%', border: baseStyle.border, font: 'inherit' }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </button>
    )
  }
  return (
    <div className={className} style={baseStyle}>
      {children}
    </div>
  )
}

// ── Slots ──────────────────────────────────────────────────────────────

function FeatureCardEyebrow({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        opacity: 0.85,
        marginBottom: '0.5rem',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function FeatureCardTitle({
  children,
  style,
  as: Tag = 'h3',
}: {
  children: React.ReactNode
  style?: React.CSSProperties
  as?: 'h2' | 'h3' | 'h4'
}) {
  return (
    <Tag
      style={{
        fontSize: '1.5rem',
        fontWeight: 600,
        letterSpacing: '-0.015em',
        margin: 0,
        lineHeight: 1.2,
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

function FeatureCardDescription({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <p
      style={{
        fontSize: '0.875rem',
        lineHeight: 1.55,
        opacity: 0.85,
        margin: '0.5rem 0 0',
        ...style,
      }}
    >
      {children}
    </p>
  )
}

function FeatureCardFooter({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        marginTop: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export const FeatureCard = Object.assign(FeatureCardRoot, {
  Eyebrow: FeatureCardEyebrow,
  Title: FeatureCardTitle,
  Description: FeatureCardDescription,
  Footer: FeatureCardFooter,
})
