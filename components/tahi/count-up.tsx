'use client'

/**
 * <CountUp>. Animates a numeric value from its previous rendered value to
 * a new target using a decelerating rAF tween.
 *
 * RESTRAINED by spec: use only on the lead KPI tile on /overview and recap
 * surfaces, once per load. NOT on every number. Polled/live updates should
 * get a background-tint flash instead of a re-roll.
 *
 *   <CountUp value={mrr} format={n => `$${n.toLocaleString()}`} />
 *
 *   <CountUp
 *     value={requestCount}
 *     durationMs={500}
 *     format={n => String(Math.round(n))}
 *   />
 *
 * Behaviour:
 *   - On mount: tweens from 0 to value.
 *   - On value change: tweens from the currently-displayed value to the new
 *     target (smooth re-tween, no jump).
 *   - prefers-reduced-motion reduce OR document hidden: jumps straight to
 *     the final value with no animation.
 *   - format() is called with the live intermediate float; callers should
 *     Math.round() inside format if they want integer display.
 *   - Default format: Number.toLocaleString().
 *   - Outputs a plain <span> so it composes cleanly inside any layout.
 *   - tabular-nums is set globally on body (Ramp mandate); this component
 *     adds font-variant-numeric: tabular-nums defensively as an inline
 *     style so it works even inside a container that overrides the global.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { computeTweenValue } from '@/lib/motion-utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface CountUpProps {
  /** Target value to animate toward. */
  value: number
  /** Format the live intermediate value into a display string. */
  format?: (n: number) => string
  /** Animation duration in milliseconds. Default 500. */
  durationMs?: number
  /** Optional className forwarded to the <span>. */
  className?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function defaultFormat(n: number): string {
  return n.toLocaleString()
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false
  return document.hidden
}

// ── Component ────────────────────────────────────────────────────────────────

export function CountUp({
  value,
  format = defaultFormat,
  durationMs = 500,
  className,
}: CountUpProps) {
  // displayed is the float value shown right now; starts at 0 on first mount.
  const [displayed, setDisplayed] = useState(0)

  // Track the start of the current tween so we can tween FROM the in-flight
  // displayed value when a new target arrives mid-animation.
  const rafRef = useRef<number | null>(null)
  const fromRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  useEffect(() => {
    // Skip animation when reduced motion is requested or the tab is hidden.
    if (prefersReducedMotion() || isDocumentHidden()) {
      cancel()
      setDisplayed(value)
      return
    }

    // Capture the current in-flight value as the new "from" so the tween
    // starts from wherever the number currently is on screen.
    const from = fromRef.current
    fromRef.current = value
    startTimeRef.current = null

    cancel()

    const tick = (now: number) => {
      if (startTimeRef.current === null) startTimeRef.current = now
      const elapsed = now - startTimeRef.current
      const next = computeTweenValue(from, value, elapsed, durationMs)
      setDisplayed(next)
      fromRef.current = next

      if (elapsed < durationMs) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        // Snap to exact final value on completion.
        setDisplayed(value)
        fromRef.current = value
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return cancel
  }, [value, durationMs, cancel])

  return (
    <span
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {format(displayed)}
    </span>
  )
}
