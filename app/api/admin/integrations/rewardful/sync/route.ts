import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/integrations/rewardful/sync
 * T140: Scheduled background sync of affiliate/referral data.
 * In production, this would be triggered by a Cloudflare Cron Trigger
 * running daily to refresh affiliate, referral, and commission data.
 *
 * For now, it can be called manually from the admin settings page.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.REWARDFUL_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      message: 'Rewardful API key not configured',
    })
  }

  // Stub: In production this would:
  // 1. Fetch affiliates from Rewardful API
  // 2. Fetch referrals per affiliate
  // 3. Fetch commissions and payouts
  // 4. Store/update in local cache or settings table
  // 5. Update the integration lastSyncedAt timestamp

  return NextResponse.json({
    success: true,
    message: 'Rewardful sync stub: would refresh affiliate data in production',
    syncedAt: new Date().toISOString(),
  })
}
