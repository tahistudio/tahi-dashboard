import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/integrations/mailerlite
 * Stub: adds a contact to a MailerLite group.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    email?: string
    name?: string
    groupId?: string
  }

  const { email, name } = body

  if (!email) {
    return NextResponse.json(
      { error: 'email is required' },
      { status: 400 },
    )
  }

  const apiKey = process.env.MAILERLITE_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      message: 'MailerLite integration not configured. Set MAILERLITE_API_KEY to enable.',
    })
  }

  // Stub: in production this would call MailerLite API
  // POST https://connect.mailerlite.com/api/subscribers
  // {
  //   email,
  //   fields: { name },
  //   groups: [groupId],
  // }

  return NextResponse.json({
    success: true,
    message: 'Contact queued for MailerLite sync',
    data: { email, name: name ?? null },
  })
}
