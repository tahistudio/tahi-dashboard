'use client'

/**
 * Inline rail editors for the request detail Details card.
 *
 * Each field reads as plain text with a quiet chevron on the right, and
 * turns into its editor on click. Three shapes cover every editable row:
 *
 *   <InlineMenuField>   Category, Priority, Assignee, Delivery phase
 *   <InlineDateField>   Due (native date input)
 *   <InlineNumberField> Estimated (number input with an "h" suffix)
 *
 * Read-only callers get the rendered value with no affordance at all, so a
 * client never sees a control they cannot use. Menus render through the
 * shared <Popover> so they escape the sidebar card's overflow.
 *
 * Touch targets: the trigger is 44px tall under `md` and compresses to the
 * rail's natural 2rem above it.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'

// ── Shared trigger ───────────────────────────────────────────────────────

const TRIGGER_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.4375rem',
  margin: '-0.1875rem -0.3125rem',
  padding: '0.1875rem 0.3125rem',
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--radius-sm)',
  font: 'inherit',
  fontSize: '0.8125rem',
  color: 'var(--color-text)',
  textAlign: 'right',
  cursor: 'pointer',
  // The negative margins above make the button's MARGIN box 0.625rem
  // narrower than its border box, and a plain 100% resolves against that
  // margin box. Cancelling the two margins here is what stops the chevron
  // from stealing 10px off the chip's right edge in every rail row. The
  // inner span keeps its ellipsis, so long names still truncate.
  maxWidth: 'calc(100% + 0.625rem)',
  transition: 'background-color 130ms ease',
}

function InlineTrigger({
  label,
  expanded,
  onClick,
  buttonRef,
  children,
}: {
  label: string
  expanded?: boolean
  onClick: () => void
  buttonRef?: React.RefObject<HTMLButtonElement | null>
  children: React.ReactNode
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      {...(expanded !== undefined ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': expanded } : {})}
      onClick={onClick}
      className="tahi-focus-ring min-h-11 md:min-h-8"
      style={TRIGGER_STYLE}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
      <ChevronDown
        size={13}
        aria-hidden="true"
        style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }}
      />
    </button>
  )
}

/** The muted placeholder used when a field has no value. */
export function InlineNone({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--color-text-subtle)', fontWeight: 500 }}>{children}</span>
}

const INPUT_STYLE: React.CSSProperties = {
  height: '2rem',
  padding: '0 0.5625rem',
  border: '1px solid var(--color-brand)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-bg)',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  outline: 'none',
  boxShadow: '0 0 0 3px var(--color-brand-50)',
}

// ── Menu field ───────────────────────────────────────────────────────────

export interface InlineMenuOption {
  value: string
  /** Plain label. Ignored when `node` is supplied. */
  label?: string
  /** Rich label (a chip, an avatar row). */
  node?: React.ReactNode
  /** Leading dot colour, for status-like vocabularies. */
  dot?: string
  /** Extra text matched by the search box. */
  keywords?: string
}

export function InlineMenuField({
  value,
  options,
  onChange,
  renderValue,
  ariaLabel,
  readOnly = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  emptyMessage = 'Nothing to pick',
  width = '14rem',
}: {
  value: string
  options: InlineMenuOption[]
  onChange: (next: string) => void
  renderValue: (value: string) => React.ReactNode
  ariaLabel: string
  readOnly?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  emptyMessage?: string
  width?: string
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => { if (!open) setQuery('') }, [open])

  if (readOnly) return <>{renderValue(value)}</>

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter(o =>
        (o.label ?? '').toLowerCase().includes(q) ||
        (o.keywords ?? '').toLowerCase().includes(q))
    : options

  return (
    <>
      <InlineTrigger
        label={ariaLabel}
        expanded={open}
        buttonRef={ref}
        onClick={() => setOpen(o => !o)}
      >
        {renderValue(value)}
      </InlineTrigger>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="end" width={width}>
        {searchable && (
          <div
            className="tahi-focus-within"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.375rem 0.5rem',
              borderBottom: '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-secondary)',
              flexShrink: 0,
            }}
          >
            <Search size={12} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoFocus
              style={{
                width: '100%',
                padding: '0.25rem 0',
                fontSize: '0.75rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text)',
                outline: 'none',
              }}
            />
          </div>
        )}
        <div
          role="menu"
          aria-label={ariaLabel}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.25rem' }}
        >
          {filtered.length === 0 ? (
            <p style={{ margin: 0, padding: '0.75rem 0.625rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              {emptyMessage}
            </p>
          ) : filtered.map(o => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); onChange(o.value) }}
                className="tahi-focus-ring min-h-11 md:min-h-8"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: '0.375rem 0.5rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: active ? 'var(--color-bg-secondary)' : 'transparent',
                  fontSize: '0.8125rem',
                  color: 'var(--color-text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = active ? 'var(--color-bg-secondary)' : 'transparent' }}
              >
                {o.dot && (
                  <span
                    aria-hidden="true"
                    style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', background: o.dot, flexShrink: 0 }}
                  />
                )}
                <span style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
                  {o.node ?? o.label ?? o.value}
                </span>
                {active && (
                  <Check size={13} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-brand)' }} />
                )}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

// ── Date field ───────────────────────────────────────────────────────────

export function InlineDateField({
  value,
  onChange,
  render,
  ariaLabel,
  readOnly = false,
}: {
  /** ISO date (YYYY-MM-DD) or null. */
  value: string | null
  onChange: (next: string | null) => void
  render: (value: string | null) => React.ReactNode
  ariaLabel: string
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(false)

  if (readOnly) return <>{render(value)}</>

  if (editing) {
    return (
      <input
        type="date"
        defaultValue={value ? value.slice(0, 10) : ''}
        autoFocus
        aria-label={ariaLabel}
        className="min-h-11 md:min-h-8"
        style={INPUT_STYLE}
        onChange={e => { onChange(e.target.value || null); setEditing(false) }}
        onBlur={() => setEditing(false)}
        onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
      />
    )
  }

  return (
    <InlineTrigger label={ariaLabel} onClick={() => setEditing(true)}>
      {render(value)}
    </InlineTrigger>
  )
}

// ── Number field ─────────────────────────────────────────────────────────

export function InlineNumberField({
  value,
  onChange,
  render,
  ariaLabel,
  suffix,
  readOnly = false,
  min = 0,
  step = 0.5,
}: {
  value: number | null
  onChange: (next: number | null) => void
  render: (value: number | null) => React.ReactNode
  ariaLabel: string
  suffix?: string
  readOnly?: boolean
  min?: number
  step?: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])

  if (readOnly) return <>{render(value)}</>

  function commit() {
    const parsed = Number.parseFloat(draft)
    onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null)
    setEditing(false)
  }

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3125rem' }}>
        <input
          type="number"
          min={min}
          step={step}
          value={draft}
          autoFocus
          aria-label={ariaLabel}
          className="min-h-11 md:min-h-8"
          style={{ ...INPUT_STYLE, width: '4.5rem', textAlign: 'right' }}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) }
          }}
        />
        {suffix && (
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{suffix}</span>
        )}
      </span>
    )
  }

  return (
    <InlineTrigger label={ariaLabel} onClick={() => setEditing(true)}>
      {render(value)}
    </InlineTrigger>
  )
}
