/**
 * lib/manyrequests-dedupe.ts
 *
 * The ManyRequests "ledger twin" problem.
 *
 * The ManyRequests import writes a historical ledger row per source invoice
 * (source 'manyrequests', manyrequests_id set, no Stripe and no Xero object,
 * line items attached). The importer refuses to insert one when it can already
 * see a D1 row holding the same money (lib/import/manyrequests/plan.ts
 * findLedgerTwin, a 7 day window on client, currency and total), so the two
 * rails cannot double a client's ledger at import time.
 *
 * That guard only sees what is on the same organisation AT IMPORT TIME. The 13
 * rows imported this morning landed against clients whose Stripe-import shell
 * organisations were still archived and separate. Merging those shells into the
 * real clients afterwards carried the SAME payments across, so several clients
 * now hold each payment twice: once as the ManyRequests row and once as the
 * Stripe or Xero ledger row.
 *
 * The ledger row is the truth: it is the row the rail reconciles, the row the
 * pay link hangs off, the row a payment sync updates. The ManyRequests row is
 * the one carrying the history the ledger row lacks: the ManyRequests key, the
 * old invoice number (INV-2025000008 and friends) and the line items.
 *
 * So the cleanup KEEPS the ledger row, carries that history onto it, and
 * deletes the ManyRequests row. This module holds the pure matching rules so
 * the cleanup route and the MCP tool can never disagree about what a twin is.
 */

import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, isNotNull } from 'drizzle-orm'
import { amountsMatch, isStripeInvoiceId } from '@/lib/stripe-dedupe'

/**
 * How far apart the two rows for one payment may sit. Matches the window the
 * importer's own overlap guard uses (INVOICE_DUPLICATE_WINDOW_DAYS = 7), so a
 * pair this cleanup removes is exactly a pair the importer would have refused
 * had the organisations been merged first.
 */
export const MANYREQUESTS_TWIN_WINDOW_DAYS = 7
export const MANYREQUESTS_TWIN_WINDOW_MS = MANYREQUESTS_TWIN_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** The invoice columns every rule here reads. */
export interface LedgerRowLike {
  id: string
  orgId: string
  source: string | null
  status: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  manyrequestsId: string | null
  number: string | null
  totalUsd: number
  currency: string | null
  createdAt: string | null
  paidAt: string | null
}

/**
 * A row the ManyRequests importer wrote, and nothing else.
 *
 * The Stripe and Xero object columns being empty is what makes this pass
 * IDEMPOTENT: the survivor of a pair keeps its own source and its own rail id
 * and merely gains the ManyRequests key, so it can never come back as a
 * candidate on a later run and eat a second ledger row.
 */
export function isManyrequestsRow(row: LedgerRowLike): boolean {
  return row.source === 'manyrequests'
    && Boolean(row.manyrequestsId)
    && !row.stripeInvoiceId
    && !row.xeroInvoiceId
}

/** A row one of the two live rails wrote, carrying no ManyRequests key yet. */
export function isRailLedgerRow(row: LedgerRowLike): boolean {
  if (row.manyrequestsId) return false
  return row.source === 'stripe'
    || row.source === 'xero'
    || Boolean(row.stripeInvoiceId)
    || Boolean(row.xeroInvoiceId)
}

function normaliseCurrency(currency: string | null | undefined): string {
  return (currency ?? 'USD').toUpperCase()
}

function timestamps(row: LedgerRowLike): number[] {
  const out: number[] = []
  for (const value of [row.createdAt, row.paidAt]) {
    if (!value) continue
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) out.push(parsed)
  }
  return out
}

/**
 * The smallest gap between either date on one row and either date on the other,
 * or null when neither side carries a usable date.
 *
 * Both dates count because the two rails stamp them differently: a Xero row's
 * created_at is when the import ran, not when the money moved, while its
 * paid_at is the settlement date the ManyRequests row was created around.
 *
 * A null (no comparable dates at all) is NOT treated as a match here, unlike in
 * the importer. The importer refuses on doubt, which is cheap; this pass
 * DELETES on a match, so doubt has to leave the row alone instead.
 */
export function twinDistanceMs(a: LedgerRowLike, b: LedgerRowLike): number | null {
  const left = timestamps(a)
  const right = timestamps(b)
  if (left.length === 0 || right.length === 0) return null

  let best = Number.POSITIVE_INFINITY
  for (const l of left) {
    for (const r of right) {
      const distance = Math.abs(l - r)
      if (distance < best) best = distance
    }
  }
  return best
}

function isPaid(row: LedgerRowLike): boolean {
  return row.status === 'paid' || Boolean(row.paidAt)
}

/**
 * How much a candidate twin is preferred, before distance breaks the tie.
 *
 * A Stripe INVOICE id (`in_`) beats a charge id (`ch_` / `py_`), because the
 * invoice row is the one the subscription reconciles against and the charge row
 * is itself a duplicate the sibling pass removes. A paid row beats an unpaid
 * one, because the ManyRequests history is a settled payment.
 */
export function twinPreference(row: LedgerRowLike): number {
  const invoiceRank = isStripeInvoiceId(row.stripeInvoiceId) ? 1 : 0
  const paidRank = isPaid(row) ? 1 : 0
  return invoiceRank * 2 + paidRank
}

/**
 * The rail ledger row holding the same payment as this ManyRequests row, or
 * null. Same client, same currency, same total to within half a cent, dates
 * inside the window. `claimed` keeps the pairing one to one, so a client on a
 * fixed monthly amount (Physitrack's four GBP 3,125 months) pairs each
 * ManyRequests row with its own ledger row rather than all four with one.
 */
export function findRailLedgerTwin(
  row: LedgerRowLike,
  ledgerRows: readonly LedgerRowLike[],
  claimed?: ReadonlySet<string>,
): { twin: LedgerRowLike; distanceMs: number } | null {
  let best: LedgerRowLike | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  let bestPreference = -1

  for (const candidate of ledgerRows) {
    if (candidate.id === row.id) continue
    if (claimed?.has(candidate.id)) continue
    if (candidate.orgId !== row.orgId) continue
    if (!amountsMatch(candidate.totalUsd, row.totalUsd)) continue
    if (normaliseCurrency(candidate.currency) !== normaliseCurrency(row.currency)) continue

    const distance = twinDistanceMs(candidate, row)
    if (distance === null || distance > MANYREQUESTS_TWIN_WINDOW_MS) continue

    const preference = twinPreference(candidate)
    const better = preference > bestPreference
      || (preference === bestPreference && distance < bestDistance)
    if (better) {
      best = candidate
      bestDistance = distance
      bestPreference = preference
    }
  }

  return best ? { twin: best, distanceMs: bestDistance } : null
}

// -- The cleanup ----------------------------------------------------------

export interface MrDedupeSide {
  invoiceId: string
  source: string | null
  status: string | null
  manyrequestsId: string | null
  stripeInvoiceId: string | null
  xeroInvoiceId: string | null
  number: string | null
  amount: number
  currency: string | null
  createdAt: string | null
  paidAt: string | null
  itemCount: number
}

export interface MrDedupeCarry {
  /** The ManyRequests key stamped onto the survivor. */
  manyrequestsId: string | null
  /** The old invoice number, only when the survivor had none. */
  number: string | null
  /** Line items re-parented onto the survivor (it had none of its own). */
  itemsMoved: number
  /** Line items dropped with the deleted row (the survivor already had its own). */
  itemsDeleted: number
}

export interface MrDedupePair {
  orgId: string
  orgName: string | null
  /** The duplicate: the ManyRequests import row. Deleted on apply. */
  manyrequests: MrDedupeSide
  /** The survivor: the Stripe or Xero ledger row. Updated, never deleted. */
  ledger: MrDedupeSide
  carry: MrDedupeCarry
  distanceDays: number
}

export interface MrDedupeRefusal {
  invoiceId: string
  manyrequestsId: string | null
  reason: string
}

export interface MrDedupePlan {
  dryRun: boolean
  pairs: MrDedupePair[]
  refused: MrDedupeRefusal[]
  removedInvoiceIds: string[]
  applied: {
    invoicesDeleted: number
    itemsMoved: number
    itemsDeleted: number
    numbersCarried: number
    keysCarried: number
  }
}

function side(row: LedgerRowLike, itemCount: number): MrDedupeSide {
  return {
    invoiceId: row.id,
    source: row.source,
    status: row.status,
    manyrequestsId: row.manyrequestsId,
    stripeInvoiceId: row.stripeInvoiceId,
    xeroInvoiceId: row.xeroInvoiceId,
    number: row.number,
    amount: row.totalUsd,
    currency: row.currency,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    itemCount,
  }
}

/**
 * Find (and on apply, fold away) every ManyRequests row that duplicates a rail
 * ledger row.
 *
 * NEVER deletes a row anything points at. `time_entries.invoice_id` carries no
 * foreign key on purpose (see db/schema.ts), so removing a row it names would
 * silently orphan billed hours; `ai_reply_drafts.invoice_id` cascades, which
 * would take a chase draft with it. Both come back refused with the reason.
 *
 * The write order matters and is not an accident. `manyrequests_id` and
 * `number` both sit under a UNIQUE index, so the ManyRequests row has to be
 * GONE before the survivor can be stamped with its key: items first (moved or
 * deleted), then the row, then the update.
 */
export async function planManyrequestsTwinDedupe(
  database: DB,
  opts: { dryRun: boolean },
): Promise<MrDedupePlan> {
  const rows = (await database
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      source: schema.invoices.source,
      status: schema.invoices.status,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      manyrequestsId: schema.invoices.manyrequestsId,
      number: schema.invoices.number,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      createdAt: schema.invoices.createdAt,
      paidAt: schema.invoices.paidAt,
    })
    .from(schema.invoices)) as LedgerRowLike[]

  const plan: MrDedupePlan = {
    dryRun: opts.dryRun,
    pairs: [],
    refused: [],
    removedInvoiceIds: [],
    applied: { invoicesDeleted: 0, itemsMoved: 0, itemsDeleted: 0, numbersCarried: 0, keysCarried: 0 },
  }

  const mrRows = rows.filter(isManyrequestsRow)
  const ledgerRows = rows.filter(isRailLedgerRow)
  if (mrRows.length === 0 || ledgerRows.length === 0) return plan

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

  // Every line item once, counted per invoice in memory: the pass needs the
  // count on BOTH sides of every pair and D1 hates a query per row.
  const itemRows = await database
    .select({ id: schema.invoiceItems.id, invoiceId: schema.invoiceItems.invoiceId })
    .from(schema.invoiceItems)
  const itemCounts = new Map<string, number>()
  for (const item of itemRows) {
    itemCounts.set(item.invoiceId, (itemCounts.get(item.invoiceId) ?? 0) + 1)
  }
  const countItems = (invoiceId: string) => itemCounts.get(invoiceId) ?? 0

  // Oldest first, so a re-run pairs the same way every time.
  const ordered = [...mrRows].sort(
    (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
  )
  const claimed = new Set<string>()

  for (const row of ordered) {
    const match = findRailLedgerTwin(row, ledgerRows, claimed)
    if (!match) continue
    claimed.add(match.twin.id)

    const reasons = referenced.get(row.id)
    if (reasons?.length) {
      plan.refused.push({
        invoiceId: row.id,
        manyrequestsId: row.manyrequestsId,
        reason: `Referenced elsewhere: ${Array.from(new Set(reasons)).join('; ')}`,
      })
      continue
    }

    const mrItems = countItems(row.id)
    const twinItems = countItems(match.twin.id)
    const takesItems = mrItems > 0 && twinItems === 0

    plan.pairs.push({
      orgId: row.orgId,
      orgName: orgNames.get(row.orgId) ?? null,
      manyrequests: side(row, mrItems),
      ledger: side(match.twin, twinItems),
      carry: {
        manyrequestsId: row.manyrequestsId,
        number: !match.twin.number && row.number ? row.number : null,
        itemsMoved: takesItems ? mrItems : 0,
        itemsDeleted: takesItems ? 0 : mrItems,
      },
      distanceDays: Math.round((match.distanceMs / (24 * 60 * 60 * 1000)) * 100) / 100,
    })
  }

  if (opts.dryRun || plan.pairs.length === 0) return plan

  const now = new Date().toISOString()

  for (const pair of plan.pairs) {
    const mrId = pair.manyrequests.invoiceId
    const twinId = pair.ledger.invoiceId

    // 1. The line items, before the parent goes. Moving them re-parents them
    //    out of the cascade; the alternative is letting the cascade take them.
    if (pair.carry.itemsMoved > 0) {
      await database
        .update(schema.invoiceItems)
        .set({ invoiceId: twinId })
        .where(eq(schema.invoiceItems.invoiceId, mrId))
      plan.applied.itemsMoved += pair.carry.itemsMoved
    } else if (pair.carry.itemsDeleted > 0) {
      await database.delete(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, mrId))
      plan.applied.itemsDeleted += pair.carry.itemsDeleted
    }

    // 2. The duplicate row, which frees its manyrequests_id and number from the
    //    unique indexes.
    await database.delete(schema.invoices).where(eq(schema.invoices.id, mrId))
    plan.applied.invoicesDeleted += 1

    // 3. The history, onto the survivor.
    const patch: { updatedAt: string; manyrequestsId?: string; number?: string } = { updatedAt: now }
    if (pair.carry.manyrequestsId) {
      patch.manyrequestsId = pair.carry.manyrequestsId
      plan.applied.keysCarried += 1
    }
    if (pair.carry.number) {
      patch.number = pair.carry.number
      plan.applied.numbersCarried += 1
    }
    await database.update(schema.invoices).set(patch).where(eq(schema.invoices.id, twinId))
  }

  plan.removedInvoiceIds = plan.pairs.map((pair) => pair.manyrequests.invoiceId)
  return plan
}
