'use client'

/**
 * Inline editors for a detail rail row: a menu field, a date field and a
 * number field. Built for the Requests detail and reused by the Tasks detail,
 * which is why they live here rather than under requests/.
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
 *   - Closing an editor hands focus back to the trigger that opened it, but
 *     only when focus was orphaned on <body> by the unmount. Blur closes an
 *     editor too, and blur is exactly the case where the user has already
 *     moved focus somewhere deliberate: tabbing out, or clicking the next
 *     row's trigger. Refocusing unconditionally killed both.
 *   - Nothing writes on change. A native date input reports a COMPLETE value
 *     the moment every segment is non-empty, so retyping the month of an
 *     existing 2026-09-10 emits 2026-01-10 on the way to 2026-12-10, and
 *     committing that persisted a request eight months early. The editor
 *     holds a draft and writes on Enter and on blur only.
 *   - An editor's baseline is the value it opened on, captured once. Escape
 *     reverts to that, so a parent update landing mid-edit (an optimistic
 *     patch, a refetch) cannot become the "original".
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { isOrphanedFocus } from '@/components/tahi/overlay-stack'

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
  // Matches the Details row's value cell (the prototype's `.dr-v`), so an
  // editable row and a read-only one read at exactly the same weight.
  fontSize: '0.78125rem',
  fontWeight: 600,
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
  borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)',
  fontSize: '0.78125rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  outline: 'none',
  // A mix rather than --color-brand-50, so the halo stays a tint of the brand
  // on the dark surface too instead of a pale block.
  boxShadow: '0 0 0 0.1875rem color-mix(in srgb, var(--color-brand) 14%, transparent)',
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

/**
 * What a keystroke in the menu's search box does: update the box, and tell
 * the caller so a server-backed picker can fetch.
 *
 * A function rather than two inline statements so the contract is pinned by a
 * test in a repo with no render tests: every keystroke is reported, including
 * the one that empties the box, and an absent callback is fine (which is the
 * four call sites that do not search a server).
 */
export function menuQueryChange(next: string, notify?: (query: string) => void): string {
  notify?.(next)
  return next
}

/**
 * The local search pass over the options.
 *
 * `serverFiltered` turns it off, and that is not an optimisation. A
 * server-searched option carries a rich `node` and no `label`, so running
 * this over it would drop every row the server matched on a title or a
 * request number, and the picker would look permanently empty.
 */
export function filterMenuOptions(
  options: readonly InlineMenuOption[],
  query: string,
  serverFiltered = false,
): InlineMenuOption[] {
  const q = query.trim().toLowerCase()
  if (serverFiltered || !q) return [...options]
  return options.filter(o =>
    (o.label ?? '').toLowerCase().includes(q) ||
    (o.keywords ?? '').toLowerCase().includes(q))
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
  onQueryChange,
  serverFiltered = false,
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
  /** Called on every keystroke in the search box, so a caller can fetch. */
  onQueryChange?: (query: string) => void
  /** Set when the caller has already filtered (server search). The local
   *  label/keywords pass is then skipped, because it would drop rows the
   *  server matched on a field that is not on the option. */
  serverFiltered?: boolean
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Closing clears the box, and it goes through the same helper a keystroke
  // does so the caller's copy is cleared with it. Setting the local state
  // alone left a server-backed caller holding the last search: reopening
  // showed the previous results under an empty box, with an empty-state line
  // written for a query nobody had typed.
  useEffect(() => { if (!open) setQuery(menuQueryChange('', onQueryChange)) }, [open, onQueryChange])

  if (readOnly) return <>{renderValue(value)}</>

  const filtered = filterMenuOptions(options, query, serverFiltered)

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
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="end" width={width} label={ariaLabel}>
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
              onChange={e => setQuery(menuQueryChange(e.target.value, onQueryChange))}
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
                  // the keyboard path explicit rather than incidental. Guarded
                  // the same way, so it cannot pull focus off a control the
                  // click has already moved on to.
                  requestAnimationFrame(() => {
                    if (isOrphanedFocus(document.activeElement)) ref.current?.focus()
                  })
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

/** One open editing session of the Due field. */
export interface DateEditorState {
  /** What the input shows right now. */
  draft: string
  /**
   * The value the editor opened on, as YYYY-MM-DD or ''. It is the baseline
   * every commit is measured against and what Escape restores, and it never
   * changes for the life of a session, so a parent update landing mid-edit
   * cannot become the "original".
   */
  opened: string
}

/**
 * What the editor can be told. `input` is every keystroke and every picker
 * selection; `commit` is Enter and blur; `cancel` is Escape.
 *
 * `badInput` is how a native date input says "there is something typed in
 * here that is not a date yet". Its value reads '' in that state, and
 * committing that would clear a due date the user was only part way through.
 */
export type DateEditorEvent =
  | { type: 'input'; raw: string }
  | { type: 'commit'; raw: string; badInput?: boolean }
  | { type: 'cancel' }

export interface DateEditorResult {
  state: DateEditorState
  /**
   * The value to hand the parent. Absent when the event writes nothing;
   * `null` clears the date.
   */
  write?: string | null
  /** True when the editor should close and hand focus back. */
  close: boolean
}

/** Opens a session on the value the field currently holds. */
export function openDateEditor(value: string | null): DateEditorState {
  const opened = value ? value.slice(0, 10) : ''
  return { draft: opened, opened }
}

/**
 * The Due editor's whole policy, as a pure function so the sequence a real
 * date input emits can be driven by a test.
 *
 * The rule that matters: `input` never writes. A native date input reports a
 * COMPLETE value as soon as every segment is non-empty, so retyping one
 * segment of an existing 2026-09-10 emits 2026-01-10 before it emits
 * 2026-12-10. Committing on change turned that intermediate into a real
 * PATCH, an audit-log entry and a due-date automation, and Escape could not
 * undo it because the revert read back a `value` prop the optimistic patch
 * had already overwritten. Only Enter and blur write, and they measure
 * against the value the session opened on.
 *
 * @internal Exported for the unit tests.
 */
export function reduceDateEditor(state: DateEditorState, event: DateEditorEvent): DateEditorResult {
  if (event.type === 'input') {
    return { state: { ...state, draft: event.raw }, close: false }
  }
  if (event.type === 'cancel') {
    return { state: { ...state, draft: state.opened }, close: true }
  }
  if (event.badInput) return { state, close: true }
  const { changed, value } = resolveDateCommit(event.raw, state.opened || null)
  if (!changed) return { state: { ...state, draft: event.raw }, close: true }
  return { state: { ...state, draft: event.raw }, write: value, close: true }
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
  // The session drives the render; the ref is the authoritative copy the event
  // handlers read. Handlers on an unmounting input can fire with a closure
  // from the render before the commit, and reading the ref is what stops a
  // trailing blur after Enter from writing the same value twice.
  const [session, setSession] = useState<DateEditorState | null>(null)
  const sessionRef = useRef<DateEditorState | null>(null)

  if (readOnly) return <>{render(value)}</>

  function moveSession(next: DateEditorState | null) {
    sessionRef.current = next
    setSession(next)
  }

  function returnFocus() {
    // The input has just unmounted. Pull focus back only when it landed on
    // <body>: blur closes this editor too, and there the user has already
    // moved focus somewhere deliberate (the next Tab stop, the next row's
    // trigger) that must not be stolen.
    requestAnimationFrame(() => {
      if (isOrphanedFocus(document.activeElement)) triggerRef.current?.focus()
    })
  }

  function apply(event: DateEditorEvent) {
    const current = sessionRef.current
    if (!current) return
    const { state, write, close } = reduceDateEditor(current, event)
    if (write !== undefined) onChange(write)
    if (close) {
      moveSession(null)
      returnFocus()
    } else {
      moveSession(state)
    }
  }

  if (session) {
    return (
      <input
        type="date"
        value={session.draft}
        autoFocus
        aria-label={ariaLabel}
        className="min-h-11 md:min-h-8"
        style={INPUT_STYLE}
        onChange={e => apply({ type: 'input', raw: e.target.value })}
        onBlur={e => apply({ type: 'commit', raw: e.target.value, badInput: e.target.validity.badInput })}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply({ type: 'commit', raw: e.currentTarget.value, badInput: e.currentTarget.validity.badInput })
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            apply({ type: 'cancel' })
          }
        }}
      />
    )
  }

  return (
    <InlineTrigger
      label={ariaLabel}
      buttonRef={triggerRef}
      onClick={() => moveSession(openDateEditor(value))}
    >
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
  const [draft, setDraft] = useState('')
  // The value the editor opened on, captured once. It is the baseline a
  // commit is measured against and what Escape restores, so a parent update
  // landing mid-edit cannot become the "original", and it is updated by a
  // commit so a trailing blur cannot write the same value twice.
  const opened = useRef<number | null>(null)

  if (readOnly) return <>{render(value)}</>

  function openEditor() {
    opened.current = value
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function closeEditor() {
    setEditing(false)
    // Same guard as the date editor: blur closes this too, and there focus
    // has already gone somewhere the user chose.
    requestAnimationFrame(() => {
      if (isOrphanedFocus(document.activeElement)) triggerRef.current?.focus()
    })
  }

  function commit() {
    const parsed = Number.parseFloat(draft)
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null
    if (next !== opened.current) {
      opened.current = next
      onChange(next)
    }
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
            if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(opened.current != null ? String(opened.current) : '')
              closeEditor()
            }
          }}
        />
        {suffix && (
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{suffix}</span>
        )}
      </span>
    )
  }

  return (
    <InlineTrigger label={ariaLabel} buttonRef={triggerRef} onClick={openEditor}>
      {render(value)}
    </InlineTrigger>
  )
}
