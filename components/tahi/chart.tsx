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
  labelColumnWidth = '11rem',
  rowHeight = 30,
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
        {/* Header scale */}
        {showMonths && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              alignItems: 'end',
              paddingBottom: '0.375rem',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: '0.375rem',
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
