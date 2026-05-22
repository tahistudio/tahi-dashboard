'use client'

/**
 * <TahiButton>. Every button in the app.
 *
 * Variants:
 *   primary    Lime (#78C45E) with near-black text and the leaf radius.
 *              Reserved for the single most important action on a page.
 *   secondary  Outlined. Transparent bg, --color-border-strong border.
 *              Symmetric --radius-md.
 *   ghost      Borderless, muted text. For dense rows, kebab menus.
 *   link       Inline text with a sliding-underline + animated arrow.
 *   danger     Red. Same hover lift as primary but no leaf radius.
 *
 * Icon convention (from the marketing site): the trailing slot is the
 * default. Pass `icon={<ArrowRight />}` and it renders on the right.
 * Pass `iconLeft={...}` when you need it on the left (search field,
 * back button). Loading swaps the leading slot for a spinner.
 *
 * Motion: --motion-base (420ms) on hover, ease-out. Primary lifts 1px
 * + brand glow. Secondary just shifts border colour to brand. No
 * scale anywhere. Feels cheap.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface TahiButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Trailing icon (the brand default. Arrow on a CTA). */
  icon?: React.ReactNode
  /** Leading icon. Use when the icon must sit before the label. */
  iconLeft?: React.ReactNode
  /** Explicit override. Sets where `icon` renders if both are passed. */
  iconRight?: React.ReactNode
  children?: React.ReactNode
}

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  fontWeight: 500,
  lineHeight: 1,
  border: '1px solid transparent',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  // Calm 220ms swap. No transform / box-shadow transitions because the
  // hover state stays grounded (no lift, no glow). Premium read comes
  // from the lime accent + leaf radius, not motion theatre.
  transition: 'background-color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
}

// Padding + font sizes match the design pack. Minimum tap target of 44px
// on mobile is enforced via min-height where size <= md (sm + md naturally
// sit below 44px). WCAG 2.5.8 Target Size minimum.
const SIZE_STYLE: Record<Size, React.CSSProperties> = {
  sm: { fontSize: '0.75rem',    padding: '0.375rem 0.625rem',  gap: '0.375rem', minHeight: '1.75rem' },
  md: { fontSize: '0.8125rem',  padding: '0.5rem 0.875rem',    gap: '0.375rem', minHeight: '2.25rem' },
  lg: { fontSize: '0.875rem',   padding: '0.625rem 1.125rem',  gap: '0.5rem',   minHeight: '2.5rem'  },
}

interface StyleForState {
  rest: React.CSSProperties
  hover: React.CSSProperties
  active?: React.CSSProperties
}

function variantStyle(variant: Variant): StyleForState {
  switch (variant) {
    case 'primary':
      return {
        rest: {
          background: 'var(--color-accent)',
          color: 'var(--color-accent-text)',
          borderRadius: 'var(--radius-md)',
        },
        // Match the design pack: hover just lifts the lime brightness.
        // No translateY, no shadow glow. The premium read comes from the
        // calm tempo and the lime accent itself, not motion theatre.
        hover: { background: '#8ACE6F' },
      }
    case 'secondary':
      return {
        rest: {
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-md)',
        },
        hover: { background: 'var(--color-bg-secondary)' },
      }
    case 'ghost':
      return {
        rest: {
          background: 'transparent',
          color: 'var(--color-text-muted)',
          borderRadius: 'var(--radius-sm)',
        },
        hover: { background: 'var(--color-bg-secondary)', color: 'var(--color-text)' },
      }
    case 'link':
      return {
        rest: {
          background: 'transparent',
          color: 'var(--color-brand-dark)',
          borderRadius: 0,
          padding: '0.125rem 0',
          border: 'none',
        },
        hover: { color: 'var(--color-brand)' },
      }
    case 'danger':
      return {
        rest: {
          background: 'var(--color-danger)',
          color: '#ffffff',
          borderRadius: 'var(--radius-md)',
        },
        hover: { background: '#B91C1C' },
      }
  }
}

export function TahiButton({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  iconLeft,
  iconRight,
  children,
  className,
  style,
  disabled,
  ...rest
}: TahiButtonProps) {
  const [hover, setHover] = React.useState(false)
  const [pressed, setPressed] = React.useState(false)
  const v = variantStyle(variant)

  // Trailing icon takes the `iconRight` override first, then the
  // unprefixed `icon` shorthand (which defaults to right per the brand).
  const trailing = iconRight ?? (iconLeft ? undefined : icon)
  const leading = iconLeft ?? (iconRight ? icon : undefined)

  const stateStyle: React.CSSProperties = {
    ...v.rest,
    ...(hover && !disabled ? v.hover : {}),
    ...(pressed && !disabled && v.active ? v.active : {}),
  }

  // Trailing icon translates up + right on hover. Matches the marketing
  // site signature: the arrow lifts toward where it's pointing.
  const trailingTransform = hover && !disabled
    ? 'translate(3px, -3px)'
    : 'translate(0, 0)'

  return (
    <button
      type={rest.type ?? 'button'}
      {...rest}
      className={className}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      aria-disabled={disabled || loading || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      style={{
        ...BASE_STYLE,
        ...SIZE_STYLE[size],
        ...stateStyle,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {loading ? (
        <Loader2 style={{ width: '1em', height: '1em' }} className="animate-spin" />
      ) : leading}
      {children}
      {!loading && trailing && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            transform: trailingTransform,
            transition: 'transform var(--motion-base) var(--ease-out)',
          }}
        >
          {trailing}
        </span>
      )}
    </button>
  )
}

// Convenience export for callers that want the variant union for typing.
export type { Variant as TahiButtonVariant, Size as TahiButtonSize }

// Tone-aware colour pairs for TahiLink. The default brand pair works
// on cream / white surfaces. on-dark uses light off-cream rest + lime
// hover for dark / forest backgrounds. on-lime uses dark forest text
// for lime surfaces (paired with the FeatureCard lime variant).
const TAHI_LINK_TONE: Record<'brand' | 'on-dark' | 'on-lime', { rest: string, hover: string }> = {
  brand:    { rest: 'var(--color-brand-dark)',    hover: 'var(--color-brand)' },
  // High-contrast white rest on dark surfaces. Lime on hover so the
  // shift is clearly readable through the radial gradient overlay.
  'on-dark':{ rest: '#FFFFFF',                    hover: 'var(--color-brand-bright)' },
  'on-lime':{ rest: 'var(--color-brand-deepest)',  hover: 'var(--color-brand-darker)' },
}

// Tiny inline-link helper. Keeps the sliding underline + arrow translate
// without forcing callers to wire it. Pass `tone="on-dark"` or
// "on-lime" when the surface needs the link colours to flip.
export function TahiLink({
  href,
  children,
  icon,
  className,
  tone = 'brand',
}: {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
  tone?: 'brand' | 'on-dark' | 'on-lime'
}) {
  const [hover, setHover] = React.useState(false)
  const t = TAHI_LINK_TONE[tone]
  return (
    <a
      href={href}
      className={cn('inline-flex items-center', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: hover ? t.hover : t.rest,
        textDecoration: 'none',
        gap: '0.375rem',
        position: 'relative',
        transition: 'color var(--motion-base) var(--ease-out)',
      }}
    >
      <span style={{ position: 'relative' }}>
        {children}
        <span style={{
          position: 'absolute',
          left: 0,
          bottom: '-2px',
          height: '1px',
          background: 'currentColor',
          width: hover ? '100%' : 0,
          transition: 'width var(--motion-medium) var(--ease-out)',
        }} />
      </span>
      {icon && (
        <span style={{
          display: 'inline-flex',
          transform: hover ? 'translateX(3px)' : 'translateX(0)',
          transition: 'transform var(--motion-base) var(--ease-out)',
        }}>
          {icon}
        </span>
      )}
    </a>
  )
}
