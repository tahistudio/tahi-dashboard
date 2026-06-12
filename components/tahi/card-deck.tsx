'use client'

// ─── CardDeck ────────────────────────────────────────────────────────────────
//
// A peek-behind card stack (Liam's "card behind other cards that can be sliders"
// from the Crextio reference). The active card sits on top; up to two cards peek
// from behind it, offset + scaled + faded for depth. Page through with the
// prev/next controls, the dots, arrow keys when focused, autoplay, or a
// pointer/touch swipe.
//
// Homepage "lit" upgrade (SPECS/homepage-lit.md):
//   - autoplayMs: optional. Advances every autoplayMs, pauses on hover /
//     focus-within / document.hidden, and stops PERMANENTLY after any manual
//     interaction (a click, key, or swipe).
//   - A conic progress ring around the ACTIVE dot shows autoplay progress
//     (static under reduced motion, where it just reads "current dot").
//   - Pointer drag / swipe to page (mouse + touch), snapping at a ~30%
//     width threshold.
//   - A one-time "deal-in" entrance on first mount (cards settle from a slight
//     stack), reduced-motion-skipped.
//
// Reduced motion: transitions collapse to instant, the deal-in is skipped, the
// ring stops spinning (shows current state). Empty: renders emptyState.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CardDeckProps<T> {
  items: T[]
  renderCard: (item: T, isActive: boolean) => React.ReactNode
  getKey: (item: T, index: number) => string
  ariaLabel: string
  /** Height of the deck (the active card). Cards behind add a little below. */
  minHeight?: string
  emptyState?: React.ReactNode
  /**
   * When set, autoplay advances the deck every `autoplayMs` ms. Pauses on
   * hover / focus-within / hidden tab and stops permanently after any manual
   * interaction. Off (undefined) by default.
   */
  autoplayMs?: number
  /**
   * Domain ink used for the active-dot progress ring + active dot fill.
   * Defaults to brand green. Pass e.g. 'var(--domain-sales)'.
   */
  accentColor?: string
}

const PEEK = 2 // how many cards peek behind the active one
const SWIPE_THRESHOLD = 0.3 // fraction of width past which a drag pages
const PROGRESS_FPS = 20 // progress-ring update cadence while autoplaying

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function CardDeck<T>({
  items,
  renderCard,
  getKey,
  ariaLabel,
  minHeight = '7rem',
  emptyState,
  autoplayMs,
  accentColor = 'var(--color-brand)',
}: CardDeckProps<T>) {
  const [active, setActive] = useState(0)
  const regionRef = useRef<HTMLDivElement | null>(null)

  // Autoplay state. `interacted` latches true on any manual paging and stops
  // autoplay forever. `paused` is the transient pause (hover / focus / hidden).
  const [interacted, setInteracted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 fill of the active ring

  // Drag state. dragDx is the live pointer delta (px) for the rubber-band; the
  // pointer id is tracked so we ignore stray moves.
  const [dragDx, setDragDx] = useState(0)
  const dragRef = useRef<{ id: number; startX: number } | null>(null)

  // Deal-in entrance: apply the class for one mount, once, motion permitting.
  const [dealIn, setDealIn] = useState(false)

  // Clamp the active index if the items list shrinks.
  useEffect(() => {
    if (active > items.length - 1) setActive(Math.max(0, items.length - 1))
  }, [items.length, active])

  // Deal-in on first mount only.
  useEffect(() => {
    if (prefersReducedMotion()) return
    if (items.length === 0) return
    setDealIn(true)
    const id = window.setTimeout(() => setDealIn(false), 600)
    return () => window.clearTimeout(id)
    // Intentionally run once on mount; items.length guard handles late data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = useCallback((dir: 1 | -1) => {
    setActive(a => {
      const n = items.length
      if (n === 0) return 0
      return (a + dir + n) % n
    })
  }, [items.length])

  // Manual paging latches `interacted` (kills autoplay) then moves.
  const goManual = useCallback((dir: 1 | -1) => {
    setInteracted(true)
    setProgress(0)
    go(dir)
  }, [go])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goManual(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goManual(-1) }
  }, [goManual])

  // ── Autoplay loop ──────────────────────────────────────────────────────────
  // Drives a smooth progress fill and advances when it completes. Disabled
  // entirely when autoplayMs is unset, after manual interaction, while paused,
  // under reduced motion, or with a single card.
  const autoOn =
    autoplayMs != null &&
    autoplayMs > 0 &&
    !interacted &&
    !paused &&
    items.length > 1

  useEffect(() => {
    if (!autoOn) return
    if (prefersReducedMotion()) return
    const ms = autoplayMs as number
    const startedAt = performance.now()
    const step = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      const elapsed = performance.now() - startedAt
      const frac = Math.min(1, elapsed / ms)
      setProgress(frac)
      if (frac >= 1) {
        setProgress(0)
        go(1)
      }
    }, 1000 / PROGRESS_FPS)
    return () => window.clearInterval(step)
    // active is a dep so each card restarts the fill from 0.
  }, [autoOn, autoplayMs, active, go])

  // Pause autoplay while the tab is hidden (belt-and-braces with the in-loop
  // guard, so the ring doesn't jump on return).
  useEffect(() => {
    if (autoplayMs == null) return
    function onVis() {
      setPaused(document.hidden)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [autoplayMs])

  // ── Pointer drag / swipe ─────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (items.length < 2) return
    // Ignore drags that start on an interactive control inside a card.
    const target = e.target as HTMLElement
    if (target.closest('a, button, input, textarea, select, [role="button"]')) return
    dragRef.current = { id: e.pointerId, startX: e.clientX }
  }, [items.length])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    setDragDx(e.clientX - d.startX)
  }, [])

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const width = regionRef.current?.offsetWidth ?? 1
    const dx = e.clientX - d.startX
    dragRef.current = null
    setDragDx(0)
    if (Math.abs(dx) > width * SWIPE_THRESHOLD) {
      goManual(dx < 0 ? 1 : -1)
    }
  }, [goManual])

  if (items.length === 0) return <>{emptyState ?? null}</>

  const reduced = typeof window !== 'undefined' && prefersReducedMotion()

  return (
    <div
      ref={regionRef}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onMouseEnter={() => autoplayMs != null && setPaused(true)}
      onMouseLeave={() => autoplayMs != null && setPaused(false)}
      onFocus={() => autoplayMs != null && setPaused(true)}
      onBlur={e => {
        if (autoplayMs != null && !e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      tabIndex={0}
      className={`card-deck${dealIn ? ' card-deck-dealin' : ''}`}
      style={{ position: 'relative', borderRadius: 'var(--radius-lg)', touchAction: 'pan-y' }}
    >
      {/* sr-only live region: announces the active card to AT on navigation */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
        {`Card ${active + 1} of ${items.length}`}
      </div>
      <div style={{ position: 'relative', minHeight }}>
        {items.map((item, i) => {
          // Depth relative to the active card, wrapping so the deck feels circular.
          const n = items.length
          let depth = i - active
          if (depth < 0) depth += n
          const isActive = depth === 0
          const behind = depth > 0 && depth <= PEEK
          if (!isActive && !behind) {
            // Off-stack cards stay mounted but hidden (keeps focus order sane).
            return (
              <div key={getKey(item, i)} aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', visibility: 'hidden' }}>
                {renderCard(item, false)}
              </div>
            )
          }
          // The active card follows the live drag for a tactile rubber-band; the
          // peek cards stay put. Drag overrides the transition so it tracks 1:1.
          const dragging = isActive && dragDx !== 0
          return (
            <div
              key={getKey(item, i)}
              aria-hidden={!isActive}
              aria-label={isActive ? `Card ${active + 1} of ${items.length}` : undefined}
              className="card-deck-card"
              style={{
                position: isActive ? 'relative' : 'absolute',
                inset: isActive ? undefined : 0,
                // The active card must fill the deck's minHeight so its opaque
                // surface fully covers the peek cards. Without this, a card whose
                // content is shorter than minHeight leaves a gap below it where the
                // cards behind show through (the "stacked text bleed" bug). Peek
                // cards already fill via inset:0.
                minHeight: isActive ? minHeight : undefined,
                zIndex: PEEK + 1 - depth,
                // Opaque surface so the active card fully OCCLUDES the cards behind
                // it (otherwise their text ghosts through). The peek cards carry a
                // hairline edge + radius so they read as a real layered stack.
                background: 'var(--color-bg)',
                border: isActive ? undefined : '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                transform: isActive
                  ? `translateX(${dragDx}px)`
                  : `translateY(${depth * 0.5}rem) scale(${1 - depth * 0.035})`,
                opacity: isActive ? 1 : 0.6 - (depth - 1) * 0.22,
                transformOrigin: 'top center',
                pointerEvents: isActive ? 'auto' : 'none',
                touchAction: 'pan-y',
                transition: dragging
                  ? 'none'
                  : 'transform var(--motion-medium) var(--ease-productive), opacity var(--motion-medium) var(--ease-productive)',
              }}
            >
              {renderCard(item, isActive)}
            </div>
          )
        })}
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-3)' }}>
          {/* Dots. The active dot carries the autoplay progress ring. */}
          <div className="flex items-center" style={{ gap: 'var(--space-1-5)' }} aria-hidden="true">
            {items.map((_, i) => {
              const isActive = i === active
              if (isActive) {
                return (
                  <span key={i} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '0.875rem', height: '0.875rem' }}>
                    {/* Progress ring (only meaningful while autoplaying). */}
                    {autoOn && !reduced && (
                      <span
                        className="card-deck-progress-ring"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: '9999px',
                          ['--deck-progress' as string]: String(progress),
                          ['--deck-ring-colour' as string]: accentColor,
                        }}
                      />
                    )}
                    <span
                      style={{
                        width: '0.375rem',
                        height: '0.375rem',
                        borderRadius: '9999px',
                        background: accentColor,
                      }}
                    />
                  </span>
                )
              }
              return (
                <span
                  key={i}
                  style={{
                    width: '0.375rem',
                    height: '0.375rem',
                    borderRadius: '9999px',
                    background: 'var(--color-border-strong)',
                    transition: 'background-color var(--motion-base) var(--ease-productive)',
                  }}
                />
              )
            })}
          </div>
          {/* Prev / next */}
          <div className="flex items-center" style={{ gap: 'var(--space-1)' }}>
            <DeckBtn label="Previous" onClick={() => goManual(-1)}><ChevronLeft size={15} aria-hidden="true" /></DeckBtn>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums', minWidth: '2.25rem', textAlign: 'center' }}>
              {active + 1} / {items.length}
            </span>
            <DeckBtn label="Next" onClick={() => goManual(1)}><ChevronRight size={15} aria-hidden="true" /></DeckBtn>
          </div>
        </div>
      )}
    </div>
  )
}

function DeckBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center new-menu-item"
      style={{
        minWidth: '2.75rem',
        minHeight: '2.75rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
