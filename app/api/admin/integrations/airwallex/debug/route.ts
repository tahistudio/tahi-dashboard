/**
 * GET /api/admin/integrations/airwallex/debug
 *
 * Admin-only debug probe — returns the raw response shape from
 * Airwallex's /api/v1/balances/current and the first page of
 * /api/v1/financial_transactions. Used to diagnose parser mismatches.
 *
 * Will be removed once the finance reports page is trusted.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { getAirwallexToken } from '@/lib/airwallex'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  let token: string
  try {
    token = await getAirwallexToken()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), step: 'login' }, { status: 502 })
  }

  // Raw fetch — bypass our parser so we see exactly what Airwallex returns.
  const balancesRes = await fetch('https://api.airwallex.com/api/v1/balances/current', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const balancesText = await balancesRes.text()

  const txnsRes = await fetch('https://api.airwallex.com/api/v1/financial_transactions?page_size=3', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const txnsText = await txnsRes.text()

  return NextResponse.json({
    balances: {
      status: balancesRes.status,
      contentType: balancesRes.headers.get('content-type'),
      preview: balancesText.slice(0, 2000),
    },
    transactions: {
      status: txnsRes.status,
      contentType: txnsRes.headers.get('content-type'),
      preview: txnsText.slice(0, 2000),
    },
  })
}
