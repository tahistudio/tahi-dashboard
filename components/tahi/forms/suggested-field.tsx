'use client'

/**
 * <SuggestedField> and <SuggestedLabel>.
 *
 * A suggested value is written straight into the real control, so it is a real
 * value on submit with no extra accept step: the operator's job is to notice
 * it and change it if it is wrong, not to confirm it. What these two add is
 * the noticing.
 *
 * Colour is never the only signal. The tint on the control is the quiet half;
 * the word "Suggested" beside the label and the one-line reason underneath are
 * what actually say it, so the field still reads as suggested with the tint
 * unseen, in dark mode, or through a screen reader.
 *
 * No confidence number reaches the operator. The threshold already ran on the
 * server, and a percentage on screen invites arguing with a guess instead of
 * correcting it.
 *
 * Split in two because the two halves have different homes: the tint and the
 * caption wrap the control, and the chip plus the Clear link go in the `after`
 * slot beside the label, which is where a focusable element can live without
 * stealing the click that should land on the field.
 */

import * as React from 'react'
import { Sparkles } from 'lucide-react'

export interface SuggestedFieldProps {
  suggested: boolean
  /** The one sentence rendered under the field, wired by aria-describedby. */
  reason?: string
  /** The control's own id. The caption takes `${fieldId}-reason`. */
  fieldId: string
  /** The real control, with the suggested value already set on it. */
  children: React.ReactNode
}

/** The id a suggested field's caption takes, for the control's aria-describedby. */
export function suggestionReasonId(fieldId: string): string {
  return `${fieldId}-reason`
}

export function SuggestedField({
  suggested, reason, fieldId, children,
}: SuggestedFieldProps): React.ReactElement {
  if (!suggested) return <>{children}</>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3125rem' }}>
      {/* The tint sits on a wrapper rather than on the control itself: half
          these controls are a SearchableSelect or a SegmentedControl that
          paints its own background straight over an inline style. */}
      <div
        style={{
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-input)',
          padding: '0.1875rem',
        }}
      >
        {children}
      </div>
      {reason && (
        <p
          id={suggestionReasonId(fieldId)}
          style={{
            margin: 0,
            fontSize: '0.71875rem',
            fontWeight: 500,
            lineHeight: 1.45,
            color: 'var(--color-text-subtle)',
          }}
        >
          {reason}
        </p>
      )}
    </div>
  )
}

/**
 * The chip and the Clear link beside a suggested field's label.
 *
 * At 375px the label row wraps and this whole span drops to a second line,
 * with the caption below it, which is why the chip and the link are one
 * inline-flex rather than two siblings of the label.
 */
export function SuggestedLabel({
  onClear, label,
}: {
  onClear: () => void
  /** Names the field in the Clear button's accessible name. */
  label: string
}): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.125rem 0.4375rem',
          borderRadius: 'var(--radius-badge)',
          background: 'var(--color-brand-100)',
          color: 'var(--color-brand-dark)',
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        }}
      >
        <Sparkles size={14} aria-hidden="true" />
        Suggested
      </span>
      <SuggestionLink onClick={onClear} ariaLabel={`Clear the suggested ${label}`}>
        Clear
      </SuggestionLink>
    </span>
  )
}

/**
 * A quiet text link with 44px of touch reach and none of the ink.
 *
 * Restated rather than imported: the request dialog's <QuietLink> is a
 * file-local helper inside a 2,600 line client component the task dialog does
 * not import from, and lifting it out would mean reshaping a shipped surface
 * for the sake of one button.
 */
export function SuggestionLink({
  onClick, ariaLabel, children,
}: {
  onClick: () => void
  ariaLabel?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="tahi-focus-ring"
      style={{
        position: 'relative',
        margin: 0,
        // 44px of reach comes from the padding, so the link stays a link.
        padding: '0.625rem 0',
        minHeight: '2.75rem',
        border: 'none',
        background: 'none',
        color: 'var(--color-brand-dark)',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
        borderRadius: 'var(--radius-button)',
      }}
      onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
    >
      {children}
    </button>
  )
}
