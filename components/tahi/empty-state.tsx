'use client'

/**
 * <EmptyState> — the shared empty block for "nothing to show" states.
 *
 * Two variants :
 *   `full`   (default) : large leaf-gradient icon, CTA, used for full-page
 *                        empty states (request list, client list, etc.)
 *   `inline` : muted icon, compact, used for per-section / per-tab empty
 *              states (client-detail tabs, deal-detail threads, etc.)
 *
 *   <EmptyState
 *     icon={<FileText className="w-8 h-8" />}
 *     title="No requests for this client yet"
 *     description="Create one to get things moving."
 *     ctaLabel="New request"
 *     onCtaClick={() => setOpen(true)}
 *     variant="inline"
 *   />
 */

import React from 'react'

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description?: string
  ctaLabel?: string
  onCtaClick?: () => void
  action?: React.ReactNode
  variant?: 'full' | 'inline'
  className?: string
  style?: React.CSSProperties
}

export function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  onCtaClick,
  action,
  variant = 'full',
  className,
  style,
}: EmptyStateProps) {
  const isInline = variant === 'inline'

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${className ?? ''}`}
      style={{
        padding: isInline ? 'var(--space-8) var(--space-5)' : '4rem 1.5rem',
        background: isInline ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
        borderRadius: isInline ? 'var(--radius-lg)' : undefined,
        ...style,
      }}
    >
      {isInline ? (
        <div
          aria-hidden="true"
          className="flex items-center justify-center"
          style={{
            color: 'var(--color-text-muted)',
            opacity: 0.5,
            marginBottom: 'var(--space-3)',
          }}
        >
          {icon}
        </div>
      ) : (
        <div
          aria-hidden="true"
          className="flex items-center justify-center"
          style={{
            width: '3.5rem',
            height: '3.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand-dark))',
            color: '#ffffff',
            marginBottom: 'var(--space-4)',
          }}
        >
          {icon}
        </div>
      )}

      <h3
        style={{
          fontSize: isInline ? 'var(--text-sm)' : 'var(--text-md)',
          fontWeight: 600,
          color: isInline ? 'var(--color-text-muted)' : 'var(--color-text)',
          marginBottom: description ? 'var(--space-2)' : 0,
        }}
      >
        {title}
      </h3>

      {description && (
        <p
          style={{
            fontSize: isInline ? 'var(--text-xs)' : 'var(--text-sm)',
            color: isInline ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
            maxWidth: '20rem',
            marginBottom: ctaLabel || action ? 'var(--space-4)' : 0,
          }}
        >
          {description}
        </p>
      )}

      {ctaLabel && onCtaClick && (
        <button
          onClick={onCtaClick}
          className="inline-flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--color-brand)',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            cursor: 'pointer',
            minHeight: '2.25rem',
          }}
        >
          {ctaLabel}
        </button>
      )}

      {action && !ctaLabel && action}
    </div>
  )
}
