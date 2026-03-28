'use client'

// ─── Shared empty state component ────────────────────────────────────────────
// Used in request-list.tsx, overview-content.tsx, client-list.tsx, and any
// future list views that need an empty state.

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  ctaLabel?: string
  onCtaClick?: () => void
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, ctaLabel, onCtaClick, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '4rem 1.5rem', background: 'white' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: '0 12px 0 12px',
          background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
          marginBottom: '1rem',
        }}
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)', marginBottom: '0.5rem' }}>
        {title}
      </h3>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', maxWidth: '20rem', marginBottom: (ctaLabel || action) ? '1.25rem' : 0 }}>
        {description}
      </p>
      {ctaLabel && onCtaClick && (
        <button
          onClick={onCtaClick}
          className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '0.5rem 1rem', background: 'var(--color-brand)', borderRadius: 6, border: 'none', cursor: 'pointer' }}
        >
          {ctaLabel}
        </button>
      )}
      {action && !ctaLabel && action}
    </div>
  )
}
