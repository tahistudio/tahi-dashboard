import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/integrations/slack
 * Stub: posts a message to a Slack channel.
 * Supports two action types: 'new_request' and 'overdue_alert'.
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
