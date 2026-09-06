/**
 * lib/hourly-export.ts
 *
 * What the hourly-to-Xero export would bill, and everything it refuses to bill.
 *
 * POST /api/admin/billing/xero-export turns a month of billable time into draft
 * invoices. Before this module existed it did so by guessing: it took EVERY org
 * with billable hours (retainer clients included, whose hours are already paid
 * for by the retainer), used "the last non-zero rate it happened to see" for
 * all of that client's hours, `continue`d past any client whose rate came out
 * at zero without a word, stamped every invoice NZD whatever the client is
 * billed in, and left no mark on the entries, so running it twice billed the
 * same hours twice.
 *
 * The rule here is that nothing is ever dropped quietly. Either an org gets a
 * plan, or it gets a refusal carrying a reason code, a sentence an operator can
 * act on, and the ids of the entries left unbilled. The caller returns both.
 *
 * Pure on purpose so every refusal is unit testable without a D1 handle or a
 * Xero token (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

import { asCurrencyCode, formatCurrency, type CurrencyCode } from '@/lib/currency'
import { DEFAULT_INVOICE_CURRENCY } from '@/lib/invoice-defaults'

/** The billing model that entitles a client to an hourly invoice. */
export const HOURLY_BILLING_MODEL = 'hourly'

/** One candidate time entry: billable, in the window, not yet exported. */
export interface HourlyExportEntry {
  id: string
  /** time_entries.org_id: the client this entry is BILLED to. */
  orgId: string
  hours: number
  /** time_entries.hourly_rate, NULL when the logger did not type one. */
  hourlyRate: number | null
  /**
   * requests.org_id for the request this entry hangs off, when it hangs off
   * one. Normally the same as `orgId`; when it is not, the hours were logged
   * against one client's work and are about to be billed to another, and the
   * two clients can be invoiced in different currencies.
   */
  requestOrgId: string | null
}

/** One entry in the window that already carries an invoice link. */
export interface HourlyExportedEntry {
  id: string
  orgId: string
}

/** The client row, including the column Drizzle does not model. */
export interface HourlyExportOrg {
  id: string
  name: string
  xeroContactId: string | null
  defaultHourlyRate: number | null
  /** organisations.preferred_currency, free text and often blank. */
  preferredCurrency: string | null
  /** organisations.billing_model (migration 0016), NULL until derived. */
  billingModel: string | null
}

export type HourlyExportRefusalReason =
  | 'unknown_org'
  | 'already_exported'
  | 'billing_model_not_set'
  | 'billing_model_not_hourly'
  | 'unsupported_currency'
  | 'currency_mismatch'
  | 'missing_rate'
  | 'invalid_hours'
  | 'no_billable_hours'

/** An org that will NOT be invoiced, and why, in the operator's words. */
export interface HourlyExportRefusal {
  orgId: string
  orgName: string
  reason: HourlyExportRefusalReason
  message: string
  /** The entries left unbilled. Empty only when there were none to bill. */
  entryIds: string[]
}

/** One invoice line: all the hours logged at one rate. */
export interface HourlyExportLine {
  description: string
  hours: number
  rate: number
  amount: number
  currency: CurrencyCode
  entryIds: string[]
}

/** One invoice the export would raise. */
export interface HourlyExportPlan {
  orgId: string
  orgName: string
  xeroContactId: string | null
  currency: CurrencyCode
  hours: number
  amount: number
  lines: HourlyExportLine[]
  /** Every entry this invoice bills, in the order they were read. */
  entryIds: string[]
}

export interface HourlyExportPlanResult {
  plans: HourlyExportPlan[]
  skipped: HourlyExportRefusal[]
}

export interface HourlyExportInput {
  /** Billable entries in the window with no invoice link yet. */
  entries: HourlyExportEntry[]
  /** Billable entries in the same window that already carry one. */
  alreadyExported: HourlyExportedEntry[]
  /** Every org referenced by either list, billed or logged against. */
  orgs: HourlyExportOrg[]
  /** e.g. "August 2026". Goes on the line description. */
  monthLabel: string
}

/**
 * Turn a month of unbilled time into invoice plans plus refusals.
 *
 * Orgs come out in the order their first candidate entry was read, then the
 * orgs that only have already-exported entries, so a re-run of the same period
 * still reports every client it deliberately did nothing for.
 */
export function planHourlyExport(input: HourlyExportInput): HourlyExportPlanResult {
  const orgById = new Map(input.orgs.map(o => [o.id, o]))

  const candidates = new Map<string, HourlyExportEntry[]>()
  for (const entry of input.entries) {
    const bucket = candidates.get(entry.orgId)
    if (bucket) bucket.push(entry)
    else candidates.set(entry.orgId, [entry])
  }

  const exported = new Map<string, string[]>()
  for (const entry of input.alreadyExported) {
    const bucket = exported.get(entry.orgId)
    if (bucket) bucket.push(entry.id)
    else exported.set(entry.orgId, [entry.id])
  }

  const orgIds = [...candidates.keys()]
  for (const orgId of exported.keys()) {
    if (!candidates.has(orgId)) orgIds.push(orgId)
  }

  const plans: HourlyExportPlan[] = []
  const skipped: HourlyExportRefusal[] = []

  for (const orgId of orgIds) {
    const entries = candidates.get(orgId) ?? []
    const entryIds = entries.map(e => e.id)
    const org = orgById.get(orgId)

    if (!org) {
      skipped.push({
        orgId,
        orgName: orgId,
        reason: 'unknown_org',
        message: `${describeEntries(entryIds)} are billed to an organisation that is not in the client book, so nothing was invoiced.`,
        entryIds,
      })
      continue
    }

    if (entries.length === 0) {
      const done = exported.get(orgId) ?? []
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'already_exported',
        message: `${org.name}: all ${done.length} billable ${plural(done.length, 'entry', 'entries')} for ${input.monthLabel} were exported on an earlier run, so this run bills nothing new.`,
        entryIds: [],
      })
      continue
    }

    const billingModel = typeof org.billingModel === 'string' ? org.billingModel.trim().toLowerCase() : ''
    if (billingModel === '') {
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'billing_model_not_set',
        message: `${org.name} has no billing model set, so the export cannot tell whether these hours are already covered by a retainer. ${describeEntries(entryIds)} left unbilled.`,
        entryIds,
      })
      continue
    }
    if (billingModel !== HOURLY_BILLING_MODEL) {
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'billing_model_not_hourly',
        message: `${org.name} is billed as ${billingModel}, not hourly, so their hours are not invoiced by the hour. ${describeEntries(entryIds)} left unbilled.`,
        entryIds,
      })
      continue
    }

    const currency = resolveOrgCurrency(org)
    if (!currency) {
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'unsupported_currency',
        message: `${org.name} is set to bill in "${String(org.preferredCurrency).trim()}", which is not a currency this studio invoices in. ${describeEntries(entryIds)} left unbilled.`,
        entryIds,
      })
      continue
    }

    const foreign = entries.filter(e => {
      if (!e.requestOrgId || e.requestOrgId === orgId) return false
      const source = orgById.get(e.requestOrgId)
      return !source || resolveOrgCurrency(source) !== currency
    })
    if (foreign.length > 0) {
      const foreignIds = foreign.map(e => e.id)
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'currency_mismatch',
        message: `${describeEntries(foreignIds)} on ${org.name}'s bill were logged against work owned by another client that is not invoiced in ${currency}. Converting between currencies is not this export's job, so nothing was invoiced: ${foreignIds.join(', ')}.`,
        entryIds: foreignIds,
      })
      continue
    }

    const badHours = entries.filter(e => !Number.isFinite(e.hours) || e.hours < 0)
    if (badHours.length > 0) {
      const badIds = badHours.map(e => e.id)
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'invalid_hours',
        message: `${describeEntries(badIds)} for ${org.name} carry hours that are missing or negative, which would take money off the bill. Nothing was invoiced: ${badIds.join(', ')}.`,
        entryIds: badIds,
      })
      continue
    }

    const unrated: string[] = []
    const byRate = new Map<number, { hours: number; entryIds: string[] }>()
    for (const entry of entries) {
      const rate = resolveRate(entry.hourlyRate, org.defaultHourlyRate)
      if (rate === null) {
        unrated.push(entry.id)
        continue
      }
      const bucket = byRate.get(rate)
      if (bucket) {
        bucket.hours += entry.hours
        bucket.entryIds.push(entry.id)
      } else {
        byRate.set(rate, { hours: entry.hours, entryIds: [entry.id] })
      }
    }

    if (unrated.length > 0) {
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'missing_rate',
        message: `${describeEntries(unrated)} for ${org.name} have no hourly rate, and ${org.name} has no default hourly rate to fall back on. Nothing was invoiced: ${unrated.join(', ')}.`,
        entryIds: unrated,
      })
      continue
    }

    const lines: HourlyExportLine[] = [...byRate.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, bucket]) => ({
        description: lineDescription(input.monthLabel, bucket.hours, rate, currency),
        hours: round2(bucket.hours),
        rate,
        amount: round2(bucket.hours * rate),
        currency,
        entryIds: bucket.entryIds,
      }))

    const hours = round2(lines.reduce((sum, line) => sum + line.hours, 0))
    if (hours <= 0) {
      skipped.push({
        orgId,
        orgName: org.name,
        reason: 'no_billable_hours',
        message: `${org.name} has ${describeEntries(entryIds).toLowerCase()} for ${input.monthLabel} that add up to zero hours, so there is nothing to invoice.`,
        entryIds,
      })
      continue
    }

    plans.push({
      orgId,
      orgName: org.name,
      xeroContactId: org.xeroContactId,
      currency,
      hours,
      amount: round2(lines.reduce((sum, line) => sum + line.amount, 0)),
      lines,
      entryIds,
    })
  }

  return { plans, skipped }
}

/**
 * The currency this client is invoiced in, or null when the column names a
 * currency the studio has no rate card for.
 *
 * A blank column is not an error: it means nobody chose, which is the studio
 * default. A NON-blank column that does not resolve IS an error, because
 * quietly falling back would print a bill in a currency nobody agreed to.
 */
export function resolveOrgCurrency(org: Pick<HourlyExportOrg, 'preferredCurrency'>): CurrencyCode | null {
  const raw = typeof org.preferredCurrency === 'string' ? org.preferredCurrency.trim() : ''
  if (raw === '') return asCurrencyCode(DEFAULT_INVOICE_CURRENCY)
  return asCurrencyCode(raw)
}

/**
 * The rate to bill an entry at: its own, else the client's default. Null means
 * there is no usable rate, which is a refusal and never a silent skip. Zero and
 * negative are treated as absent on both sides: a zero-rate line bills nothing
 * while looking on the invoice like work that was charged for.
 */
export function resolveRate(entryRate: number | null, orgDefault: number | null): number | null {
  const own = usableRate(entryRate)
  if (own !== null) return own
  return usableRate(orgDefault)
}

function usableRate(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function lineDescription(monthLabel: string, hours: number, rate: number, currency: CurrencyCode): string {
  return `Design and development services - ${monthLabel} - ${round2(hours).toFixed(1)} hours at ${formatCurrency(rate, currency)}/hr`
}

function describeEntries(ids: string[]): string {
  return `${ids.length} time ${plural(ids.length, 'entry', 'entries')}`
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
