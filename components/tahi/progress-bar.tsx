'use client'

/**
 * <ProgressBar>. Linear sibling of <Gauge>. Use for "X of Y" displays
 * (tasks complete, capacity used, retainer hours burnt, etc.) anywhere
 * the value sits on a single linear scale.
 *
 *   <ProgressBar value={42} max={100} label="Capacity used" />
 *
 *   <ProgressBar
 *     value={hoursLogged}
 *     max={retainerCap}
 *     tone="warning"
 *     label="Hours logged this month"
 *     trailing={`${hoursLogged}h / ${retainerCap}h`}
 *   />
 *
 *   <ProgressBar
 *     segments={[
 *       { value: 18, tone: 'positive', label: 'Done' },
 *       { value: 6,  tone: 'warning',  label: 'In progress' },
 *       { value: 2,  tone: 'danger',   label: 'Blocked' },
 *     ]}
 *     max={32}
 *   />
 *
 * Tone behaviour:
 *   - 'auto'      brand at < 75%, warning at 75-99%, danger at >= 100%
 *   - 'positive'  brand-green
 *   - 'warning'   amber
 *   - 'danger'    red
 *   - 'neutral'   muted slate
 *
 * Animates from 0 to target width when scrolled into view; respects
 * prefers-reduced-motion via the shared useEnteredViewport hook.
 */

import * as React from 'react'

type Tone = 'positive' | 'warning' | 'danger' | 'neutral'
type ToneOrAuto = Tone | 'auto'

const TONE_COLOUR: Record<Tone, string> = {
  positive: 'var(--color-brand)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  neutral: 'var(--color-text-subtle)',
}

export interface ProgressSegment {
  value: number
  tone?: Tone
  /** Optional label for the legend. */
  label?: string
}

interface ProgressBarProps {
  /** Single-segment value. Ignored when `segments` is set. */
  value?: number
  /** Multi-segment values (stacked). When set, ignores `value`. */
  segments?: ReadonlyArray<ProgressSegment>
  /** Max for the scale. Default 100. */
  max?: number
  /** Tone or 'auto' (threshold-driven). Default 'auto'. */
  tone?: ToneOrAuto
  /** Top-line label. */
  label?: React.ReactNode
  /** Right-aligned trailing label (e.g. "42 / 100", "42%"). */
  trailing?: React.ReactNode
  /** Track height in px. Default 10. */
  height?: number
  /** Show a legend below segmented bars. Default true when segments has labels. */
  showLegend?: boolean
  className?: string
  ariaLabel?: string
}

function useEnteredViewport<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null)
  const [visible, setVisible] = React.useState(false)
  React.useEffect(() => {
    if (visible) return
    if (typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true)
      return
    }
    const node = ref.current
    if (!node) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
          break
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])
  return { ref, visible }
}

function autoTone(pct: number): Tone {
  if (pct >= 100) return 'danger'
  if (pct >= 75) return 'warning'
  return 'positive'
}

export function ProgressBar({
  value = 0,
  segments,
  max = 100,
  tone = 'auto',
  label,
  trailing,
  height = 10,
  showLegend,
  className,
  ariaLabel,
}: ProgressBarProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()

  const total = segments
    ? segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
    : Math.max(0, value)
  const pct = max > 0 ? (total / max) * 100 : 0
  const resolvedTone: Tone = tone === 'auto' ? autoTone(pct) : tone
  const legendVisible = showLegend ?? (!!segments && segments.some(s => !!s.label))

  return (
    <div
      ref={ref}
      className={className}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4375rem',
      }}
      role="progressbar"
      aria-valuenow={Math.round(total)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
    >
      {(label || trailing) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontWeight: 500,
          }}
        >
          <span>{label}</span>
          {trailing && (
            <span style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
              {trailing}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height,
          borderRadius: 999,
          background: 'var(--color-bg-tertiary)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {segments
          ? segments.map((seg, i) => {
              const segPct = max > 0 ? (Math.max(0, seg.value) / max) * 100 : 0
              const renderPct = visible ? segPct : 0
              return (
                <span
                  key={i}
                  aria-hidden="true"
                  style={{
                    width: `${renderPct}%`,
                    background: TONE_COLOUR[seg.tone ?? 'positive'],
                    transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
              )
            })
          : (
            <span
              aria-hidden="true"
              style={{
                width: `${visible ? Math.min(100, pct) : 0}%`,
                background: TONE_COLOUR[resolvedTone],
                transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          )}
      </div>
      {legendVisible && segments && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.375rem 0.875rem',
            fontSize: '0.6875rem',
            color: 'var(--color-text-muted)',
          }}
        >
          {segments.map((seg, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  background: TONE_COLOUR[seg.tone ?? 'positive'],
                }}
              />
              {seg.label}
              <span style={{ color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                {seg.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
