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

interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
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
   * Leading glyph. Pass `'leaf'` to lead with the brand leaf glyph
   * tinted to the chip's text colour (the new default for status pills),
   * `'dot'` for a legacy coloured circle, or `false` / omit for no
   * leader.
   */
  leader?: 'leaf' | 'dot' | false
  /**
   * Legacy alias for `leader='dot'`. Prefer `leader` for new code.
   * @deprecated
   */
  dot?: boolean
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
  dot = false,
  children,
  className,
  style,
  ...rest
}: BadgeProps) {
  // Resolve the leader: explicit `leader` prop wins, then legacy `dot`
  // fallback, otherwise undefined (no leader).
  const resolvedLeader: 'leaf' | 'dot' | undefined =
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

  return (
    <span
      {...rest}
      className={className}
      style={{
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
        ...style,
      }}
    >
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
