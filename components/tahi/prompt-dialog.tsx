/**
 * <PromptDialog> — Tahi-styled replacement for window.prompt().
 *
 * Browser native prompts are jarring, unstyled, blocking, and feel
 * unprofessional inside the dashboard. This is the brand-aligned modal we
 * use anywhere we need a quick string input from the user (save-as-template
 * names, rename flows, custom labels, etc).
 *
 * Pattern:
 *   const [open, setOpen] = useState(false)
 *   <PromptDialog
 *     open={open}
 *     title="Save as template"
 *     description="Give this template a name"
 *     defaultValue={proposal.title}
 *     placeholder="Template name"
 *     confirmLabel="Save"
 *     onConfirm={async (value) => { ... }}
 *     onCancel={() => setOpen(false)}
 *   />
 */
'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  description?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Resolves once the action is done. Throwing keeps the dialog open. */
  onConfirm: (value: string) => Promise<void> | void
  onCancel: () => void
  /** When true, an empty string is allowed. Default: false (Confirm disabled). */
  allowEmpty?: boolean
}

export function PromptDialog({
  open, title, description, defaultValue = '', placeholder, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  onConfirm, onCancel, allowEmpty = false,
}: Props) {
  const [value, setValue] = useState(defaultValue)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset value + focus when the dialog opens.
  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setSubmitting(false)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, defaultValue])

  // Esc to cancel, Cmd/Ctrl+Enter to confirm.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  async function handleConfirm() {
    const trimmed = value.trim()
    if (!allowEmpty && !trimmed) return
    setSubmitting(true)
    try {
      await onConfirm(trimmed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '26rem',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--space-5)',
        }}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 'var(--space-4)' }}>
          <div>
            <h3 id="prompt-dialog-title" style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              {title}
            </h3>
            {description && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0 0', lineHeight: 1.45 }}>
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            style={{
              padding: '0.375rem',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleConfirm() } }}
          placeholder={placeholder}
          autoFocus
          style={{
            width: '100%',
            padding: '0.625rem 0.75rem',
            fontSize: '0.875rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)',
            outline: 'none',
          }}
        />

        <div className="flex justify-end" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={submitting || (!allowEmpty && !value.trim())}
            style={{
              padding: '0.5rem 1.125rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'var(--color-brand)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 'var(--radius-leaf-sm)',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting || (!allowEmpty && !value.trim()) ? 0.55 : 1,
            }}
          >
            {submitting ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
