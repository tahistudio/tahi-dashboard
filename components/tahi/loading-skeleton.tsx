'use client'

// ─── Shared loading skeleton component ───────────────────────────────────────
// Used in request-list.tsx, overview-content.tsx, and any future list views.

interface LoadingSkeletonProps {
  rows?: number
  height?: number
}

export function LoadingSkeleton({ rows = 5, height = 48 }: LoadingSkeletonProps) {
  return (
    <div>
      <div style={{ height: 40, background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }} />
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 animate-pulse"
          style={{
            padding: '14px 16px',
            height,
            borderBottom: i < rows - 1 ? '1px solid #f9fafb' : 'none',
          }}
        >
          <div className="h-4 rounded flex-1" style={{ background: '#f3f4f6' }} />
          <div className="h-4 rounded" style={{ background: '#f3f4f6', width: 96 }} />
          <div className="h-5 rounded-full" style={{ background: '#f3f4f6', width: 80 }} />
          <div className="h-4 rounded" style={{ background: '#f3f4f6', width: 64 }} />
        </div>
      ))}
    </div>
  )
}
