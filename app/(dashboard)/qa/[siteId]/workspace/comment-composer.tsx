'use client'

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Textarea } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { QA_COMMENT_BODY_MAX } from '@/lib/qa/types'
import { oneLine } from './comments-helpers'

/** Show the counter once the body is within this many characters of the limit. */
const COUNTER_THRESHOLD = 400

export interface CommentComposerProps {
  open: boolean
  viewportLabel: string
  elementTag: string | null
  elementText: string | null
  /** Resolves when the comment is saved. Rejects with a readable message to keep the composer open. */
  onSave: (body: string) => Promise<void>
  onCancel: () => void
  /** Reports the typed text on every change (and '' on unmount) so the parent can protect a draft. */
  onDraftChange?: (text: string) => void
  /** Increase to flash the card, for example when a pick was ignored to protect the draft. */
  pulseSignal?: number
  /** Positioning is the parent's job. The card is absolutely positioned and sized by the caller. */
  style?: CSSProperties
}

const CARD_STYLE: CSSProperties = {
  position: 'absolute',
  maxWidth: '22rem',
  width: 'max-content',
  zIndex: 30,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-leaf-sm)',
  boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(18, 26, 15, 0.18))',
  padding: '0.75rem',
}

const SNIPPET_STYLE: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
}

/**
 * Small dialog-like card for writing a comment on a picked element. Esc cancels,
 * Cmd or Ctrl plus Enter saves. The textarea takes focus when the card opens.
 */
export function CommentComposer({
  open,
  viewportLabel,
  elementTag,
  elementText,
  onSave,
  onCancel,
  onDraftChange,
  pulseSignal = 0,
  style,
}: CommentComposerProps) {
  const titleId = useId()
  const textareaId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    onDraftChange?.(body)
  }, [body, onDraftChange])

  useEffect(() => () => onDraftChange?.(''), [onDraftChange])

  useEffect(() => {
    if (pulseSignal === 0) return
    setPulsing(false)
    const frame = window.requestAnimationFrame(() => setPulsing(true))
    return () => window.cancelAnimationFrame(frame)
  }, [pulseSignal])

  useEffect(() => {
    if (!open) return
    cardRef.current?.querySelector('textarea')?.focus()
  }, [open])

  if (!open) return null

  const trimmed = body.trim()
  const canSave = trimmed.length > 0 && !saving
  const remaining = QA_COMMENT_BODY_MAX - body.length
  const showCounter = body.length >= QA_COMMENT_BODY_MAX - COUNTER_THRESHOLD
  const snippet = oneLine(elementText)

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the comment.')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void save()
    }
  }

  return (
    <div
      ref={cardRef}
      role="dialog"
      data-qa-composer=""
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
      style={{ ...CARD_STYLE, ...style }}
      className={pulsing ? 'flex flex-col qa-composer-pulse' : 'flex flex-col'}
      onAnimationEnd={() => setPulsing(false)}
    >
      <div className="flex flex-col" style={{ gap: '0.5rem' }}>
        <div className="flex min-w-0 flex-wrap items-baseline" style={{ gap: '0.25rem 0.5rem' }}>
          <h2
            id={titleId}
            className="text-[var(--color-text)]"
            style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700 }}
          >
            Add comment
          </h2>
          <span className="text-[var(--color-text-subtle)]" style={{ fontSize: '0.75rem' }}>{viewportLabel}</span>
        </div>

        <div className="flex min-w-0 items-baseline" style={{ gap: '0.375rem' }}>
          <code
            className="shrink-0 rounded-[var(--radius-leaf-sm)] bg-[var(--color-bg-tertiary)] px-1.5 text-[var(--color-text)]"
            style={{ fontSize: '0.75rem', lineHeight: 1.5 }}
          >
            {`<${elementTag ?? 'element'}>`}
          </code>
          {snippet ? <span style={SNIPPET_STYLE} title={snippet}>{snippet}</span> : null}
        </div>

        <div className="flex flex-col" style={{ gap: '0.25rem' }}>
          <label htmlFor={textareaId} className="sr-only">Comment</label>
          <Textarea
            id={textareaId}
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={4}
            maxLength={QA_COMMENT_BODY_MAX}
            placeholder="What should change here?"
            aria-invalid={error !== null}
          />
          {showCounter ? (
            <span
              className={remaining <= 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}
              style={{ fontSize: '0.75rem', alignSelf: 'flex-end' }}
            >
              {remaining} characters left
            </span>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-[var(--color-danger)]" style={{ margin: 0, fontSize: '0.8125rem' }}>
            {error}
          </p>
        ) : null}

        <div className="flex justify-end" style={{ gap: '0.5rem' }}>
          <TahiButton variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </TahiButton>
          <TahiButton variant="primary" size="sm" onClick={() => void save()} disabled={!canSave} loading={saving}>
            Save
          </TahiButton>
        </div>
      </div>
    </div>
  )
}
