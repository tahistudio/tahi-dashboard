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

export const ANIMATED_ICONS = {
  'settings':     AnimatedSettings,
  'bell':         AnimatedBell,
  'heart':        AnimatedHeart,
  'refresh-cw':   AnimatedRefresh,
  'search':       AnimatedSearch,
  'eye':          AnimatedEye,
  'sparkles':     AnimatedSparkles,
  'check-circle': AnimatedCheckCircle,
  'trash':        AnimatedTrash,
} as const satisfies Record<string, React.ComponentType<AnimatedIconProps>>

export type AnimatedIconName = keyof typeof ANIMATED_ICONS
export type { MotionProps }
