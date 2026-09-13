'use client'

/**
 * <FeedbackBall>, the beta feedback tool. A round floating button with a
 * comment icon, draggable anywhere on screen (mouse and touch), persisted
 * position. A click without a drag opens a small panel: free text, Send and
 * Cancel. On send, POSTs the comment plus everything lib/feedback-context.ts
 * has been quietly recording (console errors/warnings, failed fetches,
 * visible headings, impersonation state) to /api/feedback.
 *
 * Mounted ONCE, for every audience: app/(dashboard)/layout.tsx and the two
 * onboarding entry pages. There is deliberately no inbox UI here; rows are
 * read back only through GET /api/admin/feedback and the MCP tool
 * list_feedback_comments.
 *
 * Uses <Popover> (bare) for positioning, outside-click, Escape and initial
 * focus, and adds its own Tab-cycle trap on top (the same idiom
 * <ConfirmDialog> uses) since a comment box owes a keyboard user a real trap,
 * not just "focus landed inside once".
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageCircle, Check, Loader2 } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { focusablesIn } from '@/components/tahi/overlay-stack'
import { apiPath } from '@/lib/api'
import { installFeedbackContextRecorder, getFeedbackContextSnapshot } from '@/lib/feedback-context'
import {
  clampBallPosition,
  distance,
  isClickGesture,
  breakpointForWidth,
  type Point,
} from '@/lib/feedback-ball-utils'

const STORAGE_KEY = 'tahi-feedback-ball'
/** Matches the ball's rendered size (3.5rem) so pointer-math and CSS agree. */
const BALL_SIZE_PX = 56
const EDGE_MARGIN_PX = 20
const MAX_BODY_LENGTH = 5000
/** How long the "Sent, thank you" state stays up before the panel closes. */
const SENT_LINGER_MS = 1400

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'

interface DragState {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  maxDisplacement: number
}

function defaultPosition(): Point {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - BALL_SIZE_PX - EDGE_MARGIN_PX,
    y: window.innerHeight - BALL_SIZE_PX - EDGE_MARGIN_PX,
  }
}

function loadStoredPosition(): Point | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Point>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y }
    }
    return null
  } catch {
    return null
  }
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function FeedbackBall() {
  const pathname = usePathname()
  const ballRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const positionRef = useRef<Point>({ x: 0, y: 0 })

  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 })
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SendStatus>('idle')

  useEffect(() => {
    positionRef.current = position
  }, [position])

  // Mount: start the global recorder, restore (or default) the ball's
  // position, and clamp it to whatever viewport we actually landed on.
  useEffect(() => {
    installFeedbackContextRecorder()
    const stored = loadStoredPosition() ?? defaultPosition()
    setPosition(clampBallPosition(stored, BALL_SIZE_PX, viewportSize()))
    setMounted(true)
  }, [])

  // Re-clamp on resize so a position saved on a wide screen never strands the
  // ball off a phone's edge (rotating a tablet, resizing a browser window).
  useEffect(() => {
    function onResize() {
      setPosition((prev) => clampBallPosition(prev, BALL_SIZE_PX, viewportSize()))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const resetPanel = useCallback(() => {
    setOpen(false)
    setStatus('idle')
    setText('')
  }, [])

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
    // The moment a gesture crosses from "click" into "drag", dismiss an open
    // panel rather than leave it visually stranded next to a ball that just
    // moved out from under it.
    if (wasClick && !isClickGesture(drag.maxDisplacement) && open) {
      resetPanel()
    }
    const next = clampBallPosition(
      { x: drag.originX + dx, y: drag.originY + dy },
      BALL_SIZE_PX,
      viewportSize(),
    )
    setPosition(next)
  }, [open, resetPanel])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.pointerId !== e.pointerId) return
    if (isClickGesture(drag.maxDisplacement)) {
      setOpen((v) => !v)
    } else {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positionRef.current))
      } catch {
        // best-effort persistence only
      }
    }
  }, [])

  // Tab cycles inside the panel (mirrors <ConfirmDialog>'s trap). <Popover>
  // already moves initial focus in and Escape closes; this is the one thing
  // it does not do on its own.
  useEffect(() => {
    if (!open) return
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
  }, [open])

  // Auto-grow the textarea to fit its content, capped by max-height (the CSS
  // below adds the scrollbar past that).
  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    if (open) autoGrow()
  }, [open, autoGrow])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > MAX_BODY_LENGTH || status === 'sending') return
    setStatus('sending')
    try {
      const snapshot = getFeedbackContextSnapshot()
      const width = typeof window !== 'undefined' ? window.innerWidth : 0
      const height = typeof window !== 'undefined' ? window.innerHeight : 0
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
        }),
      })
      if (!res.ok) throw new Error(`Feedback POST failed: ${res.status}`)
      setStatus('sent')
      window.setTimeout(resetPanel, SENT_LINGER_MS)
    } catch {
      setStatus('error')
    }
  }, [text, status, pathname, resetPanel])

  if (!mounted) return null

  const remaining = MAX_BODY_LENGTH - text.length
  const canSend = text.trim().length > 0 && text.length <= MAX_BODY_LENGTH && status !== 'sending'

  return (
    <>
      <button
        ref={ballRef}
        type="button"
        aria-label="Leave feedback"
        aria-haspopup="dialog"
        aria-expanded={open}
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
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          zIndex: 1400,
        }}
      >
        <MessageCircle style={{ width: '1.5rem', height: '1.5rem' }} aria-hidden="true" />
      </button>

      <Popover anchorRef={ballRef} open={open} onClose={resetPanel} label="Leave a comment" bare width="20rem" offset={10}>
        <div
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
                  onClick={resetPanel}
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
