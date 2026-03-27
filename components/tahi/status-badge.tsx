import { cn } from '@/lib/utils'

type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'in_progress'
  | 'client_review'
  | 'delivered'
  | 'archived'

type OrgStatus = 'prospect' | 'active' | 'paused' | 'churned' | 'archived'
type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'written_off'

type BadgeStyle = { label: string; bg: string; color: string; border?: string }

const REQUEST_STATUS_MAP: Record<RequestStatus, BadgeStyle> = {
  draft:         { label: 'Draft',         bg: 'var(--status-draft-bg)',          color: 'var(--status-draft-text)',         border: 'var(--status-draft-border)' },
  submitted:     { label: 'Submitted',     bg: 'var(--status-submitted-bg)',      color: 'var(--status-submitted-text)',     border: 'var(--status-submitted-border)' },
  in_review:     { label: 'In review',     bg: 'var(--status-in-review-bg)',      color: 'var(--status-in-review-text)',     border: 'var(--status-in-review-border)' },
  in_progress:   { label: 'In progress',   bg: 'var(--status-in-progress-bg)',    color: 'var(--status-in-progress-text)',   border: 'var(--status-in-progress-border)' },
  client_review: { label: 'Client review', bg: 'var(--status-client-review-bg)',  color: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  delivered:     { label: 'Delivered',     bg: 'var(--status-delivered-bg)',      color: 'var(--status-delivered-text)',     border: 'var(--status-delivered-border)' },
  archived:      { label: 'Archived',      bg: 'var(--status-archived-bg)',       color: 'var(--status-archived-text)',      border: 'var(--status-archived-border)' },
}

const ORG_STATUS_MAP: Record<OrgStatus, BadgeStyle> = {
  prospect: { label: 'Prospect', bg: 'var(--status-submitted-bg)',   color: 'var(--status-submitted-text)',   border: 'var(--status-submitted-border)' },
  active:   { label: 'Active',   bg: 'var(--status-delivered-bg)',   color: 'var(--status-delivered-text)',   border: 'var(--status-delivered-border)' },
  paused:   { label: 'Paused',   bg: 'var(--status-in-review-bg)',   color: 'var(--status-in-review-text)',   border: 'var(--status-in-review-border)' },
  churned:  { label: 'Churned',  bg: 'var(--color-danger-bg)',       color: 'var(--color-danger)' },
  archived: { label: 'Archived', bg: 'var(--status-archived-bg)',    color: 'var(--status-archived-text)',    border: 'var(--status-archived-border)' },
}

const INVOICE_STATUS_MAP: Record<InvoiceStatus, BadgeStyle> = {
  draft:       { label: 'Draft',       bg: 'var(--status-draft-bg)',      color: 'var(--status-draft-text)',      border: 'var(--status-draft-border)' },
  sent:        { label: 'Sent',        bg: 'var(--status-submitted-bg)',  color: 'var(--status-submitted-text)',  border: 'var(--status-submitted-border)' },
  viewed:      { label: 'Viewed',      bg: 'var(--status-client-review-bg)', color: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  paid:        { label: 'Paid',        bg: 'var(--status-delivered-bg)',  color: 'var(--status-delivered-text)',  border: 'var(--status-delivered-border)' },
  overdue:     { label: 'Overdue',     bg: 'var(--color-danger-bg)',      color: 'var(--color-danger)' },
  written_off: { label: 'Written off', bg: 'var(--status-archived-bg)',   color: 'var(--status-archived-text)',   border: 'var(--status-archived-border)' },
}

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
