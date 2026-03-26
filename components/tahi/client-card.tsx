import Link from 'next/link'
import { Globe, ChevronRight, MessageSquare, Clock } from 'lucide-react'
import { StatusBadge, PlanBadge, HealthDot } from './status-badge'

interface ClientCardProps {
  id: string
  name: string
  website?: string | null
  status: string
  planType?: string | null
  healthStatus?: string | null
  openRequestCount?: number
  lastActivity?: string | null
  industry?: string | null
}

export function ClientCard({
  id,
  name,
  website,
  status,
  planType,
  healthStatus,
  openRequestCount = 0,
  lastActivity,
  industry,
}: ClientCardProps) {
  // Generate initials avatar
  const initials = name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Link
      href={`/clients/${id}`}
      className="group flex items-center gap-4 px-4 py-3.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-brand)] hover:shadow-sm transition-all"
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 flex-shrink-0 flex items-center justify-center text-sm font-bold text-white brand-gradient"
        style={{ borderRadius: 'var(--radius-leaf-sm)' }}
      >
        {initials}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-brand-dark)] transition-colors truncate">
            {name}
          </span>
          <HealthDot health={healthStatus ?? null} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {industry && (
            <span className="text-xs text-[var(--color-text-subtle)]">{industry}</span>
          )}
          {website && (
            <span className="flex items-center gap-0.5 text-xs text-[var(--color-text-subtle)]">
              <Globe className="w-3 h-3" />
              {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </span>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
        <PlanBadge plan={planType ?? null} />
        <StatusBadge status={status as 'active'} type="org" />
      </div>

      {/* Stats */}
      <div className="hidden md:flex items-center gap-4 text-xs text-[var(--color-text-muted)] flex-shrink-0 min-w-[160px]">
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3.5 h-3.5" />
          {openRequestCount} open
        </span>
        {lastActivity && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {formatRelative(lastActivity)}
          </span>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-[var(--color-text-subtle)] group-hover:text-[var(--color-brand)] transition-colors flex-shrink-0" />
    </Link>
  )
}

function formatRelative(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
    return `${Math.floor(diffDays / 365)}y ago`
  } catch {
    return ''
  }
}
