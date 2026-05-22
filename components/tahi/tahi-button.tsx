'use client'

/**
 * <TahiButton> — every button in the app.
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
 * scale anywhere — feels cheap.
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
  /** Trailing icon (the brand default — arrow on a CTA). */
  icon?: React.ReactNode
  /** Leading icon. Use when the icon must sit before the label. */
  iconLeft?: React.ReactNode
  /** Explicit override — sets where `icon` renders if both are passed. */
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
  transition: 'background-color var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out), color var(--motion-base) var(--ease-out), box-shadow var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out)',
}

const SIZE_STYLE: Record<Size, React.CSSProperties> = {
  sm: { fontSize: 'var(--text-xs)',  padding: '0.4rem 0.7rem',  gap: '0.375rem' },
  md: { fontSize: 'var(--text-sm)',  padding: '0.55rem 0.9rem', gap: '0.5rem'   },
  lg: { fontSize: 'var(--text-base)',padding: '0.7rem 1.15rem', gap: '0.5rem'   },
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
          borderRadius: 'var(--radius-leaf-sm)',
        },
        hover: {
          background: '#6DB853',   // a touch deeper than the rest lime
          transform: 'translateY(-1px)',
          boxShadow: 'var(--shadow-brand)',
        },
        active: { transform: 'translateY(0)', boxShadow: 'none' },
      }
    case 'secondary':
      return {
        rest: {
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 'var(--radius-md)',
        },
        hover: {
          borderColor: 'var(--color-brand)',
          color: 'var(--color-brand-dark)',
        },
      }
    case 'ghost':
      return {
        rest: {
          background: 'transparent',
          color: 'var(--color-text-muted)',
          borderRadius: 'var(--radius-md)',
        },
        hover: {
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand-dark)',
        },
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
        hover: {
          background: '#B91C1C',
          transform: 'translateY(-1px)',
          boxShadow: '0 2px 8px rgba(220, 38, 38, 0.22)',
        },
        active: { transform: 'translateY(0)', boxShadow: 'none' },
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

  return (
    <button
      {...rest}
      className={className}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
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
      {!loading && trailing}
    </button>
  )
}

// Convenience export for callers that want the variant union for typing.
export type { Variant as TahiButtonVariant, Size as TahiButtonSize }

// Tiny inline-link helper for the `link` variant — keeps the sliding
// underline + arrow translate without forcing callers to wire it.
export function TahiLink({
  href,
  children,
  icon,
  className,
}: {
  href: string
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  const [hover, setHover] = React.useState(false)
  return (
    <a
      href={href}
      className={cn('inline-flex items-center', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: hover ? 'var(--color-brand)' : 'var(--color-brand-dark)',
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
