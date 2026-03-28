import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format currency amounts */
export function formatCurrency(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Convert USD amount to another currency using cached rates */
export function convertCurrency(
  usdAmount: number,
  targetCurrency: string,
  rates: Record<string, number>
): number {
  if (targetCurrency === 'USD') return usdAmount
  const rate = rates[targetCurrency]
  if (!rate) return usdAmount
  return usdAmount * rate
}

/** Format a date in NZ-friendly format */
export function formatDate(date: string | Date, format: 'short' | 'long' | 'relative' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date

  if (format === 'relative') {
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
  }

  if (format === 'long') {
    return d.toLocaleDateString('en-NZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  return d.toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Generate a random ID (not for security : use crypto.randomUUID() for that) */
export function generateId(): string {
  return crypto.randomUUID()
}

/** Truncate text with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 3) + '...'
}

/** Capitalise first letter */
export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/** Convert snake_case to Title Case */
export function snakeToTitle(str: string): string {
  return str
    .split('_')
    .map(word => capitalise(word))
    .join(' ')
}

/** Get initials from a name */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(word => word.charAt(0).toUpperCase())
    .join('')
}

/** Status colour mapping for request statuses */
export const REQUEST_STATUS_COLOURS: Record<string, string> = {
  draft: 'text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)]',
  submitted: 'text-blue-700 bg-blue-50',
  in_review: 'text-amber-700 bg-amber-50',
  in_progress: 'text-brand bg-[var(--color-brand-50)]',
  client_review: 'text-purple-700 bg-purple-50',
  delivered: 'text-emerald-700 bg-emerald-50',
  archived: 'text-[var(--color-text-subtle)] bg-[var(--color-bg-secondary)]',
}

/** Plan display names */
export const PLAN_LABELS: Record<string, string> = {
  tune: 'Tune',
  launch: 'Launch',
  maintain: 'Maintain',
  scale: 'Scale',
  hourly: 'Hourly',
  custom: 'Custom',
  none: 'No plan',
}

/** Plan monthly values for MRR calculation */
export const PLAN_MRR: Record<string, number> = {
  maintain: 1500,
  scale: 4000,
}
