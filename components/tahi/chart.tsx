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
  const radius: [number, number, number, number] = variant === 'pill'
    ? [999, 999, 999, 999]
    : [4, 4, 0, 0]
  const stripePatternId = React.useId()
  const maxValue = Math.max(...data.map(d => d.value))
  const fallback = TONE_COLOUR[tone]

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
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
            isAnimationActive
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

  const Wrapper = area ? AreaChart : RechartsLineChart

  return (
    <div role="img" aria-label={ariaLabel} style={{ width: '100%', height }}>
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
              isAnimationActive
            />
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke={stroke}
              strokeWidth={2}
              dot={dots ? { fill: stroke, r: 3, strokeWidth: 0 } : false}
              activeDot={{ fill: stroke, r: 4, strokeWidth: 0 }}
              isAnimationActive
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
  const offset = circumference * (1 - clamped / 100)
  const stroke = TONE_COLOUR[tone]
  return (
    <div
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
