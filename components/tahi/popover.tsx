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
 *   - Keyboard: focus moves into the panel on open when the panel has
 *     something focusable in it (a consumer that autofocuses its own field
 *     keeps that focus), and returns to the anchor on close. Because the
 *     portal is appended after the app root, without this a keyboard user
 *     had to Tab past every remaining control on the page to reach an
 *     option.
 *   - Escape closes THIS panel only. The popover registers on the shared
 *     overlay stack while open, so a SlideOver or ConfirmDialog underneath
 *     stands down instead of unmounting along with it.
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

import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusablesIn, isOrphanedFocus, overlayLayers, shouldHandleEscape } from '@/components/tahi/overlay-stack'

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
  /** When true, the panel spans viewport width (minus 8px margins) on
   *  small screens (<480px) instead of its declared width. Great for
   *  finger-friendly menus on phones — the user card popup, attachment
   *  pickers etc. Desktop layout unchanged. */
  mobileFullWidth?: boolean
  /** When true, the panel renders with no surface chrome (transparent
   *  background, no border / shadow, overflow visible) so the children own
   *  the look. Used by the forest user-card menu, which paints its own dark
   *  surface. Positioning / flip / escape / outside-click all still apply. */
  bare?: boolean
}

const MOBILE_BREAKPOINT = 480
const MOBILE_MARGIN = 8

export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  width,
  maxHeight = '20rem',
  offset = 4,
  align = 'start',
  mobileFullWidth = false,
  bare = false,
}: PopoverProps) {
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<{
    left: number
    top: number
    width: number
    placement: 'below' | 'above'
  } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const layerId = useId()

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
    // Mobile full-width override: pin the panel to viewport edges with
    // an 8px margin, ignoring the declared width entirely. Caller opts
    // in via `mobileFullWidth`.
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT
    if (mobileFullWidth && isMobile) {
      const panelW = window.innerWidth - MOBILE_MARGIN * 2
      const top = placement === 'below' ? r.bottom + offset : r.top - offset - panelH
      setPosition({ left: MOBILE_MARGIN, top, width: panelW, placement })
      return
    }

    // Resolve the panel's actual width. When `width` is a string ("16rem"
    // etc.) we don't know the px until after layout, so measure the rendered
    // panel; fall back to anchor width.
    const measuredW = panelRef.current?.offsetWidth ?? 0
    const resolvedWidth = typeof width === 'number'
      ? width
      : typeof width === 'string'
      ? (measuredW || r.width)
      : r.width
    const panelW = resolvedWidth || r.width

    let left = align === 'end' ? r.right - panelW : r.left
    // Viewport clamp — keep an 8px margin from each edge so the panel can't
    // hang off the screen on mobile when align='end' is used near the right.
    const margin = 8
    const maxLeft = window.innerWidth - panelW - margin
    if (left > maxLeft) left = maxLeft
    if (left < margin) left = margin

    const top = placement === 'below' ? r.bottom + offset : r.top - offset - panelH
    setPosition({ left, top, width: r.width, placement })
  }, [anchorRef, onClose, width, offset, align, mobileFullWidth])

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

  // Claim a layer while open. Document keydown listeners fire in registration
  // order, so without the stack an enclosing SlideOver (registered first)
  // would swallow Escape and close the whole dialog under this panel.
  useEffect(() => {
    if (!open) return
    overlayLayers.push(layerId)
    return () => overlayLayers.remove(layerId)
  }, [open, layerId])

  // Close on Escape, topmost layer only, and mark the key as handled so
  // nothing below reacts to the same press.
  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (!shouldHandleEscape(e, layerId)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose, layerId])

  // Move focus into the panel on open. The portal is appended to <body>, so
  // the panel is last in tab order: leaving focus on the trigger meant
  // tabbing through the rest of the page to reach the first option. Panels
  // with nothing focusable in them (a plain summary card) are left alone, and
  // so is a consumer that autofocused its own field.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const el = panelRef.current
      if (!el) return
      const active = document.activeElement
      if (active && active !== el && el.contains(active)) return
      const first = focusablesIn(el)[0]
      if (first) first.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Hand focus back to the anchor on close, but only when the panel was
  // holding it: closing because the user clicked another control elsewhere
  // must not yank focus off whatever they just clicked. By the time this
  // cleanup runs the panel is unmounted, so "the panel had it" reads as
  // focus having fallen back to the document.
  useEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    return () => {
      if (!isOrphanedFocus(document.activeElement)) return
      if (anchor && typeof anchor.focus === 'function' && document.contains(anchor)) anchor.focus()
    }
  }, [open, anchorRef])

  if (!open || !mounted) return null

  // Mobile override wins over the declared width so the first paint is
  // already full-width (before measure() runs).
  const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  const finalWidth = (mobileFullWidth && isMobileViewport)
    ? `${window.innerWidth - MOBILE_MARGIN * 2}px`
    : width
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
        background: bare ? 'transparent' : 'var(--color-bg)',
        border: bare ? 'none' : '1px solid var(--color-border)',
        borderRadius: bare ? 0 : 'var(--radius-card)',
        boxShadow: bare ? 'none' : 'var(--shadow-lg)',
        overflow: bare ? 'visible' : 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
