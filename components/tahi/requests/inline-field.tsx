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
 *
 * Keyboard rules the three editors share:
 *   - Every commit hands focus back to the trigger that opened the editor.
 *     Committing unmounts the input, and without this focus fell to <body>
 *     and the next Tab restarted at the top of the document.
 *   - The date editor never commits a half-typed value. A native date input
 *     fires `input` on every segment, so writing on change closed the editor
 *     after the first digit: an existing 2026-09-10 silently became
 *     2026-01-10, and a field with no date yet could not be set by keyboard
 *     at all. It now holds a draft and commits only complete dates, on
 *     change (so the picker still applies immediately), on Enter and on blur.
 *     Escape reverts.
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
      {/* nowrap is what makes the ellipsis real: text-overflow only applies to
          non-wrapping content, so without it a two-word assignee or phase name
          wrapped to a second line and grew the row instead of truncating. */}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
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
                onClick={() => {
                  setOpen(false)
                  onChange(o.value)
                  // Picking unmounts this item. <Popover> restores focus to
                  // the anchor when the panel was holding it, and this makes
                  // the keyboard path explicit rather than incidental.
                  requestAnimationFrame(() => ref.current?.focus())
                }}
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

/**
 * True when a native date input has all three segments filled with a real
 * calendar date. The element reports '' until then, and reports a complete
 * (but wrong) date the moment a single segment of an existing value changes,
 * which is why the editor cannot treat every `input` event as a commit.
 *
 * @internal Exported for the unit tests.
 */
export function isCompleteDateValue(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const [year, month, day] = raw.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

/**
 * What a commit should write, given the draft in the input and the value the
 * field currently holds. An empty draft clears the date; a complete draft
 * sets it; a half-typed draft is not a value at all, so it leaves the field
 * alone rather than writing a date the user never meant.
 *
 * @internal Exported for the unit tests.
 */
export function resolveDateCommit(
  draft: string,
  current: string | null,
): { changed: boolean; value: string | null } {
  const held = current ? current.slice(0, 10) : null
  if (draft === '') return { changed: held !== null, value: null }
  if (!isCompleteDateValue(draft)) return { changed: false, value: held }
  return { changed: draft !== held, value: draft }
}

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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : '')
  // What the parent last heard from this editor, so a value committed on
  // change is not written a second time on blur.
  const committed = useRef<string | null>(value ? value.slice(0, 10) : null)

  useEffect(() => {
    const next = value ? value.slice(0, 10) : ''
    setDraft(next)
    committed.current = next || null
  }, [value])

  if (readOnly) return <>{render(value)}</>

  function closeEditor() {
    setEditing(false)
    // The input is about to unmount. Without this, focus falls to <body> and
    // the next Tab restarts at the top of the document.
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function commit(raw: string) {
    const { changed, value: next } = resolveDateCommit(raw, committed.current)
    if (!changed) return
    committed.current = next
    onChange(next)
  }

  if (editing) {
    return (
      <input
        type="date"
        value={draft}
        autoFocus
        aria-label={ariaLabel}
        className="min-h-11 md:min-h-8"
        style={INPUT_STYLE}
        onChange={e => {
          const raw = e.target.value
          setDraft(raw)
          // The picker only ever emits complete dates, so this keeps the mouse
          // path instant. Typing stays safe because a half-typed value is not
          // complete, and the editor no longer closes itself here.
          if (isCompleteDateValue(raw)) commit(raw)
        }}
        // `badInput` is how the element says "there is something typed in here
        // that is not a date yet". Its value reads '' in that state, and
        // committing that would clear a due date the user was only part way
        // through changing.
        onBlur={e => {
          if (!e.target.validity.badInput) commit(e.target.value)
          closeEditor()
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!e.currentTarget.validity.badInput) commit(e.currentTarget.value)
            closeEditor()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            const reverted = value ? value.slice(0, 10) : ''
            setDraft(reverted)
            closeEditor()
          }
        }}
      />
    )
  }

  return (
    <InlineTrigger label={ariaLabel} buttonRef={triggerRef} onClick={() => setEditing(true)}>
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')

  useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])

  if (readOnly) return <>{render(value)}</>

  function closeEditor() {
    setEditing(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function commit() {
    const parsed = Number.parseFloat(draft)
    onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null)
    closeEditor()
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
            if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); closeEditor() }
          }}
        />
        {suffix && (
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{suffix}</span>
        )}
      </span>
    )
  }

  return (
    <InlineTrigger label={ariaLabel} buttonRef={triggerRef} onClick={() => setEditing(true)}>
      {render(value)}
    </InlineTrigger>
  )
}
