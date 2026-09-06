'use client'

/**
 * client-home.tsx - the CLIENT role home for the role-aware Overview
 * ("Studio Ledger"). Ported pixel-for-pixel from the Claude Design
 * `overview.jsx` ClientHome, but every figure is wired to a REAL portal route
 * (never the design's fabricated demo numbers) and every amount formats through
 * the real DisplayCurrency provider (never a hardcoded FX rate).
 *
 * Composition:
 *   - optional ClientFirstRun welcome (ctx.home==='first') backed by
 *     /api/portal/onboarding, which derives the knowable steps and says
 *     whether this org is a first run at all
 *   - masthead: TheWire (their pulse) -> WaitingOnYou (the dark forest feature
 *     tile that IS the hero: ranked, actionable rows) -> Vitals
 *   - Zone "Your work": TrackBoard (retainer, reorderable queue) OR ProjectBoard
 *     (project, phases), chosen by ctx.clientType
 *   - Zone "Activity": Recent requests + Next call
 *   - Zone "Library": Recent files + Your team
 *   - Zone "Billing": Invoices + Your plan | Your project
 *
 * Three things this pass fixed, from the portal reader map:
 *   1. ONE status vocabulary. lib/portal-status is the single dictionary the
 *      home, the client list and the client request detail all read, so a
 *      request cannot be called "In build" here and "In Progress" one click
 *      later.
 *   2. LOADING STATES EVERYWHERE (TASKS CT.3b). Every card holds its shape
 *      until its own read answers. No card prints its empty-state copy at a
 *      client who has plenty.
 *   3. EVERY "new request" AFFORDANCE OPENS THE DIALOG (/requests?new=1), not
 *      the list the reader then has to press New on again.
 *
 * Read-only (ctx.isReadOnly / impersonation): every write control (queue
 * reorder, onboarding toggle, Pay, start a request) is guarded in JS AND
 * visually disabled, and the switcher's `.ov[data-ro="1"]` wrapper disables the
 * rest.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useResource } from '@/lib/use-resource'
import { ApiError } from '@/lib/swr-fetcher'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import {
  externalLinkDestination,
  fileOpenDestination,
  invoicePayDestination,
  partitionClientRequests,
  requestRouteId,
  type HomeDestination,
} from '@/lib/client-home-signals'
import type { OverviewCtx } from '@/components/tahi/overview/ctx'
import { portalStatusMeta, portalStageFraction, type PortalChipTone } from '@/lib/portal-status'
import { WaitingOnYou, type WaitingItem } from '@/components/tahi/portal/home/waiting-on-you'
import {
  useOvFormat,
  Icon,
  Card,
  CardH,
  Row,
  Vitals,
  TheWire,
  Zone,
  type IconName,
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
  /** Stripe's hosted invoice page, returned by /api/portal/invoices. */
  payUrl: string | null
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
  /** Server's verdict on whether this org is actually a new client. Older
   *  deployments of the route omit it, so absent is treated as eligible. */
  firstRunEligible?: boolean
}

/* ---------- status -> visual mapping ---------- */

/**
 * ONE client vocabulary. This home used to keep a private dictionary (Queued /
 * In build / Review) while the requests list and the request detail printed the
 * studio words one click away, so the same request had two names inside the
 * same portal. Both surfaces now read lib/portal-status, which keeps the house
 * words and adds a plain gloss, and takes its colours from the shared
 * REQUEST_STATUS_CONFIG tokens so dark mode is correct without an override
 * here.
 */
function reqMeta(status: string): { label: string; gloss: string; dot: string; chip: PortalChipTone } {
  const meta = portalStatusMeta(status)
  return { label: meta.label, gloss: meta.gloss, dot: meta.dot, chip: meta.chip }
}

/** Deterministic stage percentage from the real status - used only to visualise
 *  a request's pipeline position on the TrackBoard meter (not a tracked
 *  percent, which is why the caption beside it always says the status word). */
function stagePct(status: string): number {
  return Math.round(portalStageFraction(status) * 100)
}

/* ---------- loading placeholders (TASKS CT.3b) ----------
   Every card on this home used to print its empty-state copy while its fetch
   was still in flight, so a real client's first paint read "No requests yet",
   "No files shared yet" and "Your team is being assigned". A card holds its
   shape instead, and says nothing it has not checked. */

function SkelRows({ rows = 3, height = '2.375rem' }: { rows?: number; height?: string }) {
  return (
    <div
      aria-busy="true"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}
    >
      {Array.from({ length: rows }, (_, i) => (
        // No inline `background`: an inline style beats the unlayered
        // .tahi-shimmer rule in globals.css, which left every placeholder on
        // this page a static bar running a sweep with nothing to sweep.
        <span key={i} className="tahi-shimmer" style={{ height, borderRadius: '0.5rem', display: 'block' }} />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  )
}

/** A vital's figure while its read is in flight: a bar, never a 0. */
function SkelFigure({ width = '3rem' }: { width?: string }) {
  return (
    <span
      className="tahi-shimmer"
      style={{
        display: 'inline-block',
        width,
        height: '1.25rem',
        borderRadius: '0.25rem',
        verticalAlign: 'middle',
      }}
    />
  )
}

/**
 * The one way OFF this page.
 *
 * Module level rather than a closure inside ClientHome so the first-run panel
 * shares it: its "Watch your welcome" step was the single window.open on this
 * surface that skipped the destination resolvers and handed an admin-set URL
 * straight to the browser.
 *
 * In-app paths need the basePath prefix that next/navigation applies for us and
 * window.open does not; a hosted pay link is already absolute.
 *
 * 'noopener' in the feature string makes window.open return null even when the
 * tab did open (that is what the spec says it returns), so a blocked-popup
 * check would fire on every success. The handle is taken plainly instead and
 * the opener reference severed on the way out, which is the same protection. A
 * null handle then genuinely means the tab was suppressed: a popup blocker, or
 * the embedded browser an email client opens a link in. Pay is the
 * highest-value action on this page and must never be a button that does
 * nothing, so it navigates in place instead.
 */
function openHomeDestination(dest: HomeDestination, go: (routeId: string) => void): void {
  if (dest.kind === 'route') {
    go(dest.routeId)
    return
  }
  const url = dest.url.startsWith('/') ? apiPath(dest.url) : dest.url
  const opened = window.open(url, '_blank')
  if (opened) {
    opened.opener = null
    return
  }
  window.location.href = url
}

/**
 * A read that FAILED, said plainly, with the door back.
 *
 * Deliberately not an empty state: "you have nothing" and "we could not look"
 * are different sentences and only one of them is true when
 * requirePortalFeature 403s or a route 500s. Before this, every card except
 * invoices rendered a failed read as its empty copy, so a client with plenty
 * read "No requests yet" and was offered a first-run CTA.
 */
function CardError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="pfh-err inline" role="status">
      <b>{what} did not load.</b>
      <p>That is on us, not you. Give it another go in a moment.</p>
      <button type="button" className="pfh-err-cta tahi-focus-ring" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

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

/** "Saturday 6 September", the masthead's one line of orientation. */
function todayLabel(): string {
  const d = new Date()
  return d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** First name only, for the greeting. Falls back to no name rather than to a
 *  placeholder that reads like a mail merge. */
function firstNameOf(name: string | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first
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
  // dest carries the query so the step opens the New request DIALOG rather
  // than dropping a brand new client on an empty list.
  { key: 'firstRequestSubmitted', ic: 'request', t: 'Make your first request', d: 'Tell us what you need and we take it from there', time: '3 min', dest: 'requests?new=1' },
  // dest is 'invoices', not 'plan': 'plan' resolves to /billing, a page that is
  // not in the client nav, so a client who followed this step had no way back.
  // /invoices is in their nav (for an org admin) and is where they actually
  // confirm what they are paying.
  { key: 'billingSetUp', ic: 'receipt', t: 'Confirm billing', d: 'Check your plan and payment details', time: '1 min', dest: 'invoices' },
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
  // The switcher opts every client session in; the route decides whether the
  // client is actually still setting up (firstRunEligible: it derives the two
  // knowable steps and refuses to call an established org a first run). Latch
  // on the first eligible payload with an outstanding step so finishing the
  // last one keeps the completion state on screen.
  const [wasIncomplete, setWasIncomplete] = useState(false)
  useEffect(() => {
    if (!data || data.firstRunEligible === false) return
    const state = data.onboardingState ?? {}
    if (CL_STEPS.some(s => !state[s.key])) setWasIncomplete(true)
  }, [data])

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
  // Nothing until the real state has landed: rendering an all-unchecked panel
  // first would flash a setup prompt at a client who finished months ago.
  if (!data) return null
  // An org with delivered work, or one that has simply been around a while, is
  // not a first run whatever its onboardingState blob says. The exception is a
  // client who was mid-setup in this same session.
  if (data.firstRunEligible === false && !wasIncomplete) return null

  const state = data.onboardingState ?? {}
  const done = CL_STEPS.map(s => !!state[s.key])
  const doneN = done.filter(Boolean).length
  const nextIdx = done.findIndex(d => !d)
  if (nextIdx === -1 && !wasIncomplete) return null
  const org = ctx.orgName || ctx.previewName || 'there'

  return (
    <div className="ov-welcome">
      <div className="ov-welcome-head">
        <div>
          {/* No second "Kia ora": the masthead directly above already greeted
              them by name. */}
          <h2>Welcome to your studio, {org}.</h2>
          <p>
            Everything Tahi makes for you lives here. Four small steps and you are fully set up, about seven minutes,
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
          // "Watch your welcome" had no video: the route has returned
          // onboardingLoomUrl all along and nothing on this page ever read it,
          // so the step could only be ticked, never watched. When the workspace
          // has a Loom the step plays it; when it has not, the CTA says what it
          // actually does instead of promising a start.
          // Through the same http/https gate as every other outbound link on
          // this page. An admin-set field is still a field, and this was the
          // one window.open on the client home that skipped the check.
          const stepVideo =
            s.key === 'welcomeVideoWatched' ? externalLinkDestination(data.onboardingLoomUrl) : null
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
                    if (stepVideo) {
                      openHomeDestination(stepVideo, ctx.go)
                      return
                    }
                    if (s.dest) ctx.go(s.dest)
                  }}
                >
                  {stepVideo ? 'Watch' : s.dest ? 'Start' : 'Mark done'}
                  {stepVideo || s.dest ? <> &middot; {s.time}</> : null}
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
  loading,
  failed,
  onRetry,
  onStart,
  onReorder,
}: {
  tracks: TrackItem[]
  planLabel: string | null
  ro: boolean
  /** True until /api/portal/tracks has answered. */
  loading: boolean
  /** True when the read failed with nothing to fall back on. */
  failed: boolean
  onRetry: () => void
  /** Opens the New request dialog. Every "new request" affordance on this
   *  board used to route to the /requests LIST, where the reader had to find
   *  and press New a second time. */
  onStart: () => void
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

  // The board holds its shape for the first round trip. "No active tracks yet."
  // to a client with two tracks running was the worst of the CT.3b lies.
  if (loading) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your work in motion</h3>
            <span className="ov-mini">
              <SkelFigure width="9rem" />
            </span>
          </div>
        </div>
        <SkelRows rows={2} height="5.5rem" />
      </div>
    )
  }

  // "No active tracks yet." on a failed read told a client with two tracks
  // running that they have none. The board says what actually happened.
  if (failed) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your work in motion</h3>
          </div>
        </div>
        <CardError what="Your tracks" onRetry={onRetry} />
      </div>
    )
  }

  if (lanes.length === 0) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your work in motion</h3>
            <span className="ov-mini">Your tracks appear here once your plan is set up.</span>
          </div>
          <button className="ov-cta" disabled={ro} onClick={onStart}>
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
        <button className="ov-cta" disabled={ro} onClick={onStart}>
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
                {meta && (
                  <span className={'ov-chip ' + meta.chip} title={meta.gloss || undefined}>
                    {meta.label}
                  </span>
                )}
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
                  <div className="ln-pct" title={meta?.gloss || undefined}>
                    {meta?.label}
                  </div>
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
                    <button className="ln-add" disabled={ro} onClick={onStart}>
                      + Queue another
                    </button>
                  </>
                ) : (
                  <button className="ln-open" disabled={ro} onClick={onStart}>
                    Slot open, submit a request
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* "Add a track" used to route to /billing, a page absent from the
          client nav that they could never navigate back from. Another track is
          a conversation, so it files a request instead, which is a door that
          exists. */}
      <div className="ov-tb-foot">
        <span className="ov-mini">Need more done at once?</span>
        <button className="ov-cta ghost" disabled={ro} onClick={onStart}>
          Ask about another track
        </button>
      </div>
    </div>
  )
}

/* ---------- ProjectBoard (project, phases) ---------- */

function ProjectBoard({
  project,
  ro,
  loading,
  failed,
  onRetry,
  onStart,
}: {
  project: ProjectResp | undefined
  ro: boolean
  /** True until /api/portal/project has answered. */
  loading: boolean
  /** True when the read failed with nothing to fall back on. */
  failed: boolean
  onRetry: () => void
  onStart: () => void
}) {
  const phases = project?.phases ?? []
  const title = project?.scheduleTitle || project?.project?.name || 'Your project'
  const activeIdx = phases.findIndex(p => p.state === 'active')
  const stage = activeIdx >= 0 ? `Phase ${activeIdx + 1} of ${phases.length}` : `${phases.length} phase${phases.length === 1 ? '' : 's'}`

  if (loading) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your project, phase by phase</h3>
            <span className="ov-mini">
              <SkelFigure width="9rem" />
            </span>
          </div>
        </div>
        <SkelRows rows={3} height="3.25rem" />
      </div>
    )
  }

  // "Your project plan is being set up." on a failed read is a claim about the
  // studio's work, not about the request that did not come back.
  if (failed) {
    return (
      <div className="ov-trackboard">
        <div className="ov-tb-head">
          <div>
            <h3>Your project, phase by phase</h3>
          </div>
        </div>
        <CardError what="Your project plan" onRetry={onRetry} />
      </div>
    )
  }

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
        {/* This slot used to hold a permanently disabled "Messaging soon"
            button, an affordance for a surface that does not exist. The one
            thing a client can genuinely start from here is a request, so that
            is what it does, and it opens the dialog rather than a list. */}
        <button className="ov-cta" disabled={ro} onClick={onStart}>
          New request
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
  // Money is gated separately: Act as client turns `ro` off for the client's
  // WORK but never for reaching their payment page. See OverviewCtx.
  const moneyRo = ctx.isMoneyReadOnly ?? ctx.isReadOnly

  // ── data ───────────────────────────────────────────────────────────────────
  const { data: activityData } = useResource<ActivityResp>('/api/portal/activity')
  // Page-bounded on purpose. /api/portal/requests defaults to 50 rows ordered
  // by updatedAt desc and caps at 500, so a migrated client with years of
  // history would have had "Open requests" and "Next delivery" computed from
  // the 50 most recently touched rows. 200 covers the real books with room.
  const {
    data: requestsData,
    isLoading: requestsLoading,
    error: requestsError,
    mutate: mutateRequests,
  } = useResource<RequestsResp>('/api/portal/requests?status=active&limit=200')
  // The review signal gets its OWN query rather than a slice of the one above.
  // A request sitting in client_review is by definition not being touched, so
  // its updatedAt goes stale and it is the first row to fall off a page of the
  // active list. Reading it back by exact status means "nothing waiting on you"
  // can never be an artefact of pagination.
  const {
    data: reviewData,
    isLoading: reviewLoading,
    error: reviewError,
    mutate: mutateReview,
  } = useResource<RequestsResp>('/api/portal/requests?status=client_review&limit=200')
  // The money routes turn a plain member seat away by design (only a workspace
  // admin of the org may read invoices), and a feature-disabled workspace and
  // an unlinked login 403 here too. Without this the card said "No invoices
  // yet." to somebody whose org has plenty, and offered them a Pay button on a
  // list it was never given. A 403 means "not yours to see", not "none".
  const { data: invoicesData, error: invoicesError } = useResource<InvoicesResp>(
    '/api/portal/invoices?status=all',
  )
  const invoicesDenied = invoicesError instanceof ApiError && invoicesError.status === 403
  // Nothing is said about the org's money until the read answers one way or
  // the other. The denial takes a round trip to arrive, and for that round trip
  // the card said "No invoices yet." and the strip said "Invoices due 0 / all
  // settled" to a seat whose org has plenty, which is the exact claim this pass
  // set out to remove. The card holds its place with a shimmer rather than
  // vanishing, so the plan card beside it does not change width under the
  // reader on the ordinary path.
  const invoicesSettled = !!invoicesData || !!invoicesError
  const { data: subData, isLoading: subLoading } = useResource<SubscriptionResp>('/api/portal/subscription')

  // Retainer (TrackBoard) vs project (ProjectBoard): derived from the real
  // subscription signal; ctx.clientType is a preview-only override. Defaults to
  // retainer until the subscription loads (the common case).
  const isProject = (ctx.clientType ?? subData?.clientType) === 'project'
  const {
    data: callsData,
    isLoading: callsLoading,
    error: callsError,
    mutate: mutateCalls,
  } = useResource<CallsResp>('/api/portal/calls')
  const {
    data: filesData,
    isLoading: filesLoading,
    error: filesError,
    mutate: mutateFiles,
  } = useResource<FilesResp>('/api/portal/files')
  const {
    data: teamData,
    isLoading: teamLoading,
    error: teamError,
    mutate: mutateTeam,
  } = useResource<TeamResp>('/api/portal/team')
  const {
    data: tracksData,
    isLoading: tracksLoading,
    error: tracksError,
    mutate: mutateTracks,
  } = useResource<TracksResp>(isProject ? null : '/api/portal/tracks')
  const {
    data: projectData,
    isLoading: projectLoading,
    error: projectError,
    mutate: mutateProject,
  } = useResource<ProjectResp>(isProject ? '/api/portal/project' : null)

  // A read that FAILED, distinguished from a read that came back empty. SWR
  // keeps the last good payload through a failed revalidation, so a card only
  // switches to the error state when it has nothing to show at all: a 403 from
  // requirePortalFeature, a 500, or an offline first load. Before this only the
  // invoices read branched on `error`, so every other card printed its empty
  // copy at a client whose account is full.
  const requestsFailed = !requestsData && !!requestsError
  const reviewFailed = !reviewData && !!reviewError
  // The dedicated client_review read is a nicety; the active list carries the
  // same rows. Only when BOTH are gone is the review signal genuinely unknown.
  const reviewSignalFailed = requestsFailed && reviewFailed
  const callsFailed = !callsData && !!callsError
  const filesFailed = !filesData && !!filesError
  const teamFailed = !teamData && !!teamError
  const tracksFailed = !tracksData && !!tracksError
  const projectFailed = !projectData && !!projectError
  const retryRequests = useCallback(() => {
    void mutateRequests()
    void mutateReview()
  }, [mutateRequests, mutateReview])

  const requests = useMemo(() => requestsData?.requests ?? [], [requestsData])
  const invoices = useMemo(() => invoicesData?.items ?? [], [invoicesData])
  const calls = callsData?.items ?? []
  const files = filesData?.items ?? []
  const team = teamData?.items ?? []
  const tracks = useMemo(() => tracksData?.items ?? [], [tracksData])

  // ── derived: requests ───────────────────────────────────────────────────────
  // /api/portal/requests?status=active only excludes 'archived', so this list
  // carries the client's whole delivered history. partitionClientRequests keeps
  // that history out of the review signal: only client_review is waiting on
  // them, and approving a delivery now moves it OUT of the count rather than
  // parking it there forever.
  const buckets = useMemo(() => partitionClientRequests(requests), [requests])
  // The dedicated status=client_review read is authoritative once it lands. The
  // page-one slice of the active list stands in until then, so the figure never
  // flashes zero on first paint.
  const inReview = useMemo(() => reviewData?.requests ?? buckets.review, [reviewData, buckets.review])
  const openReqs = buckets.open
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

  // ── row destinations ────────────────────────────────────────────────────────
  // Every row on this home used to route to the list it came from. These land
  // on the item instead: a hosted pay page or a served file opens in a new tab,
  // anything in-app goes through the switcher's go().
  const openDestination = useCallback((dest: HomeDestination) => openHomeDestination(dest, go), [go])

  // ── wire ────────────────────────────────────────────────────────────────────
  const wire: WireEvent[] = (activityData?.items ?? []).map(e => ({
    color: e.color,
    who: e.who,
    what: e.what,
    when: e.when,
  }))

  // -- waiting on you (ranked: review > invoice > call) ------------------------
  // Every row here is a door. A review opens that request on its approve view,
  // an invoice opens the payment page, a call opens the meeting. The tile shows
  // three and expands to the rest, so a fourth thing waiting is never a count
  // with nowhere to go.
  const waiting: WaitingItem[] = []
  for (const r of inReview) {
    waiting.push({
      key: r.id,
      kind: 'review',
      ic: 'spark',
      title: r.title,
      sub: `Ready for your review, updated ${deliveryLabel(r.updatedAt)}. Approve it, or tell us what to change.`,
      primary: { label: 'Review', onAct: () => go(requestRouteId(r.id)) },
    })
  }
  if (nearestUnpaid) {
    waiting.push({
      key: nearestUnpaid.id,
      kind: 'invoice',
      ic: 'receipt',
      title: `${invoiceLabel(nearestUnpaid)}, ${formatNative(
        nearestUnpaid.totalAmount,
        nearestUnpaid.currency ?? 'NZD',
      )}`,
      sub: dueLabel(nearestUnpaid.dueDate),
      open: { label: 'See all invoices', onOpen: () => go('invoices') },
      // Withheld, not merely disabled, under the read-only lens: an
      // impersonating admin must not reach a client's live payment page, and
      // the tile disables any action that arrives with no handler.
      primary: {
        label: 'Pay',
        onAct: moneyRo ? undefined : () => openDestination(invoicePayDestination(nearestUnpaid)),
      },
    })
  }
  // Only when there is somewhere to go. /calls is a studio page that redirects
  // a client back to /overview, so a "Join" with no link would be a button that
  // returns them to the page they pressed it on. The Next call card still shows
  // the booking either way.
  const c = calls[0]
  const joinUrl = c?.meetingUrl
  if (c && joinUrl) {
    waiting.push({
      key: c.id,
      kind: 'call',
      ic: 'phone',
      title: c.title,
      sub: callWhen(c.whenISO, c.durationMin),
      primary: { label: 'Join', onAct: () => window.open(joinUrl, '_blank', 'noopener,noreferrer') },
    })
  }
  // The tile may only claim "All quiet in the studio." once every read behind
  // it has answered: saying that to somebody with two deliveries waiting, for
  // the length of a round trip, is the exact lie this pass set out to remove.
  // It does NOT wait on the slow ones to show what it already knows, though.
  // As soon as there is a row, the row paints, and the others join it: the
  // hero of the page must not sit as a skeleton because the invoices route is
  // taking its time.
  // The dedicated status=client_review read is authoritative, and the page-one
  // slice of the active list stands in until it lands, so this is only unknown
  // while BOTH are still in flight.
  const reviewUnknown = requestsLoading && reviewLoading
  const waitingUnsettled = reviewUnknown || !invoicesSettled || callsLoading
  const waitingLoading = waiting.length === 0 ? waitingUnsettled : reviewUnknown
  // A failed requests read must never become "Nothing here yet. Send us the
  // first thing", which is what an established client saw the moment
  // /api/portal/requests 403'd or 500'd. First run is a claim about what came
  // back, so it needs something to have come back.
  const noRequestsAtAll = !requestsLoading && !requestsFailed && requests.length === 0

  // -- vitals ------------------------------------------------------------------
  // A vital whose read failed is LEFT OUT rather than printed as a 0. "Open
  // requests 0 / in progress" is a claim, and a 403 is not evidence for it.
  // The strip is flex, so the rest simply share the width, exactly as the
  // invoices vital already does when that read is denied.
  const vitals: VitalItem[] = []
  if (!requestsFailed) {
    vitals.push({
      lbl: 'Open requests',
      num: requestsLoading ? <SkelFigure width="2.5rem" /> : openReqs.length,
      sub: requestsLoading ? <SkelFigure width="4.5rem" /> : 'in progress',
    })
  }
  // "To approve", NOT "Waiting on you". The tile directly above it is headed
  // "Waiting on you" and counts reviews plus an invoice plus a call, so two
  // adjacent elements carried the same words over different numbers: a client
  // with one delivery, one bill and one call read "Waiting on you 3" sitting on
  // top of "Waiting on you / 1". The tile owns the phrase; this vital says the
  // narrower thing it actually counts.
  if (!reviewSignalFailed) {
    vitals.push({
      lbl: 'To approve',
      num: reviewUnknown ? <SkelFigure width="2.5rem" /> : inReview.length,
      muted: !reviewUnknown && inReview.length === 0,
      sub: reviewUnknown ? (
        <SkelFigure width="6rem" />
      ) : inReview.length === 0 ? (
        'nothing right now'
      ) : (
        `${inReview.length === 1 ? 'delivery' : 'deliveries'} ready for you`
      ),
    })
  }
  if (!requestsFailed) {
    vitals.push({
      lbl: 'Next delivery',
      num: requestsLoading ? (
        <SkelFigure width="4rem" />
      ) : nextDelivery ? (
        deliveryLabel(nextDelivery.dueDate)
      ) : (
        'None'
      ),
      muted: !requestsLoading && !nextDelivery,
      sub: requestsLoading ? (
        <SkelFigure width="6rem" />
      ) : nextDelivery ? (
        nextDelivery.title
      ) : (
        'nothing scheduled'
      ),
    })
  }
  // A project client used to read their overall percentage off the hero. The
  // hero is now the "Waiting on you" tile, so the figure moves here rather than
  // being dropped.
  if (isProject && !projectFailed) {
    const projectPhases = projectData?.phases ?? []
    const activePhase = projectPhases.find(ph => ph.state === 'active') ?? null
    const doneCount = projectPhases.filter(ph => ph.state === 'done').length
    const overallPct = projectPhases.length
      ? Math.round((100 * (doneCount + (activePhase ? activePhase.pct / 100 : 0))) / projectPhases.length)
      : 0
    const knownProgress = !!projectData?.progressKnown && projectPhases.length > 0
    vitals.push({
      lbl: 'Project progress',
      num: projectLoading ? (
        <SkelFigure width="3rem" />
      ) : knownProgress ? (
        `${overallPct}%`
      ) : (
        activePhase?.name ?? projectData?.project?.status ?? 'Getting started'
      ),
      muted: !projectLoading && !knownProgress,
      sub: projectLoading ? (
        <SkelFigure width="6rem" />
      ) : activePhase ? (
        activePhase.name
      ) : (
        'your plan is being set up'
      ),
    })
  }
  // "Invoices due 0 / all settled" is a claim about money this seat is not
  // allowed to see, so the tile goes rather than reassuring somebody wrongly.
  // The strip is flex, so the rest simply share the width. It stays away until
  // the read has answered, too: a reassurance nobody has checked yet is the
  // same lie one round trip earlier.
  if (invoicesSettled && !invoicesDenied) {
    vitals.push({
      lbl: 'Invoices due',
      num: invDueDisplay,
      muted: unpaid.length === 0,
      sub:
        unpaid.length === 0
          ? 'all settled'
          : `${unpaid.length} \u00b7 ${nearestUnpaid ? dueLabel(nearestUnpaid.dueDate) : 'due soon'}`,
    })
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

  // Every "new request" affordance on this page used to route to /requests,
  // the LIST, where the reader had to find and press New a second time. The
  // list opens the real dialog on ?new=1, so the home hands straight to it.
  const startRequest = useCallback(() => {
    if (ro) return
    go('requests?new=1')
  }, [ro, go])

  const planLabel = subData?.subscription?.planLabel ?? null
  const firstName = firstNameOf(ctx.userName)
  const [today, setToday] = useState('')
  useEffect(() => {
    setToday(todayLabel())
  }, [])
  const recent = requests.slice(0, 5)
  const nextCall = calls[0] ?? null
  const payDisabled: CSSProperties = moneyRo ? { opacity: 0.5, pointerEvents: 'none' } : {}

  return (
    <div className="ov" data-ro={ro ? '1' : '0'}>
      {/* A header, at last. This page had no greeting, no date and no top-level
          way to start a request: the only primary CTA was a menu tucked inside
          the hero that routed to the requests LIST.
          It sits ABOVE the first-run panel so the page opens on its h1 rather
          than on the panel's h2, and so a brand new client is not greeted
          twice in adjacent blocks. */}
      <div className="pfh-mast">
        <div className="pfh-mast-t">
          <h1>Kia ora{firstName ? `, ${firstName}` : ''}.</h1>
          <p>
            {/* Resolved after mount: the server and the reader are rarely in
                the same timezone, and a date is the classic hydration
                mismatch. */}
            {today && (
              <>
                {today}
                <span className="pfh-mast-dot" aria-hidden="true" />
              </>
            )}
            {ctx.orgName || 'Your workspace'}
            {planLabel ? ` on the ${planLabel} plan` : ''}
          </p>
        </div>
        <button
          type="button"
          className="pfh-mast-cta tahi-focus-ring"
          disabled={ro}
          onClick={startRequest}
          title={ro ? `Read-only while you are viewing as ${ctx.previewName ?? 'the client'}` : undefined}
        >
          <Icon n="plus" s={15} />
          New request
        </button>
      </div>

      <ClientFirstRun ctx={ctx} />

      <div className="ov-mast">
        <TheWire events={wire} />
        {/* The hero IS the thing that needs them. The old page led with a green
            number nobody could press and then repeated the same facts one strip
            lower, so the client's single most valuable action was never the
            most prominent element on their own home page. */}
        <WaitingOnYou
          items={waiting}
          loading={waitingLoading}
          failed={reviewSignalFailed}
          onRetry={retryRequests}
          ro={ro}
          previewName={ctx.previewName}
          onStart={startRequest}
          isFirstRun={noRequestsAtAll}
        />
        {/* Every reading behind the strip can now be withheld (a denied
            invoices read, a failed requests read), and an empty .ov-vitals is
            a bordered hairline with nothing in it. */}
        {vitals.length > 0 && <Vitals items={vitals} />}
      </div>

      <Zone label="Your work">
        <div className="ov-col-12">
          {isProject ? (
            <ProjectBoard
              project={projectData}
              ro={ro}
              loading={subLoading || projectLoading}
              failed={projectFailed}
              onRetry={() => { void mutateProject() }}
              onStart={startRequest}
            />
          ) : (
            <TrackBoard
              tracks={tracks}
              planLabel={planLabel}
              ro={ro}
              loading={subLoading || tracksLoading}
              failed={tracksFailed}
              onRetry={() => { void mutateTracks() }}
              onStart={startRequest}
              onReorder={onReorder}
            />
          )}
        </div>
      </Zone>

      <Zone label="Activity">
        <Card span={7}>
          <CardH ic="tasks" title="Recent requests" link="All requests" onLink={() => go('requests')} />
          {requestsFailed ? (
            <CardError what="Your requests" onRetry={retryRequests} />
          ) : requestsLoading ? (
            <SkelRows rows={4} />
          ) : recent.length > 0 ? (
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
                    right={
                      <span className={'ov-chip ' + meta.chip} title={meta.gloss || undefined}>
                        {meta.label}
                      </span>
                    }
                    onClick={() => go(requestRouteId(r.id))}
                  />
                )
              })}
            </div>
          ) : (
            <div className="pfh-empty-cta">
              <div className="ov-mini">No requests yet. Start one whenever you are ready.</div>
              <button className="ov-cta" disabled={ro} onClick={startRequest}>
                New request
              </button>
            </div>
          )}
        </Card>
        <Card span={5}>
          <CardH ic="phone" title="Next call" />
          {callsFailed ? (
            <CardError what="Your calls" onRetry={() => { void mutateCalls() }} />
          ) : callsLoading ? (
            <SkelRows rows={2} height="2.75rem" />
          ) : nextCall ? (
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
              {/* No client-side booking surface exists yet (/calls is a studio
                  page that redirects a client back here), so this says how to
                  move a call rather than offering a button that bounces. */}
              <div className="ov-mini" style={{ marginTop: 'auto', paddingTop: 12 }}>
                Need a different time? Reply to your confirmation email and we will move it.
              </div>
            </>
          ) : (
            <>
              <div className="ov-mini">No calls scheduled right now.</div>
              <div className="ov-mini" style={{ marginTop: 'auto', paddingTop: 12 }}>
                Your lead sets the next one, or email us any time.
              </div>
            </>
          )}
        </Card>
      </Zone>

      <Zone label="Library">
        <Card span={6}>
          <CardH ic="file" title="Recent files" link="All files" onLink={() => go('files')} />
          {filesFailed ? (
            <CardError what="Your files" onRetry={() => { void mutateFiles() }} />
          ) : filesLoading ? (
            <SkelRows rows={4} />
          ) : files.length > 0 ? (
            <div className="ov-rows">
              {files.slice(0, 4).map(f => (
                <Row
                  key={f.id}
                  title={f.name}
                  sub={`Shared by ${f.uploadedBy}${f.ago ? ` · ${f.ago}` : ''}`}
                  right={<span className="ov-chip muted">{f.type}</span>}
                  onClick={() => openDestination(fileOpenDestination(f))}
                />
              ))}
            </div>
          ) : (
            <div className="ov-mini">No files shared yet.</div>
          )}
        </Card>
        <Card span={6}>
          <CardH ic="users" title="Your team" />
          {teamFailed ? (
            <CardError what="Your team" onRetry={() => { void mutateTeam() }} />
          ) : teamLoading ? (
            <SkelRows rows={2} height="2.75rem" />
          ) : team.length > 0 ? (
            <>
              <div className="ov-rows">
                {team.map(m => (
                  <Row
                    key={m.id}
                    avText={m.avatarUrl ? undefined : initials(m.name)}
                    img={m.avatarUrl ?? undefined}
                    title={m.name}
                    sub={m.role}
                  />
                ))}
              </div>
              {/* This card used to carry a permanently disabled "Soon" button
                  on its first row, an affordance for a Messages surface that
                  redirects a client away. A question lives on the request it is
                  about, so the card says where to ask instead. */}
              <div className="ov-mini" style={{ marginTop: 'auto', paddingTop: '0.75rem' }}>
                Questions live on the request they are about, so the answer stays next to the work.
              </div>
            </>
          ) : (
            <div className="ov-mini">Your team is being assigned. They will show up here soon.</div>
          )}
        </Card>
      </Zone>

      <Zone label="Billing">
        {/* A seat that may not read the org's invoices gets no invoices card at
            all. Rendering it empty told them "No invoices yet." about bills
            that exist, beside a Pay button for a list they were never served.
            The plan card takes the full row in its place.
            While the read is still in flight the card is a shimmer in the same
            span, so the answer arrives without the plan card jumping from 5 to
            12 and back under the reader. */}
        {!invoicesSettled && (
          <Card span={7} edge="warn">
            <CardH ic="receipt" title="Invoices" />
            <div className="tahi-shimmer" style={{ height: '5.5rem', borderRadius: '0.625rem' }} />
          </Card>
        )}
        {invoicesSettled && !invoicesDenied && (
        <Card span={7} edge="warn">
          {/* The link goes to /invoices, so it says so. "Billing" pointed at a
              different page in the client's head (and at a real /billing route
              that is not in their nav). */}
          <CardH ic="receipt" title="Invoices" link="All invoices" onLink={() => go('invoices')} />
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
                          {/* Sizing lives in overview.css under .ov-pay, not in
                              an inline height, so a coarse pointer and the
                              narrow container can raise it to the 2.75rem touch
                              minimum. This is the only control on the client
                              home that reaches a payment page. */}
                          <button
                            className="ov-cta ov-pay"
                            disabled={moneyRo}
                            style={payDisabled}
                            onClick={() => openDestination(invoicePayDestination(inv))}
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
        )}

        {isProject ? (
          <Card span={invoicesDenied ? 12 : 5}>
            {/* No "Details" link: /proposals redirects a client to /requests,
                and this branch removed it from the client nav for that reason. */}
            <CardH ic="wallet" title="Your project" />
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
          <Card span={invoicesDenied ? 12 : 5}>
            {/* No "Manage" link: it went to /billing, a page that is not in the
                client nav, so a client who pressed it had no way back. Another
                track is a conversation, so the card asks for one instead. */}
            <CardH ic="wallet" title="Your plan" />
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
            <div className="pfh-empty-cta" style={{ marginTop: 'auto', paddingTop: '0.75rem' }}>
              <button className="ov-cta ghost" disabled={ro} onClick={startRequest}>
                Ask about your plan
              </button>
            </div>
          </Card>
        )}
      </Zone>
    </div>
  )
}
