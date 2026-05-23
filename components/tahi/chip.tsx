'use client'

/**
 * <Chip>. Interactive sibling of <Badge>. Used for tags, multi-select
 * values, contact pills, request participants, anything where a piece
 * of data has a visual representation and the user can act on it
 * (remove it, click it, edit it).
 *
 *   <Chip>Webflow Partner</Chip>
 *   <Chip leading={<Avatar size="xs" name="Liam" />}>Liam Miller</Chip>
 *   <Chip tone="positive">Active</Chip>
 *   <Chip onRemove={() => removeTag(id)}>Q2 launch</Chip>
 *   <Chip selected onClick={() => toggle(id)}>Strategy</Chip>
 *
 * Differences from Badge:
 *   - Always interactive (clickable / removable). Badge is decorative.
 *   - Carries leading + trailing slots for avatars, icons, status dots.
 *   - Has a `selected` state with brand-tinted ring for multi-select
 *     pickers (e.g. tag chooser, role chooser).
 *
 * Variants:
 *   subtle  (default) - tinted bg, used in dense lists
 *   solid             - filled bg, used as the primary selected state
 *   outline           - transparent bg with border
 */

import * as React from 'react'
import { X } from 'lucide-react'
import type { BadgeTone } from '@/components/tahi/badge'

interface ChipProps {
  children: React.ReactNode
  /** Semantic tone. Default 'neutral'. */
  tone?: BadgeTone
  /** Visual variant. Default 'subtle'. */
  variant?: 'subtle' | 'solid' | 'outline'
  /** Leading icon / avatar slot. */
  leading?: React.ReactNode
  /** Trailing extra (status dot, badge, kbd hint). Sits before the remove X. */
  trailing?: React.ReactNode
  /** Show a status dot in the chip's tone. Convenience over `leading`. */
  dot?: boolean
  /** Clickable. When set, hover state appears. */
  onClick?: () => void
  /** Show an X. When set, clicking the X fires this; clicking the chip body still fires onClick. */
  onRemove?: () => void
  /** Multi-select state. Brand ring + slightly different bg. */
  selected?: boolean
  /** Disabled chip. */
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}

// Tone palette (mirrors the Badge soft palette, slightly more opaque
// because chips need to read as interactive surfaces, not labels).
const TONE_MAP: Record<BadgeTone, { bg: string; text: string; border: string; dot: string }> = {
  brand:    { bg: '#E9F7EE', text: '#176B3D', border: '#C8E8D2', dot: 'var(--color-brand)' },
  positive: { bg: '#E9F7EE', text: '#176B3D', border: '#C8E8D2', dot: '#22C55E' },
  warning:  { bg: '#FEF6E6', text: '#8A5A12', border: '#F7E2B8', dot: '#F59E0B' },
  danger:   { bg: '#FDEDEC', text: '#B42318', border: '#F6CDC7', dot: '#EF4444' },
  info:     { bg: '#E8F1FE', text: '#1D4ED8', border: '#C5D9F8', dot: '#60a5fa' },
  teal:     { bg: '#E0F2F1', text: '#0F766E', border: '#B8E0DC', dot: '#06b6d4' },
  purple:   { bg: '#EFEAFB', text: '#5B21B6', border: '#D6C8F0', dot: '#a78bfa' },
  rose:     { bg: '#FCE7F0', text: '#9D174D', border: '#F5BFD7', dot: '#f472b6' },
  neutral:  { bg: 'var(--color-bg-secondary)', text: 'var(--color-text)', border: 'var(--color-border-subtle)', dot: 'var(--color-text-subtle)' },
}

export function Chip({
  children,
  tone = 'neutral',
  variant = 'subtle',
  leading,
  trailing,
  dot = false,
  onClick,
  onRemove,
  selected = false,
  disabled = false,
  size = 'md',
  className,
  ariaLabel,
}: ChipProps) {
  const palette = TONE_MAP[tone]
  const height = size === 'sm' ? '1.5rem' : '1.75rem'
  const fontSize = size === 'sm' ? '0.6875rem' : 'var(--text-xs)'
  const padding = size === 'sm' ? '0 0.4375rem' : '0 0.5rem'

  // Resolve bg / text / border per variant + selected state.
  let bg: string
  let textColour: string
  let borderColour: string

  if (variant === 'solid') {
    bg = palette.dot
    textColour = '#ffffff'
    borderColour = palette.dot
  } else if (variant === 'outline') {
    bg = 'transparent'
    textColour = palette.text
    borderColour = palette.border
  } else {
    bg = palette.bg
    textColour = palette.text
    borderColour = palette.border
  }

  // Selected ring stacks on top of the variant.
  const selectedRing = selected && variant !== 'solid'
    ? '0 0 0 2px var(--color-brand-100)'
    : undefined

  const interactive = !!onClick && !disabled

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return
    // Clicks on the remove X are stopped inside the X handler.
    onClick?.()
    // Stop propagation so chips can live inside clickable rows without
    // accidentally triggering the row.
    e.stopPropagation()
  }

  const handleRemove = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (disabled) return
    e.stopPropagation()
    if ('preventDefault' in e) e.preventDefault()
    onRemove?.()
  }

  const baseProps = {
    'aria-label': ariaLabel,
    'aria-pressed': selected || undefined,
    onClick: interactive ? handleClick : undefined,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3125rem',
      padding,
      height,
      background: bg,
      border: `1px solid ${borderColour}`,
      borderRadius: 'var(--radius-md)',
      fontSize,
      fontWeight: 500,
      color: textColour,
      cursor: interactive ? 'pointer' : 'default',
      opacity: disabled ? 0.55 : 1,
      boxShadow: selectedRing,
      transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
      whiteSpace: 'nowrap' as const,
      maxWidth: '100%',
    },
    onMouseEnter: interactive
      ? (e: React.MouseEvent<HTMLElement>) => {
          e.currentTarget.style.borderColor = variant === 'subtle'
            ? 'var(--color-border)'
            : borderColour
          if (variant === 'outline') {
            e.currentTarget.style.background = palette.bg
          }
        }
      : undefined,
    onMouseLeave: interactive
      ? (e: React.MouseEvent<HTMLElement>) => {
          e.currentTarget.style.borderColor = borderColour
          if (variant === 'outline') {
            e.currentTarget.style.background = 'transparent'
          }
        }
      : undefined,
  }

  const content = (
    <>
      {dot && !leading && (
        <span
          aria-hidden="true"
          style={{
            width: '0.4375rem',
            height: '0.4375rem',
            borderRadius: 999,
            background: variant === 'solid' ? '#ffffff' : palette.dot,
            flexShrink: 0,
          }}
        />
      )}
      {leading && (
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          {leading}
        </span>
      )}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {children}
      </span>
      {trailing && (
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>{trailing}</span>
      )}
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={handleRemove}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleRemove(e)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1rem',
            height: '1rem',
            marginLeft: '0.0625rem',
            marginRight: '-0.1875rem',
            borderRadius: 'var(--radius-sm)',
            color: variant === 'solid' ? 'rgba(255,255,255,0.85)' : palette.text,
            opacity: 0.7,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background-color 120ms ease, opacity 120ms ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (disabled) return
            e.currentTarget.style.background = variant === 'solid'
              ? 'rgba(255,255,255,0.2)'
              : 'rgba(0, 0, 0, 0.06)'
            e.currentTarget.style.opacity = '1'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.opacity = '0.7'
          }}
        >
          <X size={11} aria-hidden="true" />
        </span>
      )}
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        {...baseProps}
        style={{ ...baseProps.style, font: 'inherit' }}
      >
        {content}
      </button>
    )
  }
  return (
    <span className={className} {...baseProps}>
      {content}
    </span>
  )
}
