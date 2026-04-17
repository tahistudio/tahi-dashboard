/**
 * Shared skeleton primitives. Use these instead of one-off animated rects
 * so skeleton loaders consistently match the shape of their actual content.
 *
 * Rules:
 * - Every skeleton uses --color-bg-tertiary as the pulse color
 * - Every skeleton is wrapped in .animate-pulse
 * - Dimensions match the real content (heights, widths, row counts)
 */

import React from 'react'

/** A single animated rectangle with token-based styling */
export function SkeletonBar({
  width = '100%',
  height = '0.875rem',
  radius = 'var(--radius-sm)',
  style,
}: {
  width?: string | number
  height?: string | number
  radius?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        width,
        height,
        background: 'var(--color-bg-tertiary)',
        borderRadius: radius,
        ...style,
      }}
    />
  )
}

/** Card-shaped skeleton — use when the actual content is a single card */
export function SkeletonCard({ height = '8rem', children }: { height?: string; children?: React.ReactNode }) {
  return (
    <div
      className="animate-pulse"
      style={{
        height,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}
    >
      {children}
    </div>
  )
}

/** KPI strip skeleton: grouped panel with N cells, each has an icon + label + value */
export function SkeletonKPIStrip({ cells = 4 }: { cells?: number }) {
  const mobileRows = Math.ceil(cells / 2)
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div
        className="grid grid-cols-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(cells, 2)}, 1fr)` }}
      >
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            style={{
              padding: 'var(--space-5)',
              borderRight: (i + 1) % 2 === 0 ? 'none' : '1px solid var(--color-border-subtle)',
              borderBottom: i < (mobileRows - 1) * 2 ? '1px solid var(--color-border-subtle)' : 'none',
            }}
          >
            <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <SkeletonBar width="2rem" height="2rem" radius="var(--radius-leaf-sm)" />
              <SkeletonBar width="40%" height="0.75rem" />
            </div>
            <SkeletonBar width="60%" height="1.5rem" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Table skeleton: header bar + N rows with configurable column count */
export function SkeletonTable({ rows = 8, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBar key={i} width="60%" height="0.75rem" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: r < rows - 1 ? '1px solid var(--color-border-subtle)' : 'none',
          }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <SkeletonBar key={c} width={c === 0 ? '80%' : '60%'} height="0.875rem" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Chart skeleton: header with title + subtitle, then a chart area with bars */
export function SkeletonChart({ height = '14rem', showBars = true }: { height?: string; showBars?: boolean }) {
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}
    >
      <div style={{ marginBottom: 'var(--space-5)' }}>
        <SkeletonBar width="30%" height="0.9375rem" style={{ marginBottom: 'var(--space-2)' }} />
        <SkeletonBar width="20%" height="0.75rem" />
      </div>
      {showBars ? (
        <div className="flex items-end" style={{ height, gap: 'var(--space-2)' }}>
          {[65, 40, 80, 55, 90, 70].map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                background: 'var(--color-bg-tertiary)',
                borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              }}
            />
          ))}
        </div>
      ) : (
        <SkeletonBar width="100%" height={height} />
      )}
    </div>
  )
}

/** List of rows skeleton: N rows with an icon + two text lines */
export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse flex flex-col" style={{ gap: 'var(--space-2)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            gap: 'var(--space-3)',
          }}
        >
          <SkeletonBar width="2rem" height="2rem" radius="var(--radius-leaf-sm)" />
          <div className="flex-1 flex flex-col" style={{ gap: 'var(--space-1)' }}>
            <SkeletonBar width="70%" height="0.75rem" />
            <SkeletonBar width="50%" height="0.625rem" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Progress-bar list skeleton: for capacity/utilisation sections */
export function SkeletonProgressList({ rows = 4 }: { rows?: number }) {
  return (
    <div
      className="animate-pulse"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: i < rows - 1 ? '1px solid var(--color-border-subtle)' : 'none',
          }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
            <SkeletonBar width="40%" height="0.8125rem" />
            <SkeletonBar width="20%" height="0.75rem" />
          </div>
          <SkeletonBar width="100%" height="0.375rem" radius="var(--radius-full)" />
        </div>
      ))}
    </div>
  )
}
