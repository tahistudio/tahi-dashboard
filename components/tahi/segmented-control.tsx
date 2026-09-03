'use client'

/**
 * <SegmentedControl>. The sliding-pill segmented control shared by the
 * Requests view switcher, the detail Activity filter, the dialog size control
 * and the settings SlideSeg wrapper. Styles live in app/globals.css under
 * SEGMENTED CONTROL (.tahi-seg*).
 *
 * The pill is a real element measured from the active button's offsetLeft and
 * offsetWidth in a layout effect, so it follows whatever the buttons are doing
 * (icon-only breakpoints, fill columns, font swaps) with no per-consumer
 * maths. It re-measures on value, the option list, a ResizeObserver on the
 * track and the active button, and document.fonts.ready. It stays hidden
 * until the first measurement so hydration never jumps, and the transition
 * only switches on after a layout effect has forced the browser to compute
 * that first position with the transition still off, so mounting never
 * slides it in from the left edge (see the settled effect below).
 *
 * Roles: tablist (role=tab, aria-selected), radiogroup (role=radio,
 * aria-checked) and group (aria-pressed). tablist and radiogroup use a roving
 * tabindex with Arrow Left/Right cycling and Home/End jumping, skipping
 * disabled options. The focus ring is the shared .tahi-focus-ring class; the
 * buttons never carry an inline box-shadow, so the pill cannot swallow it.
 */

import * as React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type SegmentedControlRole = 'tablist' | 'radiogroup' | 'group'
export type SegmentedControlSize = 'sm' | 'md'
export type SegmentedControlBreakpoint = 'md' | 'lg'

export interface SegmentedControlOption<V extends string> {
  value: V
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  /**
   * Native tooltip. Browsers also expose it as the accessible description
   * (HTML-AAM maps title to the description when the name comes from
   * elsewhere), so a reason such as "This plan has no large track" reaches
   * screen readers. It is still hover-only for touch users, so a consumer
   * that disables an option should repeat the reason as visible helper text.
   * Falls back to the label when iconOnlyBelow hides it; a native title
   * cannot follow a breakpoint, so that fallback is present at every width.
   */
  title?: string
  /** id of the panel this option switches to. Emitted as aria-controls. */
  panelId?: string
}

export interface SegmentedControlProps<V extends string> {
  value: V
  onChange: (next: V) => void
  options: ReadonlyArray<SegmentedControlOption<V>>
  ariaLabel: string
  /** tablist and radiogroup get a roving tabindex plus Arrow, Home and End keys. */
  role?: SegmentedControlRole
  /** sm is 2rem tall from md up, md is 2.25rem; both are 2.75rem below md. */
  size?: SegmentedControlSize
  /**
   * Equal-width columns across the full width; otherwise content width. A
   * label longer than its column ellipsises rather than widening the track.
   */
  fill?: boolean
  /** Hide the label below this breakpoint; the name moves to title and aria-label. */
  iconOnlyBelow?: SegmentedControlBreakpoint
  /**
   * Extra classes on the track. Width and margin utilities only: the
   * .tahi-seg rules are unlayered and own display and padding, so Tailwind
   * display or padding utilities passed here are overridden.
   */
  className?: string
}

/**
 * Where the pill sits, in layout pixels read from the active button.
 * @internal Exported for the unit tests.
 */
export interface SegmentedPillRect {
  left: number
  width: number
}

/**
 * Inline style for the pill. Hidden until there is a measurement.
 * @internal Exported for the unit tests.
 */
export function pillStyle(rect: SegmentedPillRect | null): React.CSSProperties {
  if (!rect) return { visibility: 'hidden' }
  return { transform: `translateX(${rect.left}px)`, width: `${rect.width}px` }
}

/**
 * The option a key press moves to from `from`, or null when the key is not
 * one the control owns or nothing is enabled. Arrows cycle and skip disabled
 * options; Home and End jump to the first and last enabled option.
 * @internal Exported for the unit tests.
 */
export function nextSegmentIndex<V extends string>(
  options: ReadonlyArray<SegmentedControlOption<V>>,
  from: number,
  key: string,
): number | null {
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]))
  if (enabled.length === 0) return null
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled[enabled.length - 1]
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null
  const step = key === 'ArrowRight' ? 1 : -1
  const n = options.length
  let i = from
  for (let hop = 0; hop < n; hop++) {
    i = (i + step + n) % n
    if (!options[i].disabled) return i
  }
  return null
}

const TRACK_SIZE: Record<SegmentedControlSize, string> = {
  sm: 'tahi-seg-sm',
  md: 'tahi-seg-md',
}

const TRACK_ICON_ONLY: Record<SegmentedControlBreakpoint, string> = {
  md: 'tahi-seg-icon-md',
  lg: 'tahi-seg-icon-lg',
}

/* Static strings so Tailwind can see them; never built at runtime. */
const LABEL_BELOW: Record<SegmentedControlBreakpoint, string> = {
  md: 'tahi-seg-label hidden md:inline',
  lg: 'tahi-seg-label hidden lg:inline',
}

function optionStateProps(
  role: SegmentedControlRole,
  active: boolean,
): React.ButtonHTMLAttributes<HTMLButtonElement> {
  if (role === 'tablist') return { role: 'tab', 'aria-selected': active }
  if (role === 'radiogroup') return { role: 'radio', 'aria-checked': active }
  return { 'aria-pressed': active }
}

export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  role = 'group',
  size = 'md',
  fill = false,
  iconOnlyBelow,
  className,
}: SegmentedControlProps<V>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const buttons = useRef(new Map<V, HTMLButtonElement>())
  const [pill, setPill] = useState<SegmentedPillRect | null>(null)
  const [settled, setSettled] = useState(false)

  const measure = useCallback(() => {
    const el = buttons.current.get(value)
    if (!el) {
      setPill(null)
      return
    }
    const next = { left: el.offsetLeft, width: el.offsetWidth }
    setPill(prev => (prev && prev.left === next.left && prev.width === next.width ? prev : next))
  }, [value])

  // A reorder with the same option count still moves the active button, so
  // the re-measure keys on the ordered values rather than the length.
  const optionKey = options.map(o => o.value).join('\n')

  // Measure before paint on every change that can move the active button.
  useLayoutEffect(() => {
    measure()
  }, [measure, optionKey, size, fill, iconOnlyBelow])

  // Re-measure when the track or the active button changes size: breakpoint
  // crossings, label swaps, container resizes.
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    if (trackRef.current) observer.observe(trackRef.current)
    const active = buttons.current.get(value)
    if (active) observer.observe(active)
    return () => observer.disconnect()
  }, [measure, value])

  // Web fonts landing after mount change every button's width.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return
    let cancelled = false
    document.fonts.ready.then(
      () => {
        if (!cancelled) measure()
      },
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [measure])

  // Switch the transition on only once the browser has computed the first
  // measured position with the transition still off. A passive effect is not
  // enough for that: on the hydration path the setPill above lands at sync
  // priority, React flushes the passive effects of a sync commit before it
  // yields, and nothing in between forces a style recalc, so the pill's
  // before-change style would still be the transform: none that measure()
  // forced, and the first recalc with the transition on would slide the pill
  // in from the track's left edge. Reading offsetWidth here, in the commit
  // that applied the transform, forces that recalc while data-state is still
  // "measuring"; only then does the flip happen. The flag drops again if the
  // pill loses its button, so the next measurement is committed the same way.
  useLayoutEffect(() => {
    if (!pill) {
      if (settled) setSettled(false)
      return
    }
    if (settled) return
    if (pillRef.current) void pillRef.current.offsetWidth
    setSettled(true)
  }, [pill, settled])

  const roving = role !== 'group'
  const activeIndex = options.findIndex(o => o.value === value)
  const activeEnabled = activeIndex >= 0 && !options[activeIndex].disabled
  const tabStop = activeEnabled ? activeIndex : options.findIndex(o => !o.disabled)

  const handleKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!roving) return
    const next = nextSegmentIndex(options, index, e.key)
    if (next === null) return
    e.preventDefault()
    const target = options[next]
    buttons.current.get(target.value)?.focus()
    if (target.value !== value) onChange(target.value)
  }

  const trackClass = [
    'tahi-seg',
    TRACK_SIZE[size],
    fill ? 'tahi-seg-fill' : null,
    iconOnlyBelow ? TRACK_ICON_ONLY[iconOnlyBelow] : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={trackRef} role={role} aria-label={ariaLabel} className={trackClass}>
      <span
        ref={pillRef}
        className="tahi-seg-pill"
        aria-hidden="true"
        data-state={settled ? 'ready' : 'measuring'}
        style={pillStyle(pill)}
      />
      {options.map((opt, index) => {
        const active = opt.value === value
        const disabled = opt.disabled === true
        return (
          <button
            key={opt.value}
            ref={el => {
              if (el) buttons.current.set(opt.value, el)
              else buttons.current.delete(opt.value)
            }}
            type="button"
            className="tahi-seg-b tahi-focus-ring"
            data-active={active ? 'true' : undefined}
            aria-disabled={disabled ? true : undefined}
            aria-label={iconOnlyBelow ? opt.label : undefined}
            aria-controls={opt.panelId}
            title={opt.title ?? (iconOnlyBelow ? opt.label : undefined)}
            tabIndex={roving ? (index === tabStop ? 0 : -1) : undefined}
            onClick={() => {
              if (!disabled) onChange(opt.value)
            }}
            onKeyDown={handleKeyDown(index)}
            {...optionStateProps(role, active)}
          >
            {opt.icon ? (
              <span className="tahi-seg-ic" aria-hidden="true">
                {opt.icon}
              </span>
            ) : null}
            <span className={iconOnlyBelow ? LABEL_BELOW[iconOnlyBelow] : 'tahi-seg-label'}>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
