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

const REQUEST_STATUS_MAP: Record<RequestStatus, { label: string; className: string }> = {
  draft:         { label: 'Draft',         className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]' },
  submitted:     { label: 'Submitted',     className: 'bg-blue-50 text-blue-700' },
  in_review:     { label: 'In review',     className: 'bg-amber-50 text-amber-700' },
  in_progress:   { label: 'In progress',   className: 'bg-[var(--color-brand-50)] text-[var(--color-brand-dark)]' },
  client_review: { label: 'Client review', className: 'bg-purple-50 text-purple-700' },
  delivered:     { label: 'Delivered',     className: 'bg-emerald-50 text-emerald-700' },
  archived:      { label: 'Archived',      className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]' },
}

const ORG_STATUS_MAP: Record<OrgStatus, { label: string; className: string }> = {
  prospect: { label: 'Prospect', className: 'bg-blue-50 text-blue-700' },
  active:   { label: 'Active',   className: 'bg-emerald-50 text-emerald-700' },
  paused:   { label: 'Paused',   className: 'bg-amber-50 text-amber-700' },
  churned:  { label: 'Churned',  className: 'bg-red-50 text-red-700' },
  archived: { label: 'Archived', className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]' },
}

const INVOICE_STATUS_MAP: Record<InvoiceStatus, { label: string; className: string }> = {
  draft:       { label: 'Draft',       className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]' },
  sent:        { label: 'Sent',        className: 'bg-blue-50 text-blue-700' },
  viewed:      { label: 'Viewed',      className: 'bg-purple-50 text-purple-700' },
  paid:        { label: 'Paid',        className: 'bg-emerald-50 text-emerald-700' },
  overdue:     { label: 'Overdue',     className: 'bg-red-50 text-red-700' },
  written_off: { label: 'Written off', className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]' },
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

  const config = (map as Record<string, { label: string; className: string }>)[status]
  if (!config) return null

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  )
}

interface PlanBadgeProps {
  plan: string | null
  className?: string
}

const PLAN_MAP: Record<string, { label: string; className: string }> = {
  maintain: { label: 'Maintain',       className: 'bg-[var(--color-brand-50)] text-[var(--color-brand-dark)] border border-[var(--color-brand-100)]' },
  scale:    { label: 'Scale',          className: 'bg-[var(--color-brand)] text-white' },
  tune:     { label: 'Tune',           className: 'bg-blue-50 text-blue-700 border border-blue-100' },
  launch:   { label: 'Launch',         className: 'bg-purple-50 text-purple-700 border border-purple-100' },
  hourly:   { label: 'Hourly',         className: 'bg-amber-50 text-amber-700 border border-amber-100' },
  custom:   { label: 'Custom project', className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]' },
  none:     { label: 'No plan',        className: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]' },
}

export function PlanBadge({ plan, className }: PlanBadgeProps) {
  const key = plan?.toLowerCase() ?? 'none'
  const config = PLAN_MAP[key] ?? PLAN_MAP.none
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
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
    health === 'green' ? 'bg-emerald-400' :
    health === 'amber' ? 'bg-amber-400' :
    health === 'red'   ? 'bg-red-400' :
    'bg-[var(--color-border)]'

  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', colour, className)}
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
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        type === 'small'
          ? 'bg-sky-50 text-sky-700 border border-sky-100'
          : 'bg-indigo-50 text-indigo-700 border border-indigo-100',
        className
      )}
    >
      {type === 'small' ? 'Small track' : 'Large track'}
    </span>
  )
}
