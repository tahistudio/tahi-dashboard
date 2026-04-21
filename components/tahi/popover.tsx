'use client'

/**
 * <Popover> — reusable floating panel anchored to a trigger element.
 *
 * The pattern we use across the dashboard for:
 *   - Multi-select pickers (PeoplePanel)
 *   - Action dropdowns
 *   - Role / filter menus
 *   - Any "click to reveal a short stack of options over the content"
 *
 * Key behaviours:
 *   - Renders through a React portal at document.body so the panel breaks
 *     out of any overflow:hidden ancestor (sidebar Cards, kanban columns).
 *   - Positioned with position:fixed at the trigger's bounding rect, so it
 *     overlays the page rather than pushing content around.
 *   - Auto-flips to above the trigger when there isn't enough room below.
 *   - Matches trigger width by default; pass `width` to override.
 *   - Closes on outside click, Escape, and when the trigger scrolls off-
 *     screen. Repositions on scroll + resize.
 *
 * Usage:
 *
 *   const [open, setOpen] = useState(false)
 *   const triggerRef = useRef<HTMLButtonElement>(null)
 *
 *   <button ref={triggerRef} onClick={() => setOpen(v => !v)}>Open</button>
 *   <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)}>
 *     <MyMenu onPick={...} />
 *   </Popover>
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  /** The element the popover is anchored to. Used for positioning + as the
   *  "inside" bound for outside-click detection (clicks on the anchor don't
   *  close it, since the anchor typically toggles the popover). */
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Min/ideal width. Defaults to the anchor's measured width (so menus
   *  span the button below them). Pass a number of rem (e.g. "15rem") or
   *  a CSS length for a fixed size. */
  width?: string | number
  /** Max height before the panel scrolls. Defaults to 20rem. */
  maxHeight?: string | number
  /** Gap between anchor and panel. Default 4px. */
  offset?: number
  /** Alignment along the anchor's horizontal axis. Default 'start'
   *  (panel's left aligns with anchor's left). */
  align?: 'start' | 'end'
}

export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  width,
  maxHeight = '20rem',
  offset = 4,
  align = 'start',
}: PopoverProps) {
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    top: number
    width: number
    placement: 'below' | 'above'
  } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Measure + position on every open/scroll/resize.
  const measure = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // If the anchor has scrolled off-screen, close instead of painting
    // a detached popover in the wrong place.
    if (r.bottom < 0 || r.top > window.innerHeight) {
      onClose()
      return
    }
    const panelH = panelRef.current?.offsetHeight ?? 0
    const spaceBelow = window.innerHeight - r.bottom
    const spaceAbove = r.top
    const flip = spaceBelow < Math.min(panelH, 240) && spaceAbove > spaceBelow
    const placement: 'below' | 'above' = flip ? 'above' : 'below'
    const resolvedWidth = typeof width === 'number'
      ? width
      : typeof width === 'string'
      ? null
      : r.width
    const panelW = resolvedWidth ?? r.width
    const left = align === 'end'
      ? r.right - panelW
      : r.left
    const top = placement === 'below' ? r.bottom + offset : r.top - offset - panelH
    setPosition({ left, top, width: r.width, placement })
  }, [anchorRef, onClose, width, offset, align])

  // Position on open + keep aligned on scroll/resize.
  useEffect(() => {
    if (!open) return
    measure()
    const onScroll = () => measure()
    const onResize = () => measure()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, measure])

  // Re-measure once we've actually rendered the panel (so we can compute
  // its real height and flip if needed).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => measure())
    return () => cancelAnimationFrame(id)
  }, [open, measure, children])

  // Close on outside click — anchor + panel are both "inside".
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      onClose()
    }
    // Delay one tick so the click that *opened* the popover doesn't
    // immediately close it.
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handle)
    }, 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handle)
    }
  }, [open, anchorRef, onClose])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose])

  if (!open || !mounted) return null

  const finalWidth = width
    ? (typeof width === 'number' ? `${width}px` : width)
    : position
    ? `${position.width}px`
    : undefined

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: 'fixed',
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        width: finalWidth,
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        zIndex: 1000,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
