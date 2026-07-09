'use client'

/**
 * ov-kit.tsx - the shared OVKit primitives for the role-aware Overview
 * ("Studio Ledger") home. Ported to typed TSX from the Claude Design
 * `overview-kit.jsx` (window.OVKit). Every role home (owner / teammate /
 * client) composes from this single kit instead of hand-rolling SVG maths.
 *
 * Companion stylesheet: app/(dashboard)/overview/overview.css (all `.ov-*`
 * classes). A page rendering these primitives MUST import that stylesheet
 * and wrap its content in a `.ov` element (which sets container-type so the
 * design's @container queries fire).
 *
 * CURRENCY - critical departure from the design:
 *   The design's `money()`/`conv()` hardcoded a fake FX rate map. That is
 *   DELETED. Money must format through the real DisplayCurrency provider
 *   (lib/display-currency-context). Use the `useOvFormat()` hook exported
 *   here and thread `money` / `moneyCompact` into the leaf primitives via
 *   their existing `format` props (Spark / Ribbon / Hero) or to build
 *   Vitals `num` / Hero `value` display strings.
 *
 * Ledger accent hexes (risk / warn / info / negative tint) are not in the
 * token palette and differ from the lighter repo status tokens; they are
 * declared once here as a documented const object (CLAUDE.md rule 2) and in
 * overview.css, applied consistently across Ribbon / NeedsYou / edges.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { CountUp } from '@/components/tahi/count-up'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'

// Re-export the repo CountUp so homes import everything from one kit module.
export { CountUp }

/* ---------- ledger accent constants (documented inline-style hexes) ---------- */
/** Not in the token palette; kept consistent across Ribbon / NeedsYou / edges. */
const OV = {
  risk: '#C0392E', // loss bars, risk edge
  negTint: '#e08a80', // negative value tint in the ribbon tooltip
} as const

/* ---------- icons ---------- */
/** 24x24 stroke-currentColor path map. Multi-path `d` split on ' M'. */
const P = {
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  chevron: 'M6 9l6 6 6-6',
  check: 'M20 6L9 17l-5-5',
  request: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h4',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5V12l3 1.8',
  phone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  receipt: 'M4 2v20l2-1.5L8 22l2-1.5L12 22l2-1.5L16 22l2-1.5L20 22V2l-2 1.5L16 2l-2 1.5L12 2l-2 1.5L8 2 6 3.5 4 2z M8 8h8 M8 12h6',
  send: 'M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  spark: 'M12 3l1.9 5.6L19.5 10l-5.6 1.4L12 17l-1.9-5.6L4.5 10l5.6-1.4z',
  chart: 'M3 3v18h18 M7 14l4-4 3 3 5-6',
  pen: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  funnel: 'M3 4h18l-7 8v7l-4 2v-9z',
  gauge: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M13.4 10.6L19 5 M12 3a9 9 0 0 1 9 9 M3 12a9 9 0 0 1 9-9',
  bolt: 'M13 2L4.5 13H11l-1 9 8.5-11H12z',
  doc: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7',
  wallet: 'M20 12V8H6a2 2 0 0 1 0-4h12v4 M4 6v12a2 2 0 0 0 2 2h14v-4 M18 12a2 2 0 0 0 0 4h4v-4z',
  play: 'M5 3l14 9-14 9z',
  coins: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M16 22a6 6 0 1 0 0-12 6 6 0 0 0 0 12z',
  tasks: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M19 12l-7 7-7-7',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
} as const

export type IconName = keyof typeof P

export function Icon({ n, s = 18 }: { n: IconName; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {(P[n] ?? '').split(' M').map((d, i) => (
        <path key={i} d={i ? 'M' + d : d} />
      ))}
    </svg>
  )
}

/* ---------- currency (real FX via the DisplayCurrency provider) ---------- */

export interface OvFormat {
  /** Format an NZD amount in the current display currency (whole units). */
  money: (nzd: number) => string
  /** Compact form: symbol + k when |value| >= 1000 (e.g. NZ$12k, NZ$1.4k). */
  moneyCompact: (nzd: number) => string
  /** Symbol for the current display currency (e.g. NZ$, US$, £). */
  symbol: string
}

/**
 * Currency formatter bound to the real DisplayCurrency provider. Replaces the
 * design's hardcoded RATES/money/conv. Call inside a client component and pass
 * `money` / `moneyCompact` as the `format` prop of Spark / Ribbon / Hero, or
 * to build Vitals `num` strings.
 */
export function useOvFormat(): OvFormat {
  const { toDisplay, format, displayCurrency } = useDisplayCurrency()
  const symbol = SUPPORTED_CURRENCIES.find(c => c.code === displayCurrency)?.symbol ?? displayCurrency
  const money = useCallback((nzd: number) => format(nzd), [format])
  const moneyCompact = useCallback(
    (nzd: number): string => {
      const v = toDisplay(nzd)
      if (Math.abs(v) >= 1000) {
        const s = v / 1000
        const num = s >= 100 ? String(Math.round(s)) : s.toFixed(1).replace(/\.0$/, '')
        return symbol + num + 'k'
      }
      return format(nzd)
    },
    [toDisplay, format, symbol],
  )
  return { money, moneyCompact, symbol }
}

/* ---------- live clock ---------- */

/** Ticking clock; re-renders every 30s. Client-only. */
export function useNow(): Date {
  const [t, setT] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  return t
}

/** 24h hh:mm in the viewer's locale/zone. */
export const hhmm = (d: Date): string => d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false })

/* ---------- reduced-motion (SSR-safe, hydration-safe) ---------- */

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduce(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduce
}

/* ---------- charts ---------- */

export interface SparkProps {
  data: number[]
  labels?: Array<string | number>
  format?: (n: number) => string
  h?: number
  color?: string
  fill?: boolean
  bottom?: boolean
  endDot?: boolean
  fillColor?: string
  grow?: boolean
}

/**
 * Hover sparkline with crosshair + tooltip. `grow` fills its flex parent,
 * `bottom` pins to the bottom, `endDot` marks the last point when idle.
 * Renders nothing for a series shorter than 2 points (honest empty state).
 */
export function Spark({ data, labels, format, h = 46, color = 'var(--brand)', fill = true, bottom = false, endDot = false, fillColor, grow = false }: SparkProps) {
  const w = 240
  const ref = useRef<HTMLDivElement>(null)
  const [hov, setHov] = useState<number | null>(null)
  const rawId = useId()
  const id = 'sp' + rawId.replace(/[^a-zA-Z0-9]/g, '')

  if (!data || data.length < 2) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const rng = max - min || 1
  const pts: Array<[number, number]> = data.map((d, i) => [(i / (data.length - 1)) * w, h - 4 - ((d - min) / rng) * (h - 8)])
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')

  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width) * (data.length - 1))
    setHov(Math.max(0, Math.min(data.length - 1, i)))
  }
  const lx = hov == null ? 0 : (hov / (data.length - 1)) * 100

  return (
    <div
      className={'ov-chartwrap' + (bottom ? ' bottom' : '') + (grow ? ' grow' : '')}
      ref={ref}
      onMouseMove={move}
      onMouseLeave={() => setHov(null)}
      style={grow ? { minHeight: h } : { height: h }}
    >
      <svg className={'ov-spark' + (grow ? ' abs' : '')} viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" style={grow ? undefined : { height: h }}>
        {fill && (
          <>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={fillColor || color} stopOpacity="0.20" />
                <stop offset="1" stopColor={fillColor || color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={line + ' L ' + w + ' ' + h + ' L 0 ' + h + ' Z'} fill={'url(#' + id + ')'} />
          </>
        )}
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hov != null && <line x1={pts[hov][0]} y1="2" x2={pts[hov][0]} y2={h - 2} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />}
      </svg>
      {endDot && hov == null && <span className="ov-hovdot" style={{ left: '100%', top: (pts[pts.length - 1][1] / h) * 100 + '%', borderColor: color }} />}
      {hov != null && (
        <>
          <span className="ov-hovdot" style={{ left: lx + '%', top: (pts[hov][1] / h) * 100 + '%', borderColor: color }} />
          <div className={'ov-tip' + (lx > 74 ? ' flip' : lx < 12 ? ' pin' : '')} style={{ left: lx + '%' }}>
            <b>{format ? format(data[hov]) : data[hov]}</b>
            {labels && labels[hov] != null && <span>{labels[hov]}</span>}
          </div>
        </>
      )}
    </div>
  )
}

export interface RibbonProps {
  data: number[]
  labels?: Array<string | number>
  format?: (n: number) => string
  h?: number
  color?: string
  grow?: boolean
}

/**
 * Diverging +/- bar chart with a zero baseline. Positive bars use `color`,
 * negative bars use the ledger risk red. Hover raises the hovered bar and
 * dims its siblings. Renders nothing for an empty series.
 */
export function Ribbon({ data, labels, format, h = 64, color = 'var(--brand)', grow = false }: RibbonProps) {
  const w = 300
  const ref = useRef<HTMLDivElement>(null)
  const [hov, setHov] = useState<number | null>(null)

  if (!data || data.length === 0) return null

  const max = Math.max(...data.map(d => Math.abs(d))) || 1
  const n = data.length
  const gap = w / n
  const bw = gap * 0.6
  const mid = h / 2

  const move = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * n)
    setHov(Math.max(0, Math.min(n - 1, i)))
  }
  const lx = hov == null ? 0 : ((hov + 0.5) / n) * 100

  return (
    <div className={'ov-chartwrap' + (grow ? ' grow' : '')} ref={ref} onMouseMove={move} onMouseLeave={() => setHov(null)} style={grow ? { minHeight: h } : { height: h }}>
      <svg className={'ov-spark' + (grow ? ' abs' : '')} viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" style={grow ? undefined : { height: h }}>
        <line x1="0" y1={mid} x2={w} y2={mid} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const bh = (Math.abs(d) / max) * (h / 2 - 4)
          const x = i * gap + (gap - bw) / 2
          const y = d >= 0 ? mid - bh : mid
          const op = hov == null ? (d >= 0 ? 0.92 : 0.4) : i === hov ? 1 : d >= 0 ? 0.45 : 0.22
          return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={Math.max(1.5, bh).toFixed(1)} rx="2" fill={d >= 0 ? color : OV.risk} opacity={op} />
        })}
      </svg>
      {hov != null && (
        <div className={'ov-tip' + (lx > 74 ? ' flip' : lx < 12 ? ' pin' : '')} style={{ left: lx + '%' }}>
          <b style={{ color: data[hov] < 0 ? OV.negTint : undefined }}>{format ? format(data[hov]) : data[hov]}</b>
          {labels && labels[hov] != null && <span>{labels[hov]}</span>}
        </div>
      )}
    </div>
  )
}

export interface GaugeProps {
  value: number
  max?: number
  color?: string
  size?: number
}

/** Half-donut gauge (180deg arc). Track uses --bg-tertiary; value animates
 *  strokeDashoffset (gated by prefers-reduced-motion in overview.css). */
export function Gauge({ value, max = 100, color = 'var(--brand)', size = 104 }: GaugeProps) {
  const r = size / 2 - 9
  const cx = size / 2
  const cy = size / 2
  const arc = Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  const d = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy
  return (
    <svg width={size} height={size / 2 + 10} viewBox={'0 0 ' + size + ' ' + (size / 2 + 10)}>
      <path d={d} fill="none" stroke="var(--bg-tertiary)" strokeWidth="9" strokeLinecap="round" />
      <path className="ov-gauge-val" d={d} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={arc} strokeDashoffset={arc * (1 - frac)} />
    </svg>
  )
}

/* ---------- brand leaf motif ---------- */

const LEAF_PATH =
  'M11.68 4.45C11.58 6.13 11.17 7.78 10.38 9.27C8.63 12.56 5.35 14.15 1.85 14.94C2.91 11.61 4.91 8.51 7.29 5.97C7.35 5.91 7.4 5.86 7.45 5.8C7.23 6.12 6.83 6.29 6.54 6.52C3.99 9.01 2.83 10.78 1.83 12.61C1.16 13.92 0.66 15 0.73 15.17C0.14 11.85 0.14 9.29 1.21 7.07C1.93 5.56 3.1 4.29 4.46 3.3C6.46 1.84 8.86 0.87 11.23 0.18C11.36 0.14 11.36 0.23 11.37 0.3C11.65 1.65 11.77 3.06 11.68 4.45Z'

/** Static filled leaf mark. */
export function OfficialLeaf({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={Math.round((size * 16) / 12)} viewBox="0 0 12 16" fill="none" aria-hidden="true">
      <path d={LEAF_PATH} fill={color} />
    </svg>
  )
}

/** Two-stroke draw-on leaf glyph. Draw animation lives in overview.css
 *  (`.ov-leaf-draw`) and is disabled under prefers-reduced-motion. */
export function LeafGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.32} viewBox="0 0 12 16" fill="none" aria-hidden="true">
      <path
        className="ov-leaf-draw"
        pathLength={1}
        d="M11.68 4.45C11.58 6.13 11.17 7.78 10.38 9.27C8.63 12.56 5.35 14.15 1.85 14.94"
        stroke="var(--brand)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        className="ov-leaf-draw d2"
        pathLength={1}
        d="M11.37 0.3C11.36 0.23 11.36 0.14 11.23 0.18C8.86 0.87 6.46 1.84 4.46 3.3C3.1 4.29 1.93 5.56 1.21 7.07C0.14 9.29 0.14 11.85 0.54 14.24"
        stroke="var(--brand)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface MicroBarSegment {
  v: number
  color: string
}

/** Segmented aged bar (receivables aging, vitals sub-bars). Zero segments
 *  render nothing; an all-zero set yields a bare track (honest empty). */
export function MicroBar({ segs }: { segs: MicroBarSegment[] }) {
  const total = segs.reduce((a, s) => a + s.v, 0) || 1
  return (
    <div className="ov-agedbar">
      {segs.map((s, i) => s.v > 0 && <i key={i} style={{ width: (s.v / total) * 100 + '%', background: s.color }} />)}
    </div>
  )
}

/* ---------- card primitives ---------- */

export interface CardProps {
  span?: number
  className?: string
  children?: ReactNode
  style?: CSSProperties
  tone?: 'ink' | 'sand' | 'quiet'
  edge?: 'warn' | 'risk'
}

/** The ledger card. `span` = 12-col grid span, `tone` re-themes local tokens
 *  (ink = dark forest), `edge` = subtle attention border. */
export function Card({ span, className = '', children, style, tone, edge }: CardProps) {
  const cls = 'ov-card ' + (span ? 'col-' + span : '') + (tone ? ' ' + tone : '') + (edge ? ' edge-' + edge : '') + ' ' + className
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}

export interface CardHProps {
  ic?: IconName
  title: ReactNode
  link?: ReactNode
  onLink?: () => void
  badge?: ReactNode
}

/** Card header: icon chip + title + optional badge + animated text link.
 *  `onLink` should route to a real dashboard route via the home's navigator. */
export function CardH({ ic, title, link, onLink, badge }: CardHProps) {
  return (
    <div className="ov-card-h">
      {ic && (
        <span className="ch-ic">
          <Icon n={ic} s={15} />
        </span>
      )}
      <h3>{title}</h3>
      {badge}
      {link && (
        <button className="ch-link" onClick={onLink}>
          {link}
          <Icon n="arrow" s={13} />
        </button>
      )}
    </div>
  )
}

export interface RowProps {
  avText?: ReactNode
  img?: string
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  dot?: boolean
  dotColor?: string
  onClick?: () => void
}

/** List row with avatar (image or initials), title/sub, optional right value
 *  and leading status dot. Keyboard-activatable when `onClick` is set. */
export function Row({ avText, img, title, sub, right, dot, dotColor, onClick }: RowProps) {
  return (
    <div
      className={'ov-row' + (onClick ? ' click' : '')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {dot !== undefined && <span className="ov-dotm" style={{ background: dotColor || 'var(--brand)' }} />}
      {(img || avText) && (
        <span className="rw-av">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" />
          ) : (
            avText
          )}
        </span>
      )}
      <div className="rw-t">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </div>
      {right !== undefined && <span className="rw-r">{right}</span>}
      {onClick && (
        <span className="rw-ch">
          <Icon n="arrow" s={13} />
        </span>
      )}
    </div>
  )
}

/* ---------- New menu ---------- */

export interface NewMenuItem {
  ic: IconName
  label: ReactNode
  /** Route to a real create flow (e.g. /requests/new). */
  go?: () => void
}

function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [open, onClose])
  return ref
}

/** Standalone "+ New" dropdown (no greeting/clock cluster). `ro` = read-only
 *  under impersonation. `variant='hero'` restyles for the forest hero. */
export function NewMenu({ items, ro, variant }: { items: NewMenuItem[]; ro?: boolean; variant?: 'hero' }) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))
  return (
    <div className={'ov-new' + (variant ? ' on-' + variant : '')} ref={ref}>
      <button className="ov-newbtn" onClick={() => !ro && setOpen(o => !o)}>
        <Icon n="plus" s={15} />
        New
      </button>
      {open && (
        <div className="ov-newmenu">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => {
                setOpen(false)
                it.go?.()
              }}
            >
              <span className="ov-nm-ic">
                <Icon n={it.ic} s={16} />
              </span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface MastheadProps {
  hi: ReactNode
  /** Reserved for parity with the design; viewer time is derived from the
   *  local zone. Currently unused. */
  viewerTz?: string
  newItems?: NewMenuItem[]
  ro?: boolean
  timerLabel?: ReactNode
}

/** Greeting + live dual-zone clock (AKL + viewer) + optional New menu.
 *  Clock text is deferred to after mount to avoid an SSR/client time
 *  hydration mismatch. */
export function Masthead({ hi, newItems, ro, timerLabel }: MastheadProps) {
  const now = useNow()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [open, setOpen] = useState(false)
  const ref = useOutsideClose(open, () => setOpen(false))

  const aklTime = now.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' })
  const viewerTime = hhmm(now)
  const diff = viewerTime !== aklTime
  const dateStr = now.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="ov-eyebrow">
      <span className="ov-hi">{hi}</span>
      {mounted && (
        <span className="ov-clock">
          <span className="ov-ck">{dateStr}</span>
          <span className="ov-cksep" />
          <span className="ov-ck">
            <span className="ov-zonelbl">AKL</span> {aklTime}
          </span>
          {diff && (
            <>
              <span className="ov-cksep" />
              <span className="ov-ck">
                <span className="ov-zonelbl">you</span> {viewerTime}
              </span>
            </>
          )}
          {timerLabel && (
            <>
              <span className="ov-cksep" />
              <span className="ov-workshop">
                <span className="ov-wd" />
                {timerLabel}
              </span>
            </>
          )}
        </span>
      )}
      {newItems && newItems.length > 0 && (
        <div className="ov-mast-r">
          <div className="ov-new" ref={ref}>
            <button className="ov-newbtn" onClick={() => !ro && setOpen(o => !o)}>
              <Icon n="plus" s={15} />
              New
            </button>
            {open && (
              <div className="ov-newmenu">
                {newItems.map((it, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setOpen(false)
                      it.go?.()
                    }}
                  >
                    <span className="ov-nm-ic">
                      <Icon n={it.ic} s={16} />
                    </span>
                    {it.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- hero ---------- */

export interface HeroProps {
  variant?: 'forest' | 'plain' | 'warm'
  label: ReactNode
  /** Number tweens via CountUp (dur 950); any other node renders as-is. */
  value: ReactNode
  format?: (n: number) => string
  sub?: ReactNode
  delta?: ReactNode
  deltaDir?: 'up' | 'down'
  action?: ReactNode
  figure?: ReactNode
}

/** Lead KPI hero. `forest` = green gradient with leaf watermark (owner),
 *  `plain` = neutral bordered (teammate), `warm` = warmer gradient (client). */
export function Hero({ variant = 'forest', label, value, format, sub, delta, deltaDir, action, figure }: HeroProps) {
  const cls = 'ov-hero' + (variant === 'plain' ? ' plain' : '') + (variant === 'warm' ? ' warm' : '')
  return (
    <div className={cls}>
      {action && <div className="ov-hero-act">{action}</div>}
      {figure && <div className="ov-hero-fig">{figure}</div>}
      <div className="ov-hero-lbl">{label}</div>
      <div className="ov-hero-num">{typeof value === 'number' ? <CountUp value={value} format={format} durationMs={950} /> : value}</div>
      {sub && (
        <div className="ov-hero-sub">
          {delta && (
            <span className="ov-delta">
              <Icon n={deltaDir === 'down' ? 'down' : 'up'} s={12} />
              {delta}
            </span>
          )}
          {sub}
        </div>
      )}
      <div className="ov-hero-clip">
        <svg className="ov-leafwm" viewBox="0 0 12 16" fill="none" aria-hidden="true">
          <path d={LEAF_PATH} fill="currentColor" />
        </svg>
      </div>
    </div>
  )
}

/* ---------- vitals ---------- */

export interface VitalItem {
  lbl: ReactNode
  num: ReactNode
  muted?: boolean
  trend?: { tone?: 'good' | 'bad' | 'flat'; dir?: 'up' | 'down'; txt: ReactNode }
  bar?: MicroBarSegment[]
  sub?: ReactNode
}

/** Joined 4-cell metric strip with per-cell trend pill + optional MicroBar. */
export function Vitals({ items }: { items: VitalItem[] }) {
  return (
    <div className="ov-vitals">
      {items.map((v, i) => (
        <div className="ov-vital" key={i}>
          <div className="vt-lbl">{v.lbl}</div>
          <div className="vt-numrow">
            <span className={'vt-num' + (v.muted ? ' muted' : '')}>{v.num}</span>
            {v.trend && (
              <span className={'vt-trend ' + (v.trend.tone || 'flat')}>
                {v.trend.dir && <Icon n={v.trend.dir} s={11} />}
                {v.trend.txt}
              </span>
            )}
          </div>
          {v.bar && <MicroBar segs={v.bar} />}
          {v.sub && <div className="vt-sub">{v.sub}</div>}
        </div>
      ))}
    </div>
  )
}

/* ---------- NeedsYou ---------- */

export interface NeedItem {
  ic: IconName
  tone: 'money' | 'call' | 'work'
  title: ReactNode
  sub: ReactNode
  verb: ReactNode
  /** Write action (route to /invoices, /calls, /requests, ...). */
  onAct?: () => void
}

export interface NeedsYouProps {
  items: NeedItem[]
  quiet?: { title?: ReactNode; sub?: ReactNode }
  ro?: boolean
  onMore?: () => void
}

/** Attention queue: max 3 rows each with one verb, a live border-trace when
 *  populated, a `+N more` overflow, and an honest "all quiet" empty state. */
export function NeedsYou({ items, quiet, onMore }: NeedsYouProps) {
  const live = items && items.length > 0
  const extra = live ? items.length - 3 : 0
  return (
    <div className={'ov-needs' + (live ? ' live' : '')}>
      <div className="ov-needs-head">
        <h3>Needs you</h3>
        {live && <span className="ov-needs-count">{items.length}</span>}
      </div>
      {live ? (
        items.slice(0, 3).map((it, i) => (
          <div className="ov-needrow" key={i}>
            <span className={'nr-ic ' + it.tone}>
              <Icon n={it.ic} s={17} />
            </span>
            <div className="nr-t">
              <b>{it.title}</b>
              <small>{it.sub}</small>
            </div>
            <button className="nr-verb" onClick={it.onAct}>
              {it.verb}
            </button>
          </div>
        ))
      ) : (
        <div className="ov-needs-quiet">
          <span className="nq-ic">
            <Icon n="check" s={17} />
          </span>
          <div className="nq-t">
            <b>{quiet?.title || 'All quiet in the studio.'}</b>
            <small>{quiet?.sub || 'Nothing is waiting on you right now.'}</small>
          </div>
        </div>
      )}
      {extra > 0 ? (
        <button className="ov-needs-more" onClick={onMore}>
          +{extra} more waiting
          <Icon n="arrow" s={12} />
        </button>
      ) : (
        live && (
          <div className="ov-needs-foot">
            <Icon n="check" s={13} />
            Nothing else needs you today.
          </div>
        )
      )}
    </div>
  )
}

/* ---------- The Wire (stepped ticker) ---------- */

export interface WireEvent {
  color: string
  who: ReactNode
  what: ReactNode
  when?: ReactNode
}

/** One-at-a-time news ticker (4s, pause on hover). Under prefers-reduced-
 *  motion it degrades to a static 4-item list. Renders nothing when empty. */
export function TheWire({ events }: { events: WireEvent[] }) {
  const [i, setI] = useState(0)
  const reduce = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)
  const n = events.length

  useEffect(() => {
    if (reduce || paused || n <= 1) return
    const id = setInterval(() => setI(x => (x + 1) % n), 4000)
    return () => clearInterval(id)
  }, [paused, reduce, n])

  useEffect(() => {
    if (i >= n && n > 0) setI(0)
  }, [i, n])

  if (n === 0) return null

  if (reduce) {
    return (
      <div className="ov-wire" style={{ height: 'auto', alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
        <span className="ov-wire-lbl">News feed</span>
        <div className="ov-wire-static">
          {events.slice(0, 4).map((e, k) => (
            <div className="ov-wire-item" key={k} style={{ position: 'static' }}>
              <span className="ov-wire-dot" style={{ background: e.color }} />
              <span>
                <b>{e.who}</b> {e.what}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const e = events[Math.min(i, n - 1)]
  return (
    <div className="ov-wire" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-live="polite">
      <span className="ov-wire-lbl">News feed</span>
      <div className="ov-wire-track">
        <div className="ov-wire-item enter" key={i}>
          <span className="ov-wire-dot" style={{ background: e.color }} />
          <span>
            <b>{e.who}</b> {e.what}
          </span>
          {e.when != null && <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: '12px' }}>{e.when}</span>}
        </div>
      </div>
    </div>
  )
}

/* ---------- Zone (rail label + 12-col grid) ---------- */

/** Zone section: a rotated vertical rail label + fading rail line beside a
 *  12-col grid. Cards inside use `span` for their column width. */
export function Zone({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className="ov-zone">
      <div className="ov-zone-rail">
        <span>{label}</span>
        <i className="zr-line" />
      </div>
      <div className="ov-grid">{children}</div>
    </section>
  )
}
