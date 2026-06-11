'use client'

// ─── Homepage motion hooks ────────────────────────────────────────────────────
//
// Shared infrastructure for "The Studio Ledger, lit" (SPECS/homepage-lit.md).
// The page must move ONE 1s tick and ONE 60s tick for the WHOLE page (not one
// interval per countdown/clock), pause while the tab is hidden, and honour
// prefers-reduced-motion. These hooks centralise that so every card can
// re-render its countdowns/clocks without spinning up its own timer.
//
//   const seconds = useSharedTick(1000)   // re-renders every visible second
//   const minutes = useSharedTick(60000)  // re-renders every visible minute
//   const { ref, inView } = useReveal<HTMLDivElement>()  // draw-on-scroll
//
// Reduced motion: useReveal returns inView=true immediately (charts paint at
// final state). The shared ticks still run (a countdown is information, not
// decoration) but are the only resting-page movement per the budget.

import { useEffect, useRef, useState } from 'react'

// ── Module-level shared tick clocks ───────────────────────────────────────────
//
// One clock per interval length for the entire page. Subscribers register a
// callback; the interval only runs while at least one subscriber is mounted AND
// the document is visible. When the tab is hidden the interval is torn down and
// re-armed on visibilitychange, so background tabs cost nothing.

type TickInterval = 1000 | 60000

interface SharedClock {
  subscribers: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  visibilityBound: boolean
  count: number
}

const clocks: Record<TickInterval, SharedClock> = {
  1000: { subscribers: new Set(), timer: null, visibilityBound: false, count: 0 },
  60000: { subscribers: new Set(), timer: null, visibilityBound: false, count: 0 },
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

function startClock(clock: SharedClock, intervalMs: TickInterval) {
  if (clock.timer !== null) return
  if (isHidden()) return
  if (clock.subscribers.size === 0) return
  clock.timer = setInterval(() => {
    clock.count += 1
    clock.subscribers.forEach(fn => fn())
  }, intervalMs)
}

function stopClock(clock: SharedClock) {
  if (clock.timer !== null) {
    clearInterval(clock.timer)
    clock.timer = null
  }
}

function ensureVisibilityBinding(clock: SharedClock, intervalMs: TickInterval) {
  if (clock.visibilityBound) return
  if (typeof document === 'undefined') return
  clock.visibilityBound = true
  document.addEventListener('visibilitychange', () => {
    if (isHidden()) {
      // Pause: tear the interval down so a hidden tab does zero work.
      stopClock(clock)
    } else {
      // Resume: fire once immediately so the UI catches up after being away,
      // then re-arm the interval.
      if (clock.subscribers.size > 0) {
        clock.count += 1
        clock.subscribers.forEach(fn => fn())
        startClock(clock, intervalMs)
      }
    }
  })
}

function subscribe(intervalMs: TickInterval, fn: () => void): () => void {
  const clock = clocks[intervalMs]
  clock.subscribers.add(fn)
  ensureVisibilityBinding(clock, intervalMs)
  startClock(clock, intervalMs)
  return () => {
    clock.subscribers.delete(fn)
    if (clock.subscribers.size === 0) stopClock(clock)
  }
}

/**
 * useSharedTick. Subscribes the calling component to the page-wide shared
 * clock of the given interval and returns a monotonically increasing tick
 * counter. The counter changes (forcing a re-render) once per visible
 * interval; while the tab is hidden the clock is paused so countdowns and
 * clocks freeze and resume cleanly. Pass 1000 for second-level countdowns,
 * 60000 for the minute marker.
 */
export function useSharedTick(intervalMs: TickInterval): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    return subscribe(intervalMs, () => setTick(t => t + 1))
  }, [intervalMs])
  return tick
}

// ── Scroll-into-view reveal ───────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * useReveal. Returns { ref, inView } where inView flips to true the first time
 * the element scrolls into view, then stays true (one-shot, for on-mount chart
 * draws and fill animations). Honours reduced motion by returning inView=true
 * immediately so charts paint at their final state with no draw. SSR-safe: ref
 * starts null and the observer only attaches on the client.
 */
export function useReveal<T extends HTMLElement>(): { ref: React.RefObject<T | null>; inView: boolean } {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    if (typeof window === 'undefined') return
    if (prefersReducedMotion()) {
      setInView(true)
      return
    }
    const node = ref.current
    if (!node) return
    if (!('IntersectionObserver' in window)) {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [inView])

  return { ref, inView }
}
