'use client'

// ─── Cash-Flow Forecast Ribbon ────────────────────────────────────────────────
//
// A BOOKS-zone MONEY card for "The Studio Ledger, lit" (SPECS/homepage-lit.md,
// new card #7). A 6-month forward area chart of the studio's cumulative cash
// position: a single green stroke over a green-to-transparent gradient fill,
// drawing left-to-right when it scrolls into view. A pulsing dot sits on the
// TROUGH (the tightest month), with a "Tightest: {Month}, {amount}" callout,
// and the closing position counts up. Months that dip net-negative earn a
// semantic amber/red wash (only where earned, never decorative).
//
// One green per card (the money domain is the only green-allowed domain).
// Money + the month label stay ink and carry data-private at the call site.
//
// Data: GET /api/admin/reports/cash-flow-forecast?months=6 ->
//   months: [{ month: 'YYYY-MM', revenue, cost, net, cumulative }]
//   summary: { totalRevenue, totalCost, totalNet, recurringMrrNzd,
//              recurringCostNzd, commitmentCount, commitmentSource }
// We chart `cumulative` (the running cash position) as the single series; the
// trough = the month with the lowest cumulative. Closing = the last month's
// cumulative. (Real fields confirmed against the route.ts.)
//
// Reduced-motion safe: the area paints at its final state with no draw
// (isAnimationActive off), the trough dot stops pulsing, and the count-up
// resolves immediately. The chart only mounts once inView (useReveal).

import useSWR from 'swr'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceDot,
} from 'recharts'
import { LineChart } from 'lucide-react'
import { DomainCard } from './domain-card'
import { useReveal } from '@/lib/use-homepage-motion'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { CountUp } from '@/components/tahi/count-up'

// ── Endpoint shape ─────────────────────────────────────────────────────────────

interface ForecastMonth {
  month: string // 'YYYY-MM'
  revenue: number
  cost: number
  net: number
  cumulative: number
}

interface ForecastResponse {
  months?: ForecastMonth[]
  summary?: {
    totalNet?: number
  }
}

interface ChartPoint {
  month: string
  label: string // 'Jun'
  cumulative: number
  net: number
}

const GRADIENT_ID = 'cashFlowRibbonFill'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// 'YYYY-MM' -> short month label, locale-stable.
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1, 1))
  return new Intl.DateTimeFormat('en-NZ', { month: 'short', timeZone: 'UTC' }).format(d)
}

function monthLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(Date.UTC(y, m - 1, 1))
  return new Intl.DateTimeFormat('en-NZ', { month: 'long', timeZone: 'UTC' }).format(d)
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// ── Quiet tooltip ──────────────────────────────────────────────────────────────

interface TooltipPayload {
  payload: ChartPoint
}

function QuietTooltip({
  active,
  payload,
  format,
}: {
  active?: boolean
  payload?: TooltipPayload[]
  format: (n: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md, 0.5rem)',
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text)',
        boxShadow: 'none',
      }}
    >
      <div style={{ ...LABEL_STYLE, marginBottom: '0.125rem' }}>{monthLong(point.month)}</div>
      <div data-private className="tabular-nums" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {format(Math.round(point.cumulative))}
      </div>
    </div>
  )
}

// ── Card ───────────────────────────────────────────────────────────────────────

export function CashFlowRibbon({ className }: { className?: string }) {
  const { format } = useDisplayCurrency()
  const { ref, inView } = useReveal<HTMLDivElement>()
  const { data: forecastData, isLoading: loading, error } = useSWR<ForecastResponse>('/api/admin/reports/cash-flow-forecast?months=6')
  const months = forecastData?.months ?? []
  const failed = !!error

  const points: ChartPoint[] = months.map(m => ({
    month: m.month,
    label: monthLabel(m.month),
    cumulative: m.cumulative,
    net: m.net,
  }))

  // Trough = lowest cumulative position across the window.
  const troughIndex = points.reduce(
    (lowest, p, i) => (p.cumulative < points[lowest].cumulative ? i : lowest),
    0,
  )
  const trough = points[troughIndex] ?? null
  const closing = points.length > 0 ? points[points.length - 1].cumulative : 0
  // Any month dipping net-negative earns the semantic wash; below zero closing
  // is the strongest signal.
  const anyNegative = points.some(p => p.cumulative < 0)
  const reduced = prefersReducedMotion()

  return (
    <DomainCard
      domain="money"
      title="Cash-Flow Forecast"
      icon={<LineChart size={15} />}
      viewHref="/financial-reports"
      className={className}
    >
      <div ref={ref}>
        {loading ? (
          <RibbonSkeleton />
        ) : failed || points.length < 2 ? (
          <EmptyState />
        ) : (
          <>
            {/* Closing position headline */}
            <div className="flex items-baseline" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span style={LABEL_STYLE}>Closing in {points.length} mo</span>
              <span
                data-private
                className="tabular-nums"
                style={{
                  fontSize: 'clamp(1.375rem, 3.5vw, 1.75rem)',
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  color: closing < 0 ? 'var(--color-danger)' : 'var(--domain-money)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {inView ? (
                  <CountUp value={Math.round(closing)} format={n => format(Math.round(n))} />
                ) : (
                  format(Math.round(closing))
                )}
              </span>
            </div>

            {/* The ribbon */}
            <div style={{ width: '100%', height: '8.5rem', marginTop: 'var(--space-4)' }}>
              {inView && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 6, bottom: 0, left: 6 }}>
                    <defs>
                      <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--domain-money)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--domain-money)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
                      tickMargin={6}
                      interval="preserveStartEnd"
                    />
                    <YAxis hide domain={['dataMin', 'dataMax']} />
                    <Tooltip
                      content={<QuietTooltip format={format} />}
                      cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      stroke="var(--domain-money)"
                      strokeWidth={2}
                      fill={`url(#${GRADIENT_ID})`}
                      isAnimationActive={!reduced}
                      animationDuration={900}
                      animationEasing="ease-out"
                      dot={false}
                      activeDot={{ r: 3, fill: 'var(--domain-money)', stroke: 'var(--color-bg)', strokeWidth: 1.5 }}
                    />
                    {/* Pulsing trough dot */}
                    {trough && (
                      <ReferenceDot
                        x={trough.label}
                        y={trough.cumulative}
                        r={4}
                        fill={trough.cumulative < 0 ? 'var(--color-danger)' : 'var(--domain-money)'}
                        stroke="var(--color-bg)"
                        strokeWidth={1.5}
                        isFront
                        shape={props => <PulsingDot cx={props.cx} cy={props.cy} negative={trough.cumulative < 0} animate={!reduced} />}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Trough callout */}
            {trough && (
              <div
                className="flex items-center"
                style={{
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-3)',
                  paddingTop: 'var(--space-3)',
                  borderTop: '1px solid var(--color-border-subtle)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.5rem',
                    height: '0.5rem',
                    borderRadius: '9999px',
                    flexShrink: 0,
                    background: trough.cumulative < 0 ? 'var(--color-danger)' : 'var(--domain-money)',
                  }}
                />
                <span
                  data-private
                  className="tabular-nums"
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}
                >
                  Tightest: {monthLong(trough.month)}, {format(Math.round(trough.cumulative))}
                </span>
                {anyNegative && (
                  <span style={{ ...LABEL_STYLE, color: 'var(--color-danger)', marginLeft: 'auto' }}>
                    goes negative
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </DomainCard>
  )
}

// Pulsing trough dot. One perpetual loop is allowed under the resting-page
// budget for the single trough marker; reduced motion renders it static.
function PulsingDot({ cx, cy, negative, animate }: { cx?: number; cy?: number; negative: boolean; animate: boolean }) {
  if (cx == null || cy == null) return null
  const colour = negative ? 'var(--color-danger)' : 'var(--domain-money)'
  return (
    <g>
      {animate && (
        <circle cx={cx} cy={cy} r={4} fill={colour} fillOpacity={0.35}>
          <animate attributeName="r" values="4;9;4" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="fill-opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={cx} cy={cy} r={4} fill={colour} stroke="var(--color-bg)" strokeWidth={1.5} />
    </g>
  )
}

// ── Loading + empty states ─────────────────────────────────────────────────────

function RibbonSkeleton() {
  return (
    <div aria-hidden="true">
      <div
        className="tahi-shimmer"
        style={{ width: '8rem', height: '1.5rem', borderRadius: '0.375rem' }}
      />
      <div
        className="tahi-shimmer"
        style={{
          width: '100%',
          height: '8.5rem',
          marginTop: 'var(--space-4)',
          borderRadius: 'var(--radius-md, 0.5rem)',
        }}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-2)', padding: 'var(--space-3) 0' }}>
      <span style={{ ...LABEL_STYLE, color: 'var(--color-text-muted)' }}>No forecast yet</span>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)', lineHeight: 1.5, maxWidth: '22rem' }}>
        Add MRR, pipeline, and expense commitments to project the studio cash position forward.
      </p>
    </div>
  )
}
