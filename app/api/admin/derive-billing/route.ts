import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { applyBillingDerivationToAllOrgs } from '@/lib/billing-derivation'

type AnyDb = Parameters<typeof applyBillingDerivationToAllOrgs>[0]

/**
 * POST /api/admin/derive-billing
 *
 * Sweeps every non-archived org and re-derives billing model + retainer
 * dates from current signals. Fields flagged as manually overridden are
 * preserved. Useful as a one-time backfill after migration 0016 lands,
 * and as a periodic catch-up (cron or manual button).
 *
 * Response: { count: number; appliedTo: number; skipped: number; results: ApplyResult[] }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = (await db()) as unknown as AnyDb
  const results = await applyBillingDerivationToAllOrgs(database)

  const appliedTo = results.filter(r => r.applied.billingModel || r.applied.retainerStartDate).length
  const skipped = results.filter(r => r.skippedDueToManual.length > 0).length

  return NextResponse.json({
    count: results.length,
    appliedTo,
    skipped,
    results,
  })
}
