import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncXeroBalances } from '@/lib/xero-sync'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/integrations/xero/sync-balances
 *
 * Pulls current bank account balances from Xero and upserts into
 * xero_bank_balances (keyed by Xero AccountID, overwritten each sync).
 *
 * Core logic lives in lib/xero-sync.ts so the daily orchestrator cron
 * (POST /api/admin/cron/sync-xero) can reuse it without an HTTP self-call.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const drizzle = (await db()) as D1
  const outcome = await syncXeroBalances(drizzle)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
