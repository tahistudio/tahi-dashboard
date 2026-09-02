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
 * Tone palette. Values are CSS custom properties defined in globals.css
 * (:root + .dark). Light values are byte-identical to the previous
 * hardcoded design-pack hex, so light mode is unchanged; the .dark block
 * carries the tinted-on-dark overrides so chips stop keeping a light tint
 * in dark mode. `solid` is the loud-fill background for variant="solid"
 * (white text sits on it) and stays deep in both themes on purpose. Each
 * tone still has a deeper text colour for legibility against the soft
 * tinted background. Borders are reserved for the outline variant only.
 */
const TONE_MAP: Record<BadgeTone, { bg: string; text: string; border: string; dot: string; solid: string }> = {
  brand:    { bg: 'var(--badge-brand-bg)',    text: 'var(--badge-brand-text)',    border: 'var(--badge-brand-border)',    dot: 'var(--badge-brand-dot)',    solid: 'var(--badge-brand-solid)'    },
  positive: { bg: 'var(--badge-positive-bg)', text: 'var(--badge-positive-text)', border: 'var(--badge-positive-border)', dot: 'var(--badge-positive-dot)', solid: 'var(--badge-positive-solid)' },
  info:     { bg: 'var(--badge-info-bg)',     text: 'var(--badge-info-text)',     border: 'var(--badge-info-border)',     dot: 'var(--badge-info-dot)',     solid: 'var(--badge-info-solid)'     },
  warning:  { bg: 'var(--badge-warning-bg)',  text: 'var(--badge-warning-text)',  border: 'var(--badge-warning-border)',  dot: 'var(--badge-warning-dot)',  solid: 'var(--badge-warning-solid)'  },
  danger:   { bg: 'var(--badge-danger-bg)',   text: 'var(--badge-danger-text)',   border: 'var(--badge-danger-border)',   dot: 'var(--badge-danger-dot)',   solid: 'var(--badge-danger-solid)'   },
  teal:     { bg: 'var(--badge-teal-bg)',     text: 'var(--badge-teal-text)',     border: 'var(--badge-teal-border)',     dot: 'var(--badge-teal-dot)',     solid: 'var(--badge-teal-solid)'     },
  purple:   { bg: 'var(--badge-purple-bg)',   text: 'var(--badge-purple-text)',   border: 'var(--badge-purple-border)',   dot: 'var(--badge-purple-dot)',   solid: 'var(--badge-purple-solid)'   },
  rose:     { bg: 'var(--badge-rose-bg)',     text: 'var(--badge-rose-text)',     border: 'var(--badge-rose-border)',     dot: 'var(--badge-rose-dot)',     solid: 'var(--badge-rose-solid)'     },
  neutral:  { bg: 'var(--badge-neutral-bg)',  text: 'var(--badge-neutral-text)',  border: 'var(--badge-neutral-border)',  dot: 'var(--badge-neutral-dot)',  solid: 'var(--badge-neutral-solid)'  },
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
  // Loud-fill background for the solid variant. For categorical colours it
  // is the categorical hue itself; for tones it is the dedicated deep token.
  let solidBg: string

  if (stage) {
    const c = stageColour(stage)
    bg = `${c}18`
    text = c
    border = c
    dotColour = c
    solidBg = c
  } else if (source) {
    const c = sourceColour(source)
    bg = `${c}18`
    text = c
    border = c
    dotColour = c
    solidBg = c
  } else {
    const t = TONE_MAP[tone ?? 'neutral']
    bg = t.bg
    text = t.text
    border = t.border
    dotColour = t.dot
    solidBg = t.solid
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
      finalBg = solidBg
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
