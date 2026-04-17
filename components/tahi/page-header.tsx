/**
 * <PageHeader> — the standard page title block.
 *
 *   <PageHeader title="Reports" subtitle="Revenue, throughput, and clients">
 *     <Button variant="primary">New report</Button>
 *   </PageHeader>
 *
 * On mobile, actions stack below the title block. On sm+, they sit to the right.
 */

import React from 'react'

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Right-aligned action slot (buttons, filters, etc.) */
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function PageHeader({ title, subtitle, children, className, style }: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-end sm:justify-between ${className ?? ''}`}
      style={{ gap: 'var(--space-3)', ...style }}
    >
      <div>
        <h1
          style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--color-text)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div className="flex items-center flex-wrap" style={{ gap: 'var(--space-2)', flexShrink: 0 }}>
          {children}
        </div>
      )}
    </div>
  )
}
