'use client'

/**
 * <SlideOver> — the shared right-side drawer primitive.
 *
 * Use for :
 *   - AI wizards (task, request)
 *   - Filter panels
 *   - Settings side-sheets
 *   - Notification detail
 *   - Any "contextual, temporary surface that slides in from the right"
 *
 *   <SlideOver
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     title="Draft a request with AI"
 *     icon={<Sparkles size={15} />}
 *     maxWidth="28rem"
 *   >
 *     <SlideOver.Body>...</SlideOver.Body>
 *     <SlideOver.Footer>
 *       <TahiButton>Submit</TahiButton>
 *     </SlideOver.Footer>
 *   </SlideOver>
 *
 * Behaviours baked in :
 *   - Semi-transparent backdrop, click closes
 *   - Slide-in animation from the right (250ms ease-out)
 *   - Shadow-lg on the panel for clear elevation
 *   - `role="dialog"` + `aria-modal` + `aria-labelledby` for screen readers
 *   - Escape closes
 *   - Body scroll locked while open
 *   - Mobile : full-width (max-width cap is desktop-only)
 *   - Optional header with icon + title + close button
 *
 * For MODAL dialogs (centered, short-form confirmation), use <ConfirmDialog>.
 * For full-screen takeovers, use <FullScreenDialog> (not yet built).
 */

import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface SlideOverProps {
  open: boolean
  onClose: () => void
  /** Icon rendered in the header's leaf-radius wrapper. Omit for no-header slide-overs. */
  icon?: React.ReactNode
  /** Header title text. Required if you want a header rendered. */
  title?: string
  /** Optional sub-line under the title. */
  subtitle?: string
  /** Max width on desktop. Defaults to 28rem. Use 34rem for dense/form wizards. */
  maxWidth?: string
  /** Accessible label when no title is rendered. */
  ariaLabel?: string
  /** When true, hides the default close (X) button — use in combination with a custom footer close action. */
  hideCloseButton?: boolean
  children: React.ReactNode
}

function SlideOverRoot({
  open,
  onClose,
  icon,
  title,
  subtitle,
  maxWidth = '28rem',
  ariaLabel,
  hideCloseButton = false,
  children,
}: SlideOverProps) {
  // Escape closes + body scroll lock
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const titleId = title ? 'slide-over-title' : undefined

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          background: 'rgba(0, 0, 0, 0.3)',
          animation: 'slideOverFadeIn 200ms ease-out',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : ariaLabel}
        className="slide-over-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 70,
          width: '100%',
          maxWidth,
          background: 'var(--color-bg)',
          boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideOverSlideIn 250ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Header (rendered if title is set) */}
        {title && (
          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--color-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              flexShrink: 0,
            }}
          >
            {icon && (
              <div
                aria-hidden="true"
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--radius-leaf-sm)',
                  background: 'var(--color-brand-50)',
                  color: 'var(--color-brand)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {icon}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  fontSize: 'var(--text-md)',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  letterSpacing: '-0.005em',
                }}
              >
                {title}
              </h2>
              {subtitle && (
                <p style={{ margin: 'var(--space-0-5) 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {subtitle}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center"
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background 150ms ease, color 150ms ease',
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                  e.currentTarget.style.color = 'var(--color-text)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {children}
      </div>

      {/* Animation keyframes + mobile full-width rule */}
      <style>{`
        @keyframes slideOverFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideOverSlideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @media (max-width: 40rem) {
          .slide-over-panel { max-width: 100% !important; }
        }
      `}</style>
    </>
  )
}

/** Scrollable body region inside a SlideOver. */
function SlideOverBody({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-5)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** Sticky footer with bordered top divider. */
function SlideOverFooter({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        padding: 'var(--space-4) var(--space-5)',
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        flexShrink: 0,
        background: 'var(--color-bg)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export const SlideOver = Object.assign(SlideOverRoot, {
  Body: SlideOverBody,
  Footer: SlideOverFooter,
})
