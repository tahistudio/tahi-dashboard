'use client'

/**
 * Animated icons. Lucide Animated style.
 *
 * Built on Motion (Framer Motion's lighter package). Hover behaviour:
 *
 *   Mouse-enter starts the animation. The full keyframe sequence plays
 *   through regardless of cursor position. Leaving mid-play does NOT
 *   reverse or snap. After the sequence completes, the icon sits at its
 *   rest state and is ready to be re-triggered by the next mouse-enter.
 *
 *   Continuous patterns (refresh-cw) are designed as one-shot full
 *   rotations: a single 360° spin per hover, not an infinite loop.
 *
 * Implementation: `useAnimationControls` lets us await the animation
 * promise. An `isPlaying` ref guards against re-triggers while a
 * sequence is in flight. Curves match `--motion-base` (420ms) /
 * `--ease-out` (cubic-bezier(0.22, 1, 0.36, 1)).
 *
 * Honours prefers-reduced-motion via the global rule in globals.css.
 */

import * as React from 'react'
import { motion, useAnimationControls, type MotionProps } from 'motion/react'

const TAHI_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const TAHI_SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1]

interface AnimatedIconProps {
  size?: number | string
  strokeWidth?: number
  color?: string
  className?: string
  'aria-label'?: string
}

function baseSvgProps(p: AnimatedIconProps) {
  return {
    width: p.size ?? 24,
    height: p.size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: p.color ?? 'currentColor',
    strokeWidth: p.strokeWidth ?? 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': p['aria-label'] ? undefined : true,
    'aria-label': p['aria-label'],
    role: p['aria-label'] ? 'img' : undefined,
    className: p.className,
  }
}

/**
 * Hook that exposes an `onMouseEnter` handler which plays the given
 * sequence to completion once. While a sequence is in flight, further
 * mouse-enters are ignored. They re-trigger only after the previous
 * play finishes.
 */
function useHoverSequence(
  controls: ReturnType<typeof useAnimationControls>,
  rest: Record<string, unknown>,
  sequence: Record<string, unknown>,
  transition: Record<string, unknown>,
) {
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await controls.start({ ...sequence, transition })
      // Ensure we end exactly at rest in case the keyframes did not.
      await controls.start({ ...rest, transition: { duration: 0 } })
    } finally {
      playing.current = false
    }
  }, [controls, rest, sequence, transition])
  return onMouseEnter
}

// ── Settings cog · rotates 60° then glides back to 0° ───────────────────
export function AnimatedSettings(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotate: 0 },
    { rotate: [0, 60, 0] },
    { duration: 1.1, ease: TAHI_EASE, times: [0, 0.6, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </motion.svg>
  )
}

// ── Bell · rings once on hover. Pivot at the top of the bell ────────────
export function AnimatedBell(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotate: 0 },
    { rotate: [0, -12, 10, -6, 0] },
    { duration: 0.7, ease: TAHI_EASE, times: [0, 0.2, 0.45, 0.7, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: '50% 10%' }}
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </motion.svg>
  )
}

// ── Heart · soft double beat ────────────────────────────────────────────
export function AnimatedHeart(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scale: 1 },
    { scale: [1, 1.16, 1, 1.12, 1] },
    { duration: 0.65, ease: TAHI_EASE, times: [0, 0.25, 0.5, 0.75, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scale: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </motion.svg>
  )
}

// ── Refresh · one full 360° spin per hover. Linear, no overshoot ────────
export function AnimatedRefresh(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotate: 0 },
    { rotate: [0, 360] },
    { duration: 1.0, ease: 'linear' },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </motion.svg>
  )
}

// ── Search · gentle three-swing wiggle ──────────────────────────────────
export function AnimatedSearch(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotate: 0 },
    { rotate: [0, -12, 12, -8, 4, 0] },
    { duration: 0.8, ease: TAHI_SPRING, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: '40% 40%' }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </motion.svg>
  )
}

// ── Eye · single blink ──────────────────────────────────────────────────
export function AnimatedEye(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scaleY: 1 },
    { scaleY: [1, 1, 0.05, 1] },
    { duration: 0.7, ease: TAHI_EASE, times: [0, 0.45, 0.55, 0.75] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scaleY: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </motion.svg>
  )
}

// ── Sparkles · single pulse, AI features ────────────────────────────────
export function AnimatedSparkles(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scale: 1, opacity: 1 },
    { scale: [1, 1.15, 1], opacity: [1, 0.85, 1] },
    { duration: 0.7, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scale: 1, opacity: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </motion.svg>
  )
}

// ── Check-circle · draws the tick in on hover, holds, fades back ────────
export function AnimatedCheckCircle(props: AnimatedIconProps) {
  const tickControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await tickControls.start({ pathLength: 1, transition: { duration: 0.5, ease: TAHI_EASE } })
      // Hold the completed tick for a beat, then return to rest.
      await new Promise(r => setTimeout(r, 350))
      await tickControls.start({ pathLength: 0, transition: { duration: 0.25, ease: TAHI_EASE } })
    } finally {
      playing.current = false
    }
  }, [tickControls])
  return (
    <motion.svg
      {...baseSvgProps(props)}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <motion.polyline
        points="22 4 12 14.01 9 11.01"
        initial={{ pathLength: 0 }}
        animate={tickControls}
      />
    </motion.svg>
  )
}

// ── Trash · lid lifts then settles back ─────────────────────────────────
export function AnimatedTrash(props: AnimatedIconProps) {
  const lidControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await lidControls.start({ rotate: -18, y: -1.5, transition: { duration: 0.3, ease: TAHI_EASE } })
      await new Promise(r => setTimeout(r, 200))
      await lidControls.start({ rotate: 0, y: 0, transition: { duration: 0.4, ease: TAHI_EASE } })
    } finally {
      playing.current = false
    }
  }, [lidControls])
  return (
    <motion.svg
      {...baseSvgProps(props)}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <motion.g
        initial={{ rotate: 0, y: 0 }}
        animate={lidControls}
        style={{ transformOrigin: '6px 6px' }}
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </motion.g>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </motion.svg>
  )
}

// ── Inbox · lid lifts on hover then settles ───────────────────────────
export function AnimatedInbox(props: AnimatedIconProps) {
  const lidControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await lidControls.start({ y: -1.5, transition: { duration: 0.3, ease: TAHI_EASE } })
      await new Promise(r => setTimeout(r, 200))
      await lidControls.start({ y: 0, transition: { duration: 0.4, ease: TAHI_EASE } })
    } finally { playing.current = false }
  }, [lidControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <motion.g initial={{ y: 0 }} animate={lidControls}>
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </motion.g>
    </motion.svg>
  )
}

// ── Check-square · tick draws on inside the square ────────────────────
export function AnimatedCheckSquare(props: AnimatedIconProps) {
  const tickControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await tickControls.start({ pathLength: 1, transition: { duration: 0.45, ease: TAHI_EASE } })
      await new Promise(r => setTimeout(r, 280))
      await tickControls.start({ pathLength: 0, transition: { duration: 0.22, ease: TAHI_EASE } })
    } finally { playing.current = false }
  }, [tickControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      <motion.polyline points="9 11 12 14 22 4" initial={{ pathLength: 0 }} animate={tickControls} />
    </motion.svg>
  )
}

// ── Message-square · bubble pulses + tail wiggles slightly ────────────
export function AnimatedMessageSquare(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scale: 1 },
    { scale: [1, 1.08, 0.98, 1.04, 1] },
    { duration: 0.65, ease: TAHI_EASE, times: [0, 0.25, 0.5, 0.75, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scale: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </motion.svg>
  )
}

// ── Calendar · today's date pulses ────────────────────────────────────
export function AnimatedCalendar(props: AnimatedIconProps) {
  const dayControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await dayControls.start({ opacity: [0, 1, 1, 0], transition: { duration: 0.7, times: [0, 0.3, 0.7, 1], ease: TAHI_EASE } })
    } finally { playing.current = false }
  }, [dayControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <motion.rect
        x="10" y="13" width="4" height="4" rx="1"
        fill="currentColor"
        stroke="none"
        initial={{ opacity: 0 }}
        animate={dayControls}
      />
    </motion.svg>
  )
}

// ── Clock · second hand sweeps once ───────────────────────────────────
export function AnimatedClock(props: AnimatedIconProps) {
  const handControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await handControls.start({ rotate: 360, transition: { duration: 0.9, ease: TAHI_EASE } })
      await handControls.start({ rotate: 0, transition: { duration: 0 } })
    } finally { playing.current = false }
  }, [handControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <circle cx="12" cy="12" r="10" />
      <motion.line
        x1="12" y1="12" x2="12" y2="7"
        initial={{ rotate: 0 }}
        animate={handControls}
        style={{ transformOrigin: '12px 12px', transformBox: 'fill-box' }}
      />
      <line x1="12" y1="12" x2="16" y2="14" />
    </motion.svg>
  )
}

// ── Trending-up · whole icon nudges up-right (the direction of trend) ──
export function AnimatedTrendingUp(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { x: 0, y: 0 },
    { x: [0, 2, 0], y: [0, -2, 0] },
    { duration: 0.65, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ x: 0, y: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </motion.svg>
  )
}

// ── Bar-chart · bars grow from bottom ─────────────────────────────────
export function AnimatedBarChart(props: AnimatedIconProps) {
  const barControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await barControls.start({ scaleY: [0.2, 1], transition: { duration: 0.5, ease: TAHI_EASE } })
    } finally { playing.current = false }
  }, [barControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <motion.line
        x1="12" y1="20" x2="12" y2="10"
        initial={{ scaleY: 1 }}
        animate={barControls}
        style={{ transformOrigin: '12px 20px', transformBox: 'fill-box' }}
      />
      <motion.line
        x1="18" y1="20" x2="18" y2="4"
        initial={{ scaleY: 1 }}
        animate={barControls}
        style={{ transformOrigin: '18px 20px', transformBox: 'fill-box' }}
      />
      <motion.line
        x1="6" y1="20" x2="6" y2="16"
        initial={{ scaleY: 1 }}
        animate={barControls}
        style={{ transformOrigin: '6px 20px', transformBox: 'fill-box' }}
      />
    </motion.svg>
  )
}

// ── Users · gentle bounce on the group ────────────────────────────────
export function AnimatedUsers(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { y: 0 },
    { y: [0, -1.5, 0.5, 0] },
    { duration: 0.55, ease: TAHI_SPRING, times: [0, 0.35, 0.7, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ y: 0 }}
      onMouseEnter={onMouseEnter}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </motion.svg>
  )
}

// ── Layout-dashboard · the four tiles pulse sequentially ──────────────
export function AnimatedLayoutDashboard(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scale: 1 },
    { scale: [1, 1.08, 1] },
    { duration: 0.55, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scale: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </motion.svg>
  )
}

// ── File-text · top corner folds down (page-turn cue) ─────────────────
export function AnimatedFileText(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { y: 0 },
    { y: [0, -1.5, 0] },
    { duration: 0.55, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ y: 0 }}
      onMouseEnter={onMouseEnter}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </motion.svg>
  )
}

// ── Gauge · needle swings ─────────────────────────────────────────────
export function AnimatedGauge(props: AnimatedIconProps) {
  const needleControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await needleControls.start({ rotate: [0, 45, -20, 0], transition: { duration: 0.75, ease: TAHI_EASE, times: [0, 0.4, 0.7, 1] } })
    } finally { playing.current = false }
  }, [needleControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <motion.path
        d="m12 14 4-4"
        initial={{ rotate: 0 }}
        animate={needleControls}
        style={{ transformOrigin: '12px 14px', transformBox: 'fill-box' }}
      />
    </motion.svg>
  )
}

// ── Star · sparkle (scale + rotate) ───────────────────────────────────
export function AnimatedStar(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scale: 1, rotate: 0 },
    { scale: [1, 1.2, 1], rotate: [0, 20, 0] },
    { duration: 0.65, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scale: 1, rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </motion.svg>
  )
}

// ── Megaphone · gentle shake ──────────────────────────────────────────
export function AnimatedMegaphone(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotate: 0 },
    { rotate: [0, -8, 6, -4, 0] },
    { duration: 0.6, ease: TAHI_SPRING, times: [0, 0.25, 0.5, 0.75, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotate: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center' }}
    >
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </motion.svg>
  )
}

// ── Credit-card · card flips on its long axis ─────────────────────────
export function AnimatedCreditCard(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { rotateY: 0 },
    { rotateY: [0, 180, 360] },
    { duration: 0.8, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ rotateY: 0 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center', transformStyle: 'preserve-3d' }}
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </motion.svg>
  )
}

// ── Book-open · pages flutter ─────────────────────────────────────────
export function AnimatedBookOpen(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { scaleY: 1 },
    { scaleY: [1, 0.9, 1.05, 1] },
    { duration: 0.6, ease: TAHI_EASE, times: [0, 0.3, 0.7, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ scaleY: 1 }}
      onMouseEnter={onMouseEnter}
      style={{ transformOrigin: 'center bottom' }}
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </motion.svg>
  )
}

// ── Folder-open · folder lid lifts ────────────────────────────────────
export function AnimatedFolderOpen(props: AnimatedIconProps) {
  const controls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    controls,
    { y: 0 },
    { y: [0, -2, 0] },
    { duration: 0.55, ease: TAHI_EASE, times: [0, 0.5, 1] },
  )
  return (
    <motion.svg
      {...baseSvgProps(props)}
      animate={controls}
      initial={{ y: 0 }}
      onMouseEnter={onMouseEnter}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </motion.svg>
  )
}

// ── User-cog · the cog spins, user icon stays put ─────────────────────
export function AnimatedUserCog(props: AnimatedIconProps) {
  const cogControls = useAnimationControls()
  const onMouseEnter = useHoverSequence(
    cogControls,
    { rotate: 0 },
    { rotate: [0, 60, 0] },
    { duration: 0.9, ease: TAHI_EASE, times: [0, 0.6, 1] },
  )
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <circle cx="10" cy="7" r="4" />
      <path d="M10 14a7 7 0 0 0-7 7h7" />
      <motion.g
        animate={cogControls}
        initial={{ rotate: 0 }}
        style={{ transformOrigin: '17.5px 17.5px', transformBox: 'fill-box' }}
      >
        <circle cx="17.5" cy="17.5" r="2.5" />
        <path d="M17.5 14.5v-1" />
        <path d="M17.5 21.5v-1" />
        <path d="M20.5 17.5h-1" />
        <path d="M15.5 17.5h-1" />
        <path d="m19.6 15.4-.7.7" />
        <path d="m16.1 18.9-.7.7" />
        <path d="m19.6 19.6-.7-.7" />
        <path d="m16.1 16.1-.7-.7" />
      </motion.g>
    </motion.svg>
  )
}

// ── File-signature · signature line dances ────────────────────────────
export function AnimatedFileSignature(props: AnimatedIconProps) {
  const lineControls = useAnimationControls()
  const playing = React.useRef(false)
  const onMouseEnter = React.useCallback(async () => {
    if (playing.current) return
    playing.current = true
    try {
      await lineControls.start({ pathLength: [0, 1], transition: { duration: 0.5, ease: TAHI_EASE } })
      await new Promise(r => setTimeout(r, 250))
      await lineControls.start({ pathLength: 0, transition: { duration: 0.2 } })
    } finally { playing.current = false }
  }, [lineControls])
  return (
    <motion.svg {...baseSvgProps(props)} onMouseEnter={onMouseEnter}>
      <path d="M20 19.5V14h-5.5" />
      <path d="M20 14 4 2v18l4-2 4 2 4-2 4 2" />
      <path d="M9.5 17.5c-.4 0-.6-.4-.4-.7.5-.7 1.6-1.4 3-1.4 1.7 0 3 1 3.5 1.5" />
      <motion.path
        d="M3 15c1-2 3-3 5-3 1.5 0 3 .8 4 2"
        initial={{ pathLength: 0 }}
        animate={lineControls}
      />
    </motion.svg>
  )
}

export const ANIMATED_ICONS = {
  'settings':         AnimatedSettings,
  'bell':             AnimatedBell,
  'heart':            AnimatedHeart,
  'refresh-cw':       AnimatedRefresh,
  'search':           AnimatedSearch,
  'eye':              AnimatedEye,
  'sparkles':         AnimatedSparkles,
  'check-circle':     AnimatedCheckCircle,
  'trash':            AnimatedTrash,
  'inbox':            AnimatedInbox,
  'check-square':     AnimatedCheckSquare,
  'message-square':   AnimatedMessageSquare,
  'calendar':         AnimatedCalendar,
  'clock':            AnimatedClock,
  'trending-up':      AnimatedTrendingUp,
  'bar-chart':        AnimatedBarChart,
  'users':            AnimatedUsers,
  'layout-dashboard': AnimatedLayoutDashboard,
  'file-text':        AnimatedFileText,
  'gauge':            AnimatedGauge,
  'star':             AnimatedStar,
  'megaphone':        AnimatedMegaphone,
  'credit-card':      AnimatedCreditCard,
  'book-open':        AnimatedBookOpen,
  'folder-open':      AnimatedFolderOpen,
  'user-cog':         AnimatedUserCog,
  'file-signature':   AnimatedFileSignature,
} as const satisfies Record<string, React.ComponentType<AnimatedIconProps>>

export type AnimatedIconName = keyof typeof ANIMATED_ICONS
export type { MotionProps }
