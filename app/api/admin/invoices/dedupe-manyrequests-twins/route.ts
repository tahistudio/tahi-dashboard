/**
 * POST /api/admin/invoices/dedupe-manyrequests-twins
 *
 * Removes the ManyRequests "ledger twin" duplicates: a payment that exists once
 * as this morning's ManyRequests import row and once as the Stripe or Xero
 * ledger row it was always on. The importer's own overlap guard could not see
 * these because the ledger rows sat on archived Stripe-import shell
 * organisations at the time, and only came across when those shells were merged
 * into the real clients afterwards.
 *
 * The LEDGER row survives, because it is the row the rail reconciles. Before
 * the ManyRequests row goes, its history is carried onto the survivor: the
 * ManyRequests key, the old invoice number (only when the survivor has none)
 * and the line items (moved when the survivor has none of its own, otherwise
 * dropped with the row).
 *
 * Body:
 *   dryRun  boolean, default TRUE. The dry run lists every pair it found, what
 *           it would carry, and writes nothing. Pass false to fold them.
 *
 * Gates: Tahi admin, the `billing` feature, and SUPER ADMIN for the apply,
 * because deleting finance rows is a destructive door.
 *
 * NEVER touches a row anything references (a billed time entry, an AI chase
 * draft): those come back under `refused` with the reason. Idempotent: the
 * survivor keeps its own source and rail id, so a second run finds nothing.
 *
 * This route sends nothing, calls Stripe and Xero not at all, and calls no
 * other route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { planManyrequestsTwinDedupe } from '@/lib/manyrequests-dedupe'

type PermissionsDb = Parameters<typeof resolvePermissions>[0]

interface DedupeBody {
  dryRun?: unknown
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'billing')
  if (featureDenied) return featureDenied

  const database = (await db()) as DB

  const body = (await req.json().catch(() => ({}))) as DedupeBody
  const dryRun = body.dryRun !== false

  // Super-admin only for the destructive half. A dry run is read-only and any
  // admin who can see billing may run it.
  if (!dryRun) {
    const access = await resolvePermissions(database as unknown as PermissionsDb, auth)
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  try {
    const plan = await planManyrequestsTwinDedupe(database, { dryRun })

    if (!dryRun && plan.removedInvoiceIds.length > 0) {
      await logAudit(database, {
        action: 'manyrequests_invoice_twin_dedupe',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'invoice',
        entityId: 'dedupe-manyrequests-twins',
        metadata: {
          removedInvoiceIds: plan.removedInvoiceIds,
          pairs: plan.pairs.map((pair) => ({
            orgId: pair.orgId,
            orgName: pair.orgName,
            removedInvoiceId: pair.manyrequests.invoiceId,
            removedManyrequestsId: pair.manyrequests.manyrequestsId,
            removedNumber: pair.manyrequests.number,
            keptInvoiceId: pair.ledger.invoiceId,
            keptSource: pair.ledger.source,
            keptStripeInvoiceId: pair.ledger.stripeInvoiceId,
            keptXeroInvoiceId: pair.ledger.xeroInvoiceId,
            carried: pair.carry,
            amount: pair.manyrequests.amount,
            currency: pair.manyrequests.currency,
            distanceDays: pair.distanceDays,
          })),
          refused: plan.refused,
          applied: plan.applied,
        },
      })
    }

    return NextResponse.json(plan)
  } catch (error) {
    console.error('[dedupe-manyrequests-twins] failed:', error)
    return NextResponse.json({ error: 'Dedupe failed' }, { status: 500 })
  }
}
