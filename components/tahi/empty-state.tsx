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
}

export function EmptyState({ icon, title, description, ctaLabel, onCtaClick }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '64px 24px', background: 'white' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: '0 12px 0 12px',
          background: 'linear-gradient(135deg, #5A824E, #425F39)',
          marginBottom: 16,
        }}
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold" style={{ color: '#111827', marginBottom: 8 }}>
        {title}
      </h3>
      <p className="text-sm" style={{ color: '#6b7280', maxWidth: 320, marginBottom: ctaLabel ? 20 : 0 }}>
        {description}
      </p>
      {ctaLabel && onCtaClick && (
        <button
          onClick={onCtaClick}
          className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '8px 16px', background: '#5A824E', borderRadius: 6, border: 'none', cursor: 'pointer' }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  )
}
