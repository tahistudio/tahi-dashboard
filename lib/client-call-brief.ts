/**
 * lib/client-call-brief.ts
 *
 * LP.4: the pre-call brief for a call with an EXISTING client.
 *
 * The discovery pre-call digest (app/api/admin/cron/pre-call-digest) answers
 * "who is this lead and what should I ask". This answers the other question:
 * "I am about to talk to a client we already work for, what is the state of
 * play". One scannable brief: the last calls and what was decided, open
 * requests, anything handed to the client, open tasks and blockers, scope
 * creep flags and (only when the viewer may see finance) the invoice
 * position, each item carrying a link to its source.
 *
 * Everything here is PURE: rows in, brief out, no D1, no clock except the
 * `now` the caller passes. The drizzle half is lib/client-call-brief-data.ts.
 * The "what to raise" lines are deterministic rules over the same rows. No
 * model is called: the existing Haiku routes have no shared cost guard to
 * reuse, and a rule list is predictable enough for a pre-call glance.
 */

import { REQUEST_CLOSED_STATUSES, TASK_CLOSED_STATUSES } from '@/lib/status-config'
import { daysWaiting, handoffReasonLabel } from '@/lib/request-handoff-copy'
import { requestRef } from '@/lib/blockers'

/** Caps keep the brief scannable. The totals are reported so nothing is hidden silently. */
export const BRIEF_CAPS = {
  pastCalls: 5,
  requests: 10,
  handoffs: 10,
  tasks: 10,
  blockers: 10,
  scopeFlags: 10,
  raise: 6,
} as const

/** Calls that did not take place say nothing, so they are not history. */
const NOT_HISTORY = new Set(['cancelled', 'no_show', 'rescheduled'])
const SUMMARY_MAX_CHARS = 400
const DECISION_MAX_CHARS = 300
const SOON_DAYS = 3

// ── Input rows (what the data layer hands over) ──────────────────────────────

export interface BriefCallInput {
  id: string
  title: string
  scheduledAt: string
  orgId: string | null
}

export interface BriefOrgInput {
  id: string
  name: string
}

export interface BriefPastCallRow {
  id: string
  title: string
  scheduledAt: string
  status: string
  summary: string | null
  /** Summary from the linked call_transcripts row, preferred over `summary`. */
  transcriptSummary: string | null
  outcome: string | null
  outcomeNotes: string | null
  scopeNotes: string | null
}

export interface BriefRequestRow {
  id: string
  title: string
  requestNumber: number | null
  status: string
  priority: string
  dueDate: string | null
  scopeFlagged: boolean
  scopeFlagReason: string | null
  revisionCount: number | null
  maxRevisions: number | null
  waitingOnContactId: string | null
  waitingOnContactName: string | null
  waitingReason: string | null
  waitingSince: string | null
  waitingDueAt: string | null
  waitingNote: string | null
}

export interface BriefTaskRow {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  requestId: string | null
}

export interface BriefBlockerRow {
  blockedType: 'task' | 'request'
  blockedId: string
  blockedTitle: string
  blockerTitle: string
}

export interface BriefInvoiceRow {
  id: string
  number: string | null
  status: string
  totalUsd: number
  currency: string | null
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
}

export interface ClientCallBriefInput {
  call: BriefCallInput
  /** Null when the call has no client org (or the org row is gone). */
  org: BriefOrgInput | null
  pastCalls: readonly BriefPastCallRow[]
  requests: readonly BriefRequestRow[]
  tasks: readonly BriefTaskRow[]
  blockers: readonly BriefBlockerRow[]
  /** Null means the viewer may NOT see finance. An empty array means they may and there is none. */
  invoices: readonly BriefInvoiceRow[] | null
  /** True when the viewer lacks the requests or tasks feature, so an empty brief may be a permissions gap. */
  sectionsHidden?: boolean
  now: Date
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface BriefSource {
  label: string
  href: string
}

export interface BriefPastCall {
  id: string
  title: string
  scheduledAt: string
  outcome: string | null
  summary: string | null
  decisions: string | null
  href: string
}

export interface BriefRequest {
  id: string
  ref: string | null
  title: string
  status: string
  priority: string
  dueDate: string | null
  overdue: boolean
  href: string
}

export interface BriefHandoff {
  requestId: string
  ref: string | null
  title: string
  contactName: string | null
  reason: string
  daysWaiting: number
  dueAt: string | null
  note: string | null
  href: string
}

export interface BriefTask {
  id: string
  title: string
  status: string
  priority: string
  dueDate: string | null
  overdue: boolean
  href: string
}

export interface BriefBlocker {
  blockedType: 'task' | 'request'
  blockedId: string
  blockedTitle: string
  blockerTitle: string
  href: string
}

export interface BriefScopeFlag {
  requestId: string
  ref: string | null
  title: string
  reason: string | null
  revisions: string | null
  href: string
}

export interface BriefFinance {
  lastInvoice: {
    id: string
    reference: string
    status: string
    total: number
    currency: string
    dueDate: string | null
    href: string
  } | null
  overdue: Array<{ id: string; reference: string; total: number; currency: string; dueDate: string | null; href: string }>
  /** Per currency, never converted or summed across currencies. */
  overdueTotals: Array<{ currency: string; total: number }>
}

/** Counts before the caps were applied, so the UI can say "and 4 more". */
export interface BriefTotals {
  pastCalls: number
  requests: number
  handoffs: number
  tasks: number
  blockers: number
  scopeFlags: number
}

export interface ClientCallBrief {
  callId: string
  callTitle: string
  scheduledAt: string
  generatedAt: string
  /** 'no_org' = the call is not linked to a client yet, so there is no history to assemble. */
  state: 'ready' | 'no_org'
  /** Some sections were left out because of the viewer's permissions. */
  sectionsHidden: boolean
  org: { id: string; name: string; href: string } | null
  pastCalls: BriefPastCall[]
  openRequests: BriefRequest[]
  handoffs: BriefHandoff[]
  openTasks: BriefTask[]
  blockers: BriefBlocker[]
  scopeFlags: BriefScopeFlag[]
  /** Null when the viewer may not see finance: the section must not render at all. */
  finance: BriefFinance | null
  /** Deterministic talking points, most pressing first. */
  raise: string[]
  sources: BriefSource[]
  totals: BriefTotals
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clip(text: string | null | undefined, max: number): string | null {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat
}

function instant(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Date-only strings (YYYY-MM-DD) are due at the END of that day. */
function isPastDue(due: string | null, now: Date): boolean {
  if (!due) return false
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due)
  const ms = instant(dateOnly ? `${due}T23:59:59Z` : due)
  return ms !== null && ms < now.getTime()
}

function isDueSoon(due: string | null, now: Date): boolean {
  if (!due || isPastDue(due, now)) return false
  const ms = instant(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:59Z` : due)
  return ms !== null && ms - now.getTime() <= SOON_DAYS * 86_400_000
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, standard: 2 }

function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? 2
}

/** Earlier due date first; no due date last. */
function dueCompare(a: string | null, b: string | null): number {
  const am = instant(a)
  const bm = instant(b)
  if (am === null && bm === null) return 0
  if (am === null) return 1
  if (bm === null) return -1
  return am - bm
}

function money(total: number, currency: string): string {
  return `${currency} ${total.toFixed(2)}`
}

/** Group on the invoice's own currency. Amounts are never converted or added across currencies. */
function totalsByCurrency(rows: readonly BriefInvoiceRow[]): Array<{ currency: string; total: number }> {
  const sums = new Map<string, number>()
  for (const i of rows) {
    const cur = i.currency?.trim() || 'USD'
    sums.set(cur, (sums.get(cur) ?? 0) + i.totalUsd)
  }
  return [...sums.entries()]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

function invoiceReference(row: BriefInvoiceRow): string {
  return row.number?.trim() || `#${row.id.slice(0, 8)}`
}

export const requestHref = (id: string): string => `/requests/${id}`
export const taskHref = (id: string): string => `/tasks/${id}`
export const callHref = (id: string): string => `/calls?call=${encodeURIComponent(id)}`
export const clientHref = (id: string): string => `/clients/${id}`
export const invoiceHref = (id: string): string => `/invoices/${id}`

const PAID_STATUSES = new Set(['paid', 'written_off', 'draft'])

function isInvoiceOverdue(row: BriefInvoiceRow, now: Date): boolean {
  if (row.paidAt || PAID_STATUSES.has(row.status)) return false
  if (row.status === 'overdue') return true
  return isPastDue(row.dueDate, now)
}

// ── The builder ──────────────────────────────────────────────────────────────

export function buildClientCallBrief(input: ClientCallBriefInput): ClientCallBrief {
  const { call, org, now } = input
  const base = {
    callId: call.id,
    callTitle: call.title,
    scheduledAt: call.scheduledAt,
    generatedAt: now.toISOString(),
    sectionsHidden: input.sectionsHidden === true,
  }

  if (!org) {
    return {
      ...base,
      state: 'no_org',
      org: null,
      pastCalls: [],
      openRequests: [],
      handoffs: [],
      openTasks: [],
      blockers: [],
      scopeFlags: [],
      finance: null,
      raise: [],
      sources: [],
      totals: { pastCalls: 0, requests: 0, handoffs: 0, tasks: 0, blockers: 0, scopeFlags: 0 },
    }
  }

  // Past calls: other calls with this client that have already happened,
  // newest first. Cancelled, no-show and rescheduled calls are not history.
  const callMs = instant(call.scheduledAt)
  const history = input.pastCalls
    .filter(c => c.id !== call.id && !NOT_HISTORY.has(c.status))
    .filter(c => {
      const ms = instant(c.scheduledAt)
      if (ms === null) return false
      return callMs !== null ? ms < callMs : ms < now.getTime()
    })
    .sort((a, b) => (instant(b.scheduledAt) ?? 0) - (instant(a.scheduledAt) ?? 0))
  const pastCalls: BriefPastCall[] = history.slice(0, BRIEF_CAPS.pastCalls).map(c => ({
    id: c.id,
    title: c.title,
    scheduledAt: c.scheduledAt,
    outcome: c.outcome,
    summary: clip(c.transcriptSummary ?? c.summary, SUMMARY_MAX_CHARS),
    decisions: clip(c.outcomeNotes ?? c.scopeNotes, DECISION_MAX_CHARS),
    href: callHref(c.id),
  }))

  // Open requests: not closed, not a draft. Pressing first.
  const openRequestRows = input.requests
    .filter(r => !REQUEST_CLOSED_STATUSES.includes(r.status) && r.status !== 'draft')
    .sort((a, b) =>
      Number(isPastDue(b.dueDate, now)) - Number(isPastDue(a.dueDate, now))
      || priorityRank(a.priority) - priorityRank(b.priority)
      || dueCompare(a.dueDate, b.dueDate)
      || a.title.localeCompare(b.title))
  const openRequests: BriefRequest[] = openRequestRows.slice(0, BRIEF_CAPS.requests).map(r => ({
    id: r.id,
    ref: requestRef(r.requestNumber),
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueDate: r.dueDate,
    overdue: isPastDue(r.dueDate, now),
    href: requestHref(r.id),
  }))

  // Hand-offs: open requests currently sitting with a named client contact.
  const handoffRows = openRequestRows
    .filter(r => r.waitingOnContactId)
    .sort((a, b) => daysWaiting(b.waitingSince, now) - daysWaiting(a.waitingSince, now))
  const handoffs: BriefHandoff[] = handoffRows.slice(0, BRIEF_CAPS.handoffs).map(r => ({
    requestId: r.id,
    ref: requestRef(r.requestNumber),
    title: r.title,
    contactName: r.waitingOnContactName,
    reason: handoffReasonLabel(r.waitingReason),
    daysWaiting: daysWaiting(r.waitingSince, now),
    dueAt: r.waitingDueAt,
    note: clip(r.waitingNote, DECISION_MAX_CHARS),
    href: requestHref(r.id),
  }))

  // Open tasks: blocked first, then overdue, then priority, then due date.
  const openTaskRows = input.tasks
    .filter(t => !TASK_CLOSED_STATUSES.includes(t.status))
    .sort((a, b) =>
      Number(b.status === 'blocked') - Number(a.status === 'blocked')
      || Number(isPastDue(b.dueDate, now)) - Number(isPastDue(a.dueDate, now))
      || priorityRank(a.priority) - priorityRank(b.priority)
      || dueCompare(a.dueDate, b.dueDate)
      || a.title.localeCompare(b.title))
  const openTasks: BriefTask[] = openTaskRows.slice(0, BRIEF_CAPS.tasks).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    overdue: isPastDue(t.dueDate, now),
    href: taskHref(t.id),
  }))

  const blockers: BriefBlocker[] = input.blockers.slice(0, BRIEF_CAPS.blockers).map(b => ({
    ...b,
    href: b.blockedType === 'task' ? taskHref(b.blockedId) : requestHref(b.blockedId),
  }))

  // Scope flags are an open-request signal only: a delivered request is settled.
  const flagRows = openRequestRows.filter(r => r.scopeFlagged)
  const scopeFlags: BriefScopeFlag[] = flagRows.slice(0, BRIEF_CAPS.scopeFlags).map(r => ({
    requestId: r.id,
    ref: requestRef(r.requestNumber),
    title: r.title,
    reason: clip(r.scopeFlagReason, DECISION_MAX_CHARS),
    revisions: r.maxRevisions != null && r.revisionCount != null
      ? `${r.revisionCount} of ${r.maxRevisions} revisions used`
      : null,
    href: requestHref(r.id),
  }))

  // Finance: only when the caller proved the viewer may see it.
  let finance: BriefFinance | null = null
  let overdueRows: BriefInvoiceRow[] = []
  if (input.invoices) {
    const sent = input.invoices
      .filter(i => i.status !== 'draft')
      .sort((a, b) => (instant(b.sentAt ?? b.dueDate) ?? 0) - (instant(a.sentAt ?? a.dueDate) ?? 0))
    const last = sent[0] ?? null
    overdueRows = input.invoices
      .filter(i => isInvoiceOverdue(i, now))
      .sort((a, b) => dueCompare(a.dueDate, b.dueDate))
    finance = {
      lastInvoice: last
        ? {
            id: last.id,
            reference: invoiceReference(last),
            status: last.status,
            total: last.totalUsd,
            currency: last.currency ?? 'USD',
            dueDate: last.dueDate,
            href: invoiceHref(last.id),
          }
        : null,
      overdue: overdueRows.map(i => ({
        id: i.id,
        reference: invoiceReference(i),
        total: i.totalUsd,
        currency: i.currency ?? 'USD',
        dueDate: i.dueDate,
        href: invoiceHref(i.id),
      })),
      overdueTotals: totalsByCurrency(overdueRows),
    }
  }

  // What to raise: deterministic, most pressing first.
  const raise: string[] = []
  if (finance && overdueRows.length > 0) {
    const first = overdueRows[0]
    raise.push(
      overdueRows.length === 1
        ? `Invoice ${invoiceReference(first)} is overdue (${money(first.totalUsd, first.currency ?? 'USD')}).`
        : `${overdueRows.length} invoices are overdue: ${finance.overdueTotals.map(t => money(t.total, t.currency)).join(' and ')}.`,
    )
  }
  for (const h of handoffRows.slice(0, 2)) {
    const who = h.waitingOnContactName ?? 'the client'
    const days = daysWaiting(h.waitingSince, now)
    raise.push(`Ask ${who} about ${requestRef(h.requestNumber) ?? 'the request'} ${h.title}: ${handoffReasonLabel(h.waitingReason).toLowerCase()}${days > 0 ? `, waiting ${days}d` : ''}.`)
  }
  for (const f of flagRows.slice(0, 2)) {
    raise.push(`Scope on ${requestRef(f.requestNumber) ?? 'a request'} ${f.title} is flagged${f.scopeFlagReason ? `: ${clip(f.scopeFlagReason, 120)}` : ''}.`)
  }
  for (const b of input.blockers.slice(0, 2)) {
    raise.push(`${b.blockedTitle} is blocked by ${b.blockerTitle}.`)
  }
  const overdueWork = openRequestRows.filter(r => isPastDue(r.dueDate, now)).length
    + openTaskRows.filter(t => isPastDue(t.dueDate, now)).length
  if (overdueWork > 0) {
    raise.push(`${overdueWork} open item${overdueWork === 1 ? ' is' : 's are'} past due.`)
  }
  const soon = openRequestRows.filter(r => isDueSoon(r.dueDate, now)).length
  if (soon > 0) raise.push(`${soon} request${soon === 1 ? ' is' : 's are'} due within ${SOON_DAYS} days.`)
  if (history.length === 0) raise.push('No earlier calls on record with this client.')

  // Sources: one link per distinct thing the brief drew on, client first.
  const sources: BriefSource[] = [{ label: `${org.name} client page`, href: clientHref(org.id) }]
  const seen = new Set(sources.map(s => s.href))
  const push = (label: string, href: string) => {
    if (seen.has(href)) return
    seen.add(href)
    sources.push({ label, href })
  }
  for (const c of pastCalls) push(c.title, c.href)
  for (const r of openRequests) push(`${r.ref ? `${r.ref} ` : ''}${r.title}`, r.href)
  for (const t of openTasks) push(t.title, t.href)
  if (finance) {
    if (finance.lastInvoice) push(`Invoice ${finance.lastInvoice.reference}`, finance.lastInvoice.href)
    for (const i of finance.overdue) push(`Invoice ${i.reference}`, i.href)
  }

  return {
    ...base,
    state: 'ready',
    org: { id: org.id, name: org.name, href: clientHref(org.id) },
    pastCalls,
    openRequests,
    handoffs,
    openTasks,
    blockers,
    scopeFlags,
    finance,
    raise: raise.slice(0, BRIEF_CAPS.raise),
    sources,
    totals: {
      pastCalls: history.length,
      requests: openRequestRows.length,
      handoffs: handoffRows.length,
      tasks: openTaskRows.length,
      blockers: input.blockers.length,
      scopeFlags: flagRows.length,
    },
  }
}
