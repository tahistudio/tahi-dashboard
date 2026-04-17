/**
 * <Badge> — every pill / chip / status label in the app.
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
 * Tones (one meaning per colour — matches DESIGN.md color language):
 *   brand     green (complete / done / positive)
 *   positive  green (alias for brand, reads clearer in tests)
 *   warning   amber (needs attention, in review, paused)
 *   danger    red (high priority, overdue — reserved per DESIGN.md)
 *   info      blue (new, submitted, incoming)
 *   teal      teal (active, in progress)
 *   purple    purple (client action needed)
 *   rose      rose (urgent priority only)
 *   neutral   gray (inactive, draft, archived)
 *
 * Variants:
 *   soft     tinted bg + solid text (default — most of the app)
 *   solid    full colour bg + white text (loud callouts)
 *   outline  transparent bg + coloured border + coloured text
 *   count    circular pill for numeric counts
 */

import React from 'react'
import { stageColour, sourceColour } from '@/lib/chart-colors'

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
  /** Semantic tone — one of the tokens above. Ignored if `stage` or `source` is set. */
  tone?: BadgeTone
  /** Stage name for categorical colour (runs through stageColour() from chart-colors). */
  stage?: string
  /** Source name for categorical colour (runs through sourceColour() from chart-colors). */
  source?: string
  /** Visual variant. */
  variant?: BadgeVariant
  /** Size. */
  size?: BadgeSize
  /** Adds a leading coloured dot. */
  dot?: boolean
  children: React.ReactNode
}

// ── Tone → token map ────────────────────────────────────────────────────────

const TONE_MAP: Record<BadgeTone, { bg: string; text: string; border: string; dot: string }> = {
  brand: {
    bg: 'var(--color-brand-50)',
    text: 'var(--color-brand)',
    border: 'var(--color-brand-100)',
    dot: 'var(--color-brand)',
  },
  positive: {
    bg: 'var(--status-delivered-bg)',
    text: 'var(--status-delivered-text)',
    border: 'var(--status-delivered-border)',
    dot: 'var(--status-delivered-dot)',
  },
  warning: {
    bg: 'var(--status-in-review-bg)',
    text: 'var(--status-in-review-text)',
    border: 'var(--status-in-review-border)',
    dot: 'var(--status-in-review-dot)',
  },
  danger: {
    bg: 'var(--color-danger-bg)',
    text: 'var(--color-danger)',
    border: 'var(--color-danger)',
    dot: 'var(--color-danger-dot)',
  },
  info: {
    bg: 'var(--status-submitted-bg)',
    text: 'var(--status-submitted-text)',
    border: 'var(--status-submitted-border)',
    dot: 'var(--status-submitted-dot)',
  },
  teal: {
    bg: 'var(--status-in-progress-bg)',
    text: 'var(--status-in-progress-text)',
    border: 'var(--status-in-progress-border)',
    dot: 'var(--status-in-progress-dot)',
  },
  purple: {
    bg: 'var(--status-client-review-bg)',
    text: 'var(--status-client-review-text)',
    border: 'var(--status-client-review-border)',
    dot: 'var(--status-client-review-dot)',
  },
  rose: {
    bg: 'var(--priority-urgent-bg)',
    text: 'var(--priority-urgent-text)',
    border: 'var(--priority-urgent-border)',
    dot: 'var(--priority-urgent-dot)',
  },
  neutral: {
    bg: 'var(--color-bg-tertiary)',
    text: 'var(--color-text-muted)',
    border: 'var(--color-border)',
    dot: 'var(--color-text-subtle)',
  },
}

// ── Size → padding/font map ────────────────────────────────────────────────

const SIZE_MAP: Record<BadgeSize, { padding: string; fontSize: string; dotSize: string; gap: string }> = {
  sm: { padding: '0.0625rem 0.375rem', fontSize: '0.6875rem', dotSize: '0.3125rem', gap: '0.3125rem' },
  md: { padding: '0.125rem 0.5rem',    fontSize: '0.75rem',   dotSize: '0.375rem',  gap: '0.375rem'  },
}

// ── Component ───────────────────────────────────────────────────────────────

export function Badge({
  tone,
  stage,
  source,
  variant = 'soft',
  size = 'md',
  dot = false,
  children,
  className,
  style,
  ...rest
}: BadgeProps) {
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

  // Variant adjusts the final palette
  let finalBg = bg
  let finalText = text
  let finalBorder: string | undefined
  let borderRadius = 'var(--radius-full)'

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
      // Circular count badge — brand background with white text by default
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
      {dot && variant !== 'count' && (
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
