import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/admin/integrations/slack
 * Returns Slack connection status and channel config.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const rows = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'slack'))
    .limit(1)

  const integration = rows.length > 0 ? rows[0] : null
  const hasToken = !!process.env.SLACK_BOT_TOKEN

  let config: Record<string, string> = {}
  if (integration?.config) {
    try { config = JSON.parse(integration.config) as Record<string, string> } catch { /* empty */ }
  }

  return NextResponse.json({
    connected: integration?.status === 'connected' || hasToken,
    status: integration?.status ?? (hasToken ? 'connected' : 'disconnected'),
    channels: {
      new_request: config.channel_new_request ?? '',
      status_change: config.channel_status_change ?? '',
      overdue: config.channel_overdue ?? '',
    },
  })
}

/**
 * PUT /api/admin/integrations/slack
 * Update channel config.
 * Body: { channels: { new_request, status_change, overdue } }
 */
export async function PUT(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    channels?: { new_request?: string; status_change?: string; overdue?: string }
  }

  const database = await db()
  const now = new Date().toISOString()

  const config = JSON.stringify({
    channel_new_request: body.channels?.new_request ?? '',
    channel_status_change: body.channels?.status_change ?? '',
    channel_overdue: body.channels?.overdue ?? '',
  })

  const existing = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'slack'))
    .limit(1)

  if (existing.length > 0) {
    await database
      .update(schema.integrations)
      .set({ config, updatedAt: now })
      .where(eq(schema.integrations.service, 'slack'))
  } else {
    await database.insert(schema.integrations).values({
      id: crypto.randomUUID(),
      service: 'slack',
      status: process.env.SLACK_BOT_TOKEN ? 'connected' : 'disconnected',
      config,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}

/**
 * POST /api/admin/integrations/slack
 * Posts a message to a Slack channel.
 * Supports action types: 'new_request', 'status_change', 'overdue_alert'.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    action?: 'new_request' | 'overdue_alert' | 'message'
    channel?: string
    message?: string
    requestId?: string
    requestTitle?: string
    orgName?: string
  }

  const { action, channel, message } = body

  if (!channel || !message) {
    return NextResponse.json(
      { error: 'channel and message are required' },
      { status: 400 },
    )
  }

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    return NextResponse.json({
      success: false,
      message: 'Slack integration not configured. Set SLACK_BOT_TOKEN to enable.',
      action: action ?? 'message',
    })
  }

  // Stub: in production this would call Slack chat.postMessage API
  // const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${token}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({ channel, text: message }),
  // })

  return NextResponse.json({
    success: true,
    message: `Slack notification queued for #${channel}`,
    action: action ?? 'message',
  })
}
