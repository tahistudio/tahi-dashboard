'use client'

/**
 * The controls a filter rail is built out of, lifted verbatim out of
 * components/tahi/requests/requests-rail.tsx so the Tasks rail composes the
 * same pieces rather than growing a second copy of them.
 *
 * Nothing here knows a vocabulary. A rail hands <RailSelect> a label and an
 * option list; the option list is the surface's business.
 *
 * Each control is a 36px full-width button (label left, value right, chevron
 * far right) whose options open in a portalled <Popover>, so the rail's own
 * scroll box can never clip a menu. An active control takes a brand border and
 * grows a clear button that sits inside it, just before the chevron. Pass
 * `searchable` when the option list keeps growing (clients). Pass `touch` for
 * 44px targets inside the mobile Filters sheet.
 *
 * A rail keeps one `openKey` in state and drives every control's `open` /
 * `onToggle` / `onClose` from it, so a second click elsewhere can never leave
 * two floating panels on screen.
 */

import * as React from 'react'
import { Check, ChevronDown, Search, X, Bookmark } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'

// -- Option shapes -----------------------------------------------------------

/** One option in a rail control. `dot` paints a leading colour dot, which is
 *  how a status option reads the same here as on every other surface. */
export interface RailOption {
  value: string
  label: string
  /** Colour token for a leading status dot. */
  dot?: string
}

/** One active filter, ready to render as a clearable chip. Built from the
 *  same option lists the controls use, so a chip can never disagree with the
 *  control that set it. */
export interface RailFilterChip {
  key: string
  dimension: string
  label: string
  dot?: string
}

/** Turn a filter record into chips. `dimensions` names each key and supplies
 *  its option list; `defaults` says what "not set" looks like per key. Only
 *  keys present in `dimensions` can raise a chip, so a dimension this
 *  audience does not have never shows one. */
export function buildRailChips(
  filters: Record<string, string>,
  defaults: Record<string, string>,
  dimensions: readonly { key: string; label: string; options: readonly RailOption[] }[],
): RailFilterChip[] {
  return dimensions
    .filter(d => filters[d.key] !== undefined && filters[d.key] !== defaults[d.key])
    .map(d => {
      const match = d.options.find(o => o.value === filters[d.key])
      return {
        key: d.key,
        dimension: d.label,
        label: match?.label ?? filters[d.key],
        dot: match?.dot,
      }
    })
}

// -- The select control ------------------------------------------------------

export interface RailSelectProps {
  label: string
  options: readonly RailOption[]
  value: string
  onChange: (next: string) => void
  open: boolean
  onToggle: () => void
  onClose: () => void
  /** Shows the clear button and paints the brand border. */
  active?: boolean
  onClear?: () => void
  /** Adds a filter field above the options. The client list keeps growing. */
  searchable?: boolean
  searchLabel?: string
  /** 44px targets for the mobile sheet. */
  touch?: boolean
}

export function RailSelect({
  label,
  options,
  value,
  onChange,
  open,
  onToggle,
  onClose,
  active = false,
  onClear,
  searchable = false,
  searchLabel = 'Search',
  touch = false,
}: RailSelectProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [term, setTerm] = React.useState('')

  // A stale search term would hide the options the next time the menu opens.
  React.useEffect(() => { if (!open) setTerm('') }, [open])

  const current = options.find(o => o.value === value)
  const needle = term.trim().toLowerCase()
  const visible = searchable && needle
    ? options.filter(o => o.label.toLowerCase().includes(needle))
    : options

  const height = touch ? '2.75rem' : '2.25rem'
  const optionHeight = touch ? '2.75rem' : '2.125rem'
  // The chevron stays pinned to the right edge in every state, so a row of
  // controls keeps one vertical line down the rail. The clear button is laid
  // over the gap just before it, and the value simply keeps clear of both.
  const clearSize = touch ? '2rem' : '1.25rem'
  const valueGutter = active ? (touch ? '3.125rem' : '2.375rem') : '0'

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className="tahi-focus-ring"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? value}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          minHeight: height,
          padding: '0 0.5rem 0 0.625rem',
          border: `1px solid ${active || open ? 'var(--color-brand)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg)',
          fontSize: touch ? '0.84375rem' : '0.78125rem',
          fontWeight: 600,
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'border-color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--color-brand)'
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = active || open ? 'var(--color-brand)' : 'var(--color-border)'
          e.currentTarget.style.background = 'var(--color-bg)'
        }}
      >
        <span style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }}>{label}</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            minWidth: 0,
            marginLeft: 'auto',
            marginRight: valueGutter,
            color: active ? 'var(--color-brand-dark)' : 'var(--color-text)',
          }}
        >
          {current?.dot && (
            <span
              aria-hidden="true"
              style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: current.dot, flexShrink: 0 }}
            />
          )}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current?.label ?? value}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: 'var(--color-text-subtle)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--motion-quick) var(--ease-out)',
          }}
        />
      </button>

      {active && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="tahi-focus-ring"
          title={`Clear the ${label.toLowerCase()} filter`}
          aria-label={`Clear the ${label.toLowerCase()} filter`}
          style={{
            position: 'absolute',
            top: '50%',
            right: '1.625rem',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: clearSize,
            height: clearSize,
            padding: 0,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-brand)'
            e.currentTarget.style.color = 'var(--color-text-on-dark)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-bg-tertiary)'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <X size={touch ? 14 : 11} aria-hidden="true" />
        </button>
      )}

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={onClose}
        width="15rem"
        maxHeight="22rem"
      >
        {searchable && (
          <div
            className="tahi-focus-within"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4375rem',
              minHeight: touch ? '2.75rem' : '2.25rem',
              padding: '0 0.625rem',
              flexShrink: 0,
            }}
          >
            <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              autoFocus
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: touch ? '1rem' : '0.8125rem',
                color: 'var(--color-text)',
              }}
            />
          </div>
        )}
        {searchable && (
          <div
            role="separator"
            aria-orientation="horizontal"
            style={{ height: '1px', background: 'var(--color-border-subtle)', flexShrink: 0 }}
          />
        )}
        <div role="listbox" aria-label={label} style={{ overflowY: 'auto', padding: '0.25rem', minHeight: 0 }}>
          {visible.length === 0 && (
            <p style={{ margin: 0, padding: '0.5rem 0.5625rem', fontSize: '0.78125rem', color: 'var(--color-text-subtle)' }}>
              No matches
            </p>
          )}
          {visible.map(option => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className="tahi-focus-ring"
                onClick={() => { onChange(option.value); onClose() }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  minHeight: optionHeight,
                  padding: '0 0.5rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: '0.78125rem',
                  fontWeight: selected ? 600 : 500,
                  color: 'var(--color-text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {option.dot && (
                  <span
                    aria-hidden="true"
                    style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: option.dot, flexShrink: 0 }}
                  />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {option.label}
                </span>
                {selected && <Check size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-brand)' }} />}
              </button>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}

// -- Saved view row ----------------------------------------------------------

export function RailViewItem({
  label,
  count,
  active,
  onClick,
  touch,
  icon,
  disabled = false,
  title,
}: {
  label: string
  /** null withholds the number: a count nobody has read yet is a guess. */
  count: number | null
  active: boolean
  onClick: () => void
  touch: boolean
  /** Leading glyph. The Notifications rail wears the kind's own icon here, so
   *  a filter row and the rows it returns read as the same thing. */
  icon?: React.ReactNode
  /** A row with nothing behind it. Still announced, never pressable: a filter
   *  that returns nothing should say so rather than take the click. */
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="tahi-focus-ring"
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        width: '100%',
        minHeight: touch ? '2.75rem' : '2.125rem',
        padding: '0 0.625rem',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-brand-50)' : 'transparent',
        fontFamily: 'inherit',
        fontSize: touch ? '0.84375rem' : '0.78125rem',
        fontWeight: 600,
        color: active ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        textAlign: 'left',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        if (active || disabled) return
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
        e.currentTarget.style.color = 'var(--color-text)'
      }}
      onMouseLeave={e => {
        if (active || disabled) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      {icon && (
        <span
          aria-hidden="true"
          style={{
            display: 'flex',
            flexShrink: 0,
            color: active ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
          }}
        >
          {icon}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {count !== null && (
        <span
          style={{
            flexShrink: 0,
            fontSize: '0.6875rem',
            fontVariantNumeric: 'tabular-nums',
            color: active ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
            opacity: active ? 0.75 : 1,
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function RailGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.625rem',
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.5rem',
      }}
    >
      {children}
    </div>
  )
}

// -- Save as default ---------------------------------------------------------

export function SaveDefaultControl({ isDefault, onSave, touch = false }: {
  isDefault: boolean
  onSave: () => void
  touch?: boolean
}) {
  const shared: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    minHeight: touch ? '2.75rem' : '2rem',
    padding: '0 0.5rem',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: '0.75rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }

  // One element across both states. Swapping the button for a <span> once the
  // view was saved destroyed the element holding focus, so a keyboard user who
  // pressed Enter here landed back on <body> and the next Tab restarted at the
  // top of the document. `aria-disabled` rather than `disabled` keeps the
  // settled control focusable and the label live, so the change announces in
  // place instead of vanishing silently.
  return (
    <button
      type="button"
      onClick={() => { if (!isDefault) onSave() }}
      aria-disabled={isDefault || undefined}
      className="tahi-focus-ring"
      title={isDefault
        ? 'This view, these filters, and this sort are already your default'
        : 'Remember this view, these filters, and this sort'}
      style={{
        ...shared,
        color: isDefault ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
        cursor: isDefault ? 'default' : 'pointer',
        transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        if (isDefault) return
        e.currentTarget.style.color = 'var(--color-brand-dark)'
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
      }}
      // No early return on leave, even once this IS the default. Clicking the
      // control with the mouse flips isDefault while the pointer is still
      // over it, and the hover background was written imperatively above;
      // React will not undo it, because the style prop's background reads
      // 'transparent' on both sides of the change and the diff is a no-op.
      // Skipping the reset left a permanently shaded pill.
      onMouseLeave={e => {
        e.currentTarget.style.color = isDefault ? 'var(--color-text-subtle)' : 'var(--color-text-muted)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {isDefault
        ? <Check size={13} aria-hidden="true" />
        : <Bookmark size={13} aria-hidden="true" />}
      <span aria-live="polite">{isDefault ? 'Your default' : 'Save as default'}</span>
    </button>
  )
}
