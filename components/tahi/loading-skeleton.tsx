'use client'

// ─── Shared loading skeleton component ───────────────────────────────────────
// Used in request-list.tsx, overview-content.tsx, and any future list views.

interface LoadingSkeletonProps {
  rows?: number
  height?: number
}

export function LoadingSkeleton({ rows = 5, height = 48 }: LoadingSkeletonProps) {
  return (
    <div aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading content...</span>
      <div style={{ height: 40, background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-subtle)' }} />
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 animate-pulse"
          style={{
            padding: '0.875rem 1rem',
            height,
            borderBottom: i < rows - 1 ? '1px solid var(--color-bg-secondary)' : 'none',
          }}
        >
          <div className="h-4 rounded flex-1" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-4 rounded" style={{ background: 'var(--color-bg-tertiary)', width: 96 }} />
          <div className="h-5 rounded-full" style={{ background: 'var(--color-bg-tertiary)', width: 80 }} />
          <div className="h-4 rounded" style={{ background: 'var(--color-bg-tertiary)', width: 64 }} />
        </div>
      ))}
    </div>
  )
}
