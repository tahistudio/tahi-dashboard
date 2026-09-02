'use client'

/**
 * <RequestsViewSwitcher>. The four peer views of the Requests surface:
 * List, Kanban, Workload (Tahi only) and Timeline.
 *
 * Icon plus label from 1024px up, icon only below it with the name carried by
 * `title` and `aria-label`. Full WAI-ARIA tab pattern: roving tabindex, arrow
 * keys to cycle, Home and End to jump, matching the board's own tab strip so
 * the two feel like one control language.
 */

import * as React from 'react'
import { BarChart3, CalendarRange, LayoutGrid, Rows } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { REQUESTS_VIEW_KEYS, type RequestsAudience, type RequestsViewKey } from '@/lib/requests-views'

const VIEW_META: Record<RequestsViewKey, { label: string; Icon: LucideIcon; adminOnly?: boolean }> = {
  list:     { label: 'List',     Icon: Rows },
  kanban:   { label: 'Kanban',   Icon: LayoutGrid },
  workload: { label: 'Workload', Icon: BarChart3, adminOnly: true },
  timeline: { label: 'Timeline', Icon: CalendarRange },
}

/** The views this audience gets. Workload is a per-teammate cut, so it is
 *  Tahi only. */
export function viewKeysFor(audience: RequestsAudience): RequestsViewKey[] {
  return REQUESTS_VIEW_KEYS.filter(key => !VIEW_META[key].adminOnly || audience === 'admin')
}

export interface RequestsViewSwitcherProps {
  value: RequestsViewKey
  onChange: (next: RequestsViewKey) => void
  audience: RequestsAudience
}

export function RequestsViewSwitcher({ value, onChange, audience }: RequestsViewSwitcherProps) {
  const keys = viewKeysFor(audience)

  return (
    <div
      role="tablist"
      aria-label="Requests view"
      className="inline-flex flex-shrink-0"
      style={{
        padding: '0.1875rem',
        gap: '0.0625rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {keys.map((key, i) => {
        const { label, Icon } = VIEW_META[key]
        const active = key === value
        const onKeyDown = (e: React.KeyboardEvent) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            const step = e.key === 'ArrowRight' ? 1 : -1
            onChange(keys[(i + step + keys.length) % keys.length])
          } else if (e.key === 'Home') {
            e.preventDefault()
            onChange(keys[0])
          } else if (e.key === 'End') {
            e.preventDefault()
            onChange(keys[keys.length - 1])
          }
        }
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={onKeyDown}
            className="tahi-focus-ring inline-flex items-center justify-center h-11 min-w-11 px-3 lg:h-8 lg:min-w-0 lg:px-2.5"
            style={{
              gap: '0.3125rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: active ? 'var(--color-bg)' : 'transparent',
              boxShadow: active ? 'var(--shadow-xs)' : undefined,
              fontFamily: 'inherit',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
