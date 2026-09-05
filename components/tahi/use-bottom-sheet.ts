'use client'

/**
 * useBottomSheet - the three behaviours every mobile bottom sheet in the shell
 * needs, in one place: Escape dismisses it, the page underneath stops
 * scrolling, and a route change closes it (a link inside it was tapped).
 *
 * Extracted from <MobileBottomNav>'s More sheet so the top bar's More sheet
 * behaves identically instead of growing a second copy of the same effects.
 * `close` is held in a ref, so a caller passing a fresh closure on every render
 * does not re-subscribe the listeners.
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function useBottomSheet(open: boolean, close: () => void): void {
  const pathname = usePathname()
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })

  // A tap on a link inside the sheet navigates; close so the new page is not
  // left sitting behind the scrim.
  useEffect(() => { closeRef.current() }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])
}
