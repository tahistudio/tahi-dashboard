/**
 * <PageToolbar> — the standard list-page toolbar.
 *
 *   <PageToolbar>
 *     <PageToolbar.Search value={q} onChange={setQ} placeholder="Search deals..." />
 *     <PageToolbar.Filters>
 *       <Select options={...} value={x} onChange={...} />
 *       <Select options={...} value={y} onChange={...} />
 *     </PageToolbar.Filters>
 *     <PageToolbar.View>
 *       <ViewToggle value={view} onChange={setView} options={[...]} />
 *     </PageToolbar.View>
 *     <PageToolbar.Action>
 *       <Button variant="primary">New deal</Button>
 *     </PageToolbar.Action>
 *   </PageToolbar>
 *
 * Responsive:
 *   - Search takes the left side, filters next to it
 *   - View and Action pin to the right on sm+
 *   - On mobile everything stacks in this order: Search → Filters → View/Action
 */

import React from 'react'
import { Search } from 'lucide-react'
import { Input } from './input'

interface ToolbarProps {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

function ToolbarRoot({ children, className, style }: ToolbarProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center ${className ?? ''}`}
      style={{ gap: 'var(--space-3)', ...style }}
    >
      {children}
    </div>
  )
}

// ── Search slot ─────────────────────────────────────────────────────────────

interface SearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  /** Maximum width. Default 20rem. */
  maxWidth?: string
}

function ToolbarSearch({ value, onChange, placeholder = 'Search…', className, style, maxWidth = '20rem' }: SearchProps) {
  return (
    <div className={className} style={{ flex: '1 1 auto', maxWidth, ...style }}>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        leadingIcon={<Search size={14} aria-hidden="true" />}
      />
    </div>
  )
}

// ── Filters slot ────────────────────────────────────────────────────────────

function ToolbarFilters({ children, className, style }: ToolbarProps) {
  return (
    <div
      className={`flex flex-wrap items-center ${className ?? ''}`}
      style={{ gap: 'var(--space-2)', ...style }}
    >
      {children}
    </div>
  )
}

// ── View slot (right-aligned on sm+) ────────────────────────────────────────

function ToolbarView({ children, className, style }: ToolbarProps) {
  return (
    <div
      className={`flex items-center sm:ml-auto ${className ?? ''}`}
      style={{ gap: 'var(--space-2)', flexShrink: 0, ...style }}
    >
      {children}
    </div>
  )
}

// ── Action slot (pinned far-right) ──────────────────────────────────────────

function ToolbarAction({ children, className, style }: ToolbarProps) {
  return (
    <div
      className={`flex items-center ${className ?? ''}`}
      style={{ gap: 'var(--space-2)', flexShrink: 0, ...style }}
    >
      {children}
    </div>
  )
}

// ── Compound export ─────────────────────────────────────────────────────────

export const PageToolbar = Object.assign(ToolbarRoot, {
  Search: ToolbarSearch,
  Filters: ToolbarFilters,
  View: ToolbarView,
  Action: ToolbarAction,
})
