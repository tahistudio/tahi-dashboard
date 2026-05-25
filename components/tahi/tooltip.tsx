'use client'

/**
 * <Tooltip>. Wraps any element and shows a small dark label on hover or
 * keyboard focus. Portaled to <body> so it never clips inside a card.
 *
 * Usage:
 *
 *   <Tooltip label="Sync with Stripe">
 *     <IconButton icon={<RefreshCw />} />
 *   </Tooltip>
 *
 * Style: forest-dark surface, white text, 12px, leaf-sm radius, soft
 * shadow. Calm 220ms fade. 400ms hover delay (Stripe / Linear default)
 * so the tooltip doesn't pop on every accidental cursor pass. Focus
 * triggers it immediately for keyboard users.
 *
 * Sides: top by default. Auto-flips to bottom if there's no room above.
 *
 * Use it on:
 *   - icon-only buttons (kebab, bell, gear, etc.)
 *   - truncated text that needs the full value on hover
 *   - data that benefits from a hint (a number's source, a status's meaning)
 *
 * Don't use it on:
 *   - elements that already have a visible label
 *   - actions that need long explanation (use a popover instead)
 *   - touch-only surfaces (tooltips don't trigger on tap)
 */

import * as React from 'react'
import { createPortal } from 'react-dom'

type Side = 'top' | 'bottom'

interface TooltipProps {
  label: React.ReactNode
  /** Element to wrap. Must accept a ref. Use asChild for arbitrary content. */
  children: React.ReactElement
  /** Delay in ms before showing on hover. Default 400. Focus is immediate. */
  delayMs?: number
  /** Preferred side. Tooltip auto-flips if there's no room. */
  side?: Side
  /** When set, the tooltip is rendered as a sibling and the child is wrapped in a span. */
  asChild?: boolean
  /** Disable the tooltip entirely (passthrough). */
  disabled?: boolean
  /** When true, a tap on touch devices SHOWS the tooltip (toggling)
   *  instead of suppressing it. Tap outside dismisses. Default false
   *  preserves the existing behaviour where touch suppresses tooltips
   *  so the next click goes through cleanly. */
  showOnTap?: boolean
}

export function Tooltip({
  label,
  children,
  delayMs = 400,
  side = 'top',
  asChild = false,
  disabled = false,
  showOnTap = false,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ x: number, y: number, side: Side } | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const tooltipRef = React.useRef<HTMLDivElement | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Touch suppression. On touch devices, a tap fires a synthetic
  // mouseenter before the click, which makes the tooltip flash. We
  // track recent touch events and skip the next mouseenter when one
  // has just happened.
  const recentlyTouchedRef = React.useRef(false)

  React.useEffect(() => { setMounted(true) }, [])

  const computePosition = React.useCallback(() => {
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return
    const rect = trigger.getBoundingClientRect()
    const tRect = tooltip.getBoundingClientRect()
    const gap = 8
    let preferredSide: Side = side
    if (side === 'top' && rect.top - tRect.height - gap < 8) preferredSide = 'bottom'
    if (side === 'bottom' && rect.bottom + tRect.height + gap > window.innerHeight - 8) preferredSide = 'top'

    const y = preferredSide === 'top'
      ? rect.top - tRect.height - gap
      : rect.bottom + gap
    let x = rect.left + rect.width / 2 - tRect.width / 2
    x = Math.max(8, Math.min(window.innerWidth - tRect.width - 8, x))
    setCoords({ x, y, side: preferredSide })
  }, [side])

  const handleShow = React.useCallback((immediate = false) => {
    if (disabled) return
    // Skip when a touch just happened. Mobile taps fire mouseenter
    // before click, which would flash a tooltip during a tap.
    if (recentlyTouchedRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const fire = () => {
      setOpen(true)
      // Compute position after the tooltip is in the DOM.
      requestAnimationFrame(computePosition)
    }
    if (immediate) fire()
    else timerRef.current = setTimeout(fire, delayMs)
  }, [delayMs, computePosition, disabled])

  const handleHide = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(false)
    setCoords(null)
  }, [])

  // Reposition on scroll / resize while open.
  React.useEffect(() => {
    if (!open) return
    const onScroll = () => computePosition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, computePosition])

  // Tap-outside dismiss when in showOnTap mode.
  React.useEffect(() => {
    if (!open || !showOnTap) return
    function handleTouch(e: TouchEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (tooltipRef.current?.contains(target)) return
      handleHide()
    }
    // Delay one frame so the tap that opened doesn't immediately close.
    const id = setTimeout(() => document.addEventListener('touchstart', handleTouch), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('touchstart', handleTouch)
    }
  }, [open, showOnTap, handleHide])

  // Wire up the child's events while preserving any existing handlers.
  const child = children as React.ReactElement<{
    ref?: React.Ref<HTMLElement>
    onMouseEnter?: React.MouseEventHandler<HTMLElement>
    onMouseLeave?: React.MouseEventHandler<HTMLElement>
    onFocus?: React.FocusEventHandler<HTMLElement>
    onBlur?: React.FocusEventHandler<HTMLElement>
    onTouchStart?: React.TouchEventHandler<HTMLElement>
    'aria-describedby'?: string
  }>

  const tooltipId = React.useId()

  const wrappedChild = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      // Forward to any existing ref.
      const original = (children as { ref?: React.Ref<HTMLElement> }).ref
      if (typeof original === 'function') original(node)
      else if (original && 'current' in original) (original as React.MutableRefObject<HTMLElement | null>).current = node
    },
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      child.props.onMouseEnter?.(e)
      handleShow(false)
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      child.props.onMouseLeave?.(e)
      handleHide()
    },
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      child.props.onTouchStart?.(e)
      recentlyTouchedRef.current = true
      if (showOnTap) {
        // showOnTap: toggle the tooltip on tap. The next click on the
        // trigger STILL fires (we don't prevent default) — useful for
        // informational tooltips on actionable elements.
        if (open) handleHide()
        else handleShow(true)
      } else {
        handleHide()
      }
      setTimeout(() => { recentlyTouchedRef.current = false }, 600)
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(e)
      // Focus on touch devices fires from the tap. Suppress.
      if (recentlyTouchedRef.current) return
      handleShow(true)
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(e)
      handleHide()
    },
    'aria-describedby': open ? tooltipId : child.props['aria-describedby'],
  })

  const tooltipNode = mounted && open ? createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      style={{
        position: 'fixed',
        left: coords?.x ?? -9999,
        top: coords?.y ?? -9999,
        background: 'var(--color-brand-deepest)',
        color: 'var(--color-text-on-dark)',
        fontSize: '0.75rem',
        fontWeight: 500,
        lineHeight: 1.3,
        padding: '0.4rem 0.625rem',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 4px 16px rgba(18, 26, 15, 0.18)',
        pointerEvents: 'none',
        maxWidth: 'min(20rem, calc(100vw - 1rem))',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        opacity: coords ? 1 : 0,
        transform: coords ? 'translateY(0)' : (side === 'top' ? 'translateY(4px)' : 'translateY(-4px)'),
        transition: 'opacity var(--motion-quick) var(--ease-out), transform var(--motion-quick) var(--ease-out)',
        zIndex: 9999,
      }}
    >
      {label}
    </div>,
    document.body,
  ) : null

  if (asChild) {
    return <>{wrappedChild}{tooltipNode}</>
  }
  return <>{wrappedChild}{tooltipNode}</>
}
