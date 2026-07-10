/**
 * GET /api/admin/reports/financial-trends
 *
 * Returns the monthly financial_snapshots series (oldest first) so the
 * overview / reports can chart real trends: cash, owed, MRR, active clients,
 * burn and runway over time. Point-in-time metrics come from this table;
 * revenue / profit trends live in xero_pnl_snapshots.
 *
 * Each row carries `source` ('cron' = full monthly snapshot, 'backfill' =
 * cash-only reconstruction from the Airwallex ledger) so the UI can mark
 * which months have complete data.
 *
 * Auth: admin session, financial_reports feature.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature(auth, 'financial_reports')
  if (denied) return denied

  const drizzle = (await db()) as unknown as D1

  try {
    const snapshots = await drizzle
      .select()
      .from(schema.financialSnapshots)
      .orderBy(asc(schema.financialSnapshots.monthKey))
    return NextResponse.json({ snapshots })
  } catch {
    // Table not migrated yet.
    return NextResponse.json({ snapshots: [] })
  }
}
