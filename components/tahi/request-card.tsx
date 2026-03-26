import Link from 'next/link'
import {
  ChevronRight, AlertTriangle, Zap, Bug, FileText,
  Wrench, LayoutGrid, BookOpen, MessageSquare
} from 'lucide-react'
import { StatusBadge, TrackTypeBadge } from './status-badge'

interface RequestCardProps {
  id: string
  title: string
  status: string
  type: string
  category?: string | null
  priority?: string | null
  revisionCount?: number
  scopeFlagged?: boolean | null
  orgName?: string | null
  updatedAt?: string | null
  createdAt?: string | null
  trackType?: 'small' | 'large' | null
  isAdmin?: boolean
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  small_task:    FileText,
  large_task:    LayoutGrid,
  bug_fix:       Bug,
  content_update: BookOpen,
  new_feature:   Zap,
  consultation:  MessageSquare,
  custom:        Wrench,
}

const CATEGORY_COLOURS: Record<string, string> = {
  design:      'bg-pink-50 text-pink-600',
  development: 'bg-blue-50 text-blue-600',
  content:     'bg-amber-50 text-amber-600',
  strategy:    'bg-purple-50 text-purple-600',
  admin:       'bg-gray-100 text-gray-600',
  bug:         'bg-red-50 text-red-600',
}

function formatType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatRelative(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    return `${Math.floor(diffDays / 30)}mo ago`
  } catch {
    return ''
  }
}

export function RequestCard({
  id,
  title,
  status,
  type,
  category,
  priority,
  revisionCount,
  scopeFlagged,
  orgName,
  updatedAt,
  createdAt,
  trackType,
  isAdmin,
}: RequestCardProps) {
  const TypeIcon = TYPE_ICONS[type] ?? FileText
  const catColour = CATEGORY_COLOURS[category ?? ''] ?? 'bg-gray-100 text-gray-600'
  const isHighPriority = priority === 'high'
  const dateStr = updatedAt ?? createdAt

  return (
    <Link
      href={`/requests/${id}`}
      className="group flex items-start gap-3 px-4 py-3.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl hover:border-[var(--color-brand)] hover:shadow-sm transition-all"
    >
      {/* Type icon */}
      <div className={`mt-0.5 w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg ${catColour}`}>
        <TypeIcon className="w-3.5 h-3.5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start gap-2">
          {isHighPriority && (
            <Zap className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          )}
          {scopeFlagged && (
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" aria-label="Scope creep flagged" />
          )}
          <span className="text-sm font-medium text-[var(--color-text)] group-hover:text-[var(--color-brand-dark)] transition-colors leading-snug line-clamp-1">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && orgName && (
            <span className="text-xs text-[var(--color-text-subtle)] font-medium">{orgName}</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${catColour}`}>
            {formatType(type)}
          </span>
          {(revisionCount ?? 0) > 0 && (
            <span className="text-xs text-[var(--color-text-subtle)]">
              Rev {revisionCount}
            </span>
          )}
          {dateStr && (
            <span className="text-xs text-[var(--color-text-subtle)]">
              {formatRelative(dateStr)}
            </span>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {trackType && <TrackTypeBadge type={trackType} />}
        <StatusBadge status={status as 'submitted'} type="request" />
        <ChevronRight className="w-4 h-4 text-[var(--color-text-subtle)] group-hover:text-[var(--color-brand)] transition-colors" />
      </div>
    </Link>
  )
}
