/**
 * lib/stamp-invoiced.ts
 *
 * IC.8: the pre-cutover step for the hourly-to-Xero export (IC.6 / CT.13).
 *
 * Migration 0095 added time_entries.invoice_id and invoiced_at as the export's
 * idempotency key, but shipped with no backfill: every entry logged before the
 * export existed carries invoice_id = NULL, which is indistinguishable from
 * "never billed." Any of those hours that were already invoiced by hand
 * (through the old ManyRequests flow, or typed straight into Xero) would be
 * billed a SECOND time the first time POST /api/admin/billing/xero-export runs
 * over that period.
 *
 * This module is the pure planner behind POST /api/admin/time/stamp-invoiced,
 * which draws a line at a cutoff date and marks every entry on or before it as
 * already accounted for, WITHOUT raising an invoice and WITHOUT calling Xero.
 * It stamps invoiced_at = now and leaves invoice_id NULL on purpose: invoice_id
 * means "this is the local invoice that billed these hours," and there is no
 * such invoice for historical hours billed outside this app. invoiced_at alone
 * is enough to keep the export from touching them: POST
 * /api/admin/billing/xero-export now selects candidates with
 * invoice_id IS NULL AND invoiced_at IS NULL, so a stamped row drops out of the
 * next export's candidate list the same way an actually-invoiced row does.
 *
 * Same shape as lib/hourly-export.ts on purpose: an org either gets a plan (the
 * entries this call would stamp) or a refusal carrying a reason, a sentence an
 * operator can act on, and the entry ids left untouched. Nothing is dropped
 * quietly. Pure on purpose so every branch is unit testable without a D1
 * handle (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

/** One time entry on or before the cutoff, in whatever invoice state it holds. */
export interface StampInvoicedEntry {
  id: string
  orgId: string
  hours: number
  hourlyRate: number | null
  /** Already carries a local invoice. Never re-stamped, never double counted. */
  invoiceId: string | null
  /** Already stamped by an earlier run of this same route. */
  invoicedAt: string | null
}

/** The client row, name only: this planner never needs billing model or rate. */
export interface StampInvoicedOrg {
  id: string
  name: string
}

export type StampInvoicedRefusalReason =
  | 'unknown_org'
  | 'already_invoiced'
  | 'already_stamped'

/** An org, or a slice of one org's entries, that this call will NOT touch. */
export interface StampInvoicedRefusal {
  orgId: string
  orgName: string
  reason: StampInvoicedRefusalReason
  message: string
  entryIds: string[]
}

/** Hours at one rate, inside one org's plan. Rate is null when never set. */
export interface StampInvoicedRateBreakdown {
  rate: number | null
  hours: number
  entryCount: number
}

/** One org's plan: the entries this call would stamp. */
export interface StampInvoicedPlan {
  orgId: string
  orgName: string
  hours: number
  entryCount: number
  entryIds: string[]
  rates: StampInvoicedRateBreakdown[]
}

export interface StampInvoicedPlanResult {
  plans: StampInvoicedPlan[]
  skipped: StampInvoicedRefusal[]
}

export interface StampInvoicedInput {
  /** Every billable entry on or before the cutoff, any invoice state. */
  entries: StampInvoicedEntry[]
  /** Every org referenced by `entries`. */
  orgs: StampInvoicedOrg[]
  /** The cutoff date, YYYY-MM-DD, for the message text only. */
  before: string
}

/**
 * Split entries on or before a cutoff into per-org stamp plans and refusals.
 *
 * Orgs come out in the order their first entry was read, so a re-run reports
 * every client it deliberately did nothing new for, the same convention as
 * planHourlyExport.
 */
export function planStampInvoiced(input: StampInvoicedInput): StampInvoicedPlanResult {
  const orgById = new Map(input.orgs.map(o => [o.id, o]))

  const byOrg = new Map<string, StampInvoicedEntry[]>()
  for (const entry of input.entries) {
    const bucket = byOrg.get(entry.orgId)
    if (bucket) bucket.push(entry)
    else byOrg.set(entry.orgId, [entry])
  }

  const plans: StampInvoicedPlan[] = []
  const skipped: StampInvoicedRefusal[] = []

  for (const [orgId, entries] of byOrg) {
    const org = orgById.get(orgId)
    const orgName = org?.name ?? orgId

    if (!org) {
      skipped.push({
        orgId,
        orgName,
        reason: 'unknown_org',
        message: `${describeEntries(entries.length)} on or before ${input.before} are billed to an organisation that is not in the client book, so nothing was stamped.`,
        entryIds: entries.map(e => e.id),
      })
      continue
    }

    const alreadyInvoiced = entries.filter(e => e.invoiceId !== null && e.invoiceId !== undefined)
    const alreadyStamped = entries.filter(e => (e.invoiceId === null || e.invoiceId === undefined) && !!e.invoicedAt)
    const eligible = entries.filter(e => (e.invoiceId === null || e.invoiceId === undefined) && !e.invoicedAt)

    if (alreadyInvoiced.length > 0) {
      const ids = alreadyInvoiced.map(e => e.id)
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'already_invoiced',
        message: `${org.name}: ${describeEntries(ids.length)} on or before ${input.before} already carry an invoice, so they were left untouched: ${ids.join(', ')}.`,
        entryIds: ids,
      })
    }

    if (alreadyStamped.length > 0) {
      const ids = alreadyStamped.map(e => e.id)
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'already_stamped',
        message: `${org.name}: ${describeEntries(ids.length)} on or before ${input.before} were already stamped as accounted for on an earlier run, so this run stamps nothing new for them.`,
        entryIds: ids,
      })
    }

    if (eligible.length === 0) continue

    const byRate = new Map<number | null, { hours: number; entryIds: string[] }>()
    for (const entry of eligible) {
      const rate = usableRate(entry.hourlyRate)
      const bucket = byRate.get(rate)
      if (bucket) {
        bucket.hours += entry.hours
        bucket.entryIds.push(entry.id)
      } else {
        byRate.set(rate, { hours: entry.hours, entryIds: [entry.id] })
      }
    }

    const rates: StampInvoicedRateBreakdown[] = [...byRate.entries()]
      .sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1))
      .map(([rate, bucket]) => ({
        rate,
        hours: round2(bucket.hours),
        entryCount: bucket.entryIds.length,
      }))

    plans.push({
      orgId,
      orgName: org.name,
      hours: round2(eligible.reduce((sum, e) => sum + e.hours, 0)),
      entryCount: eligible.length,
      entryIds: eligible.map(e => e.id),
      rates,
    })
  }

  return { plans, skipped }
}

function usableRate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value)) return null
  return value
}

function describeEntries(count: number): string {
  return `${count} time ${count === 1 ? 'entry' : 'entries'}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
