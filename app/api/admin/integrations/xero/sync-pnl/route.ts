import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncXeroPnl } from '@/lib/xero-sync'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/integrations/xero/sync-pnl
 *
 * Pulls one Xero P&L report per month for the last N months (default 12)
 * and upserts snapshots + line items. Recomputes the "recurring" flag for
 * any line item that shows up in at least 3 of the last 4 months.
 *
 * Body: { months?: number }  (default 12, clamped 1..24)
 *
 * Core logic lives in lib/xero-sync.ts so the daily orchestrator cron
 * (POST /api/admin/cron/sync-xero) can reuse it without an HTTP self-call.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as { months?: number }
  const drizzle = (await db()) as D1
  const outcome = await syncXeroPnl(drizzle, body.months ?? 12)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
