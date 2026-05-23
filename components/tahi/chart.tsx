'use client'

/**
 * Chart primitives. Token-driven Recharts wrappers so every chart in the
 * dashboard pulls from the same `CHART` palette + grid/axis colours and
 * shares spacing defaults.
 *
 *   <BarChart data={[{label: 'Jan', value: 12}, ...]} height={220} />
 *   <BarChart data={...} variant="pill" valueCallout />
 *   <LineChart data={[{label: 'Jan', value: 12}, ...]} />
 *   <Sparkline data={[1, 3, 2, 5, 4]} tone="positive" />
 *   <Gauge value={68} label="Capacity used" />
 *
 * Variants:
 *   BarChart variant
 *     standard   solid bars, square top
 *     pill       solid bars, rounded both ends, 70% bar width
 *     striped    diagonal-stripe fill, used for inactive / forecast periods
 *
 * All charts respect the prefers-reduced-motion media query (Recharts
 * disables animations automatically when set).
 */

import * as React from 'react'
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  LineChart as RechartsLineChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  Tooltip as RechartsTooltip,
} from 'recharts'
import { CHART } from '@/lib/chart-colors'

// ── Scroll-into-view trigger ──────────────────────────────────────────
//
// Charts shouldn't animate when they're below the fold; the user
// scrolls down and sees the bars already at full height. This hook
// returns { ref, visible } where `visible` flips to true the first
// time the element intersects the viewport. Once seen, it stays true.
// Respects prefers-reduced-motion: visible is set immediately.
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

type Tone = 'positive' | 'negative' | 'neutral'
const TONE_COLOUR: Record<Tone, string> = {
  positive: CHART.positive,
  negative: CHART.negative,
  neutral: CHART.neutral,
}

// ── Shared axis/grid props ────────────────────────────────────────────

const AXIS_PROPS = {
  stroke: CHART.axis,
  fontSize: 11,
  tickLine: false,
  axisLine: { stroke: CHART.grid },
}

const GRID_PROPS = {
  stroke: CHART.grid,
  strokeDasharray: '0',
  vertical: false,
}

// ── BarChart ──────────────────────────────────────────────────────────

export interface BarDatum {
  label: string
  value: number
  // Optional per-bar overrides
  tone?: Tone
  /** When true, renders this bar as a striped pattern (for inactive / projected periods). */
  striped?: boolean
}

interface BarChartProps {
  data: readonly BarDatum[]
  /** Chart height in pixels. Default 220. */
  height?: number
  /** Visual variant. Default "standard". */
  variant?: 'standard' | 'pill' | 'striped'
  /** Default tone for bars when not overridden. */
  tone?: Tone
  /** Show a callout above the highest bar with its value. */
  valueCallout?: boolean
  /** Override Y-axis tick format. */
  formatValue?: (v: number) => string
  /** Show Y-axis labels. Default true. */
  showYAxis?: boolean
  /** Show grid lines. Default true. */
  showGrid?: boolean
  ariaLabel?: string
}

export function BarChart({
  data,
  height = 220,
  variant = 'standard',
  tone = 'positive',
  valueCallout = false,
  formatValue,
  showYAxis = true,
  showGrid = true,
  ariaLabel,
}: BarChartProps) {
  // Pill rounds the TOP corners only; bars still sit flat on the axis
  // so the baseline reads as a baseline, not a floating capsule.
  const radius: [number, number, number, number] = variant === 'pill'
    ? [999, 999, 0, 0]
    : [4, 4, 0, 0]
  const stripePatternId = React.useId()
  const maxValue = Math.max(...data.map(d => d.value))
  const fallback = TONE_COLOUR[tone]
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()

  return (
    <div ref={ref} role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data as BarDatum[]}
          margin={{ top: valueCallout ? 28 : 8, right: 8, left: showYAxis ? 0 : 8, bottom: 0 }}
        >
          <defs>
            <pattern id={stripePatternId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
              <rect width={6} height={6} fill={CHART.grid} />
              <line x1={0} y1={0} x2={0} y2={6} stroke={fallback} strokeWidth={2} opacity={0.5} />
            </pattern>
          </defs>
          {showGrid && <CartesianGrid {...GRID_PROPS} />}
          <XAxis dataKey="label" {...AXIS_PROPS} />
          {showYAxis && (
            <YAxis
              {...AXIS_PROPS}
              tickFormatter={formatValue}
              width={48}
            />
          )}
          <RechartsTooltip
            cursor={{ fill: 'rgba(90, 130, 78, 0.06)' }}
            contentStyle={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              fontSize: '0.75rem',
              padding: '0.375rem 0.625rem',
            }}
            labelStyle={{ color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: 2 }}
            itemStyle={{ color: 'var(--color-text)' }}
            formatter={formatValue ? (v: number) => formatValue(v) : undefined}
          />
          <Bar
            dataKey="value"
            radius={radius}
            maxBarSize={variant === 'pill' ? 32 : 48}
            isAnimationActive={visible}
            animationBegin={0}
            animationDuration={650}
            animationEasing="ease-out"
            label={valueCallout ? (props) => {
              const { x, y, width, value, index } = props as {
                x: number; y: number; width: number; value: number; index: number
              }
              if (data[index]?.value !== maxValue) return <g />
              const callout = formatValue ? formatValue(value) : String(value)
              const cx = x + width / 2
              return (
                <g>
                  <text
                    x={cx}
                    y={y - 8}
                    fill={CHART.positive}
                    fontSize={11}
                    fontWeight={600}
                    textAnchor="middle"
                  >
                    {callout}
                  </text>
                </g>
              )
            } : undefined}
          >
            {data.map((d, i) => {
              const isStriped = d.striped ?? variant === 'striped'
              const fillTone = d.tone ?? tone
              const fill = isStriped ? `url(#${stripePatternId})` : TONE_COLOUR[fillTone]
              return <Cell key={i} fill={fill} />
            })}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── LineChart ─────────────────────────────────────────────────────────

export interface LineDatum {
  label: string
  value: number
}

interface LineChartProps {
  data: readonly LineDatum[]
  height?: number
  tone?: Tone
  /** Fill the area below the line. */
  area?: boolean
  /** Show dots on each point. Default false. */
  dots?: boolean
  formatValue?: (v: number) => string
  showYAxis?: boolean
  showGrid?: boolean
  ariaLabel?: string
}

export function LineChart({
  data,
  height = 220,
  tone = 'positive',
  area = false,
  dots = false,
  formatValue,
  showYAxis = true,
  showGrid = true,
  ariaLabel,
}: LineChartProps) {
  const stroke = TONE_COLOUR[tone]
  const fillId = React.useId()
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()

  const Wrapper = area ? AreaChart : RechartsLineChart

  return (
    <div ref={ref} role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Wrapper
          data={data as LineDatum[]}
          margin={{ top: 12, right: 8, left: showYAxis ? 0 : 8, bottom: 0 }}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showGrid && <CartesianGrid {...GRID_PROPS} />}
          <XAxis dataKey="label" {...AXIS_PROPS} />
          {showYAxis && <YAxis {...AXIS_PROPS} tickFormatter={formatValue} width={48} />}
          <RechartsTooltip
            cursor={{ stroke: CHART.grid }}
            contentStyle={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              fontSize: '0.75rem',
              padding: '0.375rem 0.625rem',
            }}
            labelStyle={{ color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: 2 }}
            itemStyle={{ color: 'var(--color-text)' }}
            formatter={formatValue ? (v: number) => formatValue(v) : undefined}
          />
          {area ? (
            <Area
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              dot={dots ? { fill: stroke, r: 3, strokeWidth: 0 } : false}
              activeDot={{ fill: stroke, r: 4, strokeWidth: 0 }}
              isAnimationActive={visible}
              animationDuration={800}
              animationEasing="ease-out"
            />
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              dot={dots ? { fill: stroke, r: 3, strokeWidth: 0 } : false}
              activeDot={{ fill: stroke, r: 4, strokeWidth: 0 }}
              isAnimationActive={visible}
              animationDuration={800}
              animationEasing="ease-out"
            />
          )}
        </Wrapper>
      </ResponsiveContainer>
    </div>
  )
}

// ── Sparkline ─────────────────────────────────────────────────────────

interface SparklineProps {
  data: readonly number[]
  width?: number
  height?: number
  tone?: Tone
  /** Add a faint fill below the line. Default true. */
  area?: boolean
  ariaLabel?: string
}

export function Sparkline({
  data,
  width = 100,
  height = 28,
  tone = 'positive',
  area = true,
  ariaLabel,
}: SparklineProps) {
  if (data.length === 0) return <span style={{ display: 'inline-block', width, height }} />
  const stroke = TONE_COLOUR[tone]
  const minVal = Math.min(...data)
  const maxVal = Math.max(...data)
  const range = maxVal - minVal || 1
  const step = data.length > 1 ? width / (data.length - 1) : width
  const points = data.map((v, i) => {
    const x = i * step
    const y = height - ((v - minVal) / range) * height
    return [x, y] as const
  })
  const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const areaD = `${pathD} L${(points[points.length - 1][0]).toFixed(2)},${height} L0,${height} Z`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={{ overflow: 'visible' }}
    >
      {area && <path d={areaD} fill={stroke} opacity={0.15} />}
      <path d={pathD} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Gauge / progress ring ─────────────────────────────────────────────

interface GaugeProps {
  /** 0-100 percent. */
  value: number
  /** Diameter in pixels. Default 160. */
  size?: number
  /** Stroke thickness as a fraction of the radius. Default 0.12. */
  thickness?: number
  /** Tone of the filled arc. Default positive. */
  tone?: Tone
  /** Optional headline label centred in the ring. */
  label?: string
  /** Optional sub-label below the label. */
  sub?: string
  /** Custom value renderer for the centre. Defaults to "<value>%". */
  formatCentre?: (v: number) => React.ReactNode
  ariaLabel?: string
}

export function Gauge({
  value,
  size = 160,
  thickness = 0.12,
  tone = 'positive',
  label,
  sub,
  formatCentre,
  ariaLabel,
}: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, value))
  const r = size / 2
  const strokeWidth = r * thickness * 2
  const inner = r - strokeWidth / 2
  const circumference = 2 * Math.PI * inner
  // Animate from full offset (empty ring) to the target offset when
  // the gauge scrolls into view. Before that, render an empty ring.
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  const offset = circumference * (visible ? 1 - clamped / 100 : 1)
  const stroke = TONE_COLOUR[tone]
  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? `${clamped}%`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={r}
          cy={r}
          r={inner}
          fill="none"
          stroke={CHART.grid}
          strokeWidth={strokeWidth}
        />
        {/* Fill */}
        <circle
          cx={r}
          cy={r}
          r={inner}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 480ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 8%',
        }}
      >
        <div
          style={{
            fontSize: Math.max(18, Math.round(size * 0.18)),
            fontWeight: 700,
            color: 'var(--color-text)',
            lineHeight: 1,
            letterSpacing: '-0.01em',
          }}
        >
          {formatCentre ? formatCentre(clamped) : `${Math.round(clamped)}%`}
        </div>
        {label && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--color-text-muted)',
              marginTop: '0.375rem',
            }}
          >
            {label}
          </div>
        )}
        {sub && (
          <div
            style={{
              fontSize: '0.6875rem',
              color: 'var(--color-text-subtle)',
              marginTop: '0.125rem',
            }}
          >
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Donut chart ───────────────────────────────────────────────────────
//
//   <DonutChart
//     segments={[
//       { label: 'Design', value: 32 },
//       { label: 'Development', value: 48 },
//       { label: 'Strategy', value: 20 },
//     ]}
//     centreLabel="Total"
//     centreValue="$94k"
//   />

export interface DonutSegment {
  label: string
  value: number
  /** Hex override. Defaults to CHART.categorical rotation. */
  colour?: string
}

interface DonutChartProps {
  segments: readonly DonutSegment[]
  /** Pixel size. Default 180. */
  size?: number
  /** Inner radius as a fraction of the outer radius. Default 0.62. */
  innerRadiusFrac?: number
  /** Centre big label. */
  centreLabel?: React.ReactNode
  centreValue?: React.ReactNode
  /** Show a legend below the chart. Default true. */
  legend?: boolean
  ariaLabel?: string
}

export function DonutChart({
  segments,
  size = 180,
  innerRadiusFrac = 0.62,
  centreLabel,
  centreValue,
  legend = true,
  ariaLabel,
}: DonutChartProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  const outer = size / 2
  const inner = outer * innerRadiusFrac
  // Compute arc paths. Animate from 0% sweep to 100% as visible flips.
  const [progress, setProgress] = React.useState(0)
  React.useEffect(() => {
    if (!visible) return
    const start = performance.now()
    const duration = 700
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      setProgress(1 - Math.pow(1 - t, 3))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [visible])

  let cursor = -Math.PI / 2 // start at 12 o'clock
  const arcs = segments.map((seg, i) => {
    const fraction = (seg.value / total) * progress
    const angle = fraction * Math.PI * 2
    const start = cursor
    const end = cursor + angle
    cursor = end
    const large = angle > Math.PI ? 1 : 0
    const x1 = outer + outer * Math.cos(start)
    const y1 = outer + outer * Math.sin(start)
    const x2 = outer + outer * Math.cos(end)
    const y2 = outer + outer * Math.sin(end)
    const ix1 = outer + inner * Math.cos(end)
    const iy1 = outer + inner * Math.sin(end)
    const ix2 = outer + inner * Math.cos(start)
    const iy2 = outer + inner * Math.sin(start)
    const d = angle <= 0
      ? ''
      : `M ${x1.toFixed(2)} ${y1.toFixed(2)}
         A ${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
         L ${ix1.toFixed(2)} ${iy1.toFixed(2)}
         A ${inner} ${inner} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}
         Z`
    return {
      d,
      colour: seg.colour ?? CHART.categorical[i % CHART.categorical.length],
      label: seg.label,
      value: seg.value,
    }
  })

  return (
    <div ref={ref} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
      <div
        role="img"
        aria-label={ariaLabel}
        style={{ position: 'relative', width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track. Sits behind segments so any animation gap reads as track. */}
          <circle cx={outer} cy={outer} r={outer} fill={CHART.grid} />
          <circle cx={outer} cy={outer} r={inner} fill="var(--color-bg)" />
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.colour} />
          ))}
        </svg>
        {(centreLabel || centreValue) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            {centreLabel && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                {centreLabel}
              </div>
            )}
            {centreValue && (
              <div
                style={{
                  fontSize: Math.max(18, Math.round(size * 0.16)),
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  letterSpacing: '-0.01em',
                  marginTop: '0.125rem',
                  lineHeight: 1,
                }}
              >
                {centreValue}
              </div>
            )}
          </div>
        )}
      </div>
      {legend && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem 1rem',
            justifyContent: 'center',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {arcs.map((a, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: a.colour, display: 'inline-block' }} />
              {a.label}
              <span style={{ color: 'var(--color-text-subtle)' }}>
                {Math.round((a.value / total) * 100)}%
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Gantt chart ───────────────────────────────────────────────────────
//
// Horizontal-bar timeline. One row per item. Today's date marked with a
// vertical guide. Optional milestones rendered as inline diamonds.
//
//   <GanttChart
//     rangeStart={new Date('2026-05-01')}
//     rangeEnd={new Date('2026-08-01')}
//     rows={[
//       { id: '1', label: 'Discovery', start, end, tone: 'positive' },
//       { id: '2', label: 'Design',    start, end, tone: 'neutral', milestones: [date] },
//     ]}
//     today={new Date()}
//   />

export interface GanttMilestone {
  /** ISO date or Date instance. */
  date: Date
  label?: string
}

export interface GanttRow {
  id: string
  label: string
  /** Inclusive start date. */
  start: Date
  /** Inclusive end date. */
  end: Date
  tone?: Tone
  /** Categorical colour index override (uses CHART.categorical). */
  colourIndex?: number
  milestones?: readonly GanttMilestone[]
  /** Optional subtitle / owner displayed under the label. */
  sub?: string
}

interface GanttChartProps {
  rows: readonly GanttRow[]
  rangeStart: Date
  rangeEnd: Date
  /** Today line. Hidden if outside the range or null. */
  today?: Date
  /** Pixel width reserved for the left-side label column. Default 10rem. */
  labelColumnWidth?: number | string
  /** Height per bar row. Default 28. */
  rowHeight?: number
  /** Show month tick labels. Default true. */
  showMonths?: boolean
  ariaLabel?: string
}

export function GanttChart({
  rows,
  rangeStart,
  rangeEnd,
  today,
  labelColumnWidth = '10rem',
  rowHeight = 28,
  showMonths = true,
  ariaLabel,
}: GanttChartProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  const startMs = rangeStart.getTime()
  const endMs = rangeEnd.getTime()
  const span = Math.max(1, endMs - startMs)
  const pct = (d: Date) => {
    const ms = Math.max(startMs, Math.min(endMs, d.getTime()))
    return ((ms - startMs) / span) * 100
  }

  // Month ticks for the top scale.
  const months: { label: string; left: number }[] = []
  if (showMonths) {
    const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
    while (cursor <= rangeEnd) {
      const left = pct(cursor)
      months.push({
        label: cursor.toLocaleString('en', { month: 'short' }),
        left,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  const todayPct = today && today >= rangeStart && today <= rangeEnd ? pct(today) : null

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? 'Gantt timeline'}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
        fontSize: 'var(--text-xs)',
      }}
    >
      {/* Header scale */}
      {showMonths && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${typeof labelColumnWidth === 'number' ? `${labelColumnWidth}px` : labelColumnWidth} 1fr`,
            alignItems: 'end',
            paddingBottom: '0.25rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            marginBottom: '0.25rem',
          }}
        >
          <div />
          <div style={{ position: 'relative', height: '1.25rem' }}>
            {months.map((m, i) => (
              <span
                key={i}
                style={{
                  position: 'absolute',
                  left: `${m.left}%`,
                  transform: 'translateX(-50%)',
                  color: 'var(--color-text-subtle)',
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Rows */}
      {rows.map((row, i) => {
        const left = pct(row.start)
        const right = pct(row.end)
        const targetWidth = Math.max(0.5, right - left)
        const barWidth = visible ? targetWidth : 0
        const colour = row.colourIndex != null
          ? CHART.categorical[row.colourIndex % CHART.categorical.length]
          : TONE_COLOUR[row.tone ?? 'positive']
        return (
          <div
            key={row.id}
            style={{
              display: 'grid',
              gridTemplateColumns: `${typeof labelColumnWidth === 'number' ? `${labelColumnWidth}px` : labelColumnWidth} 1fr`,
              alignItems: 'center',
              gap: '0.75rem',
              height: rowHeight,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </div>
              {row.sub && (
                <div
                  style={{
                    fontSize: '0.6875rem',
                    color: 'var(--color-text-subtle)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.sub}
                </div>
              )}
            </div>
            <div style={{ position: 'relative', height: rowHeight }}>
              {/* Track */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 0,
                  right: 0,
                  height: 1,
                  background: 'var(--color-border-subtle)',
                }}
              />
              {/* Today line */}
              {todayPct != null && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 2,
                    bottom: 2,
                    left: `${todayPct}%`,
                    width: 1,
                    background: 'var(--color-brand)',
                    opacity: 0.5,
                  }}
                />
              )}
              {/* Bar */}
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  left: `${left}%`,
                  width: `${barWidth}%`,
                  height: Math.max(10, rowHeight - 12),
                  background: colour,
                  borderRadius: 999,
                  transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 60}ms`,
                  boxShadow: '0 1px 2px rgba(15, 20, 16, 0.08)',
                }}
                title={`${row.label}: ${row.start.toLocaleDateString()} - ${row.end.toLocaleDateString()}`}
              />
              {/* Milestones */}
              {row.milestones?.map((m, mi) => {
                const mLeft = pct(m.date)
                return (
                  <div
                    key={mi}
                    title={m.label ?? m.date.toLocaleDateString()}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: `${mLeft}%`,
                      transform: 'translate(-50%, -50%) rotate(45deg)',
                      width: 8,
                      height: 8,
                      background: 'var(--color-bg)',
                      border: `2px solid ${colour}`,
                    }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
      {todayPct != null && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${typeof labelColumnWidth === 'number' ? `${labelColumnWidth}px` : labelColumnWidth} 1fr`,
            gap: '0.75rem',
            paddingTop: '0.25rem',
            borderTop: '1px solid var(--color-border-subtle)',
            marginTop: '0.25rem',
          }}
        >
          <div />
          <div style={{ position: 'relative', height: '1rem' }}>
            <span
              style={{
                position: 'absolute',
                left: `${todayPct}%`,
                transform: 'translateX(-50%)',
                fontSize: '0.625rem',
                fontWeight: 600,
                color: 'var(--color-brand)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Today
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
