/**
 * S2 stub, S1 replaces.
 *
 * The Slack Web API calls slice S2 needs to post and rewrite a suggestion in
 * a founder's DM (CN.2 contract section 2 gives this module to slice S1,
 * along with usersInfo, filesInfo, the file download and viewsOpen, which S2
 * does not use). Written here so the mirror and the interactive handler have
 * something real to call while the two slices build in parallel; the lead
 * keeps S1's version at merge.
 *
 * Workers runtime only: fetch and nothing else. Every call surfaces Slack's
 * own error string as a thrown Error so a caller logs what Slack actually
 * said rather than "request failed".
 */

const SLACK_API = 'https://slack.com/api'

/** The bot token, or null when the app has not been installed yet. Every
 *  caller treats null as "Slack is not set up", never as a failure. */
export function slackBotToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN
  return token && token.trim() ? token : null
}

interface SlackEnvelope {
  ok?: boolean
  error?: string
  ts?: string
  channel?: string | { id?: string }
}

async function call(method: string, body: Record<string, unknown>): Promise<SlackEnvelope> {
  const token = slackBotToken()
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured')

  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as SlackEnvelope
  if (!data.ok) throw new Error(`slack ${method}: ${data.error ?? 'unknown_error'}`)
  return data
}

function channelId(value: SlackEnvelope['channel']): string {
  if (typeof value === 'string') return value
  return value?.id ?? ''
}

export interface SlackPostMessageInput {
  channel: string
  text: string
  blocks?: readonly unknown[]
}

export interface SlackMessageRef {
  channel: string
  ts: string
}

/** chat.postMessage. `text` is the notification fallback, which is what a
 *  phone shows on the lock screen, so it is never empty. */
export async function postMessage(input: SlackPostMessageInput): Promise<SlackMessageRef> {
  const data = await call('chat.postMessage', {
    channel: input.channel,
    text: input.text,
    blocks: input.blocks,
    unfurl_links: false,
  })
  return { channel: channelId(data.channel) || input.channel, ts: data.ts ?? '' }
}

export interface SlackUpdateMessageInput {
  channel: string
  ts: string
  text: string
  blocks?: readonly unknown[]
}

/** chat.update, which is how a decided suggestion loses its buttons in place
 *  rather than by a second message nobody asked for. */
export async function updateMessage(input: SlackUpdateMessageInput): Promise<void> {
  await call('chat.update', {
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    blocks: input.blocks,
  })
}

/** conversations.open: the app's DM channel with one user, created on first
 *  use and stable afterwards. */
export async function openDm(slackUserId: string): Promise<string> {
  const data = await call('conversations.open', { users: slackUserId })
  return channelId(data.channel)
}
