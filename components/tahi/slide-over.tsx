'use client'

/**
 * <SlideOver>. The shared right-side drawer primitive.
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
 * variant="center" turns the same shell into a centred modal: a blurred
 * backdrop, a 38.75rem panel that rises and scales in over 200ms, a body
 * capped by the panel's own 90vh height so long forms scroll inside it.
 * Under prefers-reduced-motion both variants cross-fade instead of moving.
 *
 * Both variants own the three focus behaviours a modal owes a keyboard user:
 * focus moves into the panel on open (and on every `contentKey` change), Tab
 * cycles inside it, and focus returns to the trigger on close. The Tab handler
 * is bound on document rather than the panel so it still fires when a body
 * swap has dropped focus on <body>. The right-hand drawer used to be exempt,
 * which left the mobile Filters sheet opening with focus still behind the
 * scrim; the focus-in step bails when focus is already inside the panel, so a
 * consumer that autofocuses its own field is unaffected either way.
 *
 * Escape closes the TOPMOST layer only. Inner layers (a Popover, a
 * ConfirmDialog, a picker with its own React keydown handler) either claim the
 * key with preventDefault or sit above this one on the shared overlay stack,
 * and this handler stands down in both cases. Before that, dismissing a client
 * picker inside the centred dialog unmounted the whole dialog with it.
 *
 * For short-form confirmations, <ConfirmDialog> is still the smaller tool.
 * For full-screen takeovers, use <FullScreenDialog> (not yet built).
 */

import React, { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { focusablesIn, lockBodyScroll, overlayLayers, shouldHandleEscape } from '@/components/tahi/overlay-stack'

const EXIT_MS = 220

export type SlideOverVariant = 'right' | 'center'

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
  /** When true, hides the default close (X) button. Pair it with a custom footer close action. */
  hideCloseButton?: boolean
  /**
   * 'right' (default) is the drawer. 'center' is a centred modal: blurred
   * backdrop, rise-and-scale entry, focus trapped inside the panel. Width
   * still comes from `maxWidth`, which defaults to 38.75rem when centred.
   */
  variant?: SlideOverVariant
  /**
   * Centred variant only. Changes to this value re-run the focus-into-panel
   * step, so a dialog that swaps its whole body (form to AI to confirmation)
   * never leaves focus on the <body> the unmounted control fell off. Feed it
   * whatever names the current body, e.g. the view.
   */
  contentKey?: string | number
  children: React.ReactNode
}

function SlideOverRoot({
  open,
  onClose,
  icon,
  title,
  subtitle,
  maxWidth,
  ariaLabel,
  hideCloseButton = false,
  variant = 'right',
  contentKey,
  children,
}: SlideOverProps) {
  const centred = variant === 'center'
  const panelWidth = maxWidth ?? (centred ? '38.75rem' : '28rem')
  const panelRef = useRef<HTMLDivElement>(null)
  const layerId = useId()
  // Track "rendered" separately from "open" so the close transition
  // can play before unmount. When open flips true → render immediately.
  // When open flips false → leave mounted, mark `closing`, unmount
  // after EXIT_MS.
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setRendered(true)
      setClosing(false)
      return
    }
    if (!rendered) return
    setClosing(true)
    const t = window.setTimeout(() => {
      setRendered(false)
      setClosing(false)
    }, EXIT_MS)
    return () => window.clearTimeout(t)
  }, [open, rendered])

  // Claim a layer while open so Escape only ever closes the topmost overlay.
  useEffect(() => {
    if (!open) return
    overlayLayers.push(layerId)
    return () => overlayLayers.remove(layerId)
  }, [open, layerId])

  // Escape closes, only while truly open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // A picker inside the panel may have already claimed the key, and a
      // Popover or ConfirmDialog stacked on top of this one owns it outright.
      if (!shouldHandleEscape(e, layerId)) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, layerId])

  // Body scroll lock, deliberately its own effect keyed on `open` alone.
  // Sharing the Escape effect meant every consumer's inline `onClose` arrow
  // re-ran the lock on each parent render, and a refcount that churns is a
  // refcount that can be observed mid-flight. The lock itself is shared and
  // counted, so a ConfirmDialog raised from inside this drawer no longer
  // captures 'hidden' as the value to restore.
  useEffect(() => {
    if (!open) return
    return lockBodyScroll()
  }, [open])

  // Both variants hand focus back to whatever opened them on close. Kept
  // apart from the focus-in effect below so a content swap cannot bounce focus
  // out to the opener and back.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  // Focus moves into the panel on open, and again whenever `contentKey`
  // changes: swapping the body unmounts whatever held focus, which drops it on
  // <body>, outside the panel and outside the trap.
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const el = panelRef.current
      if (!el) return
      // Already inside (a consumer focused its own field) : leave it there.
      const active = document.activeElement
      if (active && active !== el && el.contains(active)) return
      const first = focusablesIn(el)[0]
      ;(first ?? el).focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, contentKey])

  // Tab cycles inside the panel rather than escaping to the page under it.
  // Bound on document rather than the panel: after a body swap the focused
  // control is unmounted and the keydown fires on <body>, which a handler on
  // the panel node would never see.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const el = panelRef.current
      if (!el) return
      const items = focusablesIn(el)
      if (items.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const orphaned = !active || active === document.body || active === document.documentElement
      if (orphaned) {
        // Focus fell off an unmounted control onto <body>. Pull it back to
        // whichever end the Tab was heading for rather than letting it walk
        // the page behind the modal.
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      // Anything else outside the panel is a portalled child of it (the
      // searchable select renders its dropdown on document.body), so its own
      // keyboard handling is left alone.
      if (active !== el && !el.contains(active)) return
      if (e.shiftKey && (active === first || active === el)) {
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

  if (!rendered) return null

  const titleId = title ? 'slide-over-title' : undefined

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : ariaLabel}
      // -1 on both variants: the focus-in step falls back to the panel itself
      // when a body has no focusable control of its own.
      tabIndex={-1}
      className={centred ? 'slide-over-center-panel' : 'slide-over-panel'}
      style={centred
        ? {
            width: `min(${panelWidth}, 100%)`,
            maxHeight: '90vh',
            pointerEvents: 'auto',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
            outline: 'none',
            display: 'flex',
            flexDirection: 'column',
            animation: closing
              ? `slideOverModalOut ${EXIT_MS}ms ease-in forwards`
              : `slideOverModalIn var(--motion-base, 200ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)) both`,
          }
        : {
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 70,
            width: '100%',
            maxWidth: panelWidth,
            background: 'var(--color-bg)',
            boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.12)',
            // The panel is a focus target of last resort (tabIndex -1), so it
            // must not paint a browser outline when it takes focus itself.
            outline: 'none',
            display: 'flex',
            flexDirection: 'column',
            animation: closing
              ? `slideOverSlideOut ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1) forwards`
              : 'slideOverSlideIn 250ms cubic-bezier(0.22, 1, 0.36, 1)',
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
  )

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          // A scrim is always dark, in both themes, so it stays a literal
          // rgba the way <ConfirmDialog> already has it rather than a text
          // token that would invert to a white wash under .dark.
          background: centred ? 'rgba(18, 26, 15, 0.45)' : 'rgba(0, 0, 0, 0.3)',
          backdropFilter: centred ? 'blur(3px)' : undefined,
          animation: closing
            ? `slideOverFadeOut ${EXIT_MS}ms ease-in forwards`
            : 'slideOverFadeIn 200ms ease-out',
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel. Centred variant sits in a click-through flex frame so the
          backdrop underneath still closes on an outside click. */}
      {centred ? (
        <div className="slide-over-center-frame">{panel}</div>
      ) : (
        panel
      )}

      {/* Animation keyframes + mobile full-width rule */}
      <style>{`
        @keyframes slideOverFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideOverFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes slideOverSlideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes slideOverSlideOut {
          from { transform: translateX(0); }
          to   { transform: translateX(100%); }
        }
        @keyframes slideOverModalIn {
          from { opacity: 0; transform: translateY(0.875rem) scale(0.985); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes slideOverModalOut {
          from { opacity: 1; transform: none; }
          to   { opacity: 0; transform: translateY(0.5rem) scale(0.99); }
        }
        .slide-over-center-frame {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem;
          pointer-events: none;
        }
        @media (max-width: 40rem) {
          .slide-over-panel { max-width: 100% !important; }
          .slide-over-center-frame { padding: 0.75rem; }
          .slide-over-center-panel { max-height: 92vh !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Scoped to the centred variant. The drawer's slide is what its
             consumers already ship; only the new modal opts out here. */
          .slide-over-center-panel {
            animation-name: ${closing ? 'slideOverFadeOut' : 'slideOverFadeIn'} !important;
          }
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
