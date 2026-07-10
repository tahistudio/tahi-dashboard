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
import { createPortal } from 'react-dom'
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
  /**
   * Entrance animation. Default true (bars grow in on viewport entry).
   * Pass false for charts whose data arrives asynchronously after mount:
   * the grow-from-zero animation can stall at height 0 when the data (and
   * thus the chart) mounts after the viewport-visibility has already fired.
   */
  animate?: boolean
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
  animate = true,
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
            isAnimationActive={animate && visible}
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
// Horizontal-bar timeline. One row per item. Today's date marked with
// a vertical guide. Inline milestones rendered as diamonds. Optional
// gate rows render as a single sign-off / critical-gate diamond
// instead of a bar.
//
// Lifts the schedules palette: tahi / client / joint / tahi_parallel
// owners get fixed brand-locked colours. Risk-of-delay rows get a
// red diagonal hatching overlay. Legend matches the schedule editor.
//
//   <GanttChart
//     rangeStart={new Date('2026-05-01')}
//     rangeEnd={new Date('2026-08-01')}
//     today={new Date('2026-06-12')}
//     showLegend
//     rows={[
//       { id: '1', label: 'Discovery', start, end, owner: 'tahi' },
//       { id: '2', label: 'Sitemap sign-off', rowType: 'gate', gateDate: ... },
//       { id: '3', label: 'Design',  start, end, owner: 'joint', riskFlag: true },
//     ]}
//   />

export type GanttOwner = 'tahi' | 'client' | 'joint' | 'tahi_parallel'
export type GanttRowType = 'task' | 'gate' | 'critical_gate' | 'section_header'

const OWNER_COLOUR: Record<GanttOwner, string> = {
  tahi: '#5A824E',          // brand green
  client: '#1f2c1a',         // dark forest (client work)
  joint: '#d4a017',          // amber
  tahi_parallel: '#a8c89e',  // light brand
}

const OWNER_LABEL: Record<GanttOwner, string> = {
  tahi: 'Tahi',
  client: 'Client',
  joint: 'Joint',
  tahi_parallel: 'Tahi parallel',
}

const RISK_OVERLAY =
  'repeating-linear-gradient(45deg, rgba(248, 113, 113, 0.85) 0 4px, rgba(248, 113, 113, 0) 4px 8px)'

export interface GanttMilestone {
  /** ISO date or Date instance. */
  date: Date
  label?: string
}

export interface GanttRow {
  id: string
  label: string
  /** Inclusive start date. Not used for gates or section headers. */
  start?: Date
  /** Inclusive end date. Not used for gates or section headers. */
  end?: Date
  /** Owner. Drives the bar's colour. */
  owner?: GanttOwner
  /** Row type. Default 'task'. */
  rowType?: GanttRowType
  /** Single gate date (used when rowType is 'gate' or 'critical_gate'). */
  gateDate?: Date
  /** Apply the red diagonal hatching overlay to indicate at-risk work. */
  riskFlag?: boolean
  /** Categorical colour index override (uses CHART.categorical).
   *  Ignored if owner is set. */
  colourIndex?: number
  /** Semantic tone fallback when neither owner nor colourIndex is set. */
  tone?: Tone
  /** Inline milestones drawn on the bar. */
  milestones?: readonly GanttMilestone[]
  /** Optional subtitle / owner displayed under the label. */
  sub?: string
  /** Optional extra info shown inside the hover tooltip (after the
   *  built-in label + date line). */
  tooltipExtra?: React.ReactNode
}

interface GanttChartProps {
  rows: readonly GanttRow[]
  rangeStart: Date
  rangeEnd: Date
  /** Today line. Hidden if outside the range or null. */
  today?: Date
  /** Pixel width reserved for the left-side label column. Default 10rem. */
  labelColumnWidth?: number | string
  /** Height per bar row. Default 30. */
  rowHeight?: number
  /** Show month tick labels. Default true. */
  showMonths?: boolean
  /** Render the legend below the chart. Default false. */
  showLegend?: boolean
  ariaLabel?: string
}

export function GanttChart({
  rows,
  rangeStart,
  rangeEnd,
  today,
  labelColumnWidth = '14rem',
  rowHeight = 36,
  showMonths = true,
  showLegend = false,
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
        label: cursor.toLocaleString('en', { month: 'short', year: '2-digit' }),
        left,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  // Fine vertical week ticks so the eye can count days inside a
  // month band. Skip if the range is so long that ticks would crowd.
  const weekTicks: number[] = []
  if (showMonths) {
    // Find the first Monday on or after rangeStart.
    const tickCursor = new Date(rangeStart)
    const offsetToMonday = (8 - tickCursor.getDay()) % 7
    tickCursor.setDate(tickCursor.getDate() + offsetToMonday)
    while (tickCursor <= rangeEnd) {
      weekTicks.push(pct(tickCursor))
      tickCursor.setDate(tickCursor.getDate() + 7)
    }
    // Bail if the chart would have more than 1 tick per ~12px.
    if (weekTicks.length > 60) weekTicks.length = 0
  }

  const todayPct = today && today >= rangeStart && today <= rangeEnd ? pct(today) : null

  const gridTemplate = `${typeof labelColumnWidth === 'number' ? `${labelColumnWidth}px` : labelColumnWidth} 1fr`

  return (
    <div
      ref={ref}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div
        role="img"
        aria-label={ariaLabel ?? 'Gantt timeline'}
        style={{ width: '100%', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header scale: month labels + faint week ticks below them. */}
        {showMonths && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              alignItems: 'end',
              paddingBottom: '0.5rem',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: '0.5rem',
            }}
          >
            <div />
            <div style={{ position: 'relative', height: '1.75rem' }}>
              {months.map((m, i) => (
                <span
                  key={`m-${i}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: `${m.left}%`,
                    transform: 'translateX(-50%)',
                    color: 'var(--color-text-subtle)',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </span>
              ))}
              {weekTicks.map((left, i) => (
                <span
                  key={`w-${i}`}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: `${left}%`,
                    width: 1,
                    height: '0.5rem',
                    background: 'var(--color-border-subtle)',
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {/* Rows. Wrap in a relative container so we can paint week
            tick guides spanning all rows behind them. */}
        <div style={{ position: 'relative' }}>
          {/* Week tick guides. Painted in the timeline area (after the
              label column) at low opacity so they hint at week
              boundaries without competing with the bars. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: typeof labelColumnWidth === 'number' ? `calc(${labelColumnWidth}px + 0.75rem)` : `calc(${labelColumnWidth} + 0.75rem)`,
              right: 0,
              pointerEvents: 'none',
            }}
          >
            {weekTicks.map((left, i) => (
              <span
                key={`wg-${i}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${left}%`,
                  width: 1,
                  background: 'var(--color-border-subtle)',
                  opacity: 0.35,
                }}
              />
            ))}
          </div>
          {rows.map((row, i) => (
            <GanttRowItem
              key={row.id}
              row={row}
              index={i}
              visible={visible}
              pct={pct}
              todayPct={todayPct}
              rowHeight={rowHeight}
              gridTemplate={gridTemplate}
            />
          ))}
        </div>
      </div>
      {showLegend && <GanttLegendInline />}
    </div>
  )
}

// ── Gantt row item ────────────────────────────────────────────────────

function GanttRowItem({
  row,
  index,
  visible,
  pct,
  todayPct,
  rowHeight,
  gridTemplate,
}: {
  row: GanttRow
  index: number
  visible: boolean
  pct: (d: Date) => number
  todayPct: number | null
  rowHeight: number
  gridTemplate: string
}) {
  const rowType: GanttRowType = row.rowType ?? 'task'

  // Section header: a band that spans the whole timeline.
  if (rowType === 'section_header') {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          alignItems: 'center',
          gap: '0.75rem',
          height: rowHeight,
          background: 'var(--color-bg-secondary)',
          marginTop: '0.25rem',
          marginBottom: '0.125rem',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <div style={{
          padding: '0 0.75rem',
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}>
          {row.label}
        </div>
        <div />
      </div>
    )
  }

  // Gate row: a single diamond at gateDate.
  if (rowType === 'gate' || rowType === 'critical_gate') {
    const date = row.gateDate ?? row.start
    if (!date) return null
    const isCritical = rowType === 'critical_gate'
    const left = pct(date)
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          alignItems: 'center',
          gap: '0.75rem',
          height: rowHeight,
        }}
      >
        <GanttRowLabel label={row.label} sub={row.sub} />
        <div style={{ position: 'relative', height: rowHeight }}>
          <GanttTrack />
          {todayPct != null && <GanttTodayLine left={todayPct} />}
          <GanttHoverNode
            tooltip={
              <GanttTooltipBody row={row} dateLabel={date.toLocaleDateString()} />
            }
            style={{
              position: 'absolute',
              top: '50%',
              left: `${left}%`,
              transform: 'translate(-50%, -50%) rotate(45deg)',
              width: 14,
              height: 14,
              background: isCritical ? '#dc2626' : 'var(--color-bg)',
              border: `2px solid ${isCritical ? '#dc2626' : '#5A824E'}`,
              boxShadow: '0 1px 2px rgba(15, 20, 16, 0.10)',
            }}
          />
        </div>
      </div>
    )
  }

  // Standard task row.
  if (!row.start || !row.end) return null
  const left = pct(row.start)
  const right = pct(row.end)
  const targetWidth = Math.max(0.5, right - left)
  const barWidth = visible ? targetWidth : 0

  const colour = row.owner
    ? OWNER_COLOUR[row.owner]
    : row.colourIndex != null
      ? CHART.categorical[row.colourIndex % CHART.categorical.length]
      : TONE_COLOUR[row.tone ?? 'positive']

  const durationMs = row.end.getTime() - row.start.getTime()
  const durationDays = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)))

  const subInfo = row.owner
    ? `${row.sub ? `${row.sub} · ` : ''}${OWNER_LABEL[row.owner]}`
    : row.sub

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridTemplate,
        alignItems: 'center',
        gap: '0.75rem',
        height: rowHeight,
      }}
    >
      <GanttRowLabel label={row.label} sub={subInfo} />
      <div style={{ position: 'relative', height: rowHeight }}>
        <GanttTrack />
        {todayPct != null && <GanttTodayLine left={todayPct} />}
        <GanttHoverNode
          tooltip={
            <GanttTooltipBody
              row={row}
              dateLabel={`${row.start.toLocaleDateString()} - ${row.end.toLocaleDateString()}`}
              durationDays={durationDays}
            />
          }
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            left: `${left}%`,
            width: `${barWidth}%`,
            height: Math.max(12, rowHeight - 14),
            background: colour,
            backgroundImage: row.riskFlag ? RISK_OVERLAY : undefined,
            borderRadius: 999,
            transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
            transitionDelay: `${index * 60}ms`,
            boxShadow: '0 1px 2px rgba(15, 20, 16, 0.10)',
          }}
        />
        {row.milestones?.map((m, mi) => {
          const mLeft = pct(m.date)
          return (
            <GanttHoverNode
              key={mi}
              tooltip={
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                  <strong style={{ fontWeight: 600 }}>{m.label ?? 'Milestone'}</strong>
                  <span style={{ opacity: 0.8 }}>{m.date.toLocaleDateString()}</span>
                </div>
              }
              style={{
                position: 'absolute',
                top: '50%',
                left: `${mLeft}%`,
                transform: 'translate(-50%, -50%) rotate(45deg)',
                width: 9,
                height: 9,
                background: 'var(--color-bg)',
                border: `2px solid ${colour}`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function GanttRowLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0, padding: '0 0.25rem 0 0.5rem' }}>
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
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontSize: '0.6875rem',
            color: 'var(--color-text-subtle)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function GanttTrack() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: 1,
        background: 'var(--color-border-subtle)',
      }}
    />
  )
}

function GanttTodayLine({ left }: { left: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 2,
        bottom: 2,
        left: `${left}%`,
        width: 1,
        background: 'var(--color-brand)',
        opacity: 0.55,
      }}
    />
  )
}

// Hover node: child of a Tooltip-positioned floating layer. We use a
// portal'd tooltip via simple state so we can render rich content
// (the design-system Tooltip only takes a single child wrapper, but
// here we want the tooltip body to be a structured node).
function GanttHoverNode({
  style,
  tooltip,
}: {
  style: React.CSSProperties
  tooltip: React.ReactNode
}) {
  const [hovered, setHovered] = React.useState(false)
  const [pos, setPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const ref = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!hovered || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: rect.top })
  }, [hovered])

  return (
    <>
      <div
        ref={ref}
        style={style}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        tabIndex={0}
      />
      {hovered && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos.y - 10,
            left: pos.x,
            transform: 'translate(-50%, -100%)',
            background: '#1E2A1B',
            color: '#F0F2EF',
            padding: '0.5rem 0.625rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
            pointerEvents: 'none',
            zIndex: 100,
            maxWidth: '14rem',
            whiteSpace: 'normal',
          }}
        >
          {tooltip}
        </div>,
        document.body,
      )}
    </>
  )
}

function GanttTooltipBody({
  row,
  dateLabel,
  durationDays,
}: {
  row: GanttRow
  dateLabel: string
  durationDays?: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1875rem' }}>
      <strong style={{ fontWeight: 600 }}>{row.label}</strong>
      <span style={{ opacity: 0.85 }}>{dateLabel}</span>
      {durationDays != null && (
        <span style={{ opacity: 0.7 }}>
          {durationDays} day{durationDays === 1 ? '' : 's'}
        </span>
      )}
      {row.owner && (
        <span style={{ opacity: 0.7 }}>Owner: {OWNER_LABEL[row.owner]}</span>
      )}
      {row.riskFlag && (
        <span style={{ color: '#F4A0A0', fontWeight: 500 }}>At risk</span>
      )}
      {row.tooltipExtra && <span style={{ opacity: 0.7 }}>{row.tooltipExtra}</span>}
    </div>
  )
}

// ── Inline Gantt legend ───────────────────────────────────────────────

function GanttLegendInline() {
  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: '0.875rem',
        rowGap: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.6875rem',
        color: 'var(--color-text-muted)',
        fontWeight: 500,
      }}
    >
      <LegendItem swatch={<LegendBar colour={OWNER_COLOUR.tahi} />} label="Tahi" />
      <LegendItem swatch={<LegendBar colour={OWNER_COLOUR.client} />} label="Client" />
      <LegendItem swatch={<LegendBar colour={OWNER_COLOUR.joint} />} label="Joint" />
      <LegendItem swatch={<LegendBar colour={OWNER_COLOUR.tahi_parallel} />} label="Tahi parallel" />
      <LegendDivider />
      <LegendItem swatch={<LegendDiamond />} label="Sign-off gate" />
      <LegendItem swatch={<LegendDiamond critical />} label="Critical gate" />
      <LegendDivider />
      <LegendItem
        swatch={<LegendBar colour={OWNER_COLOUR.tahi} overlay={RISK_OVERLAY} />}
        label="At risk"
      />
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.4375rem' }}>
      {swatch}
      <span>{label}</span>
    </span>
  )
}

function LegendBar({ colour, overlay }: { colour: string; overlay?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '1.125rem',
        height: '0.625rem',
        background: colour,
        backgroundImage: overlay,
        borderRadius: '0.125rem',
      }}
    />
  )
}

function LegendDiamond({ critical }: { critical?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '0.75rem',
        height: '0.75rem',
        transform: 'rotate(45deg)',
        background: critical ? '#dc2626' : 'var(--color-bg)',
        border: critical ? '1.75px solid #dc2626' : '1.75px solid #5A824E',
      }}
    />
  )
}

function LegendDivider() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '1px',
        height: '0.875rem',
        background: 'var(--color-text-subtle)',
        opacity: 0.4,
      }}
    />
  )
}

// ── FunnelChart ───────────────────────────────────────────────────────
//
// Vertical pipeline-style funnel. Each stage's width is proportional
// to its value; visible label + value + percent-of-top per stage.
// Animates on scroll into view.
//
//   <FunnelChart
//     stages={[
//       { label: 'Leads',        value: 320 },
//       { label: 'Qualified',    value: 184 },
//       { label: 'Proposal',     value:  96 },
//       { label: 'Closed won',   value:  31 },
//     ]}
//   />

export interface FunnelStage {
  label: string
  value: number
  colour?: string
}

interface FunnelChartProps {
  stages: readonly FunnelStage[]
  /** Height of each stage row. Default 56. */
  stageHeight?: number
  /** Show percent-of-top per stage. Default true. */
  showPercent?: boolean
  formatValue?: (v: number) => string
  ariaLabel?: string
}

export function FunnelChart({
  stages,
  stageHeight = 56,
  showPercent = true,
  formatValue,
  ariaLabel,
}: FunnelChartProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  const top = stages.length > 0 ? stages[0].value : 0
  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? 'Funnel chart'}
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}
    >
      {stages.map((stage, i) => {
        const fraction = top > 0 ? stage.value / top : 0
        const targetPct = Math.max(8, fraction * 100)
        const renderPct = visible ? targetPct : 0
        const colour = stage.colour
          ?? CHART.categorical[i % CHART.categorical.length]
        const valueLabel = formatValue ? formatValue(stage.value) : stage.value.toLocaleString()
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', height: stageHeight }}
          >
            <div style={{ width: '8rem', flexShrink: 0 }}>
              <div style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {stage.label}
              </div>
              {showPercent && (
                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                  {Math.round(fraction * 100)}% of top
                </div>
              )}
            </div>
            <div style={{ flex: 1, position: 'relative', height: stageHeight }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: `${renderPct}%`,
                  height: stageHeight,
                  background: colour,
                  borderRadius: 'var(--radius-md)',
                  transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDelay: `${i * 80}ms`,
                  boxShadow: '0 1px 2px rgba(15, 20, 16, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  letterSpacing: '-0.01em',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
                aria-label={`${stage.label}: ${valueLabel}`}
              >
                {valueLabel}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── MultiBarChart ─────────────────────────────────────────────────────
//
// Grouped or stacked multi-series bar chart. Each series gets a
// colour from CHART.categorical (or an explicit override). Animates
// on scroll into view.
//
//   <MultiBarChart
//     data={[
//       { label: 'Jan', Revenue: 42, Costs: 18 },
//       { label: 'Feb', Revenue: 48, Costs: 22 },
//     ]}
//     series={[
//       { key: 'Revenue', label: 'Revenue', tone: 'positive' },
//       { key: 'Costs',   label: 'Costs',   tone: 'negative' },
//     ]}
//     stacked
//   />

export interface MultiBarSeries {
  key: string
  label: string
  tone?: Tone
  colour?: string
}

interface MultiBarChartProps {
  data: ReadonlyArray<Record<string, string | number>>
  /** dataKey on each row for the X-axis label. Default 'label'. */
  categoryKey?: string
  series: readonly MultiBarSeries[]
  /** Stack the series instead of grouping side-by-side. Default false. */
  stacked?: boolean
  height?: number
  /** Round top corners for the top-most stack / each bar. Default true. */
  roundTop?: boolean
  formatValue?: (v: number) => string
  showYAxis?: boolean
  showGrid?: boolean
  showLegend?: boolean
  ariaLabel?: string
}

export function MultiBarChart({
  data,
  categoryKey = 'label',
  series,
  stacked = false,
  height = 240,
  roundTop = true,
  formatValue,
  showYAxis = true,
  showGrid = true,
  showLegend = true,
  ariaLabel,
}: MultiBarChartProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  // Compute colour per series.
  const colourFor = (s: MultiBarSeries, i: number) =>
    s.colour
      ?? (s.tone ? TONE_COLOUR[s.tone] : CHART.categorical[i % CHART.categorical.length])

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart
            data={data as Array<Record<string, string | number>>}
            margin={{ top: 8, right: 8, left: showYAxis ? 0 : 8, bottom: 0 }}
          >
            {showGrid && <CartesianGrid {...GRID_PROPS} />}
            <XAxis dataKey={categoryKey} {...AXIS_PROPS} />
            {showYAxis && <YAxis {...AXIS_PROPS} tickFormatter={formatValue} width={48} />}
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
            {series.map((s, i) => {
              const isTop = i === series.length - 1
              const radius: [number, number, number, number] = roundTop && (!stacked || isTop)
                ? [4, 4, 0, 0]
                : [0, 0, 0, 0]
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={colourFor(s, i)}
                  stackId={stacked ? 'stack' : undefined}
                  radius={radius}
                  maxBarSize={48}
                  isAnimationActive={visible}
                  animationDuration={650}
                  animationEasing="ease-out"
                />
              )
            })}
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
      {showLegend && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem 1rem',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {series.map((s, i) => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: colourFor(s, i) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Heatmap ───────────────────────────────────────────────────────────
//
// Grid of cells coloured by value intensity. GitHub-contributions
// style; useful for per-day activity, hour-of-day patterns, etc.
// Hover tooltip per cell (portal'd).
//
//   <Heatmap
//     rows={[
//       { label: 'Mon', cells: [{ key: '00', value: 0 }, ...] },
//       { label: 'Tue', cells: [...] },
//     ]}
//     columns={['00', '01', ..., '23']}
//   />

export interface HeatmapCell {
  /** Column key. */
  key: string
  /** 0+ value. Higher = stronger colour. */
  value: number
  /** Optional secondary text for the tooltip. */
  meta?: string
}

export interface HeatmapRow {
  label: string
  cells: ReadonlyArray<HeatmapCell>
}

interface HeatmapProps {
  rows: ReadonlyArray<HeatmapRow>
  /** Column labels (one per cell index). */
  columns: ReadonlyArray<string>
  /** Tone for the colour ramp. Default 'positive' (brand green). */
  tone?: Tone
  /** Optional explicit max for the colour scale. Otherwise auto. */
  max?: number
  /** Fill the container width. Cells become 1fr columns + square via
   *  aspect-ratio. Overrides cellSize. Default true. */
  fluid?: boolean
  /** Cell size in px when not fluid. Default 18. */
  cellSize?: number
  /** Show row labels on the left. Default true. */
  showRowLabels?: boolean
  /** Show column labels along the top. Default true. */
  showColumnLabels?: boolean
  /** Optional value formatter for the tooltip. */
  formatValue?: (v: number) => string
  ariaLabel?: string
}

export function Heatmap({
  rows,
  columns,
  tone = 'positive',
  max,
  fluid = true,
  cellSize = 18,
  showRowLabels = true,
  showColumnLabels = true,
  formatValue,
  ariaLabel,
}: HeatmapProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()
  const effectiveMax = max ?? Math.max(
    1,
    ...rows.flatMap(r => r.cells.map(c => c.value)),
  )
  const base = TONE_COLOUR[tone]
  // Hover tooltip state
  const [hover, setHover] = React.useState<
    null | { x: number; y: number; row: string; col: string; value: number; meta?: string }
  >(null)

  // Colour ramp: 0 → bg-tertiary, 1 → full tone. Linear interpolation.
  const colourFor = (value: number) => {
    if (value <= 0) return 'var(--color-bg-tertiary)'
    const t = Math.min(1, value / effectiveMax)
    // Render as rgba over a tinted base. Easiest: tone hex + alpha t.
    const alpha = 0.12 + t * 0.78
    return `${base}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
  }

  const colTemplate = fluid
    ? `${showRowLabels ? '3rem' : ''} ${'1fr '.repeat(columns.length).trim()}`
    : `${showRowLabels ? '3rem' : '0'} repeat(${columns.length}, ${cellSize}px)`

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? 'Heatmap'}
      style={{
        display: fluid ? 'flex' : 'inline-flex',
        flexDirection: 'column',
        gap: '0.375rem',
        width: fluid ? '100%' : undefined,
      }}
    >
      {showColumnLabels && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: colTemplate,
            gap: 2,
            fontSize: '0.625rem',
            color: 'var(--color-text-subtle)',
          }}
        >
          {showRowLabels && <span />}
          {columns.map((c) => (
            <span
              key={c}
              style={{
                textAlign: 'center',
                fontWeight: 500,
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: 'grid',
            gridTemplateColumns: colTemplate,
            gap: 2,
            alignItems: 'center',
          }}
        >
          {showRowLabels && (
            <span style={{
              fontSize: '0.6875rem',
              color: 'var(--color-text-muted)',
              fontWeight: 500,
              textAlign: 'right',
              paddingRight: '0.5rem',
            }}>
              {row.label}
            </span>
          )}
          {columns.map((col) => {
            const cell = row.cells.find(c => c.key === col)
            const value = visible ? (cell?.value ?? 0) : 0
            return (
              <div
                key={col}
                role="gridcell"
                tabIndex={0}
                aria-label={`${row.label} ${col}: ${cell?.value ?? 0}`}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setHover({
                    x: r.left + r.width / 2,
                    y: r.top,
                    row: row.label,
                    col,
                    value: cell?.value ?? 0,
                    meta: cell?.meta,
                  })
                }}
                onMouseLeave={() => setHover(null)}
                style={{
                  width: fluid ? '100%' : cellSize,
                  height: fluid ? undefined : cellSize,
                  aspectRatio: fluid ? '1 / 1' : undefined,
                  borderRadius: fluid ? 'var(--radius-sm)' : 3,
                  background: colourFor(value),
                  transition: 'background 320ms ease',
                  cursor: cell ? 'default' : undefined,
                }}
              />
            )
          })}
        </div>
      ))}
      {hover && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: hover.y - 10,
            left: hover.x,
            transform: 'translate(-50%, -100%)',
            background: '#1E2A1B',
            color: '#F0F2EF',
            padding: '0.4375rem 0.5625rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
            pointerEvents: 'none',
            zIndex: 100,
            whiteSpace: 'nowrap',
          }}
        >
          <strong style={{ fontWeight: 600 }}>{hover.row} · {hover.col}</strong>
          <div style={{ opacity: 0.85, marginTop: '0.125rem' }}>
            {formatValue ? formatValue(hover.value) : hover.value}
          </div>
          {hover.meta && <div style={{ opacity: 0.7, marginTop: '0.125rem' }}>{hover.meta}</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}

// ── CalendarHeatmap ───────────────────────────────────────────────────
//
// GitHub-contributions-style calendar. 7 rows (days of week) × N
// columns (weeks). Month labels along the top. One value per ISO
// date string. Cells scale to fluid widths so the chart fills its
// container.
//
//   <CalendarHeatmap
//     rangeStart={new Date('2026-01-01')}
//     rangeEnd={new Date('2026-12-31')}
//     values={{ '2026-03-14': 4, '2026-03-15': 2, ... }}
//     tone="positive"
//   />

interface CalendarHeatmapProps {
  rangeStart: Date
  rangeEnd: Date
  /** Map of ISO date (YYYY-MM-DD) -> value. Missing dates render as 0. */
  values: Record<string, number>
  /** Tone for the colour ramp. Default 'positive'. */
  tone?: Tone
  /** Explicit max for the colour scale. Otherwise auto. */
  max?: number
  /** Optional value formatter for the tooltip. */
  formatValue?: (v: number) => string
  ariaLabel?: string
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function CalendarHeatmap({
  rangeStart,
  rangeEnd,
  values,
  tone = 'positive',
  max,
  formatValue,
  ariaLabel,
}: CalendarHeatmapProps) {
  const { ref, visible } = useEnteredViewport<HTMLDivElement>()

  // Build the week columns. Each column has 7 day slots (Sun-Sat).
  // Start from the Sunday on or before rangeStart so the first column
  // is a complete week.
  const start = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate())
  start.setDate(start.getDate() - start.getDay())
  const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate())

  type Cell = { date: Date; value: number; inRange: boolean }
  const weeks: Cell[][] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const week: Cell[] = []
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(cursor)
      const inRange = day >= rangeStart && day <= rangeEnd
      const value = inRange ? (values[toIsoDate(day)] ?? 0) : 0
      week.push({ date: day, value, inRange })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  // Month labels along the top. Position each label above the first
  // week that starts in that month.
  const monthMarkers: { weekIndex: number; label: string }[] = []
  for (let i = 0; i < weeks.length; i += 1) {
    const firstDayOfWeek = weeks[i][0].date
    if (firstDayOfWeek.getDate() <= 7) {
      monthMarkers.push({
        weekIndex: i,
        label: firstDayOfWeek.toLocaleString('en', { month: 'short' }),
      })
    }
  }

  const allValues = Object.values(values)
  const effectiveMax = max ?? Math.max(1, ...allValues, 0)
  const base = TONE_COLOUR[tone]
  const colourFor = (value: number, inRange: boolean) => {
    if (!inRange) return 'transparent'
    if (value <= 0) return 'var(--color-bg-tertiary)'
    const t = Math.min(1, value / effectiveMax)
    const alpha = 0.16 + t * 0.74
    return `${base}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
  }

  const [hover, setHover] = React.useState<
    null | { x: number; y: number; date: Date; value: number }
  >(null)

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? 'Calendar heatmap'}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', width: '100%' }}
    >
      {/* Month labels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `2rem repeat(${weeks.length}, 1fr)`,
          gap: 2,
          fontSize: '0.6875rem',
          color: 'var(--color-text-subtle)',
          fontWeight: 500,
        }}
      >
        <span />
        {weeks.map((_, wi) => {
          const marker = monthMarkers.find(m => m.weekIndex === wi)
          return (
            <span key={wi} style={{ textAlign: 'left' }}>{marker?.label ?? ''}</span>
          )
        })}
      </div>

      {/* Day rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {Array.from({ length: 7 }).map((_, dayIndex) => (
          <div
            key={dayIndex}
            style={{
              display: 'grid',
              gridTemplateColumns: `2rem repeat(${weeks.length}, 1fr)`,
              gap: 2,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: '0.625rem',
                color: 'var(--color-text-subtle)',
                textAlign: 'right',
                paddingRight: '0.5rem',
                fontWeight: 500,
              }}
            >
              {dayLabels[dayIndex]}
            </span>
            {weeks.map((week, wi) => {
              const cell = week[dayIndex]
              const value = visible ? cell.value : 0
              return (
                <div
                  key={wi}
                  role="gridcell"
                  tabIndex={cell.inRange ? 0 : -1}
                  aria-label={cell.inRange ? `${toIsoDate(cell.date)}: ${cell.value}` : 'Out of range'}
                  onMouseEnter={(e) => {
                    if (!cell.inRange) return
                    const r = e.currentTarget.getBoundingClientRect()
                    setHover({
                      x: r.left + r.width / 2,
                      y: r.top,
                      date: cell.date,
                      value: cell.value,
                    })
                  }}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 'var(--radius-sm)',
                    background: colourFor(value, cell.inRange),
                    transition: 'background 320ms ease',
                    border: cell.inRange ? '1px solid var(--color-border-subtle)' : 'none',
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend ramp */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          fontSize: '0.625rem',
          color: 'var(--color-text-subtle)',
          alignSelf: 'flex-end',
          marginTop: '0.25rem',
        }}
      >
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: 11,
              height: 11,
              borderRadius: 3,
              background: t === 0
                ? 'var(--color-bg-tertiary)'
                : `${base}${Math.round((0.16 + t * 0.74) * 255).toString(16).padStart(2, '0')}`,
            }}
          />
        ))}
        <span>More</span>
      </div>

      {hover && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            top: hover.y - 10,
            left: hover.x,
            transform: 'translate(-50%, -100%)',
            background: '#1E2A1B',
            color: '#F0F2EF',
            padding: '0.4375rem 0.5625rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
            pointerEvents: 'none',
            zIndex: 100,
            whiteSpace: 'nowrap',
          }}
        >
          <strong style={{ fontWeight: 600 }}>
            {hover.date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}
          </strong>
          <div style={{ opacity: 0.85, marginTop: '0.125rem' }}>
            {formatValue ? formatValue(hover.value) : hover.value}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
