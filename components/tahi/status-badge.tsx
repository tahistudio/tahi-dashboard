import * as React from 'react'
import { cn, snakeToTitle } from '@/lib/utils'
import {
  REQUEST_STATUS_CONFIG,
  ORG_STATUS_CONFIG,
  INVOICE_STATUS_CONFIG,
} from '@/lib/status-config'

type BadgeStyle = { label: string; bg: string; color: string; border?: string }

// Map the shared config to badge-compatible format
const REQUEST_STATUS_MAP = Object.fromEntries(
  Object.entries(REQUEST_STATUS_CONFIG).map(([k, v]) => [k, { label: v.label, bg: v.bg, color: v.text, border: v.border }])
) as Record<string, BadgeStyle>

const ORG_STATUS_MAP = Object.fromEntries(
  Object.entries(ORG_STATUS_CONFIG).map(([k, v]) => [k, { label: v.label, bg: v.bg, color: v.text, border: v.border }])
) as Record<string, BadgeStyle>

const INVOICE_STATUS_MAP = Object.fromEntries(
  Object.entries(INVOICE_STATUS_CONFIG).map(([k, v]) => [k, { label: v.label, bg: v.bg, color: v.text, border: v.border }])
) as Record<string, BadgeStyle>

interface StatusBadgeProps {
  status: string
  type?: 'request' | 'org' | 'invoice'
  className?: string
}

export function StatusBadge({ status, type = 'request', className }: StatusBadgeProps) {
  const map =
    type === 'org' ? ORG_STATUS_MAP :
    type === 'invoice' ? INVOICE_STATUS_MAP :
    REQUEST_STATUS_MAP

  const config = (map as Record<string, BadgeStyle>)[status]
  if (!config) return null

  return (
    <span
      className={cn('inline-flex items-center justify-center whitespace-nowrap', className)}
      style={{
        padding: '0.125rem 0.5rem',
        borderRadius: 'var(--radius-full, 9999px)',
        fontSize: 'var(--text-xs, 0.75rem)',
        fontWeight: 500,
        minWidth: '5.5rem',
        background: config.bg,
        color: config.color,
        border: config.border ? `1px solid ${config.border}` : undefined,
      }}
    >
      {config.label}
    </span>
  )
}

interface PlanBadgeProps {
  plan: string | null
  className?: string
}

const PLAN_MAP: Record<string, BadgeStyle> = {
  maintain: { label: 'Maintain',       bg: 'var(--color-brand-50)',    color: 'var(--color-brand-dark)',  border: 'var(--color-brand-100)' },
  scale:    { label: 'Scale',          bg: 'var(--color-brand)',       color: '#ffffff' },
  tune:     { label: 'Tune',           bg: 'var(--status-submitted-bg)', color: 'var(--status-submitted-text)', border: 'var(--status-submitted-border)' },
  launch:   { label: 'Launch',         bg: 'var(--status-client-review-bg)', color: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  hourly:   { label: 'Hourly',         bg: 'var(--status-in-review-bg)', color: 'var(--status-in-review-text)', border: 'var(--status-in-review-border)' },
  custom:   { label: 'Custom project', bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' },
  none:     { label: 'No plan',        bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' },
}

export function PlanBadge({ plan, className }: PlanBadgeProps) {
  const key = plan?.toLowerCase() ?? 'none'
  const config = PLAN_MAP[key] ?? PLAN_MAP.none
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', className)}
      style={{
        background: config.bg,
        color: config.color,
        border: config.border ? `1px solid ${config.border}` : undefined,
      }}
    >
      {config.label}
    </span>
  )
}

interface HealthDotProps {
  health: string | null
  className?: string
}

export function HealthDot({ health, className }: HealthDotProps) {
  const colour =
    health === 'green' ? 'var(--status-in-progress-dot)' :
    health === 'amber' ? 'var(--status-in-review-dot)' :
    health === 'red'   ? 'var(--color-danger)' :
    'var(--color-border)'

  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', className)}
      style={{ background: colour }}
      title={health ?? 'Unknown'}
    />
  )
}

// ── <Tag>. Generic status pill for free-form status strings ──────────────
//
// Where StatusBadge is bound to a known request/org/invoice vocabulary,
// <Tag> maps an arbitrary status string onto one of the four semantic
// tones (success / warning / danger / info) and falls back to a neutral
// pill for anything unrecognised. The mapping is data-driven, so new
// status words are a one-line addition to STATUS_TONE.
//
//   <Tag status="active" />
//   <Tag status={call.status} />
//   <Tag tone="warning">Needs review</Tag>

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

// Tones resolve to the dark-safe --status-* token trios (which carry full
// .dark overrides) rather than the semantic --color-*-bg tokens, which do
// not. Danger reuses --color-danger the way status-config already does.
const TONE_STYLE: Record<Tone, BadgeStyle> = {
  success: { label: '', bg: 'var(--status-delivered-bg)',  color: 'var(--status-delivered-text)',  border: 'var(--status-delivered-border)' },
  warning: { label: '', bg: 'var(--status-in-review-bg)',  color: 'var(--status-in-review-text)',  border: 'var(--status-in-review-border)' },
  danger:  { label: '', bg: 'var(--color-danger-bg)',      color: 'var(--color-danger)' },
  info:    { label: '', bg: 'var(--status-submitted-bg)',  color: 'var(--status-submitted-text)',  border: 'var(--status-submitted-border)' },
  neutral: { label: '', bg: 'var(--status-archived-bg)',   color: 'var(--status-archived-text)',   border: 'var(--status-archived-border)' },
}

// Normalised status word -> tone. Extend here, not at the call site.
const STATUS_TONE: Record<string, Tone> = {
  active: 'success', paid: 'success', delivered: 'success', completed: 'success',
  complete: 'success', done: 'success', approved: 'success', signed: 'success',
  success: 'success', won: 'success', published: 'success', live: 'success',
  pending: 'warning', in_review: 'warning', review: 'warning', paused: 'warning',
  deferred: 'warning', warning: 'warning', draft: 'warning', on_hold: 'warning',
  overdue: 'danger', failed: 'danger', cancelled: 'danger', canceled: 'danger',
  error: 'danger', churned: 'danger', declined: 'danger', rejected: 'danger',
  expired: 'danger', lost: 'danger', no_show: 'danger',
  submitted: 'info', sent: 'info', new: 'info', scheduled: 'info',
  info: 'info', in_progress: 'info', open: 'info', viewed: 'info',
}

function toneForStatus(status: string): Tone {
  return STATUS_TONE[status.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'neutral'
}

interface TagProps {
  /** Free-form status string, mapped to a tone via STATUS_TONE. */
  status?: string
  /** Explicit tone override. Wins over `status`. */
  tone?: Tone
  /** Display text. Defaults to a title-cased `status`. */
  children?: React.ReactNode
  className?: string
}

export function Tag({ status, tone, children, className }: TagProps) {
  const resolved = tone ?? (status ? toneForStatus(status) : 'neutral')
  const style = TONE_STYLE[resolved]
  const label = children ?? (status ? snakeToTitle(status.trim().toLowerCase().replace(/[\s-]+/g, '_')) : '')
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', className)}
      style={{
        background: style.bg,
        color: style.color,
        border: style.border ? `1px solid ${style.border}` : undefined,
      }}
    >
      {label}
    </span>
  )
}

interface TrackTypeBadgeProps {
  type: 'small' | 'large'
  className?: string
}

export function TrackTypeBadge({ type, className }: TrackTypeBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', className)}
      style={type === 'small'
        ? { background: 'var(--status-submitted-bg)', color: 'var(--status-submitted-text)', border: '1px solid var(--status-submitted-border)' }
        : { background: 'var(--status-client-review-bg)', color: 'var(--status-client-review-text)', border: '1px solid var(--status-client-review-border)' }
      }
    >
      {type === 'small' ? 'Small track' : 'Large track'}
    </span>
  )
}
