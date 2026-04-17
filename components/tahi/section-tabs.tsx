/**
 * <SectionTabs> — the sticky jump-nav used on Reports (and ready for
 * Settings, Client detail, any long page with vertical anchor sections).
 *
 *   <SectionTabs
 *     items={[
 *       { id: 'overview',         label: 'Overview' },
 *       { id: 'financial-health', label: 'Financial Health' },
 *       ...
 *     ]}
 *     rightSlot={<CurrencySelect />}
 *   />
 *
 * Layout:
 *   - Wrapped in `.sticky-section-nav` so it sticks at top: 0 of the scroll
 *     container (no gap against the top nav when the page uses `.page-flush-top`).
 *   - Tabs scroll horizontally on mobile (`.h-scroll scrollbar-hide`)
 *   - Tabs center on md+ via `md:justify-center`
 *   - Optional rightSlot is pinned to the right on all breakpoints
 *
 * Scroll behaviour:
 *   - Clicking a tab calls scrollIntoView on `#{id}` with smooth behaviour.
 *   - Provides `scroll-mt-20` offset automatically on the target sections
 *     (caller still needs id on the actual section div).
 */

import React from 'react'

export interface SectionTabItem {
  id: string
  label: React.ReactNode
  /** Optional group label for future grouped-TOC rendering. */
  group?: string
}

interface SectionTabsProps {
  items: readonly SectionTabItem[]
  /** Right-aligned slot for page-level filters (currency, date, etc.). */
  rightSlot?: React.ReactNode
  /** Custom className on the outer wrapper. */
  className?: string
  style?: React.CSSProperties
}

export function SectionTabs({ items, rightSlot, className, style }: SectionTabsProps) {
  function jumpTo(id: string) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className={`sticky-section-nav ${className ?? ''}`} style={style}>
      <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
        {/* Scrolling tabs, centered on md+ */}
        <div className="flex-1 h-scroll scrollbar-hide md:flex md:justify-center" style={{ minWidth: 0 }}>
          <div className="flex" style={{ gap: 'var(--space-0-5)' }}>
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => jumpTo(item.id)}
                className="whitespace-nowrap flex-shrink-0"
                style={{
                  padding: 'var(--space-3) var(--space-4)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '2px solid transparent',
                  transition: 'color 150ms ease, border-color 150ms ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'var(--color-brand)'
                  e.currentTarget.style.borderBottomColor = 'var(--color-brand)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                  e.currentTarget.style.borderBottomColor = 'transparent'
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {rightSlot && <div className="flex items-center flex-shrink-0" style={{ gap: 'var(--space-2)' }}>{rightSlot}</div>}
      </div>
    </div>
  )
}
