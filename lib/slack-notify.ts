/**
 * lib/slack-notify.ts
 *
 * Helper to send Slack notifications when requests are created or status changes.
 * Reads channel config from the integrations table.
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface SlackNotifyParams {
  database: DrizzleDB
  eventType: 'new_request' | 'status_change' | 'overdue'
  message: string
}

export async function sendSlackNotification({
  database,
  eventType,
  message,
}: SlackNotifyParams): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return

  // Get channel config
  const rows = await database
    .select({ config: schema.integrations.config })
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'slack'))
    .limit(1)

  if (rows.length === 0) return

  let config: Record<string, string> = {}
  try {
    config = JSON.parse(rows[0].config ?? '{}') as Record<string, string>
  } catch {
    return
  }

  const channelKey = `channel_${eventType}`
  const channel = config[channelKey]
  if (!channel) return

  // Send to Slack
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, text: message }),
    })
  } catch {
    // Silent failure for Slack notifications
  }
}

/**
 * Post an arbitrary message to a Slack channel. Resolves the channel from
 * the integrations config in priority order: the named config key (e.g.
 * 'channel_covers'), then 'channel_new_request' as a sensible default, or
 * a literal channel id passed in. Returns whether it sent + any error so
 * callers can surface "Slack not configured" to the user.
 */
export async function postSlackMessage(params: {
  database: DrizzleDB
  text: string
  channelKey?: string        // config key to look up, e.g. 'channel_covers'
  channelId?: string         // or a literal channel id, takes precedence
}): Promise<{ sent: boolean; error?: string }> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return { sent: false, error: 'SLACK_BOT_TOKEN not configured' }

  let channel = params.channelId ?? ''
  if (!channel) {
    const rows = await params.database
      .select({ config: schema.integrations.config })
      .from(schema.integrations)
      .where(eq(schema.integrations.service, 'slack'))
      .limit(1)
    if (rows.length === 0) return { sent: false, error: 'Slack integration not connected' }
    let config: Record<string, string> = {}
    try { config = JSON.parse(rows[0].config ?? '{}') as Record<string, string> } catch { /* empty */ }
    channel = config[params.channelKey ?? 'channel_covers']
      ?? config.channel_covers
      ?? config.channel_new_request
      ?? config.channel_status_change
      ?? ''
    if (!channel) return { sent: false, error: 'No Slack channel configured (set one in Settings → Integrations)' }
  }

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text: params.text, unfurl_links: false }),
    })
    const data = await res.json() as { ok?: boolean; error?: string }
    if (!data.ok) return { sent: false, error: data.error ?? 'Slack API error' }
    return { sent: true }
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Slack request failed' }
  }
}
