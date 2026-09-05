'use client'

/**
 * useBottomSheet - everything a mobile bottom sheet in the shell needs to be a
 * real modal dialog, in one place, so the nav's More sheet and the top bar's
 * More sheet cannot drift.
 *
 * It covers:
 *   - Escape dismisses, but only when this sheet is the topmost overlay. The
 *     sheet joins the shared `overlayLayers` stack, so a popover, a picker or
 *     a ConfirmDialog opened from inside it owns Escape first. Without that,
 *     backing out of the currency list closed the whole sheet with it, and
 *     registration order could not save it: the sheet opens first, so its
 *     document listener also runs first.
 *   - The scrim dismisses on the same rule, armed on mousedown. A nested
 *     popover closes on mousedown, which would otherwise leave the sheet
 *     topmost again by the time the click bubbled to the scrim.
 *   - The page underneath stops scrolling, through the shared refcounted lock
 *     rather than a private write to body.style, so a dialog raised from
 *     inside the sheet cannot capture 'hidden' as the value to restore.
 *   - Focus moves into the panel on open, Tab cycles inside it, and focus
 *     returns to whatever opened the sheet on close. The panel is announced
 *     `aria-modal="true"`, which removes the trigger from the accessibility
 *     tree, so leaving focus parked on it was leaving it on a node the screen
 *     reader no longer exposes.
 *   - A route change closes it (a link inside it was tapped).
 *
 * `close` is held in a ref, so a caller passing a fresh closure on every
 * render does not re-subscribe the listeners.
 *
 * Wire the two handles it returns: `panelRef` on the sheet panel (give the
 * panel `tabIndex={-1}` so an empty sheet still has somewhere to put focus)
 * and `overlayProps` on the scrim.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { usePathname } from 'next/navigation'
import {
  focusablesIn,
  isOrphanedFocus,
  lockBodyScroll,
  overlayLayers,
  shouldDismissOnBackdrop,
  shouldHandleEscape,
} from '@/components/tahi/overlay-stack'

export interface BottomSheetHandles {
  /** Attach to the sheet panel. The hook focuses, traps and restores through it. */
  panelRef: RefObject<HTMLDivElement | null>
  /** Spread onto the scrim. Dismisses on a scrim-only press with nothing above. */
  overlayProps: {
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => void
    onClick: (e: ReactMouseEvent<HTMLElement>) => void
  }
}

export function useBottomSheet(open: boolean, close: () => void): BottomSheetHandles {
  const pathname = usePathname()
  const closeRef = useRef(close)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const armedRef = useRef(false)
  const layerId = useId()

  useEffect(() => { closeRef.current = close })

  // A tap on a link inside the sheet navigates; close so the new page is not
  // left sitting behind the scrim.
  useEffect(() => { closeRef.current() }, [pathname])

  // Claim a layer while open, so everything below stands down and everything
  // opened from inside the sheet stacks above it.
  useEffect(() => {
    if (!open) return
    overlayLayers.push(layerId)
    return () => overlayLayers.remove(layerId)
  }, [open, layerId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleEscape(e, layerId)) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, layerId])

  useEffect(() => {
    if (!open) return
    return lockBodyScroll()
  }, [open])

  // Focus in on open, back to the opener on close. The restore only fires when
  // focus has fallen to the document, so closing because the user tapped some
  // other control does not yank focus off what they just tapped.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const frame = window.requestAnimationFrame(() => {
      const el = panelRef.current
      if (!el) return
      const active = document.activeElement
      if (active && active !== el && el.contains(active)) return
      const first = focusablesIn(el)[0]
      ;(first ?? el).focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (!isOrphanedFocus(document.activeElement)) return
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  // Tab cycles inside the panel rather than walking the page behind the scrim.
  // Bound on document, not the panel: when a control unmounts under focus the
  // keydown fires on <body>, which a handler on the panel would never see.
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
      if (isOrphanedFocus(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      // Anything else outside the panel is a portalled child of it (a Popover
      // renders on document.body), so its own keyboard handling is left alone.
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

  const onMouseDown = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    armedRef.current = shouldDismissOnBackdrop(e, layerId)
  }, [layerId])

  const onClick = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    const armed = armedRef.current
    armedRef.current = false
    if (!armed) return
    if (e.target !== e.currentTarget) return
    closeRef.current()
  }, [])

  return useMemo(
    () => ({ panelRef, overlayProps: { onMouseDown, onClick } }),
    [onMouseDown, onClick],
  )
}
