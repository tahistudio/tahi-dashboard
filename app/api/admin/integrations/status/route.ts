import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/integrations/status
 * Returns which integrations have their env vars configured.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    stripe: {
      configured: !!process.env.STRIPE_SECRET_KEY,
      webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    },
    resend: {
      configured: !!process.env.RESEND_API_KEY,
    },
    xero: {
      configured: !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET),
    },
    slack: {
      configured: !!process.env.SLACK_BOT_TOKEN,
    },
    mailerlite: {
      configured: !!process.env.MAILERLITE_API_KEY,
    },
  })
}
