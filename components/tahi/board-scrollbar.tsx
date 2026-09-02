'use client'

/**
 * <BoardScrollbar>. A proxy scrollbar for any horizontal scroller.
 *
 * macOS overlay scrollbars fade out until you already scrolled, and
 * shift-wheel is a keybind most people never learn, so a wide kanban
 * board looks like it simply ends at the viewport edge. This draws a
 * scrollbar that is always visible above the scroller and two-way bound
 * to its scrollLeft: a track with a proportional thumb you drag with a
 * mouse or a finger, arrows that page one column at a time, and
 * click-to-page on the track itself.
 *
 *   const scrollerRef = React.useRef<HTMLDivElement | null>(null)
 *   <BoardScrollbar scrollerRef={scrollerRef} controlsId="board" signature={count} />
 *   <div id="board" ref={scrollerRef} style={{ overflowX: 'auto' }}>…</div>
 *
 * It renders nothing when the content fits. Measurement resyncs from a
 * rAF-throttled scroll listener, a ResizeObserver on the scroller, and
 * the `signature` prop (cards added or moved change scrollWidth without
 * firing either).
 */

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// ── Pure helpers (unit-tested in __tests__/board-scrollbar.test.ts) ───

export interface ScrollerMetrics {
  clientWidth: number
  scrollWidth: number
  scrollLeft: number
}

/** Minimum thumb size. Matches the 44px mobile touch target floor. */
export const MIN_THUMB_PX = 44

/** Sub-pixel slack so browser rounding does not fake an overflow. */
const EPSILON_PX = 2
/** Ratio slack at either end, so a 1px gap still counts as parked. */
const EPSILON_RATIO = 0.002

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** How far the scroller can travel horizontally. */
export function maxScrollLeft(m: ScrollerMetrics): number {
  return Math.max(0, m.scrollWidth - m.clientWidth)
}

/** True when there is enough hidden content to be worth a scrollbar. */
export function overflows(m: ScrollerMetrics): boolean {
  return maxScrollLeft(m) > EPSILON_PX
}

/** Current position as a 0 to 1 fraction of the scrollable span. */
export function scrollRatio(m: ScrollerMetrics): number {
  const max = maxScrollLeft(m)
  if (max <= 0) return 0
  return clamp(m.scrollLeft / max, 0, 1)
}

/** Thumb width in px: proportional to the visible fraction, floored at
 *  MIN_THUMB_PX and capped at the track so it can never overhang. */
export function thumbWidth(
  trackWidth: number,
  m: ScrollerMetrics,
  minThumb: number = MIN_THUMB_PX,
): number {
  const visibleFraction = m.scrollWidth > 0 ? Math.min(1, m.clientWidth / m.scrollWidth) : 1
  const proportional = Math.round(trackWidth * visibleFraction)
  return Math.min(trackWidth, Math.max(minThumb, proportional))
}

/** Thumb offset in px from the left of the track. */
export function thumbOffset(
  trackWidth: number,
  m: ScrollerMetrics,
  minThumb: number = MIN_THUMB_PX,
): number {
  const travel = Math.max(0, trackWidth - thumbWidth(trackWidth, m, minThumb))
  return Math.round(travel * scrollRatio(m))
}

/** Back arrow disabled state. Also true when nothing overflows. */
export function atStart(m: ScrollerMetrics): boolean {
  if (!overflows(m)) return true
  return scrollRatio(m) <= EPSILON_RATIO
}

/** Forward arrow disabled state. Also true when nothing overflows. */
export function atEnd(m: ScrollerMetrics): boolean {
  if (!overflows(m)) return true
  return scrollRatio(m) >= 1 - EPSILON_RATIO
}

/** Translate a thumb pointer drag into a scrollLeft. The thumb travels
 *  `span` px to cover `max` px of scroll, so the delta is amplified. */
export function scrollLeftFromDrag({
  startScrollLeft,
  deltaX,
  span,
  max,
}: {
  startScrollLeft: number
  deltaX: number
  span: number
  max: number
}): number {
  if (span <= 0) return clamp(startScrollLeft, 0, max)
  return clamp(startScrollLeft + (deltaX / span) * max, 0, max)
}

/** One column plus one gap: the unit the arrows and track clicks page by. */
export function columnStep(
  scroller: HTMLElement | null,
  selector: string,
  fallback: number,
): number {
  if (!scroller) return fallback
  const column = scroller.querySelector(selector)
  if (!(column instanceof HTMLElement)) return fallback
  let gap = 0
  const parsed = Number.parseFloat(getComputedStyle(scroller).columnGap)
  if (Number.isFinite(parsed) && parsed > 0) gap = parsed
  const width = column.offsetWidth
  return width > 0 ? width + gap : fallback
}

// ── Component ────────────────────────────────────────────────────────

interface BoardScrollbarProps {
  /** The horizontally scrolling element this bar drives. */
  scrollerRef: React.RefObject<HTMLElement | null>
  /** Changes to this value force a re-measure. Pass anything that
   *  changes when the scroller's content changes (a row count, a
   *  joined list of column sizes). */
  signature?: string | number
  /** Selector for one page unit inside the scroller. */
  stepSelector?: string
  /** Page step in px when no element matches stepSelector. */
  fallbackStep?: number
  /** id of the scroller, wired to aria-controls. */
  controlsId?: string
  /** Accessible name for the thumb. */
  label?: string
  className?: string
}

const SCROLLBAR_CSS = `
.tahi-boardbar-btn{
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease;
}
.tahi-boardbar-btn:hover:not(:disabled){
  background: var(--color-bg-secondary);
  border-color: var(--color-brand);
  color: var(--color-brand-dark);
}
.tahi-boardbar-btn:disabled{ opacity: 0.38; cursor: default; }
.tahi-boardbar-thumb{ transition: background-color 150ms ease, border-color 150ms ease; }
.tahi-boardbar-thumb:hover{ background: var(--color-text-subtle); border-color: var(--color-text-subtle); }
.tahi-boardbar-thumb[data-dragging="true"],
.tahi-boardbar-thumb[data-dragging="true"]:hover{
  background: var(--color-brand);
  border-color: var(--color-brand);
  cursor: grabbing;
}
@media (max-width: 47.9375rem){
  .tahi-boardbar-btn{ width: 2.75rem; height: 2.75rem; }
  .tahi-boardbar-track{ height: 0.875rem; }
}
`

export function BoardScrollbar({
  scrollerRef,
  signature,
  stepSelector = '[data-board-column]',
  fallbackStep = 278,
  controlsId,
  label = 'Scroll the board sideways',
  className,
}: BoardScrollbarProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startX: number; startScrollLeft: number; span: number; max: number } | null>(null)

  const [metrics, setMetrics] = React.useState<ScrollerMetrics>({
    clientWidth: 0,
    scrollWidth: 0,
    scrollLeft: 0,
  })
  const [trackWidth, setTrackWidth] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)

  const measure = React.useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const next: ScrollerMetrics = {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      scrollLeft: el.scrollLeft,
    }
    setMetrics(prev => (
      prev.clientWidth === next.clientWidth &&
      prev.scrollWidth === next.scrollWidth &&
      prev.scrollLeft === next.scrollLeft
        ? prev
        : next
    ))
  }, [scrollerRef])

  // Scroll drives the thumb. rAF-throttled so a flick does not
  // re-render once per pixel.
  React.useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let frame = 0
    const tick = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; measure() })
    }
    el.addEventListener('scroll', tick, { passive: true })
    window.addEventListener('resize', tick)
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(tick)
      observer.observe(el)
    }
    measure()
    return () => {
      el.removeEventListener('scroll', tick)
      window.removeEventListener('resize', tick)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scrollerRef, measure])

  // Adding, moving or filtering cards changes scrollWidth without
  // firing scroll or resize.
  React.useEffect(() => { measure() }, [signature, measure])

  const visible = overflows(metrics)

  React.useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const update = () => setTrackWidth(track.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => observer.disconnect()
  }, [visible])

  const page = React.useCallback((direction: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    const by = columnStep(el, stepSelector, fallbackStep) * direction
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: by, behavior: 'smooth' })
    else el.scrollLeft += by
  }, [scrollerRef, stepSelector, fallbackStep])

  const jump = React.useCallback((left: number) => {
    const el = scrollerRef.current
    if (!el) return
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' })
    else el.scrollLeft = left
  }, [scrollerRef])

  if (!visible) return null

  const width = thumbWidth(trackWidth || 1, metrics)
  const offset = thumbOffset(trackWidth || 1, metrics)
  const travel = Math.max(0, (trackWidth || 1) - width)
  const max = maxScrollLeft(metrics)
  const disabledBack = atStart(metrics)
  const disabledForward = atEnd(metrics)

  // Pointer events cover mouse, pen and touch with one code path.
  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, span: travel, max }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const el = scrollerRef.current
    if (!drag || !el) return
    el.scrollLeft = scrollLeftFromDrag({
      startScrollLeft: drag.startScrollLeft,
      deltaX: e.clientX - drag.startX,
      span: drag.span,
      max: drag.max,
    })
  }

  const onThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only the bare track pages; a press on the thumb starts a drag.
    if (e.target !== trackRef.current) return
    const track = trackRef.current
    if (!track) return
    const x = e.clientX - track.getBoundingClientRect().left
    page(x < offset ? -1 : 1)
  }

  const onThumbKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); page(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); page(1) }
    else if (e.key === 'Home') { e.preventDefault(); jump(0) }
    else if (e.key === 'End') { e.preventDefault(); jump(max) }
  }

  const buttonStyle: React.CSSProperties = {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.75rem',
    height: '1.75rem',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--color-bg)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: 0,
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: '0.5rem',
        width: '100%',
      }}
    >
      <style>{SCROLLBAR_CSS}</style>
      <button
        type="button"
        className="tahi-boardbar-btn tahi-focus-ring"
        style={buttonStyle}
        disabled={disabledBack}
        aria-label="Previous column"
        title="Previous column"
        onClick={() => page(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      <div
        ref={trackRef}
        className="tahi-boardbar-track"
        onPointerDown={onTrackPointerDown}
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minWidth: 0,
          height: '0.75rem',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '0.4375rem',
          background: 'var(--color-bg-secondary)',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        <div
          className="tahi-boardbar-thumb tahi-focus-ring"
          role="scrollbar"
          tabIndex={0}
          data-dragging={dragging ? 'true' : 'false'}
          aria-orientation="horizontal"
          aria-controls={controlsId}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(scrollRatio(metrics) * 100)}
          onPointerDown={onThumbPointerDown}
          onPointerMove={onThumbPointerMove}
          onPointerUp={onThumbPointerUp}
          onPointerCancel={onThumbPointerUp}
          onKeyDown={onThumbKeyDown}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${offset}px`,
            width: `${width}px`,
            border: '1px solid var(--color-border)',
            borderRadius: '0.375rem',
            background: 'var(--color-border)',
            cursor: 'grab',
            touchAction: 'none',
          }}
        />
      </div>

      <button
        type="button"
        className="tahi-boardbar-btn tahi-focus-ring"
        style={buttonStyle}
        disabled={disabledForward}
        aria-label="Next column"
        title="Next column"
        onClick={() => page(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
