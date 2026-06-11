'use client'

// ─── The Ledger Masthead ─────────────────────────────────────────────────────
//
// "The Studio Ledger" thesis: the most important things wear the LEAST chrome.
// MRR is set at display scale directly on the warm-sand canvas (no card, no
// gradient, no icon). The five old KPI tiles collapse into this one typographic
// ledger row. The page speaks exactly one human sentence per day (the Studio
// Note). See SPECS/homepage-studio-ledger.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, ArrowRight } from 'lucide-react'
import { CountUp } from '@/components/tahi/count-up'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { usePermissions } from '@/components/tahi/permissions-context'

// The masthead consumes the extended /api/admin/overview payload (Slice 0).
export interface LedgerData {
  kpis: {
    activeClients: number
    openRequests: number
    inProgress: number
    outstandingInvoicesNzd?: number
    mrr?: number
  }
  monthlyRevenue?: { month: string; total: number }[]
  cash?: { totalNzd: number; runwayMonths: number | null; burnNzd: number } | null
  arAging?: {
    currentNzd: number
    d30Nzd: number
    d60Nzd: number
    d90Nzd: number
    totalNzd: number
    oldest: { clientName: string | null; daysPastDue: number; amountNzd: number } | null
  } | null
  overnight?: {
    since: string
    deliveriesCompleted: number
    clientReplies: number
    paymentsClearedCount?: number
    paymentsClearedNzd?: number
  }
  activeTimer?: { running: boolean; label: string | null } | null
  openByStatus?: Record<string, number>
}

const AUCKLAND_TZ = 'Pacific/Auckland'

export function LedgerMasthead({ userName, data, loading }: { userName: string; data: LedgerData | null; loading: boolean }) {
  const { features } = usePermissions()
  const firstName = userName.split(' ')[0]

  const canMrr = features['financial_reports'] !== false
  const canInvoices = features['invoices'] !== false
  const canClients = features['clients'] !== false
  const canRequests = features['requests'] !== false

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-5)' }}>
      {/* Eyebrow: greeting + clocks + workshop light · quick action */}
      <div
        className="flex items-center justify-between flex-wrap"
        style={{ gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}
      >
        <div className="flex items-center flex-wrap" style={{ gap: 'var(--space-2-5)', rowGap: 'var(--space-1)' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Kia ora, {firstName}</span>
          <Dot />
          <TodayDate />
          <Dot />
          <TwoClocks />
          {data?.activeTimer?.running && (
            <>
              <Dot />
              <WorkshopLight label={data.activeTimer.label} />
            </>
          )}
        </div>
        <NewMenu canRequests={canRequests} canClients={canClients} />
      </div>

      {/* The ledger: MRR set bare on the canvas, vitals hairline-separated beside it */}
      <div
        className="flex flex-col lg:flex-row lg:items-end"
        style={{ gap: 'var(--space-5)' }}
      >
        {/* MRR hero figure */}
        <div style={{ flexShrink: 0 }}>
          <p
            style={{
              fontSize: 'var(--text-2xs, 0.6875rem)',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-subtle)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Monthly recurring
          </p>
          {loading ? (
            <div className="tahi-shimmer" style={{ height: '3.25rem', width: '11rem', borderRadius: 'var(--radius-sm)' }} />
          ) : canMrr && data?.kpis.mrr != null ? (
            <div className="flex items-end" style={{ gap: 'var(--space-3)' }}>
              <MrrFigure value={data.kpis.mrr} />
              <Sparkbar points={(data.monthlyRevenue ?? []).map(m => m.total)} />
            </div>
          ) : (
            <p style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-subtle)' }}>&mdash;</p>
          )}
          {!loading && canMrr && data?.monthlyRevenue && (
            <RevenueDelta points={data.monthlyRevenue.map(m => m.total)} />
          )}
        </div>

        {/* Vitals */}
        <div
          className="flex items-stretch flex-wrap"
          style={{ gap: 0, rowGap: 'var(--space-3)', marginLeft: 'auto' }}
        >
          {canMrr && (
            <Vital
              label="Cash"
              loading={loading}
              value={data?.cash ? <Money n={data.cash.totalNzd} /> : <Muted />}
              sub={data?.cash?.runwayMonths != null ? `${data.cash.runwayMonths.toFixed(1)} mo runway` : 'no burn data'}
            />
          )}
          {canInvoices && (
            <Vital
              label="Owed"
              loading={loading}
              value={data?.kpis.outstandingInvoicesNzd != null ? <Money n={data.kpis.outstandingInvoicesNzd} /> : <Muted />}
              sub={<AgedMicroBar aging={data?.arAging ?? null} />}
            />
          )}
          {canClients && (
            <Vital
              label="Clients"
              loading={loading}
              value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>{data?.kpis.activeClients ?? 0}</span>}
              sub="active"
            />
          )}
          {canRequests && (
            <Vital
              label="Open"
              loading={loading}
              value={<span style={{ fontVariantNumeric: 'tabular-nums' }}>{data?.kpis.openRequests ?? 0}</span>}
              sub={data?.kpis.inProgress != null ? `${data.kpis.inProgress} in progress` : 'requests'}
              last
            />
          )}
        </div>
      </div>

      {/* Hairline rule */}
      <div style={{ height: 1, background: 'var(--color-border-subtle)' }} />

      {/* The Studio Note: one signed human sentence per day */}
      <StudioNote data={data} loading={loading} />
    </div>
  )
}

// ─── MRR figure ───────────────────────────────────────────────────────────────

function MrrFigure({ value }: { value: number }) {
  const { format, toDisplay } = useDisplayCurrency()
  // Render the converted number with CountUp, keeping the display-currency prefix.
  const target = toDisplay(value)
  const prefix = useMemo(() => {
    const sample = format(value)
    const match = sample.match(/^[^\d-]+/)
    return match ? match[0] : ''
  }, [format, value])
  return (
    <span
      data-private
      style={{
        fontSize: 'clamp(2.25rem, 6vw, 3.25rem)',
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        color: 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-block',
      }}
    >
      {prefix}
      <CountUp value={Math.round(target)} format={n => Math.round(n).toLocaleString()} />
    </span>
  )
}

function Sparkbar({ points }: { points: number[] }) {
  const bars = points.slice(-6)
  const max = Math.max(1, ...bars)
  if (bars.length === 0) return null
  return (
    <div className="flex items-end" style={{ gap: '0.1875rem', height: '1.75rem', paddingBottom: '0.25rem' }} aria-hidden="true">
      {bars.map((v, i) => {
        const h = Math.max(8, Math.round((v / max) * 100))
        const isLast = i === bars.length - 1
        return (
          <div
            key={i}
            style={{
              width: '0.375rem',
              height: `${h}%`,
              background: isLast ? 'var(--color-brand)' : 'var(--color-brand-100)',
              borderRadius: '2px',
              transition: 'height var(--motion-medium) var(--ease-productive)',
            }}
          />
        )
      })}
    </div>
  )
}

function RevenueDelta({ points }: { points: number[] }) {
  const bars = points.slice(-2)
  if (bars.length < 2 || bars[0] === 0) return null
  const pct = Math.round(((bars[1] - bars[0]) / bars[0]) * 100)
  if (pct === 0) return null
  const up = pct > 0
  return (
    <p
      data-private
      style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        color: up ? 'var(--color-success)' : 'var(--color-text-subtle)',
        marginTop: 'var(--space-1-5)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {up ? '+' : ''}{pct}% <span style={{ color: 'var(--color-text-subtle)', fontWeight: 400 }}>vs last month</span>
    </p>
  )
}

// ─── Vital ────────────────────────────────────────────────────────────────────

function Vital({ label, value, sub, loading, last }: { label: string; value: React.ReactNode; sub: React.ReactNode; loading: boolean; last?: boolean }) {
  return (
    <div
      style={{
        paddingLeft: 'var(--space-4)',
        paddingRight: last ? 0 : 'var(--space-4)',
        borderRight: last ? 'none' : '1px solid var(--color-border-subtle)',
        minWidth: '5.5rem',
      }}
    >
      <p style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-subtle)', marginBottom: 'var(--space-1)' }}>
        {label}
      </p>
      {loading ? (
        <div className="tahi-shimmer" style={{ height: '1.5rem', width: '3.5rem', borderRadius: 'var(--radius-sm)' }} />
      ) : (
        <p style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
          {value}
        </p>
      )}
      <div style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
        {sub}
      </div>
    </div>
  )
}

function Money({ n }: { n: number }) {
  const { format } = useDisplayCurrency()
  return <span data-private style={{ fontVariantNumeric: 'tabular-nums' }}>{format(n)}</span>
}

function Muted() {
  return <span style={{ color: 'var(--color-text-subtle)' }}>&mdash;</span>
}

function AgedMicroBar({ aging }: { aging: LedgerData['arAging'] }) {
  if (!aging || aging.totalNzd <= 0) return <span>nothing overdue</span>
  const segs = [
    { v: aging.currentNzd, c: 'var(--color-success)' },
    { v: aging.d30Nzd + aging.d60Nzd, c: 'var(--color-warning)' },
    { v: aging.d90Nzd, c: 'var(--color-danger)' },
  ]
  const total = Math.max(1, aging.totalNzd)
  return (
    <div
      data-private
      className="flex items-center"
      style={{ height: '0.25rem', width: '4rem', borderRadius: '9999px', overflow: 'hidden', background: 'var(--color-bg-tertiary)', marginTop: '0.1875rem' }}
      aria-hidden="true"
    >
      {segs.map((s, i) => s.v > 0 && (
        <div key={i} style={{ width: `${(s.v / total) * 100}%`, height: '100%', background: s.c }} />
      ))}
    </div>
  )
}

// ─── Two Clocks + Workshop Light ──────────────────────────────────────────────

function fmtTime(tz: string) {
  try {
    return new Intl.DateTimeFormat('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date())
  } catch {
    return ''
  }
}

function TwoClocks() {
  // Mount-gated: time differs between server and client, so render nothing until
  // mounted to avoid a hydration mismatch, then tick every 30s.
  const [mounted, setMounted] = useState(false)
  const [, setTick] = useState(0)
  const [localTz, setLocalTz] = useState<string | null>(null)
  useEffect(() => {
    setMounted(true)
    setLocalTz(Intl.DateTimeFormat().resolvedOptions().timeZone)
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])
  if (!mounted) return null
  const akl = fmtTime(AUCKLAND_TZ)
  const showLocal = localTz && localTz !== AUCKLAND_TZ
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      AKL {akl}
      {showLocal && <span style={{ color: 'var(--color-text-subtle)' }}> &middot; you {fmtTime(localTz)}</span>}
    </span>
  )
}

function WorkshopLight({ label }: { label: string | null }) {
  return (
    <span className="flex items-center" style={{ gap: 'var(--space-1-5)', color: 'var(--color-brand)' }}>
      <span className="workshop-pulse" aria-hidden="true" style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: '9999px', background: 'var(--color-brand)', display: 'inline-block' }} />
      <span data-private style={{ fontWeight: 500 }}>{label ?? 'In the studio'}</span>
    </span>
  )
}

// ─── The Studio Note ──────────────────────────────────────────────────────────

function StudioNote({ data, loading }: { data: LedgerData | null; loading: boolean }) {
  const { format } = useDisplayCurrency()
  const [stamp, setStamp] = useState<string | null>(null)
  useEffect(() => {
    setStamp(new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()).toLowerCase().replace(/\s/g, ''))
  }, [])

  if (loading) {
    return <div className="tahi-shimmer" style={{ height: '1.25rem', width: '70%', borderRadius: 'var(--radius-sm)' }} />
  }

  const ov = data?.overnight
  const fragments: string[] = []
  if (ov?.paymentsClearedNzd && ov.paymentsClearedNzd > 0) {
    fragments.push(`${format(ov.paymentsClearedNzd)} cleared`)
  }
  if (ov?.clientReplies && ov.clientReplies > 0) {
    fragments.push(`${ov.clientReplies} client ${ov.clientReplies === 1 ? 'reply' : 'replies'}`)
  }
  if (ov?.deliveriesCompleted && ov.deliveriesCompleted > 0) {
    fragments.push(`${ov.deliveriesCompleted} shipped`)
  }

  const oldest = data?.arAging?.oldest
  const concern =
    oldest && oldest.daysPastDue > 0
      ? { text: `Chase ${oldest.clientName ?? 'an overdue invoice'} (${oldest.daysPastDue}d overdue)`, href: '/invoices' }
      : (data?.kpis.openRequests ?? 0) > 0
        ? { text: 'Move the open requests forward', href: '/requests' }
        : null

  const slept = fragments.length > 0 ? `While you slept: ${joinList(fragments)}.` : 'Quiet overnight in the studio.'

  return (
    <div className="flex items-start" style={{ gap: 'var(--space-2-5)' }}>
      <LeafGlyph />
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text)', lineHeight: 1.55, flex: 1, minWidth: 0 }}>
        <span data-private>{slept}</span>
        {concern && (
          <>
            {' '}
            <Link
              href={concern.href}
              data-private
              className="studio-note-link"
              style={{ color: 'var(--color-brand)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              {concern.text} <ArrowRight size={12} aria-hidden="true" style={{ display: 'inline', verticalAlign: 'middle' }} />
            </Link>
          </>
        )}
        {stamp && (
          <span style={{ color: 'var(--color-text-subtle)', fontSize: 'var(--text-xs)' }}> &nbsp;Noted {stamp}</span>
        )}
      </p>
    </div>
  )
}

// Self-drawing single-stroke leaf glyph (the Growing Leaf, in one of its 3 homes).
function LeafGlyph() {
  const ref = useRef<SVGPathElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const len = el.getTotalLength()
    el.style.transition = 'none'
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    // Force reflow then animate the draw once.
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 700ms var(--ease-productive)'
    el.style.strokeDashoffset = '0'
  }, [])
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.1875rem' }}>
      <path
        ref={ref}
        d="M3 13C3 8 6 3.5 13 3C12.5 10 8 13 3 13ZM3 13C5.5 11 7.5 8.5 9.5 6"
        stroke="var(--color-brand)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── New action menu ──────────────────────────────────────────────────────────

function NewMenu({ canRequests, canClients }: { canRequests: boolean; canClients: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = [
    canRequests && { label: 'New request', href: '/requests?new=1' },
    canClients && { label: 'Add client', href: '/clients?new=1' },
    { label: 'Log time', href: '/time?new=1' },
  ].filter(Boolean) as { label: string; href: string }[]

  if (items.length === 0) return null

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center tahi-press"
        style={{
          gap: 'var(--space-1-5)',
          padding: 'var(--space-1-5) var(--space-3)',
          background: 'var(--color-brand)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-leaf-sm)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Plus size={14} aria-hidden="true" /> New
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.375rem)',
            right: 0,
            minWidth: '11rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-floating)',
            padding: 'var(--space-1)',
            zIndex: 40,
          }}
        >
          {items.map(it => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center new-menu-item"
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text)',
                textDecoration: 'none',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function Dot() {
  return <span aria-hidden="true" style={{ color: 'var(--color-text-subtle)', opacity: 0.6 }}>&middot;</span>
}

function TodayDate() {
  const [s, setS] = useState<string | null>(null)
  useEffect(() => {
    setS(new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date()))
  }, [])
  return <span suppressHydrationWarning>{s ?? ''}</span>
}

function joinList(parts: string[]): string {
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}
