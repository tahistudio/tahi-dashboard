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
