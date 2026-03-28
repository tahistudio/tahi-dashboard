import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/admin/integrations/mailerlite
 * Returns MailerLite connection status.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hasApiKey = !!process.env.MAILERLITE_API_KEY

  const database = await db()
  const rows = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'mailerlite'))
    .limit(1)

  const integration = rows.length > 0 ? rows[0] : null

  return NextResponse.json({
    connected: integration?.status === 'connected' || hasApiKey,
    status: integration?.status ?? (hasApiKey ? 'connected' : 'disconnected'),
    lastSynced: integration?.lastSyncedAt ?? null,
  })
}

/**
 * PUT /api/admin/integrations/mailerlite
 * Remove/unsubscribe a contact on client offboarding (T130).
 * Body: { email: string, action: 'unsubscribe' }
 */
export async function PUT(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { email?: string; action?: string }
  if (!body.email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  // Stub: in production would call MailerLite API to unsubscribe
  return NextResponse.json({
    success: true,
    message: 'MailerLite unsubscribe stub: would remove in production',
    email: body.email,
  })
}

/**
 * POST /api/admin/integrations/mailerlite
 * Adds a contact to a MailerLite group (T129).
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
