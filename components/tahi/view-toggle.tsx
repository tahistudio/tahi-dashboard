/**
 * <ViewToggle> — list/board/grid view toggle used on list pages.
 *
 *   <ViewToggle
 *     value={view}
 *     onChange={setView}
 *     options={[
 *       { value: 'list',  icon: List,    label: 'List view' },
 *       { value: 'board', icon: Columns, label: 'Board view' },
 *     ]}
 *   />
 *
 * Each option is a button with an icon and an accessible label (shown via
 * aria-label + title). Active state uses --color-brand solid bg.
 */

import React from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ViewToggleOption<V extends string = string> {
  value: V
  icon: LucideIcon
  label: string
}

interface ViewToggleProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: readonly ViewToggleOption<V>[]
  size?: 'sm' | 'md'
}

export function ViewToggle<V extends string>({ value, onChange, options, size = 'md' }: ViewToggleProps<V>) {
  const buttonSize = size === 'sm' ? '2rem' : '2.25rem'
  const iconSize = size === 'sm' ? 13 : 14

  return (
    <div
      className="flex items-center overflow-hidden flex-shrink-0"
      role="group"
      style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
    >
      {options.map(opt => {
        const Icon = opt.icon
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            aria-label={opt.label}
            title={opt.label}
            aria-pressed={active}
            className="flex items-center justify-center transition-colors"
            style={{
              width: buttonSize,
              height: buttonSize,
              background: active ? 'var(--color-brand)' : 'var(--color-bg)',
              color: active ? '#ffffff' : 'var(--color-text-muted)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Icon size={iconSize} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
