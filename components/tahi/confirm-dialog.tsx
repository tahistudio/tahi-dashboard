'use client'

/**
 * <ConfirmDialog>. The short-form confirmation in front of every destructive
 * write (archive, delete, bulk actions, drag-to-nest).
 *
 * It declares `role="dialog" aria-modal="true"`, so it owes a keyboard user
 * the behaviours a modal implies, and now implements them rather than only
 * announcing them: Cancel takes focus on open, Tab cycles inside the panel,
 * Escape cancels (topmost layer only, via the shared overlay stack), body
 * scroll is locked while it is up, and focus returns to whatever opened it.
 * Before this, activating Delete from a menu unmounted the item holding focus,
 * dropped focus on <body>, and left Tab walking the whole page behind the
 * scrim before it reached Cancel.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { focusablesIn, isOrphanedFocus, overlayLayers, shouldHandleEscape } from '@/components/tahi/overlay-stack'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'primary'
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  /** Optional third button between Cancel and Confirm. Renders in a
   *  muted style so it doesn't compete with the primary action.
   *  Common use: "Don't ask again", "Skip and remember", etc. */
  secondaryAction?: {
    label: string
    onClick: () => Promise<void> | void
  }
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
  secondaryAction,
}: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const layerId = useId()

  // Claim a layer while open so Escape closes this dialog and nothing under it.
  useEffect(() => {
    if (!open) return
    overlayLayers.push(layerId)
    return () => overlayLayers.remove(layerId)
  }, [open, layerId])

  // Escape cancels, plus the body scroll lock <SlideOver> already does. The
  // lock is skipped while an action is in flight for the same reason Cancel
  // is disabled then: the write is already on its way.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleEscape(e, layerId)) return
      if (loading) return
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onCancel, loading, layerId])

  // Focus lands on Cancel, never on the destructive button.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const el = panelRef.current
      if (!el) return
      const active = document.activeElement
      if (active && active !== el && el.contains(active)) return
      const target = cancelRef.current ?? focusablesIn(el)[0]
      if (target) target.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Tab cycles inside the panel. Bound on document because the control that
  // opened the dialog is usually a menu item that has already unmounted,
  // which leaves the keydown firing on <body>.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const el = panelRef.current
      if (!el) return
      const items = focusablesIn(el)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (isOrphanedFocus(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (!active || !el.contains(active)) return
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Focus returns to the opener on close. Skipped when the opener has gone
  // (the menu item that raised the dialog usually has), since re-focusing
  // <body> is what stranded focus in the first place.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    if (isOrphanedFocus(opener)) return
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  if (!open) return null

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
    }
  }

  async function handleSecondary() {
    if (!secondaryAction) return
    setLoading(true)
    try {
      await secondaryAction.onClick()
    } finally {
      setLoading(false)
    }
  }

  const confirmBg =
    variant === 'danger'  ? 'var(--color-danger)'
    : variant === 'primary' ? 'var(--color-brand)'
    : 'var(--color-warning)'
  const iconBg =
    variant === 'danger'  ? 'var(--color-danger-bg)'
    : variant === 'primary' ? 'var(--color-brand-50)'
    : 'var(--color-warning-bg)'
  const iconColor =
    variant === 'danger'  ? 'var(--color-danger)'
    : variant === 'primary' ? 'var(--color-brand)'
    : 'var(--color-warning)'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={panelRef}
        style={{
          background: 'var(--color-bg)',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '26rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <div
            style={{
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: '0.625rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: iconBg,
            }}
          >
            <AlertTriangle
              style={{
                width: '1.25rem',
                height: '1.25rem',
                color: iconColor,
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <h3
              id="confirm-dialog-title"
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--color-text)',
                margin: 0,
              }}
            >
              {title}
            </h3>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--color-text-muted)',
                marginTop: '0.375rem',
                lineHeight: 1.5,
              }}
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            className="tahi-focus-ring"
            onClick={onCancel}
            style={{
              padding: '0.25rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X style={{ width: '1.125rem', height: '1.125rem' }} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'flex-end',
            marginTop: '1.25rem',
          }}
        >
          <button
            ref={cancelRef}
            type="button"
            className="tahi-focus-ring"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
              minHeight: '2.75rem',
            }}
          >
            {cancelLabel}
          </button>
          {secondaryAction && (
            <button
              type="button"
              className="tahi-focus-ring"
              onClick={() => void handleSecondary()}
              disabled={loading}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-muted)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                minHeight: '2.75rem',
              }}
            >
              {secondaryAction.label}
            </button>
          )}
          <button
            type="button"
            className="tahi-focus-ring"
            onClick={() => void handleConfirm()}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              background: loading ? 'var(--color-text-subtle)' : confirmBg,
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              minHeight: '2.75rem',
            }}
          >
            {loading && <Loader2 style={{ width: '0.875rem', height: '0.875rem' }} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
