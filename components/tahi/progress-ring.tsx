'use client'

/**
 * <ProgressRing>. SVG circular progress indicator.
 *
 * Animated stroke-dashoffset transition conveys the arc fill. The track
 * circle uses --color-border-subtle; the progress arc uses --color-brand.
 * Reduced motion: value change is immediate (no transition). The component
 * is accessible via role="progressbar" + aria-valuenow.
 *
 *   <ProgressRing value={72} />
 *
 *   <ProgressRing value={onboardingProgress} size={64} strokeWidth={5}>
 *     <span style={{ fontSize: '0.875rem', fontWeight: 700 }}>{onboardingProgress}%</span>
 *   </ProgressRing>
 *
 *   <ProgressRing value={pct} label="Capacity used">
 *     <CountUp value={pct} format={n => `${Math.round(n)}%`} />
 *   </ProgressRing>
 *
 * Props:
 *   value        Progress 0-100. Values outside this range are clamped.
 *   size         Outer diameter in pixels. Default 48.
 *   strokeWidth  Track and arc stroke width in pixels. Default 4.
 *   label        aria-label for the progressbar role. Shown as a tooltip
 *                for screen-reader users; not rendered visually.
 *   children     Rendered centred inside the ring. If omitted, a plain
 *                percentage label is shown (e.g. "72%").
 */

import React, { useEffect, useRef, useState } from 'react'

// ── Reduced-motion detection ─────────────────────────────────────────────────

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProgressRingProps {
  /** Progress percentage, 0-100. Clamped to valid range. */
  value: number
  /** Outer diameter of the ring in px. Default 48. */
  size?: number
  /** Stroke width of track and arc in px. Default 4. */
  strokeWidth?: number
  /** Accessible label for the progressbar element. */
  label?: string
  /** Content rendered in the centre of the ring. Defaults to value%. */
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProgressRing({
  value,
  size = 48,
  strokeWidth = 4,
  label,
  children,
  className,
  style,
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, value))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  // Track whether reduced motion applies. We read it once on mount and do not
  // re-check (a toggle mid-session is extremely rare; the browser will handle
  // it via the CSS `transition: none` override if the user changes the setting
  // while the page is open).
  const reducedMotion = useRef(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    reducedMotion.current = prefersReducedMotion()
    setMounted(true)
  }, [])

  const transition = !mounted || reducedMotion.current
    ? 'none'
    : 'stroke-dashoffset var(--dur-5, 400ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1))'

  const defaultLabel = `${Math.round(clamped)}%`

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? defaultLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border-subtle)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc. Rotated -90deg so it starts from the top (12 o'clock). */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transformOrigin: 'center',
            transform: 'rotate(-90deg)',
            transition,
          }}
        />
      </svg>
      {/* Centre content */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.25,
          fontWeight: 600,
          color: 'var(--color-text)',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children ?? defaultLabel}
      </div>
    </div>
  )
}
