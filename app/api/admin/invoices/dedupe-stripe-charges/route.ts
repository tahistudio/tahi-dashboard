/**
 * POST /api/admin/invoices/dedupe-stripe-charges
 *
 * Removes the Stripe "charge twin" duplicates: a subscription payment that was
 * imported twice, once as the Stripe invoice (`in_...`) and once as the charge
 * that settled it (`ch_...` / `py_...`). Each pair doubled a client's billed
 * total in every finance view. The import itself no longer creates them
 * (lib/stripe-sync.ts chargeInvoiceLink); this endpoint clears the ones that
 * already landed.
 *
 * Body:
 *   dryRun  boolean, default TRUE. The dry run lists every pair it found and
 *           writes nothing. Pass false to delete the charge twins.
 *
 * Gates: Tahi admin, the `billing` feature, and SUPER ADMIN for the apply,
 * because deleting finance rows is a destructive door.
 *
 * NEVER touches a row anything references (a billed time entry, an AI chase
 * draft): those come back under `refused` with the reason. The invoice side of
 * every pair is never modified. The apply writes ONE audit row carrying every
 * id it removed.
 *
 * This route sends nothing, calls Stripe not at all, and calls no other route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { planStripeChargeTwinDedupe } from '@/lib/stripe-dedupe'

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
    const plan = await planStripeChargeTwinDedupe(database, { dryRun })

    if (!dryRun && plan.removedInvoiceIds.length > 0) {
      await logAudit(database, {
        action: 'stripe_charge_twin_dedupe',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'invoice',
        entityId: 'dedupe-stripe-charges',
        metadata: {
          removedInvoiceIds: plan.removedInvoiceIds,
          pairs: plan.pairs.map((pair) => ({
            orgId: pair.orgId,
            orgName: pair.orgName,
            removedInvoiceId: pair.charge.invoiceId,
            removedStripeId: pair.charge.stripeId,
            keptInvoiceId: pair.invoice.invoiceId,
            keptStripeId: pair.invoice.stripeId,
            amount: pair.charge.amount,
            currency: pair.charge.currency,
          })),
          refused: plan.refused,
          applied: plan.applied,
        },
      })
    }

    return NextResponse.json(plan)
  } catch (error) {
    console.error('[dedupe-stripe-charges] failed:', error)
    return NextResponse.json({ error: 'Dedupe failed' }, { status: 500 })
  }
}
