/**
 * <Badge>. Every pill / chip / status label in the app.
 *
 * One component, two ways to drive colour:
 *   1. Semantic tone: <Badge tone="danger">Overdue</Badge>
 *   2. Categorical  : <Badge stage="discovery">Discovery</Badge>
 *                     <Badge source="webflow_partner">Webflow Partner</Badge>
 *
 * This replaces:
 *   - 50+ inline <span className="inline-flex rounded-full ..."> chips
 *   - <StatusBadge> / <PlanBadge> / <HealthDot> (we'll alias those in this file)
 *   - Priority badges, source badges, stage badges across Pipeline / Tasks / Requests
 *
 *   <Badge tone="positive">Delivered</Badge>
 *   <Badge tone="warning" dot>In review</Badge>
 *   <Badge tone="danger" size="sm">High</Badge>
 *   <Badge variant="outline" tone="neutral">Draft</Badge>
 *   <Badge variant="count">12</Badge>
 *   <Badge stage="Closed Won">Closed Won</Badge>
 *   <Badge source="webflow_partner">Webflow Partner</Badge>
 *
 * Tones (one meaning per colour. Matches DESIGN.md color language):
 *   brand     green (complete / done / positive)
 *   positive  green (alias for brand, reads clearer in tests)
 *   warning   amber (needs attention, in review, paused)
 *   danger    red (high priority, overdue. Reserved per DESIGN.md)
 *   info      blue (new, submitted, incoming)
 *   teal      teal (active, in progress)
 *   purple    purple (client action needed)
 *   rose      rose (urgent priority only)
 *   neutral   gray (inactive, draft, archived)
 *
 * Variants:
 *   soft     tinted bg + solid text (default. Most of the app)
 *   solid    full colour bg + white text (loud callouts)
 *   outline  transparent bg + coloured border + coloured text
 *   count    circular pill for numeric counts
 */

import React from 'react'
import { X } from 'lucide-react'
import { stageColour, sourceColour } from '@/lib/chart-colors'
import { LeafIcon } from '@/components/tahi/tahi-glyphs'

// ── Types ───────────────────────────────────────────────────────────────────

export type BadgeTone =
  | 'brand'
  | 'positive'
  | 'warning'
  | 'danger'
  | 'info'
  | 'teal'
  | 'purple'
  | 'rose'
  | 'neutral'

export type BadgeVariant = 'soft' | 'solid' | 'outline' | 'count'
export type BadgeSize = 'sm' | 'md'

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'onClick'> {
  /** Semantic tone. One of the tokens above. Ignored if `stage` or `source` is set. */
  tone?: BadgeTone
  /** Stage name for categorical colour (runs through stageColour() from chart-colors). */
  stage?: string
  /** Source name for categorical colour (runs through sourceColour() from chart-colors). */
  source?: string
  /** Visual variant. */
  variant?: BadgeVariant
  /** Size. */
  size?: BadgeSize
  /**
   * Optional leading glyph. Default is no leader (cleanest, Stripe-style,
   * label carries all the meaning).
   *   'icon' a user-supplied Lucide icon via the `icon` prop. Most informative.
   *   'dot'  small 6px coloured circle. Classic, calm.
   *   'leaf' brand leaf glyph. Reserved for Tahi-branded chips only.
   *   false  no leader (default).
   */
  leader?: 'leaf' | 'dot' | 'icon' | false
  /** Lucide icon node when leader='icon'. Sized + tinted automatically. */
  icon?: React.ReactNode
  /**
   * Legacy alias for `leader='dot'`. Prefer `leader` for new code.
   * @deprecated
   */
  dot?: boolean
  /** Click handler. When set, the badge renders as a button and gains
   *  a hover state. Use for selectable / pickable badges (tags, role
   *  pickers, filter values). */
  onClick?: () => void
  /** Remove handler. When set, renders a trailing X. Clicking the X
   *  fires this and never propagates to `onClick`. Use for removable
   *  tags, contact pills, applied filters. */
  onRemove?: () => void
  /** Selected state for multi-pick lists. Adds a brand-100 ring. */
  selected?: boolean
  /** Disabled. Lowers opacity and prevents clicks. */
  disabled?: boolean
  children: React.ReactNode
}

// ── Tone → token map ────────────────────────────────────────────────────────

/**
 * Tone palette. Values come straight from the Tahi Studio design pack
 * (Stripe-soft Twenty-leaning). Each tone has a deeper text colour for
 * legibility against the soft tinted background. Borders are reserved
 * for the outline variant only. Soft variant has no border, which keeps
 * the visual weight down across dense lists.
 */
const TONE_MAP: Record<BadgeTone, { bg: string; text: string; border: string; dot: string }> = {
  brand:    { bg: '#EEF5EB', text: '#3F6235', border: '#D5E4CF', dot: '#5A824E' },
  positive: { bg: '#E9F7EE', text: '#176B3D', border: '#C8E8D2', dot: '#22C55E' },
  info:     { bg: '#EBF1FE', text: '#1F4FBA', border: '#D5E2FB', dot: '#3B82F6' },
  warning:  { bg: '#FEF6E6', text: '#8A5A12', border: '#F7E2B8', dot: '#F59E0B' },
  danger:   { bg: '#FDEDEC', text: '#B42318', border: '#F6CDC7', dot: '#EF4444' },
  teal:     { bg: '#E6F6F9', text: '#0E6E81', border: '#C2E7EE', dot: '#06B6D4' },
  purple:   { bg: '#F0EBFC', text: '#5A30C3', border: '#DCD2F4', dot: '#8B5CF6' },
  rose:     { bg: '#FBE9F2', text: '#9D1F62', border: '#F4CADF', dot: '#EC4899' },
  neutral:  { bg: '#F2F4F2', text: '#525A52', border: '#E1E5E1', dot: '#9CA3AF' },
}

// ── Size → padding/font map ────────────────────────────────────────────────

// Padding + font sizes match the design pack (3px 9px / 12px / 6px radius).
const SIZE_MAP: Record<BadgeSize, { padding: string; fontSize: string; dotSize: string; gap: string }> = {
  sm: { padding: '0.125rem 0.4375rem', fontSize: '0.6875rem', dotSize: '0.3125rem', gap: '0.3125rem' },
  md: { padding: '0.1875rem 0.5625rem', fontSize: '0.75rem',  dotSize: '0.375rem',  gap: '0.375rem'  },
}

// ── Component ───────────────────────────────────────────────────────────────

export function Badge({
  tone,
  stage,
  source,
  variant = 'soft',
  size = 'md',
  leader,
  icon,
  dot = false,
  onClick,
  onRemove,
  selected = false,
  disabled = false,
  children,
  className,
  style,
  ...rest
}: BadgeProps) {
  // Resolve the leader: explicit `leader` prop wins, then legacy `dot`
  // fallback, otherwise no leader.
  const resolvedLeader: 'leaf' | 'dot' | 'icon' | undefined =
    leader === false ? undefined
    : leader ?? (dot ? 'dot' : undefined)

  // Resolve colour source: categorical (stage/source) overrides semantic tone.
  let bg: string
  let text: string
  let border: string
  let dotColour: string

  if (stage) {
    const c = stageColour(stage)
    bg = `${c}18`
    text = c
    border = c
    dotColour = c
  } else if (source) {
    const c = sourceColour(source)
    bg = `${c}18`
    text = c
    border = c
    dotColour = c
  } else {
    const t = TONE_MAP[tone ?? 'neutral']
    bg = t.bg
    text = t.text
    border = t.border
    dotColour = t.dot
  }

  const s = SIZE_MAP[size]

  // Variant adjusts the final palette. The default soft variant uses the
  // 6px symmetric radius from the design pack (not pill) so dense tables
  // and chip rows feel calmer.
  let finalBg = bg
  let finalText = text
  let finalBorder: string | undefined
  let borderRadius = 'var(--radius-sm)'

  switch (variant) {
    case 'soft':
      finalBorder = undefined
      break
    case 'solid':
      finalBg = text
      finalText = '#ffffff'
      finalBorder = undefined
      break
    case 'outline':
      finalBg = 'transparent'
      finalBorder = border
      break
    case 'count':
      // Circular count badge. Brand background with white text by default.
      finalBg = tone ? bg : 'var(--color-brand)'
      finalText = tone ? text : '#ffffff'
      finalBorder = undefined
      borderRadius = 'var(--radius-full)'
      break
  }

  // Interactive when onClick or onRemove is set. We render as a
  // button in that case so the badge is keyboard-focusable and reads
  // as an interactive element to assistive tech.
  const isInteractive = (!!onClick || !!onRemove) && !disabled
  const isButton = !!onClick && !disabled
  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: s.gap,
    padding: s.padding,
    fontSize: s.fontSize,
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    borderRadius,
    background: finalBg,
    color: finalText,
    border: finalBorder ? `1px solid ${finalBorder}` : undefined,
    boxShadow: selected ? '0 0 0 2px var(--color-brand-100)' : undefined,
    opacity: disabled ? 0.55 : 1,
    cursor: isInteractive ? 'pointer' : undefined,
    transition: 'box-shadow 150ms ease, background-color 150ms ease, opacity 150ms ease',
    ...style,
  }

  const inner = (
    <>
      {resolvedLeader === 'leaf' && variant !== 'count' && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            color: dotColour,
            flexShrink: 0,
          }}
        >
          <LeafIcon size={size === 'sm' ? 9 : 10} />
        </span>
      )}
      {resolvedLeader === 'icon' && variant !== 'count' && icon && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: dotColour,
            flexShrink: 0,
            width: size === 'sm' ? '0.6875rem' : '0.75rem',
            height: size === 'sm' ? '0.6875rem' : '0.75rem',
          }}
        >
          {icon}
        </span>
      )}
      {resolvedLeader === 'dot' && variant !== 'count' && (
        <span
          aria-hidden="true"
          style={{
            width: s.dotSize,
            height: s.dotSize,
            borderRadius: '9999px',
            background: dotColour,
            flexShrink: 0,
          }}
        />
      )}
      {children}
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!disabled) onRemove()
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: size === 'sm' ? '0.875rem' : '1rem',
            height: size === 'sm' ? '0.875rem' : '1rem',
            marginLeft: '0.0625rem',
            marginRight: '-0.1875rem',
            borderRadius: 'var(--radius-sm)',
            color: 'currentColor',
            opacity: 0.6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'background-color 120ms ease, opacity 120ms ease',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (disabled) return
            e.currentTarget.style.opacity = '1'
            e.currentTarget.style.background = variant === 'solid'
              ? 'rgba(255, 255, 255, 0.22)'
              : 'rgba(0, 0, 0, 0.06)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <X size={size === 'sm' ? 10 : 11} aria-hidden="true" />
        </span>
      )}
    </>
  )

  if (isButton) {
    const buttonHover = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.boxShadow = selected
        ? '0 0 0 2px var(--color-brand)'
        : '0 0 0 2px var(--color-brand-100)'
    }
    const buttonLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.boxShadow = selected
        ? '0 0 0 2px var(--color-brand-100)'
        : ''
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick?.() }}
        aria-pressed={selected || undefined}
        disabled={disabled}
        className={className}
        style={{ ...containerStyle, font: 'inherit' }}
        onMouseEnter={buttonHover}
        onMouseLeave={buttonLeave}
      >
        {inner}
      </button>
    )
  }

  return (
    <span
      {...rest}
      className={className}
      style={containerStyle}
    >
      {inner}
    </span>
  )
}

// ── Convenience helpers ─────────────────────────────────────────────────────

/** Map a request/deal status slug to a Badge tone. */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'draft':
    case 'archived':
      return 'neutral'
    case 'submitted':
      return 'info'
    case 'in_review':
      return 'warning'
    case 'in_progress':
      return 'teal'
    case 'client_review':
      return 'purple'
    case 'delivered':
    case 'paid':
    case 'signed':
    case 'completed':
    case 'done':
      return 'positive'
    case 'overdue':
    case 'expired':
    case 'cancelled':
    case 'no_show':
    case 'lost':
    case 'blocked':  // NOTE : blocked uses warning per DESIGN.md, but if a caller
                     // wants the semantic "error" state here we still map it.
                     // Use <Badge tone="warning"> for actual Blocked task pills.
      return 'danger'
    default:
      return 'neutral'
  }
}

/** Map a priority slug to a Badge tone. */
export function priorityTone(priority: string): BadgeTone {
  switch (priority) {
    case 'urgent': return 'rose'
    case 'high':   return 'danger'
    case 'medium': return 'info'
    case 'low':    return 'neutral'
    default:       return 'neutral'
  }
}
