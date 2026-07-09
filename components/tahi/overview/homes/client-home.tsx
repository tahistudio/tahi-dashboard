'use client'

/**
 * client-home.tsx - the CLIENT role home for the role-aware Overview
 * ("Studio Ledger"). Ported pixel-for-pixel from the Claude Design
 * `overview.jsx` ClientHome, but every figure is wired to a REAL portal route
 * (never the design's fabricated demo numbers) and every amount formats through
 * the real DisplayCurrency provider (never a hardcoded FX rate).
 *
 * Composition (matches the design exactly):
 *   - optional ClientFirstRun welcome (ctx.home==='first') backed by real
 *     organisations.onboardingState via /api/portal/onboarding
 *   - masthead: TheWire (their pulse) -> Hero (project progress OR awaiting
 *     review, by ctx.clientType) -> Vitals -> NeedsYou
 *   - Zone "Your work": TrackBoard (retainer, reorderable queue) OR ProjectBoard
 *     (project, phases), chosen by ctx.clientType
 *   - Zone "Activity": Recent requests + Next call
 *   - Zone "Library": Recent files + Your team
 *   - Zone "Billing": Invoices + Your plan | Your project
 *
 * Read-only (ctx.isReadOnly / impersonation): NewMenu is passed ro, every write
 * control (queue reorder, onboarding toggle, Pay) is guarded in JS AND visually
 * disabled, and the switcher's `.ov[data-ro="1"]` wrapper disables the rest.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import type { OverviewCtx } from '@/components/tahi/overview/ctx'
import {
  useOvFormat,
  Icon,
  Card,
  CardH,
  Row,
  Hero,
  Vitals,
  NeedsYou,
  TheWire,
  Zone,
  NewMenu,
  type IconName,
  type NeedItem,
  type NewMenuItem,
  type VitalItem,
  type WireEvent,
} from '@/components/tahi/overview/ov-kit'

/* ---------- route response shapes (read from the actual portal routes) ---------- */

interface ActivityResp {
  items: Array<{ id: string; who: string; what: string; when: string; whenISO: string; color: string }>
}

interface ReqRow {
  id: string
  title: string
  type: string
  status: string
  priority: string | null
  queueOrder: number | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}
interface RequestsResp {
  requests: ReqRow[]
  page: number
  limit: number
}

interface TrackReq {
  id: string
  title: string
  type: string
  status: string
  priority: string | null
  queueOrder: number | null
  dueDate: string | null
  createdAt: string
}
interface TrackItem {
  id: string
  type: string
  isPriorityTrack: boolean | number | null
  currentRequest: TrackReq | null
  queue: TrackReq[]
}
interface TracksResp {
  items: TrackItem[]
  subscription: { id: string; planType: string; status: string } | null
}

interface Phase {
  name: string
  state: 'done' | 'active' | 'upcoming'
  pct: number
  note: string | null
}
interface ProjectResp {
  isProject: boolean
  scheduleTitle: string | null
  project: { name: string; status: string; targetLaunchDate: string | null } | null
  phases: Phase[]
  progressKnown: boolean
  nextMilestone: { name: string; dateISO: string | null } | null
  nextInvoice: { dateISO: string } | null
  targetLaunchDate: string | null
}

interface InvoiceRow {
  id: string
  status: string
  totalAmount: number
  currency: string | null
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  createdAt: string
}
interface InvoicesResp {
  items: InvoiceRow[]
}

interface SubscriptionResp {
  clientType: 'retainer' | 'project'
  subscription: null | {
    id: string
    planType: string
    planLabel: string
    status: string
    nextInvoiceDate: string | null
    monthlyRate: number
    trackCount: number
  }
}

interface CallItem {
  id: string
  title: string
  whenISO: string
  durationMin: number
  meetingUrl: string | null
  withName: string | null
  avatar: string | null
}
interface CallsResp {
  items: CallItem[]
}

interface FileItem {
  id: string
  name: string
  type: string
  uploadedBy: string
  ago: string
  url: string
}
interface FilesResp {
  items: FileItem[]
}

interface TeamItem {
  id: string
  name: string
  role: string
  avatarUrl: string | null
}
interface TeamResp {
  items: TeamItem[]
}

interface OnboardingResp {
  onboardingState: Record<string, boolean>
  onboardingLoomUrl: string | null
}

/* ---------- status -> visual mapping (data-value hexes, documented per rule 2) ---------- */

type ChipTone = 'brand' | 'info' | 'warn' | 'muted' | 'rose'

/** Client-facing request status meta: leading dot colour + right chip. delivered
 *  and client_review both read as "your review" (client action pending). */
const REQ_META: Record<string, { label: string; dot: string; chip: ChipTone }> = {
  submitted: { label: 'Queued', dot: '#8a9987', chip: 'muted' },
  in_review: { label: 'In review', dot: '#C9A227', chip: 'warn' },
  in_progress: { label: 'In build', dot: '#2A6FDB', chip: 'info' },
  client_review: { label: 'Review', dot: '#C9A227', chip: 'warn' },
  delivered: { label: 'Review', dot: '#C9A227', chip: 'warn' },
  on_hold: { label: 'On hold', dot: '#8a9987', chip: 'muted' },
  completed: { label: 'Done', dot: '#5A824E', chip: 'brand' },
  archived: { label: 'Archived', dot: '#8a9987', chip: 'muted' },
  cancelled: { label: 'Cancelled', dot: '#8a9987', chip: 'muted' },
}
function reqMeta(status: string): { label: string; dot: string; chip: ChipTone } {
  return REQ_META[status] ?? { label: status.replace(/_/g, ' '), dot: 'var(--brand)', chip: 'muted' }
}

/** Deterministic stage fraction from the real status - used only to visualise a
 *  request's pipeline position on the TrackBoard meter (not a tracked percent). */
const STAGE_PCT: Record<string, number> = {
  submitted: 12,
  in_review: 30,
  in_progress: 62,
  on_hold: 45,
  client_review: 88,
  delivered: 100,
  completed: 100,
}
function stagePct(status: string): number {
  return STAGE_PCT[status] ?? 20
}

/** Client-facing request buckets. review = waiting on the client; open = still
 *  moving through the studio. Module-scoped so they stay referentially stable. */
const REVIEW_SET = ['client_review', 'delivered']
const OPEN_SET = ['submitted', 'in_review', 'in_progress', 'on_hold']

/* ---------- small helpers ---------- */

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function typeLabel(t: string): string {
  return t === 'large_task' || t === 'large' ? 'Large task' : 'Small task'
}

/** Short delivery label: Today / Tomorrow / weekday within a week / date. */
function deliveryLabel(iso: string | null): string {
  if (!iso) return 'None'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'None'
  const diff = Math.ceil((startOfDayMs(t) - startOfDayMs(Date.now())) / 86_400_000)
  if (diff < 0) return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7) return new Date(iso).toLocaleDateString('en-NZ', { weekday: 'short' })
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

function dueLabel(iso: string | null): string {
  if (!iso) return 'No due date'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'No due date'
  const diff = Math.ceil((startOfDayMs(t) - startOfDayMs(Date.now())) / 86_400_000)
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} overdue`
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  return `Due in ${diff} days`
}

function shortDate(iso: string | null): string {
  if (!iso) return 'TBC'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }) : 'TBC'
}

function invoiceLabel(inv: InvoiceRow): string {
  const iso = inv.dueDate ?? inv.createdAt
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${d.toLocaleDateString('en-NZ', { month: 'long' })} invoice` : 'Invoice'
}

function callWhen(iso: string, mins: number): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return `${mins} min`
  const day = d.toLocaleDateString('en-NZ', { weekday: 'long' })
  const time = d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time} · ${mins} min`
}

/* ---------- ClientFirstRun (real onboarding state) ---------- */

interface FirstRunStep {
  key: string
  ic: IconName
  t: string
  d: string
  time: string
  dest: string | null
}
const CL_STEPS: FirstRunStep[] = [
  { key: 'welcomeVideoWatched', ic: 'play', t: 'Watch your welcome', d: 'A short intro on how your studio works', time: '1 min', dest: null },
  { key: 'brandAssetsUploaded', ic: 'file', t: 'Share brand assets', d: 'Logos, fonts and guidelines so day one is on-brand', time: '2 min', dest: 'files' },
  { key: 'firstRequestSubmitted', ic: 'request', t: 'Make your first request', d: 'Tell us what you need and we take it from there', time: '3 min', dest: 'requests' },
  { key: 'billingSetUp', ic: 'receipt', t: 'Confirm billing', d: 'Check your plan and payment details', time: '1 min', dest: 'plan' },
  { key: 'meetTheTeam', ic: 'users', t: 'Say hi to the team', d: 'Your team is already in your Messages', time: '1 min', dest: 'messages' },
]
const FIRSTRUN_DISMISS_KEY = 'tahi-ov-firstrun-dismissed'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(FIRSTRUN_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function ClientFirstRun({ ctx }: { ctx: OverviewCtx }) {
  const show = ctx.home === 'first'
  const ro = ctx.isReadOnly
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())
  const { data, mutate } = useResource<OnboardingResp>(show && !dismissed ? '/api/portal/onboarding' : null)

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      window.localStorage.setItem(FIRSTRUN_DISMISS_KEY, '1')
    } catch {
      /* storage unavailable - dismissal just will not persist */
    }
  }, [])

  const toggle = useCallback(
    async (key: string, next: boolean) => {
      if (ro) return
      mutate(
        prev => (prev ? { ...prev, onboardingState: { ...prev.onboardingState, [key]: next } } : prev),
        false,
      )
      try {
        await fetch(apiPath('/api/portal/onboarding'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: key, completed: next }),
        })
      } catch {
        /* network error - revalidate to restore truth */
      }
      mutate()
    },
    [ro, mutate],
  )

  if (!show || dismissed) return null

  const state = data?.onboardingState ?? {}
  const done = CL_STEPS.map(s => !!state[s.key])
  const doneN = done.filter(Boolean).length
  const nextIdx = done.findIndex(d => !d)
  const org = ctx.orgName || ctx.previewName || 'there'

  return (
    <div className="ov-welcome">
      <div className="ov-welcome-head">
        <div>
          <h2>Kia ora, {org}. Welcome to your studio.</h2>
          <p>
            Everything Tahi makes for you lives here. Five small steps and you are fully set up, about eight minutes,
            and you can stop anytime.
          </p>
        </div>
        <div className="ov-welcome-prog">
          <span className="wp-num">
            {doneN}
            <i>/{CL_STEPS.length}</i>
          </span>
          <div className="ov-meter" style={{ width: 110 }}>
            <i style={{ width: (doneN / CL_STEPS.length) * 100 + '%' }} />
          </div>
          <span className="ov-mini">set up</span>
        </div>
      </div>
      <div className="ov-welcome-steps">
        {CL_STEPS.map((s, i) => {
          const isDone = done[i]
          const isNext = i === nextIdx
          return (
            <div key={s.key} className={'ov-wstep' + (isDone ? ' done' : '') + (isNext ? ' next' : '')}>
              <button
                className="ws-check"
                aria-label={isDone ? 'Mark not done' : 'Mark done'}
                disabled={ro}
                onClick={() => toggle(s.key, !isDone)}
              >
                {isDone && <Icon n="check" s={12} />}
              </button>
              <span className="ws-ic">
                <Icon n={s.ic} s={16} />
              </span>
              <div className="ws-t">
                <b>{s.t}</b>
                <small>{s.d}</small>
              </div>
              {isNext ? (
                <button
                  className="ov-cta ws-go"
                  disabled={ro}
                  onClick={() => {
                    if (ro) return
                    toggle(s.key, true)
                    if (s.dest) ctx.go(s.dest)
                  }}
                >
                  Start &middot; {s.time}
                </button>
              ) : (
                <span className="ws-time">{isDone ? 'Done' : s.time}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="ov-welcome-foot">
        <span className="ov-mini">
          {nextIdx === -1
            ? 'That is everything, this panel will bow out now.'
            : 'Your lead gets a note as you go, no need to be perfect.'}
        </span>
        <button className="ov-welcome-skip" onClick={dismiss}>
          {nextIdx === -1 ? 'Finish up' : 'I will explore on my own'}
        </button>
      </div>
    </div>
  )
}

/* ---------- TrackBoard (retainer, reorderable queue) ---------- */

function laneKey(tracks: TrackItem[]): string {
  return tracks.map(t => `${t.id}:${t.currentRequest?.id ?? ''}:${t.queue.map(q => q.id).join(',')}`).join('|')
}

function TrackBoard({
  tracks,
  planLabel,
  ro,
  go,
  onReorder,
}: {
  tracks: TrackItem[]
  planLabel: string | null
  ro: boolean
  go: (id: string) => void
  onReorder: (trackId: string, requestIds: string[]) => void
}) {
  const key = laneKey(tracks)
  const [lanes, setLanes] = useState<TrackItem[]>(tracks)
  // Resync local optimistic lanes whenever the fetched tracks materially change.
  useEffect(() => {
    setLanes(tracks)
    // key is the stable signature of tracks; tracks itself is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const moveQ = useCallback(
    (trackId: string, qi: number, dir: -1 | 1) => {
      if (ro) return
      setLanes(prev =>
        prev.map(t => {
          if (t.id !== trackId) return t
          const q = [...t.queue]
          const j = qi + dir
          if (j < 0 || j >= q.length) return t
          ;[q[qi], q[j]] = [q[j], q[qi]]
          onReorder(
            trackId,
            q.map(r => r.id),
          )
          return { ...t, queue: q }
        }),
      )
    },
    [ro, onReorder],
  )

  if (lanes.length === 0) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your work in motion</h3>
            <span className="ov-mini">Your tracks appear here once your plan is set up.</span>
          </div>
          <button className="ov-cta" disabled={ro} onClick={() => go('requests')}>
            New request
          </button>
        </div>
        <div className="ov-mini">No active tracks yet.</div>
      </div>
    )
  }

  return (
    <div className="ov-trackboard">
      <div className="ov-tb-head">
        <div>
          <h3>Your work in motion</h3>
          <span className="ov-mini">
            {planLabel ? `${planLabel} plan · ` : ''}
            {lanes.length} track{lanes.length === 1 ? '' : 's'} running in parallel
          </span>
        </div>
        <button className="ov-cta" disabled={ro} onClick={() => go('requests')}>
          New request
        </button>
      </div>
      <div className="ov-tb-lanes">
        {lanes.map((t, ti) => {
          const cur = t.currentRequest
          const meta = cur ? reqMeta(cur.status) : null
          return (
            <div className="ov-lane" key={t.id}>
              <div className="ov-lane-h">
                <b>Track {ti + 1}</b>
                {meta && <span className={'ov-chip ' + meta.chip}>{meta.label}</span>}
              </div>
              {cur ? (
                <div className="ov-lane-now">
                  <div className="ln-t">
                    <b>{cur.title}</b>
                    <small>
                      {cur.dueDate ? `Delivery ${deliveryLabel(cur.dueDate)}` : typeLabel(cur.type)}
                    </small>
                  </div>
                  <div className="ov-meter">
                    <i style={{ width: stagePct(cur.status) + '%' }} />
                  </div>
                  <div className="ln-pct">{meta?.label}</div>
                </div>
              ) : (
                <div className="ov-lane-now">
                  <div className="ln-t">
                    <b>Ready for your next request</b>
                    <small>This track is open</small>
                  </div>
                </div>
              )}
              <div className="ov-lane-next">
                <span className="ov-lane-lbl">Up next &middot; your order</span>
                {t.queue.length > 0 ? (
                  <>
                    {t.queue.map((q, qi) => (
                      <div className="ln-q" key={q.id}>
                        <span className="ln-q-pos">{qi + 1}</span>
                        <span className="ln-q-t">{q.title}</span>
                        {!ro && (
                          <span className="ln-q-ctl">
                            <button aria-label="Move up" disabled={qi === 0} onClick={() => moveQ(t.id, qi, -1)}>
                              <Icon n="up" s={12} />
                            </button>
                            <button
                              aria-label="Move down"
                              disabled={qi === t.queue.length - 1}
                              onClick={() => moveQ(t.id, qi, 1)}
                            >
                              <Icon n="down" s={12} />
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                    <button className="ln-add" disabled={ro} onClick={() => go('requests')}>
                      + Queue another
                    </button>
                  </>
                ) : (
                  <button className="ln-open" disabled={ro} onClick={() => go('requests')}>
                    Slot open, submit a request
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="ov-tb-foot">
        <span className="ov-mini">Need more done at once?</span>
        <button className="ov-cta ghost" disabled={ro} onClick={() => go('plan')}>
          Add a track
        </button>
      </div>
    </div>
  )
}

/* ---------- ProjectBoard (project, phases) ---------- */

function ProjectBoard({ project, ro, go }: { project: ProjectResp | undefined; ro: boolean; go: (id: string) => void }) {
  const phases = project?.phases ?? []
  const title = project?.scheduleTitle || project?.project?.name || 'Your project'
  const activeIdx = phases.findIndex(p => p.state === 'active')
  const stage = activeIdx >= 0 ? `Phase ${activeIdx + 1} of ${phases.length}` : `${phases.length} phase${phases.length === 1 ? '' : 's'}`

  return (
    <div className="ov-trackboard">
      <div className="ov-tb-head">
        <div>
          <h3>Your project, phase by phase</h3>
          <span className="ov-mini">
            {title}
            {phases.length > 0 ? ` · ${stage}` : ''}
          </span>
        </div>
        <button className="ov-cta" disabled={ro} onClick={() => go('messages')}>
          Message the team
        </button>
      </div>
      {phases.length > 0 ? (
        <div className="ov-phases">
          {phases.map((p, i) => {
            // 'upcoming' maps to the design's 'ahead' visual (not yet started).
            const cls = p.state === 'done' ? 'done' : p.state === 'active' ? 'active' : 'ahead'
            const width = p.state === 'done' ? '100%' : p.state === 'active' ? p.pct + '%' : '0%'
            return (
              <div className={'ov-phase ' + cls} key={p.name + i}>
                <div className="ph-top">
                  <span className="ph-dot">{p.state === 'done' ? <Icon n="check" s={11} /> : i + 1}</span>
                  <b>{p.name}</b>
                  {p.state === 'active' && <span className="ov-chip info">Now</span>}
                </div>
                <div className="ov-meter">
                  <i style={{ width }} />
                </div>
                {p.note && (
                  <div className="ov-mini" style={{ marginTop: 7 }}>
                    {p.note}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ov-mini">Your project plan is being set up. Your team will share the phases here shortly.</div>
      )}
    </div>
  )
}

/* ---------- ClientHome ---------- */

export function ClientHome({ ctx }: { ctx: OverviewCtx }) {
  const { money } = useOvFormat()
  const { formatNative } = useDisplayCurrency()
  const go = ctx.go
  const ro = ctx.isReadOnly

  // ── data ───────────────────────────────────────────────────────────────────
  const { data: activityData } = useResource<ActivityResp>('/api/portal/activity')
  const { data: requestsData } = useResource<RequestsResp>('/api/portal/requests?status=active')
  const { data: invoicesData } = useResource<InvoicesResp>('/api/portal/invoices?status=all')
  const { data: subData } = useResource<SubscriptionResp>('/api/portal/subscription')

  // Retainer (TrackBoard) vs project (ProjectBoard): derived from the real
  // subscription signal; ctx.clientType is a preview-only override. Defaults to
  // retainer until the subscription loads (the common case).
  const isProject = (ctx.clientType ?? subData?.clientType) === 'project'
  const { data: callsData } = useResource<CallsResp>('/api/portal/calls')
  const { data: filesData } = useResource<FilesResp>('/api/portal/files')
  const { data: teamData } = useResource<TeamResp>('/api/portal/team')
  const { data: tracksData, mutate: mutateTracks } = useResource<TracksResp>(
    isProject ? null : '/api/portal/tracks',
  )
  const { data: projectData } = useResource<ProjectResp>(isProject ? '/api/portal/project' : null)

  const requests = useMemo(() => requestsData?.requests ?? [], [requestsData])
  const invoices = useMemo(() => invoicesData?.items ?? [], [invoicesData])
  const calls = callsData?.items ?? []
  const files = filesData?.items ?? []
  const team = teamData?.items ?? []
  const tracks = useMemo(() => tracksData?.items ?? [], [tracksData])

  // ── derived: requests ───────────────────────────────────────────────────────
  const inReview = useMemo(() => requests.filter(r => REVIEW_SET.includes(r.status)), [requests])
  const openReqs = useMemo(() => requests.filter(r => OPEN_SET.includes(r.status)), [requests])
  const nextDelivery = useMemo(() => {
    const dated = openReqs
      .filter(r => r.dueDate)
      .sort((a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime())
    return dated[0] ?? null
  }, [openReqs])

  // ── derived: invoices ───────────────────────────────────────────────────────
  const unpaid = useMemo(() => invoices.filter(i => i.status === 'sent' || i.status === 'overdue'), [invoices])
  const nearestUnpaid = useMemo(() => {
    const dated = [...unpaid].sort(
      (a, b) => new Date(a.dueDate ?? a.createdAt).getTime() - new Date(b.dueDate ?? b.createdAt).getTime(),
    )
    return dated[0] ?? null
  }, [unpaid])
  const invCurrencies = useMemo(() => new Set(unpaid.map(i => i.currency ?? 'NZD')), [unpaid])
  const invSum = useMemo(() => unpaid.reduce((s, i) => s + (i.totalAmount || 0), 0), [unpaid])
  const invSameCurrency = invCurrencies.size <= 1
  const invDueDisplay =
    unpaid.length === 0 ? '0' : invSameCurrency ? formatNative(invSum, unpaid[0]?.currency ?? 'NZD') : String(unpaid.length)

  // ── wire ────────────────────────────────────────────────────────────────────
  const wire: WireEvent[] = (activityData?.items ?? []).map(e => ({
    color: e.color,
    who: e.who,
    what: e.what,
    when: e.when,
  }))

  // ── needs you (ranked: review > invoice > call, max 3) ──────────────────────
  const needs: NeedItem[] = []
  if (inReview.length > 0) {
    needs.push({
      tone: 'work',
      ic: 'file',
      title: `${inReview.length} ready for your review`,
      sub: inReview
        .slice(0, 2)
        .map(r => r.title)
        .join(' · '),
      verb: 'Review',
      onAct: () => go('requests'),
    })
  }
  if (nearestUnpaid) {
    needs.push({
      tone: 'money',
      ic: 'receipt',
      title: `${invoiceLabel(nearestUnpaid)} due`,
      sub: `${formatNative(nearestUnpaid.totalAmount, nearestUnpaid.currency ?? 'NZD')} · ${dueLabel(
        nearestUnpaid.dueDate,
      )}`,
      verb: 'Pay',
      onAct: () => go('invoices'),
    })
  }
  if (calls[0]) {
    const c = calls[0]
    needs.push({
      tone: 'call',
      ic: 'phone',
      title: c.title,
      sub: callWhen(c.whenISO, c.durationMin),
      verb: 'Join',
      onAct: () => {
        if (c.meetingUrl) window.open(c.meetingUrl, '_blank', 'noopener,noreferrer')
        else go('calls')
      },
    })
  }

  // ── vitals ──────────────────────────────────────────────────────────────────
  const vitals: VitalItem[] = [
    { lbl: 'Open requests', num: openReqs.length, sub: 'in progress' },
    { lbl: 'In review', num: inReview.length, muted: inReview.length === 0, sub: 'waiting on you' },
    {
      lbl: 'Next delivery',
      num: nextDelivery ? deliveryLabel(nextDelivery.dueDate) : 'None',
      muted: !nextDelivery,
      sub: nextDelivery ? nextDelivery.title : 'nothing scheduled',
    },
    {
      lbl: 'Invoices due',
      num: invDueDisplay,
      muted: unpaid.length === 0,
      sub:
        unpaid.length === 0
          ? 'all settled'
          : `${unpaid.length} · ${nearestUnpaid ? dueLabel(nearestUnpaid.dueDate) : 'due soon'}`,
    },
  ]

  // ── hero ────────────────────────────────────────────────────────────────────
  const retainerNewItems: NewMenuItem[] = [{ ic: 'request', label: 'New request', go: () => go('requests') }]
  const projectNewItems: NewMenuItem[] = [
    { ic: 'msg', label: 'Message the team', go: () => go('messages') },
    { ic: 'request', label: 'New request', go: () => go('requests') },
  ]

  let hero: ReactNode
  if (isProject) {
    const phases = projectData?.phases ?? []
    const activePhase = phases.find(p => p.state === 'active') ?? null
    const doneCount = phases.filter(p => p.state === 'done').length
    const overallPct = phases.length
      ? Math.round((100 * (doneCount + (activePhase ? activePhase.pct / 100 : 0))) / phases.length)
      : 0
    const milestone = projectData?.nextMilestone
    if (projectData?.progressKnown && phases.length > 0) {
      hero = (
        <Hero
          variant="forest"
          label="Project progress"
          value={overallPct}
          format={n => `${Math.round(n)}%`}
          sub={
            activePhase
              ? `${activePhase.note ?? activePhase.name + ' phase'}${milestone ? ` · next ${milestone.name}` : ''}`
              : 'On track'
          }
          action={<NewMenu items={projectNewItems} ro={ro} variant="hero" />}
        />
      )
    } else {
      hero = (
        <Hero
          variant="forest"
          label="Project progress"
          value={activePhase?.name ?? projectData?.project?.status ?? 'Getting started'}
          sub={milestone ? `Next: ${milestone.name}` : 'Your plan is being set up'}
          action={<NewMenu items={projectNewItems} ro={ro} variant="hero" />}
        />
      )
    }
  } else {
    hero = (
      <Hero
        variant="forest"
        label="Awaiting your review"
        value={inReview.length}
        sub={inReview.length > 0 ? inReview.slice(0, 2).map(r => r.title).join(' · ') : 'Nothing waiting on you'}
        action={<NewMenu items={retainerNewItems} ro={ro} variant="hero" />}
      />
    )
  }

  // ── track reorder persistence ───────────────────────────────────────────────
  const onReorder = useCallback(
    async (trackId: string, requestIds: string[]) => {
      if (ro || requestIds.length === 0) return
      try {
        await fetch(apiPath(`/api/portal/tracks/${trackId}/reorder`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestIds }),
        })
      } catch {
        /* network error - revalidate to restore the server order */
      }
      mutateTracks()
    },
    [ro, mutateTracks],
  )

  const planLabel = subData?.subscription?.planLabel ?? null
  const recent = requests.slice(0, 5)
  const nextCall = calls[0] ?? null
  const payDisabled: CSSProperties = ro ? { opacity: 0.5, pointerEvents: 'none' } : {}

  return (
    <>
      <ClientFirstRun ctx={ctx} />

      <div className="ov-mast">
        <TheWire events={wire} />
        {hero}
        <Vitals items={vitals} />
        <NeedsYou items={needs} ro={ro} onMore={() => go('requests')} />
      </div>

      <Zone label="Your work">
        <div className="col-12">
          {isProject ? (
            <ProjectBoard project={projectData} ro={ro} go={go} />
          ) : (
            <TrackBoard tracks={tracks} planLabel={planLabel} ro={ro} go={go} onReorder={onReorder} />
          )}
        </div>
      </Zone>

      <Zone label="Activity">
        <Card span={7}>
          <CardH ic="tasks" title="Recent requests" link="All requests" onLink={() => go('requests')} />
          {recent.length > 0 ? (
            <div className="ov-rows">
              {recent.map(r => {
                const meta = reqMeta(r.status)
                return (
                  <Row
                    key={r.id}
                    dot
                    dotColor={meta.dot}
                    title={r.title}
                    sub={`${meta.label} · updated ${deliveryLabel(r.updatedAt)}`}
                    right={<span className={'ov-chip ' + meta.chip}>{meta.label}</span>}
                    onClick={() => go('requests')}
                  />
                )
              })}
            </div>
          ) : (
            <div className="ov-mini">No requests yet. Start one whenever you are ready.</div>
          )}
        </Card>
        <Card span={5}>
          <CardH ic="phone" title="Next call" />
          {nextCall ? (
            <>
              <Row
                avText={nextCall.avatar ? undefined : initials(nextCall.withName ?? nextCall.title)}
                img={nextCall.avatar ?? undefined}
                title={nextCall.title}
                sub={callWhen(nextCall.whenISO, nextCall.durationMin)}
                right={
                  nextCall.meetingUrl ? (
                    <a
                      className="ov-cta"
                      href={nextCall.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ height: 30, fontSize: 12, padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}
                    >
                      Join
                    </a>
                  ) : (
                    <span className="rw-r">TBC</span>
                  )
                }
              />
              <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                <button
                  className="ov-cta ghost"
                  disabled={ro}
                  style={{ width: '100%', height: 34, fontSize: 12.5 }}
                  onClick={() => go('calls')}
                >
                  Book another time
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="ov-mini">No calls scheduled right now.</div>
              <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                <button
                  className="ov-cta ghost"
                  disabled={ro}
                  style={{ width: '100%', height: 34, fontSize: 12.5 }}
                  onClick={() => go('calls')}
                >
                  Book a call
                </button>
              </div>
            </>
          )}
        </Card>
      </Zone>

      <Zone label="Library">
        <Card span={6}>
          <CardH ic="file" title="Recent files" link="All files" onLink={() => go('files')} />
          {files.length > 0 ? (
            <div className="ov-rows">
              {files.slice(0, 4).map(f => (
                <Row
                  key={f.id}
                  title={f.name}
                  sub={`Shared by ${f.uploadedBy}${f.ago ? ` · ${f.ago}` : ''}`}
                  right={<span className="ov-chip muted">{f.type}</span>}
                  onClick={() => go('files')}
                />
              ))}
            </div>
          ) : (
            <div className="ov-mini">No files shared yet.</div>
          )}
        </Card>
        <Card span={6}>
          <CardH ic="users" title="Your team" />
          {team.length > 0 ? (
            <div className="ov-rows">
              {team.map((m, i) => (
                <Row
                  key={m.id}
                  avText={m.avatarUrl ? undefined : initials(m.name)}
                  img={m.avatarUrl ?? undefined}
                  title={m.name}
                  sub={m.role}
                  right={
                    i === 0 ? (
                      <button
                        className="ov-cta ghost"
                        disabled={ro}
                        style={{ height: 30, fontSize: 12, padding: '0 12px' }}
                        onClick={() => go('messages')}
                      >
                        Message
                      </button>
                    ) : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className="ov-mini">Your team is being assigned. They will show up here soon.</div>
          )}
        </Card>
      </Zone>

      <Zone label="Billing">
        <Card span={7} edge="warn">
          <CardH ic="receipt" title="Invoices" link="Billing" onLink={() => go('invoices')} />
          {invoices.length > 0 ? (
            <div className="ov-rows">
              {invoices.slice(0, 4).map(inv => {
                const paid = inv.status === 'paid'
                return (
                  <Row
                    key={inv.id}
                    title={invoiceLabel(inv)}
                    sub={paid ? `Paid ${shortDate(inv.paidAt)}` : dueLabel(inv.dueDate)}
                    right={
                      paid ? (
                        <span className="ov-chip brand">Paid</span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                          <b style={{ color: 'var(--text)', font: "700 13px 'Manrope',sans-serif" }}>
                            {formatNative(inv.totalAmount, inv.currency ?? 'NZD')}
                          </b>
                          <button
                            className="ov-cta"
                            disabled={ro}
                            style={{ height: 28, fontSize: 11.5, padding: '0 10px', ...payDisabled }}
                            onClick={() => go('invoices')}
                          >
                            Pay
                          </button>
                        </span>
                      )
                    }
                  />
                )
              })}
            </div>
          ) : (
            <div className="ov-mini">No invoices yet.</div>
          )}
        </Card>

        {isProject ? (
          <Card span={5}>
            <CardH ic="wallet" title="Your project" link="Details" onLink={() => go('proposals')} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: "700 20px 'Manrope',sans-serif", color: 'var(--text)' }}>
                {projectData?.project?.name ?? projectData?.scheduleTitle ?? 'Your project'}
              </span>
              <span className="ov-chip brand">{projectData?.project?.status ?? 'Active'}</span>
            </div>
            <div className="ov-mini" style={{ marginTop: 5 }}>
              {projectData?.targetLaunchDate ? `Target launch ${shortDate(projectData.targetLaunchDate)}` : 'Fixed scope'}
            </div>
            <div className="ov-subrows">
              <div className="ov-subrow">
                <span>Phase</span>
                <b>{projectData?.phases.find(p => p.state === 'active')?.name ?? 'In progress'}</b>
              </div>
              <div className="ov-subrow">
                <span>Next milestone</span>
                <b>
                  {projectData?.nextMilestone
                    ? `${projectData.nextMilestone.name}${
                        projectData.nextMilestone.dateISO ? ` · ${shortDate(projectData.nextMilestone.dateISO)}` : ''
                      }`
                    : 'TBC'}
                </b>
              </div>
              <div className="ov-subrow">
                <span>Next invoice</span>
                <b>{projectData?.nextInvoice ? shortDate(projectData.nextInvoice.dateISO) : 'On launch'}</b>
              </div>
            </div>
          </Card>
        ) : (
          <Card span={5}>
            <CardH ic="wallet" title="Your plan" link="Manage" onLink={() => go('plan')} />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: "700 20px 'Manrope',sans-serif", color: 'var(--text)' }}>
                {planLabel ?? 'Retainer'}
              </span>
              <span className="ov-chip brand">{subData?.subscription?.status === 'active' ? 'Active' : 'Retainer'}</span>
            </div>
            <div className="ov-mini" style={{ marginTop: 5 }}>
              {subData?.subscription
                ? `${money(subData.subscription.monthlyRate)}/mo · ${subData.subscription.trackCount} track${
                    subData.subscription.trackCount === 1 ? '' : 's'
                  }`
                : 'Retainer plan'}
            </div>
            <div className="ov-subrows">
              <div className="ov-subrow">
                <span>Next invoice</span>
                <b>{subData?.subscription?.nextInvoiceDate ? shortDate(subData.subscription.nextInvoiceDate) : 'TBC'}</b>
              </div>
              <div className="ov-subrow">
                <span>Tracks</span>
                <b>
                  {subData?.subscription
                    ? `${subData.subscription.trackCount} active`
                    : `${tracks.length} active`}
                </b>
              </div>
            </div>
          </Card>
        )}
      </Zone>
    </>
  )
}
