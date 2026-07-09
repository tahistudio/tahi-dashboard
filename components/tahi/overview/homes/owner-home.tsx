'use client'

/**
 * owner-home.tsx - the OWNER (admin / super-admin) role home for the rebuilt
 * Studio Ledger overview. Ported from the Claude Design `overview.jsx`
 * OwnerHome, rendered entirely through the shared OVKit primitives
 * (ov-kit.tsx) and wired to REAL, currency-aware routes via useResource.
 *
 * Structure (design order): masthead (TheWire, MRR forest Hero + Spark +
 * NewMenu, Vitals, NeedsYou + DailyBrief) then zones Books -> Ahead -> Work
 * -> Clients -> Growth.
 *
 * Honest empties per the owner audit: Social omits the unbacked "reach" stat;
 * Cash runway uses a horizon strip (no monthly cash series exists); Pipeline
 * omits the fabricated forecast sparkline; every trend chip with no real
 * prior-period source is dropped rather than invented. Every money figure
 * formats through useOvFormat (never a hardcoded FX rate).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import type { OverviewCtx } from '@/components/tahi/overview/ctx'
import {
  Icon,
  useOvFormat,
  useNow,
  Spark,
  Ribbon,
  Gauge,
  MicroBar,
  Card,
  CardH,
  Row,
  NewMenu,
  Hero,
  Vitals,
  NeedsYou,
  TheWire,
  Zone,
} from '@/components/tahi/overview/ov-kit'
import type {
  WireEvent,
  NeedItem,
  VitalItem,
  MicroBarSegment,
  NewMenuItem,
} from '@/components/tahi/overview/ov-kit'

/* ============================================================ shared types */

interface OverviewData {
  kpis: {
    activeClients: number
    openRequests: number
    inProgress: number
    outstandingInvoicesNzd?: number
    outstandingInvoicesCount?: number
    overdueInvoicesCount?: number
    mrr?: number
  }
  mrrDeltaPct?: number | null
  recentRequests: RecentRequest[]
  monthlyRevenue: { month: string; total: number }[]
  cash: { totalNzd: number; runwayMonths: number | null; burnNzd: number } | null
  arAging: ArAging | null
  activeTimer: { running: boolean; label: string | null }
  openByStatus: Record<string, number>
  clientsByPlan: Record<string, number>
}

interface ArAging {
  currentNzd: number
  d30Nzd: number
  d60Nzd: number
  d90Nzd: number
  totalNzd: number
  oldest: { clientName: string | null; daysPastDue: number; amountNzd: number } | null
}

interface RecentRequest {
  id: string
  title: string
  status: string
  orgName: string | null
  updatedAt: string | null
}

interface WireRow {
  id: string
  type: string
  text: string
  at: string
}

interface BriefRow {
  tone: 'risk' | 'warn' | 'ok' | ''
  verb: string | null
  to: string
  text: string
}
interface BriefData {
  urgent: BriefRow[]
  week: BriefRow[]
  slept: BriefRow[]
}

interface OffTrack {
  orgId: string
  orgName: string
  status: string
  offTrackCount: number
}
interface UpcomingCall {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
  withName: string | null
}

/* ============================================================ helpers */

// Per-domain ink for the wire dot. The wire route's event.type maps to the
// same --domain-* tokens the-wire.tsx uses, so dark mode swaps them for free.
const DOMAIN_INK: Record<string, string> = {
  content: 'var(--domain-content)',
  social: 'var(--domain-social)',
  sales: 'var(--domain-sales)',
  money: 'var(--domain-money)',
  client: 'var(--domain-clients)',
  ops: 'var(--domain-ops)',
}

const STATUS_DOT: Record<string, string> = {
  submitted: 'var(--brand)',
  in_review: '#C9A227',
  in_progress: '#2A6FDB',
  client_review: '#C9A227',
  on_hold: '#6D4FA3',
  delivered: '#5A824E',
  cancelled: 'var(--text-faint)',
  draft: 'var(--text-faint)',
}
const STATUS_LABEL: Record<string, string> = {
  submitted: 'Queued',
  in_review: 'In review',
  in_progress: 'In build',
  client_review: 'Client review',
  on_hold: 'On hold',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  draft: 'Draft',
}

function relTime(iso: string | null, nowMs: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, nowMs - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h'
  const d = Math.floor(h / 24)
  return d + 'd'
}

function fmtCountdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h > 0 ? `${h}h ${mm}m` : `${mm} min`
}

function shortMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-NZ', { month: 'short', timeZone: 'UTC' })
}

function initials(s: string | null): string {
  const t = (s ?? '?').trim()
  const parts = t.split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Message bodies are stored as Tiptap (HTML or JSON). Reduce either to a short
// plain-text snippet for the card preview so raw <p> tags never show.
function plainSnippet(body: string | null | undefined, max = 90): string {
  if (!body) return ''
  let text = body.trim()
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const collected: string[] = []
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        const n = node as { text?: unknown; content?: unknown }
        if (typeof n.text === 'string') collected.push(n.text)
        if (Array.isArray(n.content)) n.content.forEach(walk)
      }
      walk(JSON.parse(text))
      text = collected.join(' ')
    } catch {
      // fall through to tag stripping
    }
  }
  text = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

// Buckets `count` timestamps into `weeks` trailing 7-day windows (oldest first).
function weeklyBuckets(isos: (string | null)[], weeks: number): number[] {
  const now = Date.now()
  const week = 7 * 24 * 60 * 60 * 1000
  const arr = new Array<number>(weeks).fill(0)
  for (const iso of isos) {
    if (!iso) continue
    const t = Date.parse(iso)
    if (Number.isNaN(t) || t > now) continue
    const ago = Math.floor((now - t) / week)
    if (ago < 0 || ago >= weeks) continue
    arr[weeks - 1 - ago] += 1
  }
  return arr
}

function Shim({ h = 44 }: { h?: number }) {
  return <div className="tahi-shimmer" style={{ height: h, borderRadius: 10, background: 'var(--bg-secondary)' }} />
}
function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="ov-mini" style={{ lineHeight: 1.55 }}>{children}</p>
}

/* ============================================================ OwnerHome */

export function OwnerHome({ ctx }: { ctx: OverviewCtx }) {
  const go = ctx.go
  const ro = ctx.isReadOnly
  const { money, moneyCompact } = useOvFormat()
  const { data: ov } = useResource<OverviewData>('/api/admin/overview')

  const newItems: NewMenuItem[] = [
    { ic: 'request', label: 'New request', go: () => go('requests') },
    { ic: 'users', label: 'Add client', go: () => go('clients') },
    { ic: 'clock', label: 'Log time', go: () => go('time') },
  ]

  // ── Hero: MRR forest gradient + 12-month spark + New menu ──
  const kpis = ov?.kpis
  const mrr = kpis?.mrr
  const series = ov?.monthlyRevenue ?? []
  // mrrDeltaPct compares invoiced revenue month-over-month; when the current
  // month has no invoiced revenue yet (common early in the month, or on a fresh
  // workspace) that reads as a misleading -100%, so only surface the delta when
  // there is real current-month revenue to compare against.
  const currentMonthTotal = series[series.length - 1]?.total ?? 0
  const delta = currentMonthTotal > 0 ? ov?.mrrDeltaPct : null
  const heroFigure =
    series.length >= 2 ? (
      <Spark
        data={series.map(m => m.total)}
        labels={series.map(m => shortMonth(m.month))}
        format={v => moneyCompact(v)}
        color="rgba(255,255,255,.9)"
        fillColor="#ffffff"
        endDot
        h={56}
      />
    ) : undefined

  return (
    <div className="ov" data-ro={ro ? '1' : '0'}>
      <div className="ov-mast">
        <WireStrip />

        <Hero
          variant="forest"
          label="Monthly recurring revenue"
          value={mrr != null ? mrr : <span style={{ fontSize: 34 }}>&middot;</span>}
          format={v => money(v)}
          sub={mrr != null ? (delta != null ? 'vs last month' : 'this month') : 'MRR not configured'}
          delta={mrr != null && delta != null ? `${Math.abs(delta)}%` : undefined}
          deltaDir={delta != null && delta < 0 ? 'down' : 'up'}
          action={<NewMenu items={newItems} ro={ro} variant="hero" />}
          figure={heroFigure}
        />

        <VitalsStrip ov={ov} moneyCompact={moneyCompact} />

        <div className="ov-topstack">
          <NeedsYouBlock go={go} ro={ro} oldest={ov?.arAging?.oldest ?? null} />
          <DailyBrief go={go} ro={ro} />
        </div>
      </div>

      <Zone label="Books">
        <TakeHomeInk />
        <CashRunway cash={ov?.cash ?? null} loading={!ov} go={go} />
        <CashFlowRibbon go={go} />
        <Receivables arAging={ov?.arAging ?? null} loading={!ov} />
      </Zone>

      <Zone label="Ahead">
        <PipelineAhead go={go} />
        <StudioCapacity go={go} />
        <HotLeads go={go} />
        <ProposalsLive go={go} />
      </Zone>

      <Zone label="Work">
        <InTheStudio requests={ov?.recentRequests} loading={!ov} go={go} />
        <TodaysCalls go={go} />
        <UnreadMessages go={go} />
        <Worklog go={go} />
      </Zone>

      <Zone label="Clients">
        <RetainerHealth go={go} />
        <Contracts go={go} />
      </Zone>

      <Zone label="Growth">
        <ContentEngine go={go} />
        <SocialCadence go={go} />
        <Reviews go={go} />
        <DocsHub go={go} />
      </Zone>
    </div>
  )
}

/* ============================================================ masthead parts */

function WireStrip() {
  const nowMs = useNow().getTime()
  const { data } = useResource<{ events?: WireRow[] }>('/api/admin/overview/wire')
  const events: WireEvent[] = (data?.events ?? []).map(e => ({
    color: DOMAIN_INK[e.type] ?? 'var(--brand)',
    who: '',
    what: e.text,
    when: relTime(e.at, nowMs),
  }))
  return <TheWire events={events} />
}

function agedBar(a: ArAging): MicroBarSegment[] {
  return [
    { v: a.currentNzd, color: '#5A824E' },
    { v: a.d30Nzd, color: '#C9A227' },
    { v: a.d60Nzd + a.d90Nzd, color: '#C0392E' },
  ]
}

function VitalsStrip({
  ov,
  moneyCompact,
}: {
  ov: OverviewData | undefined
  moneyCompact: (nzd: number) => string
}) {
  const kpis = ov?.kpis
  const cash = ov?.cash ?? null
  const ar = ov?.arAging ?? null

  // Cash: runway-horizon fill bar (real, derived from runwayMonths).
  const runway = cash?.runwayMonths ?? null
  const cashBar: MicroBarSegment[] | undefined =
    runway != null
      ? [
          { v: Math.min(runway, 12), color: 'var(--brand)' },
          { v: Math.max(0, 12 - Math.min(runway, 12)), color: 'var(--bg-tertiary)' },
        ]
      : undefined

  // Clients: plan split from clientsByPlan.
  const plans = Object.entries(ov?.clientsByPlan ?? {})
  const planColors = ['var(--brand)', '#93c98a', '#2A6FDB', '#C9A227']
  const planBar: MicroBarSegment[] | undefined =
    plans.length > 0 ? plans.map(([, v], i) => ({ v, color: planColors[i % planColors.length] })) : undefined
  const planSub = plans.length > 0 ? plans.map(([k, v]) => `${v} ${titleCase(k)}`).join(' · ') : 'active clients'

  // Open: building / review / queued split from openByStatus.
  const obs = ov?.openByStatus ?? {}
  const building = obs['in_progress'] ?? 0
  const review = (obs['in_review'] ?? 0) + (obs['client_review'] ?? 0)
  const openTotal = kpis?.openRequests ?? 0
  const queued = Math.max(0, openTotal - building - review)
  const openBar: MicroBarSegment[] = [
    { v: building, color: '#2A6FDB' },
    { v: review, color: '#C9A227' },
    { v: queued, color: 'var(--bg-tertiary)' },
  ]

  const owed = kpis?.outstandingInvoicesNzd

  const items: VitalItem[] = [
    {
      lbl: 'Cash',
      num: cash ? moneyCompact(cash.totalNzd) : '·',
      muted: !cash,
      bar: cashBar,
      sub: runway != null ? `${runway.toFixed(1)} months runway` : 'runway not available',
    },
    {
      lbl: 'Owed',
      num: owed != null ? moneyCompact(owed) : '·',
      muted: owed == null,
      bar: ar ? agedBar(ar) : undefined,
      sub:
        owed != null
          ? `${kpis?.outstandingInvoicesCount ?? 0} invoices · ${kpis?.overdueInvoicesCount ?? 0} overdue`
          : 'not available',
    },
    {
      lbl: 'Clients',
      num: kpis ? String(kpis.activeClients) : '·',
      muted: !kpis,
      bar: planBar,
      sub: planSub,
    },
    {
      lbl: 'Open',
      num: kpis ? String(kpis.openRequests) : '·',
      muted: !kpis,
      bar: kpis ? openBar : undefined,
      sub: kpis
        ? `${building} building · ${review} review · ${queued} queued`
        : 'requests',
    },
  ]
  return <Vitals items={items} />
}

function NeedsYouBlock({
  go,
  ro,
  oldest,
}: {
  go: (id: string) => void
  ro: boolean
  oldest: { clientName: string | null; daysPastDue: number; amountNzd: number } | null
}) {
  const { money } = useOvFormat()
  const nowMs = useNow().getTime()
  const { data: offData } = useResource<{ engagements?: OffTrack[] }>('/api/admin/engagements/off-track')
  const { data: callData } = useResource<{ calls?: UpcomingCall[] }>(
    '/api/admin/discovery-calls/upcoming?limit=5&includePast=1',
  )
  const items = useMemo<NeedItem[]>(() => {
    const off = offData?.engagements ?? []
    const calls = callData?.calls ?? []
    const scored: { u: number; item: NeedItem }[] = []

    if (oldest && oldest.daysPastDue > 0) {
      scored.push({
        u: 2_000_000 + oldest.daysPastDue,
        item: {
          tone: 'money',
          ic: 'receipt',
          title: `${oldest.clientName ?? 'A client'} invoice overdue`,
          sub: `${money(oldest.amountNzd)} · ${oldest.daysPastDue} days past due`,
          verb: 'Nudge',
          onAct: () => go('invoices'),
        },
      })
    }

    let best: { c: UpcomingCall; at: number } | null = null
    for (const c of calls) {
      const at = new Date(c.scheduledAt).getTime()
      if (!Number.isFinite(at) || at < nowMs) continue
      if (!best || at < best.at) best = { c, at }
    }
    if (best) {
      const delta = best.at - nowMs
      if (delta <= 2 * 60 * 60 * 1000) {
        const c = best.c
        scored.push({
          u: 1_000_000 + (2 * 60 * 60 * 1000 - delta),
          item: {
            tone: 'call',
            ic: 'phone',
            title: c.withName ?? c.title,
            sub: `in ${fmtCountdown(delta)}`,
            verb: 'Join',
            onAct: () => (c.meetingUrl ? window.open(c.meetingUrl, '_blank', 'noopener') : go('calls')),
          },
        })
      }
    }

    for (const e of off) {
      const sev = e.status === 'blocked' ? 500 : e.status === 'delayed' ? 400 : 300
      scored.push({
        u: sev + Math.min(e.offTrackCount, 50),
        item: {
          tone: 'work',
          ic: 'chart',
          title: `${e.orgName} engagement off-track`,
          sub: `${e.offTrackCount} ${e.offTrackCount === 1 ? 'phase' : 'phases'} off track`,
          verb: 'Reschedule',
          onAct: () => go('clients'),
        },
      })
    }

    scored.sort((a, b) => b.u - a.u)
    return scored.map(s => s.item)
  }, [offData, callData, oldest, nowMs, money, go])

  return <NeedsYou items={items} ro={ro} onMore={() => go('requests')} />
}

function DailyBrief({ go, ro }: { go: (id: string) => void; ro: boolean }) {
  const { data, mutate } = useResource<BriefData & { generatedAt?: string }>('/api/admin/overview/brief')
  const [mounted, setMounted] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({ urgent: true, week: false, slept: false })
  useEffect(() => setMounted(true), [])

  const urgent = data?.urgent ?? []
  const week = data?.week ?? []
  const slept = data?.slept ?? []

  // The brief is computed once per morning and cached; POST /refresh?force=1
  // regenerates on demand, then we revalidate to pull the fresh cache.
  const onRefresh = useCallback(async () => {
    if (ro || refreshing) return
    setRefreshing(true)
    try {
      await fetch(apiPath('/api/admin/overview/brief/refresh?force=1'), { method: 'POST' })
      await mutate()
    } catch {
      /* network error - leave the existing brief in place */
    } finally {
      setRefreshing(false)
    }
  }, [ro, refreshing, mutate])

  // "Updated 3h ago" style relative label off the cached generatedAt stamp.
  // Guarded on `mounted` so Date.now() never runs during SSR hydration.
  const rel = mounted && data?.generatedAt ? relTime(data.generatedAt, Date.now()) : ''
  const updatedStr = !rel ? '' : rel === 'just now' ? 'Updated just now' : `Updated ${rel} ago`

  const sections: { key: string; lbl: string; tone: string; rows: BriefRow[] }[] = [
    { key: 'urgent', lbl: 'Urgent today', tone: 'risk', rows: urgent },
    { key: 'week', lbl: 'This week, before they bite', tone: 'warn', rows: week },
    { key: 'slept', lbl: 'While you slept', tone: '', rows: slept },
  ]

  const timeStr = mounted
    ? new Date().toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' }) +
      ' · ' +
      new Date().toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
    : ''

  const lede =
    urgent.length + week.length === 0
      ? 'All clear. Nothing is waiting on you right now.'
      : `${urgent.length} ${urgent.length === 1 ? 'thing needs' : 'things need'} you today, ${week.length} this week.`

  return (
    <div className="ov-brief">
      <div className="ov-brief-h">
        <h3>Daily brief</h3>
        {timeStr && <span className="ov-brief-time">{timeStr}</span>}
        {updatedStr && (
          <span style={{ font: "500 11.5px 'Manrope',sans-serif", color: 'var(--text-faint)' }}>{updatedStr}</span>
        )}
        {!ro && (
          <button
            type="button"
            className="bs-act"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh daily brief"
            title="Refresh daily brief"
          >
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        )}
      </div>
      <p className="ov-brief-lede">{lede}</p>
      <div className="ov-brief-accs">
        {sections.map(s => {
          const isOpen = !!open[s.key]
          return (
            <div className={'ov-acc' + (isOpen ? ' open' : '')} key={s.key}>
              <button
                className="ov-acc-h"
                onClick={() => setOpen(o => ({ ...o, [s.key]: !o[s.key] }))}
                aria-expanded={isOpen}
              >
                <span className={'ov-acc-count' + (s.tone ? ' ' + s.tone : '')}>{s.rows.length}</span>
                <span className="ov-acc-lbl">{s.lbl}</span>
                <span className="ov-acc-chev">
                  <Icon n="chevron" s={14} />
                </span>
              </button>
              <div className="ov-acc-body" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
                <div className="ov-acc-inner">
                  {s.rows.length === 0 ? (
                    <div className="bs-row">
                      <span className="bs-dot" />
                      <span className="bs-txt">Nothing here right now.</span>
                    </div>
                  ) : (
                    s.rows.map((r, i) => (
                      <div className="bs-row" key={i}>
                        <span className={'bs-dot' + (r.tone && r.tone !== 'ok' ? ' ' + r.tone : '')} />
                        <span className="bs-txt">{r.text}</span>
                        {r.verb && (
                          <button className="bs-act" onClick={() => go(r.to)}>
                            {r.verb}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ============================================================ Books zone */

interface SummaryData {
  disposableCash?: number
  reserves?: { total: number; items: { id: string; name: string; category: string | null; accruedAmount: number }[] }
  bankBalances?: { currency: string }[]
}

function TakeHomeInk() {
  const { money, moneyCompact } = useOvFormat()
  const { data, error } = useResource<SummaryData>('/api/admin/financial-reports/summary')

  const disposable = data?.disposableCash ?? 0
  const reservesTotal = data?.reserves?.total ?? 0
  const total = disposable + reservesTotal
  const takeHomePct = total > 0 ? Math.round((disposable / total) * 100) : 0
  const pots = (data?.reserves?.items ?? []).slice(0, 3)
  const hasData = !!data && !error && total > 0

  return (
    <Card span={5} tone="ink">
      <CardH ic="wallet" title="Take-home" />
      {!data && !error ? (
        <Shim h={120} />
      ) : !hasData ? (
        <EmptyLine>Connect your finances to see take-home and reserves.</EmptyLine>
      ) : (
        <>
          <div className="ov-gauge-wrap">
            <Gauge value={takeHomePct} max={100} size={112} />
            <div className="ov-gauge-legend">
              <div>
                <b style={{ color: 'var(--text)', font: '700 17px Manrope' }}>{moneyCompact(disposable)}</b>
                <div className="ov-mini">disposable this month</div>
              </div>
              <div className="ov-mini lg-row">
                <span>
                  <i style={{ background: 'var(--brand)' }} />
                  Take-home
                </span>
                <b>{takeHomePct}%</b>
              </div>
              <div className="ov-mini lg-row">
                <span>
                  <i style={{ background: 'var(--bg-tertiary)' }} />
                  Tax + reserves
                </span>
                <b>{100 - takeHomePct}%</b>
              </div>
            </div>
          </div>
          {pots.length > 0 && (
            <div className="ov-subrows">
              {pots.map(p => (
                <div className="ov-subrow" key={p.id}>
                  <span>{p.name}</span>
                  <b>{money(p.accruedAmount)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function HorizonStrip({ runway }: { runway: number | null }) {
  const months = 12
  const clamped = runway === null ? 0 : Math.max(0, Math.min(runway, months))
  const pct = (clamped / months) * 100
  return (
    <div style={{ marginTop: 'auto', paddingTop: 14 }} aria-hidden="true">
      <div style={{ position: 'relative', height: 2, borderRadius: 9999, background: 'var(--border-subtle)' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: 'var(--brand)',
            borderRadius: 9999,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {Array.from({ length: months }, (_, i) => {
          const filled = i < Math.round(clamped)
          return (
            <span
              key={i}
              style={{
                width: i === 0 || i === months - 1 ? 3 : 2,
                height: i === 0 || i === months - 1 ? 7 : 5,
                borderRadius: 9999,
                background: filled ? 'var(--brand)' : 'var(--border-strong)',
                opacity: filled ? 1 : 0.5,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function CashRunway({
  cash,
  loading,
  go,
}: {
  cash: { totalNzd: number; runwayMonths: number | null; burnNzd: number } | null
  loading: boolean
  go: (id: string) => void
}) {
  const { moneyCompact } = useOvFormat()
  return (
    <Card span={7}>
      <CardH ic="chart" title="Cash runway" link="Open books" onLink={() => go('financialreports')} />
      {loading ? (
        <Shim h={90} />
      ) : !cash ? (
        <EmptyLine>Connect Xero to see runway.</EmptyLine>
      ) : (
        <>
          <div className="ov-statrow" style={{ marginBottom: 14 }}>
            <div className="ov-stat">
              <div className="st-num">{moneyCompact(cash.totalNzd)}</div>
              <div className="st-lbl">in the bank</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">
                {cash.runwayMonths != null ? cash.runwayMonths.toFixed(1) : '·'}
                <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>mo</span>
              </div>
              <div className="st-lbl">runway at burn</div>
            </div>
          </div>
          <HorizonStrip runway={cash.runwayMonths} />
        </>
      )}
    </Card>
  )
}

interface CashFlowData {
  months?: { month: string; net: number }[]
}
function CashFlowRibbon({ go }: { go: (id: string) => void }) {
  const { moneyCompact } = useOvFormat()
  const { data } = useResource<CashFlowData>('/api/admin/reports/cash-flow-forecast?months=12')
  const months = useMemo(() => data?.months ?? [], [data])
  const xLabels = useMemo(() => {
    if (months.length === 0) return []
    const step = Math.max(1, Math.ceil(months.length / 6))
    return months.filter((_, i) => i % step === 0).map(m => shortMonth(m.month))
  }, [months])

  return (
    <Card span={7}>
      <CardH ic="chart" title="Cash-flow ribbon" link="Open books" onLink={() => go('financialreports')} />
      {!data ? (
        <Shim h={64} />
      ) : months.length < 1 ? (
        <EmptyLine>Add MRR, pipeline and commitments to project cash flow.</EmptyLine>
      ) : (
        <>
          <Ribbon
            data={months.map(m => m.net)}
            labels={months.map(m => shortMonth(m.month))}
            format={v => (v >= 0 ? '+' : '-') + moneyCompact(Math.abs(v))}
            grow
          />
          <div className="ov-ribbon-x">
            {xLabels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function Receivables({ arAging, loading }: { arAging: ArAging | null; loading: boolean }) {
  const { money } = useOvFormat()
  const overdue = arAging ? arAging.d30Nzd + arAging.d60Nzd + arAging.d90Nzd : 0
  const healthy = !arAging || arAging.totalNzd <= 0
  return (
    <Card span={5} edge="risk">
      <CardH ic="receipt" title="Receivables" />
      {loading ? (
        <Shim h={80} />
      ) : healthy ? (
        <EmptyLine>Nothing outstanding right now.</EmptyLine>
      ) : (
        <>
          <div className="ov-statrow">
            <div className="ov-stat">
              <div className="st-num">{money(arAging!.totalNzd)}</div>
              <div className="st-lbl">outstanding</div>
            </div>
          </div>
          <MicroBar segs={agedBar(arAging!)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }} className="ov-mini">
            <span>Current {money(arAging!.currentNzd)}</span>
            <span style={{ color: '#C0392E' }}>Overdue {money(overdue)}</span>
          </div>
        </>
      )}
    </Card>
  )
}

/* ============================================================ Ahead zone */

interface DealRow {
  id: string
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  expectedCloseDate: string | null
}
interface PipelineForecast {
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
}

function PipelineAhead({ go }: { go: (id: string) => void }) {
  const { moneyCompact } = useOvFormat()
  const { data: dealsData } = useResource<{ items: DealRow[] }>('/api/admin/deals?limit=100')
  const { data: forecast } = useResource<PipelineForecast>('/api/admin/reports/pipeline-forecast')
  const loading = !dealsData || !forecast
  const deals = dealsData?.items ?? []
  const open = deals.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost)

  const now = new Date()
  const closing = open.filter(d => {
    if (!d.expectedCloseDate) return false
    const c = new Date(d.expectedCloseDate)
    return c.getMonth() === now.getMonth() && c.getFullYear() === now.getFullYear()
  }).length
  const weighted = forecast ? forecast.weightedUpfrontNzd + forecast.weightedMonthlyNzd * 12 : 0

  return (
    <Card span={7}>
      <CardH ic="funnel" title="Pipeline ahead" link="View pipeline" onLink={() => go('deals')} />
      {loading ? (
        <Shim h={70} />
      ) : open.length === 0 && weighted <= 0 ? (
        <EmptyLine>No deals in the pipeline yet.</EmptyLine>
      ) : (
        <div className="ov-statrow">
          <div className="ov-stat">
            <div className="st-num">{moneyCompact(weighted)}</div>
            <div className="st-lbl">weighted</div>
          </div>
          <div className="ov-stat">
            <div className="st-num">{open.length}</div>
            <div className="st-lbl">open deals</div>
          </div>
          <div className="ov-stat">
            <div className="st-num">{closing}</div>
            <div className="st-lbl">closing this month</div>
          </div>
        </div>
      )}
    </Card>
  )
}

interface CapacityMember {
  id: string
  name: string
  utilization: number
}
interface CapacityData {
  teamMembers: CapacityMember[]
  totalCapacity: number
  totalAllocated: number
  availableCapacity: number
}

function StudioCapacity({ go }: { go: (id: string) => void }) {
  const { data } = useResource<CapacityData>('/api/admin/pipeline/capacity')
  const members = data?.teamMembers ?? []
  const util =
    data && data.totalCapacity > 0 ? Math.round((data.totalAllocated / data.totalCapacity) * 100) : 0

  return (
    <Card span={5}>
      <CardH ic="gauge" title="Studio capacity" link="Capacity" onLink={() => go('capacity')} />
      {!data ? (
        <Shim h={120} />
      ) : members.length === 0 ? (
        <EmptyLine>No one in the studio yet.</EmptyLine>
      ) : (
        <>
          <div className="ov-gauge-wrap">
            <Gauge value={util} max={100} size={112} color="#B0761F" />
            <div className="ov-gauge-legend">
              <div>
                <b style={{ color: 'var(--text)', font: '700 17px Manrope' }}>{util}%</b>
                <div className="ov-mini">booked capacity</div>
              </div>
              <div className="ov-mini lg-row">
                <span>
                  <i style={{ background: '#B0761F' }} />
                  Allocated
                </span>
                <b>{Math.round(data.totalAllocated)}h</b>
              </div>
              <div className="ov-mini lg-row">
                <span>
                  <i style={{ background: 'var(--bg-tertiary)' }} />
                  Available
                </span>
                <b>{Math.round(data.availableCapacity)}h</b>
              </div>
            </div>
          </div>
          <div className="ov-subrows">
            {members.slice(0, 4).map(m => {
              const u = Math.max(0, Math.round(m.utilization))
              return (
                <div className="ov-subrow" key={m.id}>
                  <span style={{ flex: '0 0 52px' }}>{m.name.trim().split(/\s+/)[0]}</span>
                  <span className="ov-meter" style={{ flex: 1 }}>
                    <i style={{ width: `${Math.min(100, u)}%` }} />
                  </span>
                  <b>{u}%</b>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

interface Lead {
  id: string
  name: string | null
  company: string | null
  source: string | null
  aiScore: number | null
  status: string | null
}
function leadChip(score: number | null): ReactNode {
  if (score == null) return undefined
  if (score >= 80) return <span className="ov-chip brand">Hot</span>
  if (score >= 60) return <span className="ov-chip warn">Warm</span>
  return <span className="ov-chip muted">{Math.round(score)}</span>
}
function HotLeads({ go }: { go: (id: string) => void }) {
  const { data } = useResource<{ leads: Lead[] }>('/api/admin/leads?status=new')
  const leads = useMemo(
    () => [...(data?.leads ?? [])].sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0)),
    [data],
  )
  const warm = leads.filter(l => (l.aiScore ?? 0) >= 60).length

  return (
    <Card span={6}>
      <CardH
        ic="spark"
        title="Hot leads"
        badge={warm > 0 ? <span className="ov-chip warn">{warm} warm</span> : undefined}
        link="All leads"
        onLink={() => go('leads')}
      />
      {!data ? (
        <Shim h={90} />
      ) : leads.length === 0 ? (
        <EmptyLine>No fresh leads in the queue.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {leads.slice(0, 3).map(l => (
            <Row
              key={l.id}
              avText={initials(l.name || l.company)}
              title={l.name || l.company || 'Unnamed lead'}
              sub={[l.source ? titleCase(l.source.replace(/_/g, ' ')) : 'Lead', l.status].filter(Boolean).join(' · ')}
              right={leadChip(l.aiScore)}
              onClick={() => go('leads')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

interface ProposalRow {
  id: string
  title: string | null
  orgName: string | null
  dealTitle: string | null
  status: string | null
  publicSharedAt: string | null
}
function proposalChip(status: string | null): ReactNode {
  switch (status) {
    case 'accepted':
      return <span className="ov-chip brand">Accepted</span>
    case 'shared':
      return <span className="ov-chip info">Out</span>
    case 'declined':
      return <span className="ov-chip rose">Declined</span>
    case 'expired':
      return <span className="ov-chip muted">Expired</span>
    default:
      return <span className="ov-chip muted">Draft</span>
  }
}
function ProposalsLive({ go }: { go: (id: string) => void }) {
  const nowMs = useNow().getTime()
  const { data } = useResource<{ items: ProposalRow[] }>('/api/admin/proposals')
  const rows = useMemo(() => {
    const items = data?.items ?? []
    return [...items].sort((a, b) => {
      const at = a.publicSharedAt ? Date.parse(a.publicSharedAt) : 0
      const bt = b.publicSharedAt ? Date.parse(b.publicSharedAt) : 0
      return bt - at
    })
  }, [data])

  return (
    <Card span={6}>
      <CardH ic="file" title="Proposals live" link="All proposals" onLink={() => go('proposals')} />
      {!data ? (
        <Shim h={90} />
      ) : rows.length === 0 ? (
        <EmptyLine>No proposals yet.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {rows.slice(0, 3).map(p => (
            <Row
              key={p.id}
              title={p.orgName || p.dealTitle || p.title || 'Proposal'}
              sub={p.publicSharedAt ? `Shared ${relTime(p.publicSharedAt, nowMs)} ago` : 'Draft'}
              right={proposalChip(p.status)}
              onClick={() => go('proposals')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

/* ============================================================ Work zone */

function InTheStudio({
  requests,
  loading,
  go,
}: {
  requests: RecentRequest[] | undefined
  loading: boolean
  go: (id: string) => void
}) {
  const nowMs = useNow().getTime()
  const rows = requests ?? []
  return (
    <Card span={7}>
      <CardH ic="tasks" title="In the studio" link="All requests" onLink={() => go('requests')} />
      {loading ? (
        <Shim h={120} />
      ) : rows.length === 0 ? (
        <EmptyLine>No active requests.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {rows.slice(0, 4).map(r => (
            <Row
              key={r.id}
              dot
              dotColor={STATUS_DOT[r.status] ?? 'var(--brand)'}
              title={r.orgName ? `${r.orgName} · ${r.title}` : r.title}
              sub={`updated ${relTime(r.updatedAt, nowMs)} ago`}
              right={STATUS_LABEL[r.status] ?? r.status}
              onClick={() => go('requests')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function TodaysCalls({ go }: { go: (id: string) => void }) {
  const nowMs = useNow().getTime()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { data } = useResource<{ calls: UpcomingCall[] }>('/api/admin/discovery-calls/upcoming?limit=5&includePast=1')

  const today = useMemo(() => {
    if (!mounted) return []
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = start.getTime() + 24 * 60 * 60 * 1000
    return (data?.calls ?? []).filter(c => {
      const t = new Date(c.scheduledAt).getTime()
      return Number.isFinite(t) && t >= start.getTime() && t < end
    })
  }, [data, mounted])

  const shown = today.slice(0, 3)
  const later = today.length - shown.length

  function callTime(iso: string): string {
    const d = new Date(iso)
    return Number.isFinite(d.getTime())
      ? d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
      : ''
  }

  return (
    <Card span={5}>
      <CardH ic="phone" title="Today's calls" link="Calendar" onLink={() => go('calls')} />
      {!data || !mounted ? (
        <Shim h={90} />
      ) : today.length === 0 ? (
        <EmptyLine>No calls on the board today.</EmptyLine>
      ) : (
        <>
          <div className="ov-rows">
            {shown.map(c => {
              const at = new Date(c.scheduledAt).getTime()
              const live = Number.isFinite(at) && at - nowMs <= 10 * 60000 && nowMs <= at + c.durationMinutes * 60000
              return (
                <Row
                  key={c.id}
                  avText={initials(c.withName || c.title)}
                  title={c.withName ?? c.title}
                  sub={`${callTime(c.scheduledAt)} · ${c.durationMinutes} min`}
                  right={
                    c.meetingUrl && live ? (
                      <button
                        className="ov-cta"
                        style={{ height: 30, fontSize: 12, padding: '0 12px' }}
                        onClick={() => window.open(c.meetingUrl as string, '_blank', 'noopener')}
                      >
                        Join
                      </button>
                    ) : (
                      <span className="ov-mini">{callTime(c.scheduledAt)}</span>
                    )
                  }
                />
              )
            })}
          </div>
          {later > 0 && (
            <button className="ov-card-more" onClick={() => go('calls')}>
              +{later} later today
              <Icon n="arrow" s={12} />
            </button>
          )}
        </>
      )}
    </Card>
  )
}

interface Conversation {
  id: string
  orgName: string | null
  participantNames: string[]
  lastMessage: { body: string } | null
  unreadCount: number
}
function UnreadMessages({ go }: { go: (id: string) => void }) {
  const { data } = useResource<{ conversations: Conversation[] }>('/api/admin/conversations?unread=1&limit=3')
  const convs = data?.conversations ?? []
  return (
    <Card span={7}>
      <CardH ic="msg" title="Unread messages" link="All messages" onLink={() => go('messages')} />
      {!data ? (
        <Shim h={90} />
      ) : convs.length === 0 ? (
        <EmptyLine>No unread messages.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {convs.map(c => {
            const name = c.orgName || c.participantNames[0] || 'Conversation'
            return (
              <Row
                key={c.id}
                avText={initials(name)}
                title={name}
                sub={plainSnippet(c.lastMessage?.body) || 'New message'}
                right={<span className="ov-chip brand">{c.unreadCount}</span>}
                onClick={() => go('messages')}
              />
            )
          })}
        </div>
      )}
    </Card>
  )
}

interface WorklogMember {
  id: string
  name: string
  trackedHours: number
}
interface WorklogData {
  members: WorklogMember[]
  totalTracked: number
  billablePct: number
  avgPerPerson: number
}
function Worklog({ go }: { go: (id: string) => void }) {
  const { data } = useResource<WorklogData>('/api/admin/reports/worklog?range=week')
  const members = data?.members ?? []
  const maxTracked = Math.max(1, ...members.map(m => m.trackedHours))
  return (
    <Card span={5}>
      <CardH ic="clock" title="Worklog this week" link="Time" onLink={() => go('time')} />
      {!data ? (
        <Shim h={120} />
      ) : members.length === 0 ? (
        <EmptyLine>No hours logged this week.</EmptyLine>
      ) : (
        <>
          <div className="ov-statrow" style={{ marginBottom: 12, justifyContent: 'space-between', paddingRight: 6 }}>
            <div className="ov-stat">
              <div className="st-num">
                {data.totalTracked}
                <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>h</span>
              </div>
              <div className="st-lbl">tracked</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">{data.billablePct}%</div>
              <div className="st-lbl">billable</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">
                {data.avgPerPerson}
                <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>h</span>
              </div>
              <div className="st-lbl">avg / person</div>
            </div>
          </div>
          <div className="ov-subrows" style={{ marginTop: 0 }}>
            {members.slice(0, 4).map(m => (
              <div className="ov-subrow" key={m.id}>
                <span style={{ flex: '0 0 52px' }}>{m.name.trim().split(/\s+/)[0]}</span>
                <span className="ov-meter" style={{ flex: 1 }}>
                  <i style={{ width: `${Math.round((m.trackedHours / maxTracked) * 100)}%` }} />
                </span>
                <b>{m.trackedHours}h</b>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

/* ============================================================ Clients zone */

interface RetainerClient {
  orgId: string
  orgName: string
  churnRiskScore: number
  healthStatus: string | null
}
type HealthBucket = 'healthy' | 'atrisk' | 'attention'
function healthBucket(c: RetainerClient): HealthBucket {
  if (c.healthStatus === 'red' || c.churnRiskScore >= 60) return 'attention'
  if (c.healthStatus === 'amber' || c.churnRiskScore >= 35) return 'atrisk'
  return 'healthy'
}
function RetainerHealth({ go }: { go: (id: string) => void }) {
  const { data } = useResource<{ clients: RetainerClient[] }>('/api/admin/reports/retainer-health')
  const clients = data?.clients ?? []
  const healthy = clients.filter(c => healthBucket(c) === 'healthy').length
  const atRisk = clients.filter(c => healthBucket(c) === 'atrisk')
  const attention = clients.filter(c => healthBucket(c) === 'attention')
  const flagged = [...attention, ...atRisk]

  return (
    <Card span={7} edge="warn">
      <CardH ic="users" title="Retainer health" link="All clients" onLink={() => go('clients')} />
      {!data ? (
        <Shim h={120} />
      ) : clients.length === 0 ? (
        <EmptyLine>No retainer clients to watch yet.</EmptyLine>
      ) : (
        <>
          <div className="ov-healthsum">
            <span className="hs-seg">
              <i style={{ background: 'var(--brand)' }} />
              {healthy} healthy
            </span>
            <span className="hs-seg">
              <i style={{ background: '#B0761F' }} />
              {atRisk.length} at risk
            </span>
            <span className="hs-seg">
              <i style={{ background: '#C0392E' }} />
              {attention.length} needs attention
            </span>
          </div>
          {flagged.length > 0 && (
            <div className="ov-rows">
              {flagged.slice(0, 2).map(c => {
                const b = healthBucket(c)
                return (
                  <Row
                    key={c.orgId}
                    avText={initials(c.orgName)}
                    title={c.orgName}
                    sub={b === 'attention' ? 'Needs attention' : 'At risk'}
                    right={
                      b === 'attention' ? (
                        <span className="ov-chip rose">Attention</span>
                      ) : (
                        <span className="ov-chip warn">At risk</span>
                      )
                    }
                    onClick={() => go('clients')}
                  />
                )
              })}
            </div>
          )}
          {healthy > 0 && (
            <button className="ov-card-more" onClick={() => go('clients')}>
              {healthy} healthy {healthy === 1 ? 'client' : 'clients'} ticking along
              <Icon n="arrow" s={12} />
            </button>
          )}
        </>
      )}
    </Card>
  )
}

interface Contract {
  id: string
  name: string
  status: string
  orgName: string | null
  expiresAt: string | null
}
function Contracts({ go }: { go: (id: string) => void }) {
  const nowMs = useNow().getTime()
  const { data } = useResource<{ items: Contract[] }>('/api/admin/contracts')
  const items = data?.items ?? []
  const active = items.filter(c => c.status === 'signed').length
  const day = 24 * 60 * 60 * 1000
  const renewSoon = items.filter(c => {
    if (!c.expiresAt) return false
    const t = new Date(c.expiresAt).getTime()
    return Number.isFinite(t) && t - nowMs >= 0 && t - nowMs <= 30 * day
  })
  const awaiting = items.filter(c => c.status === 'sent' || c.status === 'draft')
  const rows = [...renewSoon, ...awaiting.filter(a => !renewSoon.some(r => r.id === a.id))].slice(0, 3)

  function chip(c: Contract): ReactNode {
    if (c.expiresAt) {
      const t = new Date(c.expiresAt).getTime()
      if (Number.isFinite(t) && t - nowMs >= 0 && t - nowMs <= 30 * day) return <span className="ov-chip warn">Soon</span>
    }
    if (c.status === 'sent') return <span className="ov-chip info">Out</span>
    if (c.status === 'draft') return <span className="ov-chip muted">Draft</span>
    return <span className="ov-chip muted">Ahead</span>
  }

  return (
    <Card span={5} edge="warn">
      <CardH ic="file" title="Contracts" link="All contracts" onLink={() => go('contracts')} />
      {!data ? (
        <Shim h={100} />
      ) : items.length === 0 ? (
        <EmptyLine>No contracts yet.</EmptyLine>
      ) : (
        <>
          <div className="ov-statrow" style={{ marginBottom: 12 }}>
            <div className="ov-stat">
              <div className="st-num">{active}</div>
              <div className="st-lbl">active</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">{renewSoon.length}</div>
              <div className="st-lbl">renew &lt; 30d</div>
            </div>
          </div>
          {rows.length > 0 && (
            <div className="ov-rows">
              {rows.map(c => (
                <Row
                  key={c.id}
                  title={c.name}
                  sub={
                    c.expiresAt
                      ? `Renews ${new Date(c.expiresAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`
                      : c.orgName ?? 'Awaiting signature'
                  }
                  right={chip(c)}
                  onClick={() => go('contracts')}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/* ============================================================ Growth zone */

interface ContentCounts {
  queued: number
  researching: number
  drafting: number
  reviewing: number
  finalising: number
  ready: number
  failed: number
  total: number
}
interface ScheduleData {
  publishHistory?: { publishedAt: string }[]
}
function ContentEngine({ go }: { go: (id: string) => void }) {
  const { data: drafts } = useResource<{ counts: ContentCounts }>('/api/admin/content/drafts')
  const { data: sched } = useResource<ScheduleData>('/api/admin/content/schedule')
  const loading = !drafts || !sched
  const counts = drafts?.counts
  const inDraft = counts ? counts.queued + counts.researching + counts.drafting + counts.finalising : 0
  const awaitingReview = counts?.reviewing ?? 0
  const ready = counts?.ready ?? 0
  const history = useMemo(() => sched?.publishHistory ?? [], [sched])
  const cadence = useMemo(() => weeklyBuckets(history.map(h => h.publishedAt), 8), [history])
  const hasAny = (counts?.total ?? 0) > 0 || history.length > 0

  return (
    <Card span={7}>
      <CardH ic="pen" title="Content engine" link="Content studio" onLink={() => go('content')} />
      {loading ? (
        <Shim h={90} />
      ) : !hasAny ? (
        <EmptyLine>No content in flight yet.</EmptyLine>
      ) : (
        <>
          <div className="ov-statrow" style={{ marginBottom: 12 }}>
            <div className="ov-stat">
              <div className="st-num">{inDraft}</div>
              <div className="st-lbl">in draft</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">{awaitingReview}</div>
              <div className="st-lbl">awaiting review</div>
            </div>
            <div className="ov-stat">
              <div className="st-num">{ready}</div>
              <div className="st-lbl">ready</div>
            </div>
          </div>
          <Spark
            data={cadence}
            color="#6D4FA3"
            h={38}
            labels={cadence.map((_, i) => (i === cadence.length - 1 ? 'this wk' : `${cadence.length - 1 - i}w`))}
            format={v => `${Math.round(v)} pieces`}
            grow
          />
        </>
      )}
    </Card>
  )
}

interface BufferChannel {
  id: string
}
interface BufferPost {
  sentAt: string | null
  createdAt: string | null
}
function SocialCadence({ go }: { go: (id: string) => void }) {
  const { data: status } = useResource<{ channels: BufferChannel[]; configured: boolean }>(
    '/api/admin/integrations/buffer/status',
  )
  const { data: sent } = useResource<{ posts: BufferPost[] }>('/api/admin/integrations/buffer/posts?status=sent&count=100')
  const configured = status?.configured ?? true
  const channels = status?.channels ?? []
  const posts = useMemo(() => sent?.posts ?? [], [sent])
  const week = 7 * 24 * 60 * 60 * 1000
  const postsThisWeek = posts.filter(p => {
    const t = Date.parse(p.sentAt ?? p.createdAt ?? '')
    return !Number.isNaN(t) && Date.now() - t <= week
  }).length
  const cadence = useMemo(() => weeklyBuckets(posts.map(p => p.sentAt ?? p.createdAt), 8), [posts])

  return (
    <Card span={5}>
      <CardH ic="share" title="Social cadence" link="Social" onLink={() => go('social')} />
      {!status ? (
        <Shim h={80} />
      ) : !configured || channels.length === 0 ? (
        <>
          <EmptyLine>Connect Buffer to track your posting cadence.</EmptyLine>
          <button className="ov-card-more" onClick={() => go('social')}>
            Connect Buffer
            <Icon n="arrow" s={12} />
          </button>
        </>
      ) : (
        <>
          <div className="ov-statrow">
            <div className="ov-stat">
              <div className="st-num">{postsThisWeek}</div>
              <div className="st-lbl">posts / wk</div>
            </div>
          </div>
          <Spark
            data={cadence}
            color="#2A6FDB"
            h={34}
            labels={cadence.map((_, i) => (i === cadence.length - 1 ? 'this wk' : `${cadence.length - 1 - i}w`))}
            format={v => `${Math.round(v)} posts`}
            grow
          />
        </>
      )}
    </Card>
  )
}

interface Review {
  orgId: string
  orgName: string
  outreachStatus: string
}
const REVIEW_ACTIVE = new Set(['asked', 'deferred', 'in_progress'])
function reviewChip(status: string): ReactNode {
  if (status === 'in_progress') return <span className="ov-chip brand">Ready</span>
  if (status === 'asked') return <span className="ov-chip info">Out</span>
  return <span className="ov-chip muted">Hold</span>
}
function reviewSub(status: string): string {
  if (status === 'in_progress') return 'In progress'
  if (status === 'asked') return 'Outreach sent'
  return 'Deferred follow-up'
}
function Reviews({ go }: { go: (id: string) => void }) {
  const { data } = useResource<{ reviews: Review[] }>('/api/admin/reviews')
  const active = (data?.reviews ?? []).filter(r => REVIEW_ACTIVE.has(r.outreachStatus))
  return (
    <Card span={7}>
      <CardH ic="star" title="Reviews & case studies" link="Reviews" onLink={() => go('reviews')} />
      {!data ? (
        <Shim h={90} />
      ) : active.length === 0 ? (
        <EmptyLine>No reviews in flight.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {active.slice(0, 3).map(r => (
            <Row
              key={r.orgId}
              avText={initials(r.orgName)}
              title={r.orgName}
              sub={reviewSub(r.outreachStatus)}
              right={reviewChip(r.outreachStatus)}
              onClick={() => go('reviews')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

interface DocPage {
  id: string
  title: string
  lastEditedBy: string | null
  lastEditedAt: string | null
}
function DocsHub({ go }: { go: (id: string) => void }) {
  const nowMs = useNow().getTime()
  const { data } = useResource<{ pages: DocPage[] }>('/api/admin/docs')
  const pages = data?.pages ?? []
  return (
    <Card span={5}>
      <CardH ic="book" title="Docs hub" link="All docs" onLink={() => go('docs')} />
      {!data ? (
        <Shim h={90} />
      ) : pages.length === 0 ? (
        <EmptyLine>No docs yet.</EmptyLine>
      ) : (
        <div className="ov-rows">
          {pages.slice(0, 3).map(p => (
            <Row
              key={p.id}
              title={p.title}
              sub={`Edited ${p.lastEditedBy ? 'by ' + p.lastEditedBy + ' · ' : ''}${relTime(p.lastEditedAt, nowMs)} ago`}
              onClick={() => go('docs')}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
