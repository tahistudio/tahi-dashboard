/**
 * lib/stripe-dedupe.ts
 *
 * The Stripe "charge twin" problem, and its two halves.
 *
 * A subscription payment exists TWICE in the Stripe API: once as the invoice
 * (`in_...`) and once as the charge that settled it (`ch_...`, or `py_...` for
 * a non-card payment). Both imports write an `invoices` row, so a client whose
 * payment came in through both doors is billed twice in every finance view.
 * Eight such pairs were found on production, each doubling a client's total.
 *
 * The charge importer has always had a guard for this (`if (charge.invoice)
 * skip`), and it missed these because it trusted ONE field: for a charge that
 * settled through a PaymentIntent (which is every subscription payment on a
 * modern API version, and every `py_` charge), the invoice link lives on the
 * PaymentIntent, not on the charge, so `charge.invoice` reads null and the
 * charge looks like a one-off. `chargeInvoiceLink` in lib/stripe-sync.ts now
 * reads both, and `findInvoiceTwin` below is the belt-and-braces second check
 * against what is already in the database.
 *
 * This module holds the pure matching rules so the IMPORT (lib/stripe-sync.ts)
 * and the CLEANUP (POST /api/admin/invoices/dedupe-stripe-charges) can never
 * disagree about what a twin is.
 */

import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, inArray, isNotNull } from 'drizzle-orm'

/** How far apart an invoice and its settling charge may be created. */
export const TWIN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** Money compares in dollars, so a half-cent is the tolerance. */
export const AMOUNT_EPSILON = 0.005

/** The invoice columns every rule here reads. */
export interface InvoiceRowLike {
  id: string
  orgId: string
  stripeInvoiceId: string | null
  source: string | null
  totalUsd: number
  currency: string | null
  createdAt: string | null
  paidAt?: string | null
  notes?: string | null
  manyrequestsId?: string | null
  xeroInvoiceId?: string | null
}

/** `ch_` is a card charge, `py_` the legacy id for a non-card one. */
export function isStripeChargeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && (id.startsWith('ch_') || id.startsWith('py_'))
}

export function isStripeInvoiceId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('in_')
}

/**
 * A row the charge importer wrote: Stripe source, a charge id, and no
 * ManyRequests or Xero object hanging off it. Anything carrying one of those
 * is a ledger row from another rail and is never a candidate.
 */
export function isChargeRow(row: InvoiceRowLike): boolean {
  return row.source === 'stripe'
    && isStripeChargeId(row.stripeInvoiceId)
    && !row.manyrequestsId
    && !row.xeroInvoiceId
}

/** A row the invoice importer wrote. */
export function isInvoiceRow(row: InvoiceRowLike): boolean {
  return row.source === 'stripe' && isStripeInvoiceId(row.stripeInvoiceId)
}

export function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < AMOUNT_EPSILON
}

function normaliseCurrency(currency: string | null | undefined): string {
  return (currency ?? '').toUpperCase()
}

export function withinTwinWindow(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const left = Date.parse(a)
  const right = Date.parse(b)
  if (Number.isNaN(left) || Number.isNaN(right)) return false
  return Math.abs(left - right) <= TWIN_WINDOW_MS
}

/** What a twin lookup needs to know about the charge side. */
export interface ChargeSideLike {
  orgId: string
  totalUsd: number
  currency: string | null
  createdAt: string | null
}

/**
 * The invoice row that already holds this money, or null.
 *
 * Same organisation, same amount, same currency, created inside the window.
 * When several qualify the CLOSEST in time wins, so a client on a fixed
 * monthly amount pairs each charge with its own invoice rather than with the
 * oldest one. `claimed` keeps the pairing one to one.
 */
export function findInvoiceTwin(
  charge: ChargeSideLike,
  invoiceRows: InvoiceRowLike[],
  claimed?: Set<string>,
): InvoiceRowLike | null {
  const chargeAt = charge.createdAt ? Date.parse(charge.createdAt) : Number.NaN
  if (Number.isNaN(chargeAt)) return null

  let best: InvoiceRowLike | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const row of invoiceRows) {
    if (claimed?.has(row.id)) continue
    if (row.orgId !== charge.orgId) continue
    if (!amountsMatch(row.totalUsd, charge.totalUsd)) continue
    if (normaliseCurrency(row.currency) !== normaliseCurrency(charge.currency)) continue
    if (!withinTwinWindow(row.createdAt, charge.createdAt)) continue

    const distance = Math.abs(Date.parse(row.createdAt as string) - chargeAt)
    if (distance < bestDistance) {
      best = row
      bestDistance = distance
    }
  }

  return best
}

// -- The cleanup ----------------------------------------------------------

export interface DedupeSide {
  invoiceId: string
  stripeId: string | null
  amount: number
  currency: string | null
  createdAt: string | null
  paidAt: string | null
  notes: string | null
}

export interface DedupePair {
  orgId: string
  orgName: string | null
  /** The duplicate: the row the charge importer wrote. Deleted on apply. */
  charge: DedupeSide
  /** The survivor: the row the invoice importer wrote. Never touched. */
  invoice: DedupeSide
}

export interface DedupeRefusal {
  invoiceId: string
  stripeId: string | null
  reason: string
}

export interface DedupePlan {
  dryRun: boolean
  pairs: DedupePair[]
  refused: DedupeRefusal[]
  removedInvoiceIds: string[]
  applied: { invoicesDeleted: number; itemsDeleted: number }
}

function side(row: InvoiceRowLike): DedupeSide {
  return {
    invoiceId: row.id,
    stripeId: row.stripeInvoiceId,
    amount: row.totalUsd,
    currency: row.currency,
    createdAt: row.createdAt,
    paidAt: row.paidAt ?? null,
    notes: row.notes ?? null,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Find (and on apply, remove) every charge row that duplicates an invoice row.
 *
 * NEVER deletes a row anything points at. `time_entries.invoice_id` carries no
 * foreign key on purpose (see db/schema.ts), so removing a row it names would
 * silently orphan billed hours; `ai_reply_drafts.invoice_id` cascades, which
 * would take a chase draft with it. Both come back refused with the reason.
 */
export async function planStripeChargeTwinDedupe(
  database: DB,
  opts: { dryRun: boolean },
): Promise<DedupePlan> {
  const rows = (await database
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      source: schema.invoices.source,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      createdAt: schema.invoices.createdAt,
      paidAt: schema.invoices.paidAt,
      notes: schema.invoices.notes,
      manyrequestsId: schema.invoices.manyrequestsId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.source, 'stripe'))) as InvoiceRowLike[]

  const chargeRows = rows.filter(isChargeRow)
  const invoiceRows = rows.filter(isInvoiceRow)

  const plan: DedupePlan = {
    dryRun: opts.dryRun,
    pairs: [],
    refused: [],
    removedInvoiceIds: [],
    applied: { invoicesDeleted: 0, itemsDeleted: 0 },
  }

  if (chargeRows.length === 0 || invoiceRows.length === 0) return plan

  const orgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
  const orgNames = new Map(orgs.map((o) => [o.id, (o.name ?? null) as string | null]))

  const referenced = new Map<string, string[]>()
  const addReference = (invoiceId: string | null, reason: string) => {
    if (!invoiceId) return
    const list = referenced.get(invoiceId) ?? []
    list.push(reason)
    referenced.set(invoiceId, list)
  }

  const timeRefs = await database
    .select({ id: schema.timeEntries.id, invoiceId: schema.timeEntries.invoiceId })
    .from(schema.timeEntries)
    .where(isNotNull(schema.timeEntries.invoiceId))
  for (const ref of timeRefs) addReference(ref.invoiceId, 'a time entry is billed to it (time_entries.invoice_id)')

  const draftRefs = await database
    .select({ id: schema.aiReplyDrafts.id, invoiceId: schema.aiReplyDrafts.invoiceId })
    .from(schema.aiReplyDrafts)
    .where(isNotNull(schema.aiReplyDrafts.invoiceId))
  for (const ref of draftRefs) addReference(ref.invoiceId, 'an AI reply draft points at it (ai_reply_drafts.invoice_id)')

  // Oldest first, so a re-run pairs the same way every time.
  const ordered = [...chargeRows].sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  )
  const claimed = new Set<string>()

  for (const charge of ordered) {
    const twin = findInvoiceTwin(charge, invoiceRows, claimed)
    if (!twin) continue
    claimed.add(twin.id)

    const reasons = referenced.get(charge.id)
    if (reasons?.length) {
      plan.refused.push({
        invoiceId: charge.id,
        stripeId: charge.stripeInvoiceId,
        reason: `Referenced elsewhere: ${Array.from(new Set(reasons)).join('; ')}`,
      })
      continue
    }

    plan.pairs.push({
      orgId: charge.orgId,
      orgName: orgNames.get(charge.orgId) ?? null,
      charge: side(charge),
      invoice: side(twin),
    })
  }

  if (opts.dryRun || plan.pairs.length === 0) return plan

  const ids = plan.pairs.map((pair) => pair.charge.invoiceId)

  for (const batch of chunk(ids, 50)) {
    const items = await database
      .select({ id: schema.invoiceItems.id })
      .from(schema.invoiceItems)
      .where(inArray(schema.invoiceItems.invoiceId, batch))
    plan.applied.itemsDeleted += items.length
    await database.delete(schema.invoiceItems).where(inArray(schema.invoiceItems.invoiceId, batch))
    await database.delete(schema.invoices).where(inArray(schema.invoices.id, batch))
    plan.applied.invoicesDeleted += batch.length
  }

  plan.removedInvoiceIds = ids
  return plan
}
