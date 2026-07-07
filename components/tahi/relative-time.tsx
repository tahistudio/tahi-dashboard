'use client'

/**
 * <RelativeTime>. Renders a compact "time ago" label inside a <time>
 * element, with the absolute date exposed on hover via the title.
 *
 * This is the single home for the "Just now / 2m ago / 3h ago / 5d ago"
 * ladder that had drifted into a dozen hand-rolled copies. Xero-aware via
 * parseLooseDate, so it also accepts the old JSON.NET /Date(...)/ strings.
 * Text-only, so it inherits currentColor and needs no dark-mode tokens.
 *
 *   <RelativeTime date={request.createdAt} />
 *   <RelativeTime date={invoice.paidAt} fallback="-" />
 */

import * as React from 'react'
import { parseLooseDate } from '@/lib/utils'

interface RelativeTimeProps {
  date: string | number | Date | null | undefined
  /** Shown when the date is missing or unparseable. Defaults to ''. */
  fallback?: string
  className?: string
}

/** Absolute label used for the hover title, e.g. "6 Jul 2026, 2:14 pm". */
function absoluteLabel(d: Date): string {
  return d.toLocaleString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Compact relative label. Past-only ladder that keeps climbing past a week
 * into w / mo / y, unlike the older formatDate('relative') which stopped at
 * 7d and silently fell back to an absolute date.
 */
export function formatRelative(d: Date, now: number = Date.now()): string {
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export function RelativeTime({ date, fallback = '', className }: RelativeTimeProps) {
  const d = parseLooseDate(typeof date === 'number' ? new Date(date) : date)
  if (!d) return <>{fallback}</>

  return (
    <time
      dateTime={d.toISOString()}
      title={absoluteLabel(d)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelative(d)}
    </time>
  )
}
