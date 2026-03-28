import { cn } from '@/lib/utils'
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
