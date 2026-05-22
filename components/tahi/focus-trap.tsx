'use client'

/**
 * <FocusTrap>. Traps Tab + Shift+Tab inside the wrapped tree while active.
 *
 * Plus:
 *   Auto-focuses the first tabbable element (or `initialFocus` ref) on open.
 *   Restores focus to the previously focused element when deactivated.
 *   Esc key calls `onEscape` if provided.
 *
 * Use it for modals, drawers, popovers that should be modal.
 */

import * as React from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

interface FocusTrapProps {
  active: boolean
  children: React.ReactNode
  onEscape?: () => void
  initialFocus?: React.RefObject<HTMLElement | null>
  /** When true, restores focus to the previously focused element on deactivate. */
  restoreFocus?: boolean
  /** className passthrough on the wrapping div. */
  className?: string
  style?: React.CSSProperties
}

export function FocusTrap({
  active,
  children,
  onEscape,
  initialFocus,
  restoreFocus = true,
  className,
  style,
}: FocusTrapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const previouslyFocusedRef = React.useRef<Element | null>(null)

  React.useEffect(() => {
    if (!active) return

    previouslyFocusedRef.current = document.activeElement

    // Set initial focus on the next paint so the trap target is mounted.
    const t = setTimeout(() => {
      const target = initialFocus?.current ?? containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      target?.focus()
    }, 0)

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement as HTMLElement | null

      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (current === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', handleKeyDown, true)
      if (restoreFocus && previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus()
      }
    }
  }, [active, initialFocus, onEscape, restoreFocus])

  return <div ref={containerRef} className={className} style={style}>{children}</div>
}
