'use client'

// ─── Needs You ────────────────────────────────────────────────────────────────
//
// The page's act-now queue: signature move #5, "Earned loudness". Hard-capped at
// THREE rows, ONE verb (action) per row, ranked by urgency (most-overdue /
// most-imminent first). It owns the page's single border-trace, applied ONLY when
// it carries rows so the signature stays scarce. A healthy studio collapses this
// to one calm line ("All quiet in the studio") with no trace and no alarm colour.
//
// Sources (reused from overview-content.tsx, FALLBACK FIRST per the spec):
//   1. Off-track engagements  — /api/admin/engagements/off-track  [Reschedule]
//   2. The single imminent next call (within ~2h)                 [Join]
//   3. The oldest genuinely-overdue invoice (passed as a prop)    [Nudge]
//
// See SPECS/homepage-studio-ledger.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Calendar, ExternalLink, FileText, RotateCcw } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import type { DeliveryStatus } from '@/lib/delivery-status'
import { DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL } from '@/lib/delivery-status-labels'

const AUCKLAND_TZ = 'Pacific/Auckland'
// Only a call landing within this window is "imminent" enough to demand the page.
const IMMINENT_WINDOW_MS = 2 * 60 * 60 * 1000

// ─── Source shapes (mirrors of the overview-content widgets) ──────────────────

interface OffTrackEngagement {
  orgId: string
  orgName: string
  status: DeliveryStatus
  pctComplete: number
  rowsDone: number
  rowsTotal: number
  offTrackCount: number
}

interface UpcomingCall {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
  withName: string | null
  withSubtitle: string | null
  parentType: 'lead' | 'deal' | 'org' | 'request' | 'task' | null
  parentHref: string | null
  fromCalendar: boolean
}

export interface OldestOverdueInvoice {
  clientName: string | null
  daysPastDue: number
  amountNzd: number
}

// ─── Internal unified row model ───────────────────────────────────────────────

type Tone = 'warning' | 'danger' | 'brand'

interface Row {
  key: string
  // Higher urgency sorts first.
  urgency: number
  tone: Tone
  // Primary line (carries data-private where it names a client/person).
  body: React.ReactNode
  action: React.ReactNode
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface NeedsYouProps {
  oldest: OldestOverdueInvoice | null
  className?: string
}

export function NeedsYou({ oldest, className }: NeedsYouProps) {
  const [offTrack, setOffTrack] = useState<OffTrackEngagement[]>([])
  const [calls, setCalls] = useState<UpcomingCall[]>([])
  const [loading, setLoading] = useState(true)
  // Mount gate: relative time + clocks differ server vs client.
  const [now, setNow] = useState<number | null>(null)
  const { format } = useDisplayCurrency()

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(apiPath('/api/admin/engagements/off-track'))
        .then(r => (r.ok ? (r.json() as Promise<{ engagements?: OffTrackEngagement[] }>) : { engagements: [] }))
        .then(d => d.engagements ?? [])
        .catch(() => [] as OffTrackEngagement[]),
      fetch(apiPath('/api/admin/discovery-calls/upcoming?limit=5&includePast=1'))
        .then(r => (r.ok ? (r.json() as Promise<{ calls?: UpcomingCall[] }>) : { calls: [] }))
        .then(d => d.calls ?? [])
        .catch(() => [] as UpcomingCall[]),
    ]).then(([eng, cl]) => {
      if (cancelled) return
      setOffTrack(eng)
      setCalls(cl)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The single most-imminent upcoming call (soonest future call overall).
  const nextCall = useMemo(() => {
    if (now == null) return null
    let best: { call: UpcomingCall; at: number } | null = null
    for (const c of calls) {
      const at = new Date(c.scheduledAt).getTime()
      if (Number.isNaN(at) || at < now) continue
      if (!best || at < best.at) best = { call: c, at }
    }
    return best
  }, [calls, now])

  const rows = useMemo<Row[]>(() => {
    if (now == null) return []
    const out: Row[] = []

    // 1. Off-track engagements. The delivery rollup carries no literal "days
    //    behind" figure, so we degrade to the status word + off-track phase
    //    count and derive urgency from severity (blocked > delayed > at_risk)
    //    then count. Tone follows the status colour (amber = at_risk warning,
    //    red = delayed/blocked).
    for (const e of offTrack) {
      const sev = SEVERITY[e.status] ?? 0
      out.push({
        key: `eng:${e.orgId}`,
        urgency: URGENCY_OFF_TRACK_BASE + sev * 100 + Math.min(e.offTrackCount, 50),
        tone: e.status === 'at_risk' ? 'warning' : 'danger',
        body: (
          <>
            <span data-private style={{ fontWeight: 600 }}>{e.orgName}</span>{' '}
            <span style={{ color: DELIVERY_STATUS_COLOR[e.status] }}>{DELIVERY_STATUS_LABEL[e.status].toLowerCase()}</span>
            <span style={{ color: 'var(--color-text-subtle)' }}>
              {' · '}
              {e.offTrackCount} {e.offTrackCount === 1 ? 'phase' : 'phases'} off track
            </span>
          </>
        ),
        action: <RowLink href={`/clients/${e.orgId}`} label="Reschedule" icon={<RotateCcw size={13} aria-hidden="true" />} />,
      })
    }

    // 2. The imminent next call (only within the ~2h window). Show client-local
    //    time first, Auckland beneath, per Two Clocks.
    if (nextCall) {
      const delta = nextCall.at - now
      if (delta <= IMMINENT_WINDOW_MS) {
        const c = nextCall.call
        out.push({
          key: `call:${c.id}`,
          // Sooner = more urgent: invert the remaining time within the window.
          urgency: URGENCY_CALL_BASE + (IMMINENT_WINDOW_MS - delta),
          tone: 'brand',
          body: (
            <>
              <span data-private style={{ fontWeight: 600 }}>{c.withName ?? c.title}</span>
              <span style={{ color: 'var(--color-text-subtle)' }}>
                {' in '}
                {formatCountdown(delta)}
                {' · '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(c.scheduledAt, undefined)}</span>
                {' / '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(c.scheduledAt, AUCKLAND_TZ)} AKL</span>
              </span>
            </>
          ),
          action: c.meetingUrl ? (
            <RowExternal href={c.meetingUrl} label="Join" icon={<ExternalLink size={13} aria-hidden="true" />} />
          ) : c.parentHref ? (
            <RowLink href={c.parentHref} label="Open" icon={<Calendar size={13} aria-hidden="true" />} />
          ) : null,
        })
      }
    }

    // 3. The oldest genuinely-overdue invoice (only when past due).
    if (oldest && oldest.daysPastDue > 0) {
      out.push({
        key: 'invoice:oldest',
        urgency: URGENCY_INVOICE_BASE + oldest.daysPastDue,
        tone: 'danger',
        body: (
          <>
            <span style={{ fontWeight: 600 }}>Invoice overdue {oldest.daysPastDue}d</span>
            <span style={{ color: 'var(--color-text-subtle)' }}>
              {' · '}
              <span data-private style={{ fontVariantNumeric: 'tabular-nums' }}>{format(oldest.amountNzd)}</span>
              {oldest.clientName ? <>{' · '}<span data-private>{oldest.clientName}</span></> : null}
            </span>
          </>
        ),
        action: <RowLink href="/invoices" label="Nudge" icon={<FileText size={13} aria-hidden="true" />} />,
      })
    }

    out.sort((a, b) => b.urgency - a.urgency)
    return out.slice(0, 3)
  }, [offTrack, nextCall, oldest, now, format])

  // ── Loading: a calm placeholder, no trace (the signature stays scarce). ──
  if (loading || now == null) {
    return (
      <section aria-label="Needs you" className={className} style={shellStyle(false)}>
        <ZoneLabel />
        <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
          {[0, 1].map(n => (
            <div key={n} className="tahi-shimmer" style={{ height: '2.75rem', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      </section>
    )
  }

  // ── Empty: one calm seasonal line + optional "Next:" + a self-drawing leaf. ──
  if (rows.length === 0) {
    return (
      <section aria-label="Needs you" className={className} style={shellStyle(false)}>
        <ZoneLabel />
        <div className="flex items-center" style={{ gap: 'var(--space-2-5)' }}>
          <LeafGlyph />
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text)', lineHeight: 1.55 }}>
            All quiet in the studio.
            {nextCall && (
              <span style={{ color: 'var(--color-text-subtle)' }}>
                {' '}Next: <span data-private style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{nextCall.call.withName ?? nextCall.call.title}</span>
                {' at '}
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(nextCall.call.scheduledAt, undefined)}</span>
              </span>
            )}
          </p>
        </div>
      </section>
    )
  }

  // ── Populated: the single border-trace lives here. ──
  return (
    <section
      aria-label="Needs you"
      className={['tahi-border-trace', className].filter(Boolean).join(' ')}
      style={shellStyle(true)}
    >
      <ZoneLabel />
      <ul className="flex flex-col" style={{ gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map(r => (
          <li key={r.key}>
            <NeedsYouRow tone={r.tone} body={r.body} action={r.action} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

const SR_PREFIX: Partial<Record<Tone, string>> = {
  danger: 'Urgent: ',
  warning: 'Warning: ',
}

function NeedsYouRow({ tone, body, action }: { tone: Tone; body: React.ReactNode; action: React.ReactNode }) {
  const prefix = SR_PREFIX[tone]
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center"
      style={{
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        minHeight: '2.75rem',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '50%',
          flexShrink: 0,
          background: TONE_COLOR[tone],
        }}
      />
      <p
        className="flex-1"
        style={{ minWidth: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text)', lineHeight: 1.4 }}
      >
        {prefix && <span className="sr-only">{prefix}</span>}
        {body}
      </p>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

// ─── Action buttons (one verb each, >=44px tap target) ────────────────────────

const actionStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-1-5)',
  minHeight: '2.75rem',
  padding: 'var(--space-1-5) var(--space-3-5, 0.875rem)',
  background: 'var(--color-bg)',
  color: 'var(--color-link)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-leaf-sm)',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

function RowLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="tahi-press needs-you-action" style={actionStyle}>
      {icon}
      {label}
    </Link>
  )
}

function RowExternal({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tahi-press needs-you-action" style={actionStyle}>
      {label}
      {icon}
    </a>
  )
}

// ─── Zone label (letterpress 11px, replaces the icon-chip header) ─────────────

function ZoneLabel() {
  return (
    <p
      style={{
        fontSize: 'var(--text-2xs, 0.6875rem)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: 'var(--space-3)',
      }}
    >
      Needs you
    </p>
  )
}

// ─── Self-drawing leaf glyph (the empty-state's calm seal) ────────────────────

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
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 700ms var(--ease-productive)'
    el.style.strokeDashoffset = '0'
  }, [])
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
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

// ─── Style + helpers ──────────────────────────────────────────────────────────

const TONE_COLOR: Record<Tone, string> = {
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  brand: 'var(--color-brand)',
}

// Urgency bands keep the three sources on one scale: overdue invoices and
// imminent calls always outrank an off-track engagement, and within each band
// the more-overdue / sooner item sorts first.
const URGENCY_INVOICE_BASE = 2_000_000
const URGENCY_CALL_BASE = 1_000_000
const URGENCY_OFF_TRACK_BASE = 0

const SEVERITY: Record<DeliveryStatus, number> = {
  blocked: 5,
  delayed: 4,
  at_risk: 3,
  in_progress: 2,
  not_started: 1,
  done: 0,
}

function shellStyle(populated: boolean): React.CSSProperties {
  return {
    background: 'var(--color-bg)',
    // The populated trace class supplies its own border; the calm states use
    // the standard subtle hairline so the signature trace stays scarce.
    border: populated ? undefined : '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
  }
}

function fmtTime(iso: string, tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-NZ', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(tz ? { timeZone: tz } : {}),
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
