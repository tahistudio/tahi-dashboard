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
}

export interface NeedInvoice {
  id: string
  status: string
  totalAmount: number
  currency?: string | null
  dueDate?: string | null
  createdAt?: string | null
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
  /** Now, injectable so the rules are testable without freezing the clock. */
  now?: Date
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

  // ── Money that has not landed ──
  for (const inv of input.invoices) {
    const due = parse(inv.dueDate)
    const isOverdue = inv.status === 'overdue' || (inv.status === 'sent' && due != null && due < now)
    if (!isOverdue) continue
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
