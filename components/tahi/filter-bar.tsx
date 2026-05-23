'use client'

/**
 * <FilterBar>. Notion / Linear style filter chip builder.
 *
 *   <FilterBar
 *     filters={[
 *       { id: 'status', label: 'Status', kind: 'select',
 *         options: [
 *           { value: 'paid',    label: 'Paid',    tone: 'positive' },
 *           { value: 'overdue', label: 'Overdue', tone: 'danger' },
 *           { value: 'draft',   label: 'Draft',   tone: 'neutral' },
 *         ] },
 *       { id: 'client', label: 'Client', kind: 'select',
 *         options: [...] },
 *     ]}
 *     active={active}
 *     onChange={setActive}
 *     search={{ value: q, onChange: setQ, placeholder: 'Search invoices' }}
 *   />
 *
 * Layout:
 *   [🔍 Search ____] [Status: Paid ×] [Client: Acme ×] [+ Add filter]
 *
 * Behaviour:
 *   - Search input on the left. Optional.
 *   - Active filter chips inline. Each shows "Label: Value" with X to
 *     remove. Click the chip body to re-pick the value.
 *   - "+ Add filter" opens a popover listing filters that aren't
 *     already active. Picking one adds a chip with the first option
 *     auto-selected, then immediately opens the chip's editor.
 */

import * as React from 'react'
import { Search, Plus, X, Check } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { Badge, type BadgeTone } from '@/components/tahi/badge'

// ── Types ───────────────────────────────────────────────────────────────────

export interface FilterOption {
  value: string
  label: string
  tone?: BadgeTone
}

export interface FilterDef {
  id: string
  label: string
  kind: 'select'
  options: FilterOption[]
}

export interface ActiveFilter {
  id: string
  value: string
}

interface FilterBarProps {
  filters: FilterDef[]
  active: ActiveFilter[]
  onChange: (next: ActiveFilter[]) => void
  search?: {
    value: string
    onChange: (next: string) => void
    placeholder?: string
  }
  className?: string
  /** Compact = smaller chip + button heights. */
  size?: 'md' | 'sm'
}

// ── Implementation ──────────────────────────────────────────────────────────

export function FilterBar({
  filters,
  active,
  onChange,
  search,
  className,
  size = 'md',
}: FilterBarProps) {
  const addRef = React.useRef<HTMLButtonElement | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  // When the user just added a filter we auto-open its editor.
  const [autoEditId, setAutoEditId] = React.useState<string | null>(null)

  const fieldHeight = size === 'sm' ? '1.875rem' : '2.25rem'
  const fieldFont = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)'

  const availableFilters = filters.filter(f => !active.some(a => a.id === f.id))

  const addFilter = (def: FilterDef) => {
    const next: ActiveFilter = { id: def.id, value: def.options[0]?.value ?? '' }
    onChange([...active, next])
    setAddOpen(false)
    setAutoEditId(def.id)
  }

  const removeFilter = (id: string) => {
    onChange(active.filter(a => a.id !== id))
  }

  const updateFilter = (id: string, next: string) => {
    onChange(active.map(a => (a.id === id ? { ...a, value: next } : a)))
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      {search && (
        <div
          className="tahi-input-group"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '0 var(--space-2)',
            height: fieldHeight,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            flex: '1 1 16rem',
            maxWidth: '24rem',
            minWidth: '12rem',
          }}
        >
          <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <input
            type="text"
            value={search.value}
            onChange={e => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? 'Search'}
            aria-label={search.placeholder ?? 'Search'}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: fieldFont,
              color: 'var(--color-text)',
            }}
          />
          {search.value && (
            <button
              type="button"
              onClick={() => search.onChange('')}
              aria-label="Clear search"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0 0.125rem',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
                display: 'inline-flex',
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {active.map(a => {
        const def = filters.find(f => f.id === a.id)
        if (!def) return null
        return (
          <FilterChip
            key={a.id}
            def={def}
            value={a.value}
            initialOpen={autoEditId === a.id}
            onValueChange={next => updateFilter(a.id, next)}
            onRemove={() => removeFilter(a.id)}
            onEditorClosed={() => { if (autoEditId === a.id) setAutoEditId(null) }}
            size={size}
          />
        )
      })}

      {availableFilters.length > 0 && (
        <>
          <button
            ref={addRef}
            type="button"
            onClick={() => setAddOpen(v => !v)}
            className="inline-flex items-center"
            style={{
              gap: '0.3125rem',
              height: fieldHeight,
              padding: '0 0.75rem',
              background: 'transparent',
              border: '1px dashed var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)',
              fontSize: fieldFont,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-bg-secondary)'
              e.currentTarget.style.color = 'var(--color-text)'
              e.currentTarget.style.borderColor = 'var(--color-border-strong, var(--color-border))'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
            aria-haspopup="menu"
            aria-expanded={addOpen}
            aria-label="Add filter"
          >
            <Plus size={13} aria-hidden="true" />
            Add filter
          </button>
          <Popover
            anchorRef={addRef}
            open={addOpen}
            onClose={() => setAddOpen(false)}
            align="start"
            width="13rem"
          >
            <div role="menu" aria-label="Filter type">
              {availableFilters.map(f => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  onClick={() => addFilter(f)}
                  className="w-full text-left"
                  style={{
                    padding: '0.4375rem 0.625rem',
                    background: 'transparent',
                    border: 'none',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Popover>
        </>
      )}
    </div>
  )
}

// ── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({
  def,
  value,
  initialOpen,
  onValueChange,
  onRemove,
  onEditorClosed,
  size,
}: {
  def: FilterDef
  value: string
  initialOpen: boolean
  onValueChange: (next: string) => void
  onRemove: () => void
  onEditorClosed: () => void
  size: 'md' | 'sm'
}) {
  const ref = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(initialOpen)
  React.useEffect(() => {
    if (initialOpen) setOpen(true)
  }, [initialOpen])

  const chipHeight = size === 'sm' ? '1.875rem' : '2.25rem'
  const chipFont = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)'
  const selected = def.options.find(o => o.value === value)

  return (
    <span style={{ display: 'inline-flex' }}>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center"
        style={{
          gap: '0.375rem',
          height: chipHeight,
          paddingLeft: '0.625rem',
          paddingRight: '0.25rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          fontSize: chipFont,
          fontWeight: 500,
          color: 'var(--color-text)',
          cursor: 'pointer',
          transition: 'border-color 150ms ease, background-color 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border-strong, var(--color-text-subtle))' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span style={{ color: 'var(--color-text-muted)' }}>{def.label}</span>
        {selected ? (
          selected.tone
            ? (
              <Badge tone={selected.tone} variant="soft" size="sm" leader={false}>
                {selected.label}
              </Badge>
            )
            : <span style={{ color: 'var(--color-text)' }}>{selected.label}</span>
        ) : (
          <span style={{ color: 'var(--color-text-subtle)' }}>Any</span>
        )}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }
          }}
          aria-label={`Remove ${def.label} filter`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.25rem',
            height: '1.25rem',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-subtle)',
            transition: 'background-color 120ms ease, color 120ms ease',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg-tertiary)'
            e.currentTarget.style.color = 'var(--color-text)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-subtle)'
          }}
        >
          <X size={12} aria-hidden="true" />
        </span>
      </button>
      <Popover
        anchorRef={ref}
        open={open}
        onClose={() => { setOpen(false); onEditorClosed() }}
        align="start"
        width="13rem"
      >
        <div role="listbox" aria-label={`${def.label} options`}>
          {def.options.map(opt => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onValueChange(opt.value)
                  setOpen(false)
                  onEditorClosed()
                }}
                className="w-full inline-flex items-center"
                style={{
                  gap: '0.5rem',
                  padding: '0.4375rem 0.625rem',
                  background: isSelected ? 'var(--color-bg-secondary)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 120ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--color-bg-secondary)' : 'transparent' }}
              >
                {opt.tone ? (
                  <Badge tone={opt.tone} variant="soft" size="sm" leader={false}>{opt.label}</Badge>
                ) : (
                  <span style={{ flex: 1 }}>{opt.label}</span>
                )}
                {!opt.tone && <span style={{ flex: 1 }} />}
                {isSelected && <Check size={13} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />}
              </button>
            )
          })}
        </div>
      </Popover>
    </span>
  )
}
