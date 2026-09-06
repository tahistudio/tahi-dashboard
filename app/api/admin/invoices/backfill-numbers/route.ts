import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNull } from 'drizzle-orm'
import {
  planInvoiceNumberBackfill,
  type BackfillCandidate,
} from '@/lib/invoice-number-backfill'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/invoices/backfill-numbers
 *
 * Recover the invoice number an IMPORTED row was born with, for the rows that
 * predate migration 0096.
 *
 * WHAT IT WILL NEVER DO, and the reason each rule exists:
 *
 *   It never mints. The studio sequence numbers invoices at the moment they are
 *   raised. Handing a 2024 bill an INV-2026-xxxx from today's counter would
 *   invent a document number that appears on nothing the client holds, and it
 *   would burn sequence values on history.
 *
 *   It never renumbers. A row that already has a number is refused by name, not
 *   silently skipped, so "why did this one not change" has an answer.
 *
 *   It never guesses. A number is only written when it can be read back out of
 *   something the importer of the day actually recorded: manyrequests_id (which
 *   IS the ManyRequests invoice number), or the number the Xero and Stripe
 *   importers wrote into notes. Everything else is refused with a sentence.
 *
 * dryRun DEFAULTS TO TRUE. This writes to a money column under a unique index,
 * so the unqualified call is the preview: it returns the exact plan, row by row,
 * and touches nothing. Pass { "dryRun": false } to apply it.
 *
 * Response shape is the same either way, so a plan can be diffed against what
 * was applied:
 *   { success, dryRun, scanned, filledCount, filled: [{ id, number, origin }],
 *     refusedCount, refused: [{ id, reason, message, candidate? }], failed? }
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Money route: the Tahi org alone is not enough, the seat must be able to see
  // Invoices (CLAUDE.md rule 11 + the role contract in lib/require-feature).
  const deniedFeature = await requireFeature({ userId, orgId }, 'invoices')
  if (deniedFeature) return deniedFeature

  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return NextResponse.json({ error: 'dryRun must be true or false' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false

  const database = (await db()) as unknown as D1

  // Deliberately NOT org-scoped. This is a ledger repair over the whole invoice
  // book, run by a super admin, and a per-client slice of it would leave the
  // uniqueness argument half-applied.
  const candidateRows = await database
    .select({
      id: schema.invoices.id,
      number: schema.invoices.number,
      notes: schema.invoices.notes,
      manyrequestsId: schema.invoices.manyrequestsId,
    })
    .from(schema.invoices)
    .where(isNull(schema.invoices.number))

  // Every number already held, so a recovered value that would collide is
  // refused by name here instead of blowing up the write against the unique
  // index halfway through the batch.
  const takenRows = await database
    .select({ number: schema.invoices.number })
    .from(schema.invoices)

  const candidates: BackfillCandidate[] = candidateRows.map(row => ({
    id: row.id,
    number: row.number ?? null,
    notes: row.notes ?? null,
    manyrequestsId: row.manyrequestsId ?? null,
  }))

  const taken = takenRows
    .map(row => row.number)
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')

  const plan = planInvoiceNumberBackfill({ candidates, taken })

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      scanned: candidates.length,
      filledCount: plan.fills.length,
      filled: plan.fills,
      refusedCount: plan.refusals.length,
      refused: plan.refusals,
    })
  }

  // One UPDATE per row, each guarded by `number IS NULL` again. The plan was
  // built from a read that is now seconds old, and an invoice raised in that
  // gap has its own minted number: the guard makes this write lose that race
  // rather than overwriting it.
  const applied: typeof plan.fills = []
  const failed: Array<{ id: string; number: string; error: string }> = []

  for (const fill of plan.fills) {
    try {
      await database
        .update(schema.invoices)
        .set({ number: fill.number, updatedAt: new Date().toISOString() })
        .where(and(eq(schema.invoices.id, fill.id), isNull(schema.invoices.number)))
      applied.push(fill)
    } catch (err) {
      console.error('[backfill-numbers] could not write invoice number', err)
      failed.push({
        id: fill.id,
        number: fill.number,
        error: 'Could not write this number. It may have been taken since the plan was built.',
      })
    }
  }

  return NextResponse.json({
    success: true,
    dryRun: false,
    scanned: candidates.length,
    filledCount: applied.length,
    filled: applied,
    refusedCount: plan.refusals.length,
    refused: plan.refusals,
    ...(failed.length > 0 ? { failedCount: failed.length, failed } : {}),
  })
}
