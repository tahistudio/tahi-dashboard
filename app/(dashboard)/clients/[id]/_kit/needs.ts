/**
 * needsFor(): what this client needs from you today, in priority order.
 *
 * Pure. It takes the rows the client page has already loaded and returns a
 * list of one-line claims with the action that answers each one, so the strip
 * on Overview never has to guess and the rules stay unit-testable.
 *
 * Every rule is grounded in data the repo actually returns. Where the design
 * assumed a field the repo has no source for (a per-client `lastTouch`, an
 * array of health `reasons`), the rule reads the nearest honest substitute:
 * the newest request update or held call for last touch, and the saved health
 * note for the reason. A rule with nothing behind it is not emitted at all,
 * because a claim the operator cannot verify is worse than silence.
 */

import type { ClientTabId } from './types'

export type NeedTone = 'danger' | 'warn' | 'info'

export interface NeedItem {
  key: string
  tone: NeedTone
  /** The claim, in plain words. */
  text: string
  /** The label on the button that answers it. */
  action: string
  /** Which tab the action opens. */
  tab?: ClientTabId
  /** A request to open instead of switching tab. */
  requestId?: string
}

export interface NeedRequest {
  id: string
  requestNumber?: number | null
  title: string
  status: string
  dueDate?: string | null
  scopeFlagged?: boolean | number | null
  updatedAt?: string | null
  /** Set on a sub-request. The page filters these out before calling in. */
  parentRequestId?: string | null
}

export interface NeedInvoice {
  id: string
  status: string
  totalAmount: number
  currency?: string | null
  dueDate?: string | null
  createdAt?: string | null
}

/** Invoice statuses that still count as money out and not yet in. */
export const OPEN_INVOICE_STATUSES = ['sent', 'viewed', 'overdue']

/**
 * The one definition of an overdue invoice on this page.
 *
 * The strip, the Invoices tab badge and the Invoices table all call this, so
 * a row cannot read red in one place and neutral in another. `viewed` counts:
 * a client opening an invoice and not paying it is exactly the case the strip
 * exists for, and only the nightly job ever writes the `overdue` status.
 */
export function isInvoiceOverdue(inv: Pick<NeedInvoice, 'status' | 'dueDate'>, now: Date): boolean {
  if (inv.status === 'overdue') return true
  if (inv.status !== 'sent' && inv.status !== 'viewed') return false
  const due = parse(inv.dueDate)
  return due != null && due < now
}

export interface NeedContract {
  id: string
  name: string
  status: string
  expiryDate?: string | null
}

export interface NeedCall {
  id: string
  scheduledAt: string
  status: string
}

export interface NeedContact {
  id: string
  name: string
  clerkUserId: string | null
}

export interface NeedsInput {
  orgName: string
  status: string
  healthStatus: string | null
  healthNote: string | null
  billingModel: string | null
  requests: NeedRequest[]
  invoices: NeedInvoice[]
  contracts: NeedContract[]
  contacts: NeedContact[]
  calls: NeedCall[]
  trackCount: number
  occupiedTrackCount: number
  /**
   * The viewer holds clients.billing_card. Defaults to true. When false the
   * money rules are dropped rather than shown with a dead action, because the
   * Invoices and Money tabs are not in this viewer's tab strip at all.
   */
  canMoney?: boolean
  /** The onboarding checklist, already derived. Omitted when unknown. */
  onboarding?: OnboardingRead
  /** Now, injectable so the rules are testable without freezing the clock. */
  now?: Date
}

/** What the Overview rail card knows, in the shape the rules need. */
export interface OnboardingRead {
  /** This org still reads as a first run (nothing delivered, still young). */
  firstRunEligible: boolean
  done: number
  total: number
  /** They have never sent a request. Derived, not self-attested. */
  awaitingFirstRequest: boolean
}

/** Statuses that still count as live work on the board. */
export const OPEN_REQUEST_STATUSES = ['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold']

const DAY_MS = 86_400_000
const QUIET_DAYS = 21
const EXPIRY_WARN_DAYS = 60

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function requestLabel(r: NeedRequest): string {
  return r.requestNumber != null ? `#${r.requestNumber} ${r.title}` : r.title
}

/** The first health reason we can honestly show: the saved note, or nothing. */
export function firstHealthReason(input: Pick<NeedsInput, 'healthNote'>): string | null {
  const note = (input.healthNote ?? '').trim()
  if (!note) return null
  // The note is prose. Lead with its first sentence so the strip stays a line.
  const firstSentence = note.split(/(?<=[.!?])\s+/)[0] ?? note
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence
}

export function needsFor(input: NeedsInput): NeedItem[] {
  const now = input.now ?? new Date()
  const out: NeedItem[] = []

  // ── Money that has not landed. Silent for a seat without the billing card:
  // the amount is the same secret the hero's MRR cell and the Money tab are
  // gated on, and the strip's action opens a tab they do not have. ──
  for (const inv of input.canMoney === false ? [] : input.invoices) {
    if (!isInvoiceOverdue(inv, now)) continue
    const due = parse(inv.dueDate)
    const late = due ? daysBetween(due, now) : 0
    out.push({
      key: `inv-${inv.id}`,
      tone: 'danger',
      text: late > 0
        ? `An invoice for ${inv.currency ?? 'NZD'} ${inv.totalAmount.toLocaleString('en-NZ')} is ${plural(late, 'day', 'days')} overdue`
        : `An invoice for ${inv.currency ?? 'NZD'} ${inv.totalAmount.toLocaleString('en-NZ')} is overdue`,
      action: 'Open invoices',
      tab: 'invoices',
    })
  }

  // ── Work that has slipped ──
  for (const r of input.requests) {
    if (!OPEN_REQUEST_STATUSES.includes(r.status)) continue
    const due = parse(r.dueDate)
    if (!due || due >= now) continue
    const late = daysBetween(due, now)
    out.push({
      key: `due-${r.id}`,
      tone: 'danger',
      text: `${requestLabel(r)} is ${plural(Math.max(late, 1), 'day', 'days')} overdue`,
      action: 'Open',
      requestId: r.id,
    })
  }

  // ── Scope the studio has already flagged ──
  for (const r of input.requests) {
    if (!r.scopeFlagged) continue
    if (!OPEN_REQUEST_STATUSES.includes(r.status)) continue
    out.push({
      key: `scope-${r.id}`,
      tone: 'warn',
      text: `${requestLabel(r)} is flagged for scope`,
      action: 'Open',
      requestId: r.id,
    })
  }

  // ── Waiting on the client ──
  for (const r of input.requests) {
    if (r.status !== 'client_review') continue
    const seen = parse(r.updatedAt)
    const waiting = seen ? daysBetween(seen, now) : 0
    out.push({
      key: `review-${r.id}`,
      tone: 'warn',
      text: waiting > 0
        ? `${requestLabel(r)} has been with ${input.orgName} for ${plural(waiting, 'day', 'days')}`
        : `${requestLabel(r)} is waiting on ${input.orgName}`,
      action: 'Open',
      requestId: r.id,
    })
  }

  // ── Still settling in. Only raised while the checklist says this is a first
  // run and the outstanding step is one the studio can actually act on: the
  // other two steps are the client's own (watch the welcome video, upload
  // brand assets) and there is no button here that would move them. ──
  const ob = input.onboarding
  if (ob && ob.firstRunEligible && ob.awaitingFirstRequest) {
    out.push({
      key: 'onboarding',
      tone: 'info',
      text: `Onboarding ${ob.done} of ${ob.total}: ${input.orgName} has not sent a first request yet`,
      action: 'Open requests',
      tab: 'requests',
    })
  }

  // ── People who cannot get in ──
  const withoutPortal = input.contacts.filter(c => !c.clerkUserId)
  if (withoutPortal.length > 0) {
    out.push({
      key: 'invites',
      tone: 'info',
      text: withoutPortal.length === 1
        ? `${withoutPortal[0].name} has no portal access yet`
        : `${withoutPortal.length} contacts have no portal access yet`,
      action: 'Manage seats',
      tab: 'people',
    })
  }

  // ── Paper out for signature, and paper about to lapse ──
  for (const k of input.contracts) {
    if (k.status !== 'sent') continue
    out.push({
      key: `paper-${k.id}`,
      tone: 'info',
      text: `${k.name} is out for signature`,
      action: 'Open papers',
      tab: 'papers',
    })
  }
  for (const k of input.contracts) {
    if (k.status !== 'signed') continue
    const expiry = parse(k.expiryDate)
    if (!expiry) continue
    const left = daysBetween(now, expiry)
    if (left < 0 || left > EXPIRY_WARN_DAYS) continue
    out.push({
      key: `expiry-${k.id}`,
      tone: 'warn',
      text: `${k.name} expires in ${plural(left, 'day', 'days')}`,
      action: 'Open papers',
      tab: 'papers',
    })
  }

  const upcomingCall = input.calls
    .filter(c => c.status === 'scheduled' && (parse(c.scheduledAt)?.getTime() ?? 0) >= now.getTime())
    .sort((a, b) => (parse(a.scheduledAt)?.getTime() ?? 0) - (parse(b.scheduledAt)?.getTime() ?? 0))[0] ?? null

  // ── No call on a live retainer ──
  if (input.status === 'active' && input.billingModel === 'retainer' && !upcomingCall) {
    out.push({
      key: 'nocall',
      tone: 'info',
      text: 'No call is booked. Retainers drift without one.',
      action: 'Book a call',
      tab: 'calls',
    })
  }

  // ── Quiet ──
  if (input.status === 'active') {
    const touches: number[] = []
    for (const r of input.requests) {
      const t = parse(r.updatedAt)?.getTime()
      if (t != null) touches.push(t)
    }
    for (const c of input.calls) {
      const t = parse(c.scheduledAt)?.getTime()
      if (t != null && t <= now.getTime()) touches.push(t)
    }
    if (touches.length > 0) {
      const last = new Date(Math.max(...touches))
      const quiet = daysBetween(last, now)
      if (quiet >= QUIET_DAYS) {
        out.push({
          key: 'quiet',
          tone: 'warn',
          text: `Quiet for ${plural(quiet, 'day', 'days')}. No request moved and no call was held.`,
          action: 'Book a call',
          tab: 'calls',
        })
      }
    }
  }

  // ── Tracks paid for and standing idle ──
  const openWork = input.requests.filter(r => OPEN_REQUEST_STATUSES.includes(r.status))
  if (input.status === 'active' && input.trackCount > 0 && input.occupiedTrackCount === 0 && openWork.length === 0) {
    out.push({
      key: 'idle',
      tone: 'warn',
      text: input.trackCount === 1
        ? 'The track is idle with nothing queued'
        : `All ${input.trackCount} tracks are idle with nothing queued`,
      action: 'Open requests',
      tab: 'requests',
    })
  }

  // ── An at-risk account always leads the strip ──
  if (input.healthStatus === 'red') {
    const reason = firstHealthReason(input)
    out.unshift({
      key: 'risk',
      tone: 'danger',
      text: `At risk: ${reason ?? 'no reason recorded yet, so it needs a proper look'}`,
      action: upcomingCall ? 'Prep the call' : 'Book a call',
      tab: 'calls',
    })
  }

  return out
}
