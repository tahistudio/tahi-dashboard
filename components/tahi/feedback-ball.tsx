'use client'

/**
 * <FeedbackBall>, the beta feedback tool. A round floating button with a
 * comment icon, draggable anywhere on screen (mouse and touch). On release
 * it soft-snaps to whichever viewport edge it landed nearest to (left,
 * right, top or bottom), sitting a fixed inset from that edge with a short
 * ease-out animation; the snapped edge + offset (not the raw drop point)
 * persists to localStorage and re-clamps on resize.
 *
 * A click (not a drag) enters PICK MODE: the cursor becomes a crosshair, the
 * element under the pointer gets a highlight outline, and the ball shows a
 * hint. Clicking an element picks it (a tap works too): the highlight
 * becomes a pin at the element's top-left and the comment panel opens
 * anchored beside it, flipping to stay inside the viewport. Escape, or
 * clicking the ball again, leaves pick mode with no anchor (a general
 * comment) instead. A "Change" link in the anchored panel returns to pick
 * mode.
 *
 * On send, POSTs the comment plus everything lib/feedback-context.ts has
 * been quietly recording (console errors/warnings, failed fetches, visible
 * headings, impersonation state) and, when one was picked, the element's
 * anchor (lib/feedback-anchor.ts) to /api/feedback.
 *
 * Mounted ONCE, for every audience: app/(dashboard)/layout.tsx and the two
 * onboarding entry pages. There is deliberately no inbox UI here; rows are
 * read back only through GET /api/admin/feedback and the MCP tool
 * list_feedback_comments.
 *
 * Uses <Popover> (bare) for positioning, outside-click, Escape and initial
 * focus, and adds its own Tab-cycle trap on top (the same idiom
 * <ConfirmDialog> uses) since a comment box owes a keyboard user a real trap,
 * not just "focus landed inside once". The panel anchors to the ball itself
 * for a general comment, or to the picked element when one was chosen, so
 * Popover's own flip-above/clamp-horizontal logic keeps it on screen from
 * any ball position or picked element.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, Check, Loader2 } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { focusablesIn } from '@/components/tahi/overlay-stack'
import { apiPath } from '@/lib/api'
import { installFeedbackContextRecorder, getFeedbackContextSnapshot } from '@/lib/feedback-context'
import {
  buildSelectorPath,
  describeElement,
  findScrollState,
  nearestSectionContext,
  rectInScroller,
  type AnchorElementLike,
  type AnchorRect,
  type ScrollerElementLike,
  type ScrollState,
} from '@/lib/feedback-anchor'
import {
  clampBallPosition,
  distance,
  isClickGesture,
  breakpointForWidth,
  snapToEdge,
  positionForEdgeSnap,
  type Point,
  type Size,
  type EdgeSnap,
} from '@/lib/feedback-ball-utils'

const STORAGE_KEY = 'tahi-feedback-ball'
/** Matches the ball's rendered size (3.5rem) so pointer-math and CSS agree. */
const BALL_SIZE_PX = 56
/** 1rem, assuming the default 16px root font size (matches BALL_SIZE_PX's
 *  own 3.5rem = 56px assumption above). */
const EDGE_INSET_PX = 16
/** Ease-out, no bounce, as short as still reads as an animation. */
const SNAP_TRANSITION_MS = 180
/** Matches MobileBottomNav's own `md:hidden` breakpoint. */
const MOBILE_NAV_BREAKPOINT_PX = 768
/** A little more than the tab bar's own height (min-height 50px + padding +
 *  safe-area), so the ball never sits under it. */
const MOBILE_TAB_BAR_RESERVE_PX = 64
const MAX_BODY_LENGTH = 5000
/** How long the "Sent, thank you" state stays up before the panel closes. */
const SENT_LINGER_MS = 1400

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'
/** idle: resting. picking: crosshair + highlight, choosing what to comment
 *  on. panel: the comment box is open, with or without a picked anchor. */
type Mode = 'idle' | 'picking' | 'panel'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  maxDisplacement: number
}

interface PickedAnchor {
  selector: string
  tag: string
  text: string
  rect: AnchorRect
  context: string | null
}

interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
}

function defaultDropPosition(): Point {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - BALL_SIZE_PX - EDGE_INSET_PX,
    y: window.innerHeight - BALL_SIZE_PX - EDGE_INSET_PX,
  }
}

function loadStoredSnap(): EdgeSnap | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<EdgeSnap>
    const edge = parsed.edge
    if (
      (edge === 'left' || edge === 'right' || edge === 'top' || edge === 'bottom')
      && typeof parsed.offset === 'number'
      && Number.isFinite(parsed.offset)
    ) {
      return { edge, offset: parsed.offset }
    }
    return null
  } catch {
    return null
  }
}

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The viewport used for edge-snap maths: full width, but height reduced on
 *  narrow screens so the ball never rests under the mobile bottom tab bar. */
function effectiveViewport(): Size {
  const { width, height } = viewportSize()
  const reserve = width < MOBILE_NAV_BREAKPOINT_PX ? MOBILE_TAB_BAR_RESERVE_PX : 0
  return { width, height: Math.max(0, height - reserve) }
}

/** A real HTMLElement satisfies AnchorElementLike structurally (tagName, id,
 *  textContent, parentElement, previousElementSibling, getAttribute all
 *  exist on it), but TypeScript's structural check on the recursive
 *  parentElement / previousElementSibling links is safer made explicit. */
function toAnchorElementLike(el: HTMLElement): AnchorElementLike {
  return el as unknown as AnchorElementLike
}

function toScrollerElementLike(el: HTMLElement): ScrollerElementLike {
  return el as unknown as ScrollerElementLike
}

/** Overflow as the browser computes it, for the scroller walk. */
function readOverflowY(el: ScrollerElementLike): string {
  return window.getComputedStyle(el as unknown as Element).overflowY
}

/** The document's own scroll, used when nothing between the picked element
 *  and the root scrolls. On a dashboard screen this is the fallback, not the
 *  answer: the shell scrolls inside <main class="overflow-y-auto">. */
function documentScrollState(): ScrollState {
  return {
    originX: 0,
    originY: 0,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
  }
}

function rectFromElement(el: HTMLElement): ViewportRect {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Fixed-position placement for a UI element that hugs one side of the ball,
 *  chosen so it opens away from whichever edge the ball is snapped to (a
 *  ball on the right edge gets its hint to the left, and so on). */
function edgeAwareFixedStyle(
  edge: EdgeSnap['edge'],
  pos: Point,
  ballSize: number,
  gap: number,
  viewport: Size,
): React.CSSProperties {
  const style: React.CSSProperties = { position: 'fixed' }
  if (edge === 'left') {
    style.left = pos.x + ballSize + gap
    style.top = pos.y
  } else if (edge === 'right') {
    style.right = Math.max(0, viewport.width - pos.x) + gap
    style.top = pos.y
  } else if (edge === 'top') {
    style.left = pos.x
    style.top = pos.y + ballSize + gap
  } else {
    style.left = pos.x
    style.bottom = Math.max(0, viewport.height - pos.y) + gap
  }
  return style
}

export function FeedbackBall() {
  const pathname = usePathname()
  const ballRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const positionRef = useRef<Point>({ x: 0, y: 0 })
  const hoveredElRef = useRef<HTMLElement | null>(null)
  const pickedElRef = useRef<HTMLElement | null>(null)

  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 })
  const [snap, setSnap] = useState<EdgeSnap | null>(null)
  const [snapAnimating, setSnapAnimating] = useState(false)
  const [mode, setMode] = useState<Mode>('idle')
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SendStatus>('idle')
  const [hoverRect, setHoverRect] = useState<ViewportRect | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{ tag: string; text: string } | null>(null)
  const [pickedAnchor, setPickedAnchor] = useState<PickedAnchor | null>(null)
  const [pickedRect, setPickedRect] = useState<ViewportRect | null>(null)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  // Mount: start the global recorder, restore (or default) the ball's
  // snapped edge + offset, converting a fresh default drop point through the
  // same snap maths so there is exactly one source of truth for "where does
  // the ball rest".
  useEffect(() => {
    installFeedbackContextRecorder()
    const vp = effectiveViewport()
    const drop = defaultDropPosition()
    const initialSnap = loadStoredSnap()
      ?? snapToEdge({ x: drop.x, y: drop.y, width: BALL_SIZE_PX, height: BALL_SIZE_PX }, vp, EDGE_INSET_PX)
    setSnap(initialSnap)
    setPosition(positionForEdgeSnap(initialSnap, BALL_SIZE_PX, vp, EDGE_INSET_PX))
    setMounted(true)
  }, [])

  // Re-clamp along the same edge on resize, so a snap saved on a wide screen
  // never strands the ball off a phone's edge or under its tab bar.
  useEffect(() => {
    function onResize() {
      setSnap((prev) => {
        if (!prev) return prev
        const vp = effectiveViewport()
        setPosition(positionForEdgeSnap(prev, BALL_SIZE_PX, vp, EDGE_INSET_PX))
        return prev
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resetAll = useCallback(() => {
    setMode('idle')
    setStatus('idle')
    setText('')
    pickedElRef.current = null
    setPickedAnchor(null)
    setPickedRect(null)
    hoveredElRef.current = null
    setHoverRect(null)
    setHoverInfo(null)
  }, [])

  /** Escape, or a second click on the ball, while picking: open the panel
   *  with no anchor (a general comment). */
  const commitGeneralComment = useCallback(() => {
    pickedElRef.current = null
    setPickedAnchor(null)
    setPickedRect(null)
    hoveredElRef.current = null
    setHoverRect(null)
    setHoverInfo(null)
    setMode('panel')
  }, [])

  /** Clicking an element while picking: pin it and open the panel anchored
   *  to it. */
  const pickElement = useCallback((target: HTMLElement) => {
    const el = toAnchorElementLike(target)
    const described = describeElement(el)
    const viewportRect = target.getBoundingClientRect()
    const scroll = findScrollState(toScrollerElementLike(target), readOverflowY, documentScrollState())

    pickedElRef.current = target
    setPickedAnchor({
      selector: buildSelectorPath(el),
      tag: described.tag,
      text: described.text,
      rect: rectInScroller(viewportRect, scroll),
      context: nearestSectionContext(el),
    })
    setPickedRect(rectFromElement(target))
    hoveredElRef.current = null
    setHoverRect(null)
    setHoverInfo(null)
    setMode('panel')
  }, [])

  /** The "Change" link in an anchored panel: back to picking, dropping the
   *  current pin. */
  const returnToPicking = useCallback(() => {
    pickedElRef.current = null
    setPickedAnchor(null)
    setPickedRect(null)
    setMode('picking')
  }, [])

  const handleBallClick = useCallback(() => {
    if (mode === 'idle') {
      setMode('picking')
    } else if (mode === 'picking') {
      commitGeneralComment()
    } else {
      // mode === 'panel': mirror the old toggle-closed behaviour.
      resetAll()
    }
  }, [mode, commitGeneralComment, resetAll])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      maxDisplacement: 0,
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const wasClick = isClickGesture(drag.maxDisplacement)
    drag.maxDisplacement = Math.max(drag.maxDisplacement, distance({ x: 0, y: 0 }, { x: dx, y: dy }))
    // The moment a gesture crosses from "click" into "drag", cancel whatever
    // picking/panel state is open rather than leave it visually stranded
    // next to a ball that just moved out from under it.
    if (wasClick && !isClickGesture(drag.maxDisplacement) && mode !== 'idle') {
      resetAll()
    }
    // Free drag: unclamped by the edge inset, matching the pointer 1:1.
    // Snapping only happens on release.
    const next = clampBallPosition(
      { x: drag.originX + dx, y: drag.originY + dy },
      BALL_SIZE_PX,
      viewportSize(),
    )
    setPosition(next)
  }, [mode, resetAll])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pointerId !== e.pointerId) return
    if (isClickGesture(drag.maxDisplacement)) {
      handleBallClick()
      return
    }
    // Drag released: soft-snap to the nearest edge, animate to it, and
    // persist the edge + offset (not the raw drop point).
    const vp = effectiveViewport()
    const droppedRect = { x: positionRef.current.x, y: positionRef.current.y, width: BALL_SIZE_PX, height: BALL_SIZE_PX }
    const nextSnap = snapToEdge(droppedRect, vp, EDGE_INSET_PX)
    const nextPosition = positionForEdgeSnap(nextSnap, BALL_SIZE_PX, vp, EDGE_INSET_PX)
    setSnap(nextSnap)
    setSnapAnimating(true)
    setPosition(nextPosition)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSnap))
    } catch {
      // best-effort persistence only
    }
    window.setTimeout(() => setSnapAnimating(false), SNAP_TRANSITION_MS)
  }, [handleBallClick])

  // Pick mode: crosshair cursor, a highlight following the hovered element,
  // a click (or tap) picks it, Escape opens a general comment. The ball and
  // any open panel are never valid pick targets.
  useEffect(() => {
    if (mode !== 'picking') return

    function isIgnoredTarget(target: EventTarget | null): boolean {
      const el = target as Node | null
      if (!el) return true
      return !!(ballRef.current?.contains(el) || panelRef.current?.contains(el))
    }

    function updateHoverFromPoint(x: number, y: number) {
      const target = document.elementFromPoint(x, y) as HTMLElement | null
      if (!target || isIgnoredTarget(target)) {
        hoveredElRef.current = null
        setHoverRect(null)
        setHoverInfo(null)
        return
      }
      hoveredElRef.current = target
      setHoverRect(rectFromElement(target))
      setHoverInfo(describeElement(toAnchorElementLike(target)))
    }

    function onPointerMove(e: PointerEvent) {
      updateHoverFromPoint(e.clientX, e.clientY)
    }

    function onClick(e: MouseEvent) {
      if (isIgnoredTarget(e.target)) return
      const target = e.target as HTMLElement
      e.preventDefault()
      e.stopPropagation()
      pickElement(target)
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      commitGeneralComment()
    }

    function onScrollOrResize() {
      const el = hoveredElRef.current
      if (!el || !document.contains(el)) return
      setHoverRect(rectFromElement(el))
    }

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.body.style.cursor = previousCursor
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [mode, pickElement, commitGeneralComment])

  // Keep the pin in sync with the picked element while the anchored panel
  // is open (recompute on scroll and resize, same as the pick-mode highlight).
  useEffect(() => {
    if (mode !== 'panel' || !pickedAnchor) return
    function sync() {
      const el = pickedElRef.current
      if (!el || !document.contains(el)) return
      setPickedRect(rectFromElement(el))
    }
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [mode, pickedAnchor])

  // Tab cycles inside the panel (mirrors <ConfirmDialog>'s trap). <Popover>
  // already moves initial focus in and Escape closes; this is the one thing
  // it does not do on its own.
  useEffect(() => {
    if (mode !== 'panel') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const el = panelRef.current
      if (!el) return
      const items = focusablesIn(el)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
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
  }, [mode])

  // Auto-grow the textarea to fit its content, capped by max-height (the CSS
  // below adds the scrollbar past that).
  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    if (mode === 'panel') autoGrow()
  }, [mode, autoGrow])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > MAX_BODY_LENGTH || status === 'sending') return
    setStatus('sending')
    try {
      const snapshot = getFeedbackContextSnapshot()
      const width = typeof window !== 'undefined' ? window.innerWidth : 0
      const height = typeof window !== 'undefined' ? window.innerHeight : 0
      // Best-effort and deliberately awaited before the comment POST so the
      // key can ride along on it: the capture carries its own timeout and
      // resolves null rather than throwing, so the worst case is a comment
      // that lands a few seconds later without a picture.
      const { captureAndStoreScreenshot } = await import('@/lib/feedback-screenshot')
      const screenshotKey = await captureAndStoreScreenshot(
        pickedElRef.current,
        apiPath('/api/feedback/screenshot'),
      )
      const res = await fetch(apiPath('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          route: pathname,
          pageTitle: typeof document !== 'undefined' ? document.title : undefined,
          viewportWidth: width,
          viewportHeight: height,
          breakpoint: breakpointForWidth(width),
          theme: typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
            ? 'dark'
            : 'light',
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          context: snapshot,
          anchor: pickedAnchor ?? undefined,
          screenshotKey: screenshotKey ?? undefined,
        }),
      })
      if (!res.ok) throw new Error(`Feedback POST failed: ${res.status}`)
      setStatus('sent')
      window.setTimeout(resetAll, SENT_LINGER_MS)
    } catch {
      setStatus('error')
    }
  }, [text, status, pathname, pickedAnchor, resetAll])

  if (!mounted) return null

  const remaining = MAX_BODY_LENGTH - text.length
  const canSend = text.trim().length > 0 && text.length <= MAX_BODY_LENGTH && status !== 'sending'
  const edge = snap?.edge ?? 'right'
  const anchorRef = pickedAnchor ? pickedElRef : ballRef

  return (
    <>
      {mode === 'picking' && hoverRect && hoverInfo && (
        <div
          data-feedback-ball="true"
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: hoverRect.x,
            top: hoverRect.y,
            width: hoverRect.width,
            height: hoverRect.height,
            border: '2px solid var(--color-brand)',
            borderRadius: '2px',
            pointerEvents: 'none',
            zIndex: 1399,
            boxSizing: 'border-box',
          }}
        >
          <span
            style={{
              position: 'absolute',
              ...(hoverRect.y < 28 ? { top: '100%', marginTop: '0.25rem' } : { bottom: '100%', marginBottom: '0.25rem' }),
              left: 0,
              display: 'block',
              maxWidth: '16rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              background: 'var(--color-brand)',
              color: '#ffffff',
              fontSize: '0.6875rem',
              fontWeight: 600,
              padding: '0.125rem 0.5rem',
              borderRadius: '0 6px 0 6px',
            }}
          >
            {hoverInfo.tag}{hoverInfo.text ? ` ${hoverInfo.text}` : ''}
          </span>
        </div>
      )}

      {mode === 'panel' && pickedAnchor && pickedRect && (
        <div
          data-feedback-ball="true"
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: pickedRect.x,
            top: pickedRect.y,
            transform: 'translate(-50%, -50%)',
            width: '1.5rem',
            height: '1.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: 'var(--color-brand)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
            pointerEvents: 'none',
            zIndex: 1399,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          1
        </div>
      )}

      <button
        data-feedback-ball="true"
        ref={ballRef}
        type="button"
        aria-label="Leave feedback"
        aria-haspopup="dialog"
        aria-expanded={mode === 'panel'}
        aria-pressed={mode === 'picking'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="tahi-focus-ring"
        style={{
          position: 'fixed',
          left: position.x,
          top: position.y,
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: '9999px',
          border: 'none',
          background: 'var(--color-brand)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-lg)',
          cursor: mode === 'picking' ? 'crosshair' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          zIndex: 1400,
          transition: snapAnimating ? 'left 180ms ease-out, top 180ms ease-out' : 'none',
        }}
      >
        <MessageCircle style={{ width: '1.5rem', height: '1.5rem' }} aria-hidden="true" />
      </button>

      {mode === 'picking' && (
        <div
          data-feedback-ball="true"
          role="status"
          aria-live="polite"
          style={{
            ...edgeAwareFixedStyle(edge, position, BALL_SIZE_PX, 12, viewportSize()),
            zIndex: 1401,
            maxWidth: '16rem',
            background: 'var(--color-text)',
            color: '#ffffff',
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: 1.4,
            padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-leaf-sm)',
            boxShadow: 'var(--shadow-lg)',
            pointerEvents: 'none',
          }}
        >
          Pick the thing you mean, or press Escape for a general comment
        </div>
      )}

      <Popover anchorRef={anchorRef} open={mode === 'panel'} onClose={resetAll} label="Leave a comment" bare width="20rem" offset={10}>
        <div
          data-feedback-ball="true"
          ref={panelRef}
          style={{
            width: '20rem',
            maxWidth: 'calc(100vw - 2rem)',
            borderRadius: 'var(--radius-leaf)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-lg)',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
          }}
        >
          {status === 'sent' ? (
            <div
              role="status"
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0' }}
            >
              <div
                style={{
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: 'var(--radius-leaf-sm)',
                  background: 'var(--color-brand-50)',
                  color: 'var(--color-brand-dark)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Check style={{ width: '1.25rem', height: '1.25rem' }} />
              </div>
              <p style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                Sent, thank you
              </p>
            </div>
          ) : (
            <>
              <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                Leave a comment
              </h3>
              {pickedAnchor && (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    About: {pickedAnchor.tag}{pickedAnchor.text ? ` ${pickedAnchor.text}` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={returnToPicking}
                    className="tahi-focus-ring"
                    style={{
                      flexShrink: 0,
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      minHeight: '2.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: 'var(--color-brand-dark)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    Change
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  autoGrow()
                }}
                placeholder="What did you see?"
                rows={3}
                maxLength={MAX_BODY_LENGTH}
                disabled={status === 'sending'}
                className="tahi-focus-ring"
                style={{
                  width: '100%',
                  resize: 'none',
                  minHeight: '4.5rem',
                  maxHeight: '16rem',
                  overflowY: 'auto',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                }}
              />
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                Tell us what you saw. We capture the page and any errors for you.
              </p>
              {status === 'error' && (
                <p role="alert" style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-danger)' }}>
                  Something went wrong sending that. Please try again.
                </p>
              )}
              {remaining < 200 && (
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                  {Math.max(remaining, 0)} characters left
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  onClick={resetAll}
                  disabled={status === 'sending'}
                  className="tahi-focus-ring"
                  style={{
                    padding: '0.5rem 1rem',
                    minHeight: '2.75rem',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    cursor: status === 'sending' ? 'not-allowed' : 'pointer',
                    opacity: status === 'sending' ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend}
                  className="tahi-focus-ring"
                  style={{
                    padding: '0.5rem 1.125rem',
                    minHeight: '2.75rem',
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    border: 'none',
                    background: 'var(--color-brand)',
                    color: '#ffffff',
                    cursor: canSend ? 'pointer' : 'not-allowed',
                    opacity: canSend ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                  }}
                >
                  {status === 'sending' && <Loader2 style={{ width: '1rem', height: '1rem' }} className="animate-spin" aria-hidden="true" />}
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </Popover>
    </>
  )
}
