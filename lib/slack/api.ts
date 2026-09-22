/**
 * lib/slack/api.ts
 *
 * A thin, typed wrapper over the Slack Web API calls the app makes.
 *
 * Two things it exists to get right:
 *
 *   SLACK ANSWERS 200 WHEN IT REFUSES. `{"ok":false,"error":"channel_not_found"}`
 *   arrives with an HTTP 200, so anything that trusts `res.ok` reports every
 *   failure as a success and a founder's approval silently goes nowhere. Every
 *   call here throws an Error carrying Slack's own error string.
 *
 *   A MISSING TOKEN IS AN ERROR, not a shrug. lib/slack-notify.ts deliberately
 *   returns quietly when SLACK_BOT_TOKEN is unset, because a missed channel
 *   ping is cosmetic. A DM carrying the only copy of a suggestion is not, so
 *   the caller has to find out.
 *
 * Kept separate from lib/slack-notify.ts, which stays exactly as it is: that
 * file posts to a shared channel from the integrations config, this one talks
 * to people.
 */

const SLACK_API = 'https://slack.com/api'

function botToken(): string {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured')
  return token
}

interface SlackEnvelope {
  ok?: boolean
  error?: string
}

async function readEnvelope<T extends SlackEnvelope>(method: string, res: Response): Promise<T> {
  const data = (await res.json()) as T
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error ?? 'unknown_error'}`)
  return data
}

async function callSlack<T extends SlackEnvelope>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = botToken()
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  return readEnvelope<T>(method, res)
}

async function getSlack<T extends SlackEnvelope>(method: string, params: Record<string, string>): Promise<T> {
  const token = botToken()
  const query = new URLSearchParams(params).toString()
  const res = await fetch(`${SLACK_API}/${method}?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  return readEnvelope<T>(method, res)
}

/**
 * Block Kit is a nested, open-ended shape and typing it fully would be a
 * second library. `unknown[]` is honest: the blocks are built in one place
 * (lib/slack/blocks.ts, slice S2) and only ever passed through here.
 */
export type SlackBlocks = readonly unknown[]

export interface SlackMessageRef {
  channel: string
  ts: string
}

export interface PostMessageInput {
  channel: string
  /** Always set, even alongside blocks: it is the notification and fallback text. */
  text: string
  blocks?: SlackBlocks
  threadTs?: string
}

export async function postMessage(input: PostMessageInput): Promise<SlackMessageRef> {
  const data = await callSlack<SlackEnvelope & { channel?: string; ts?: string }>('chat.postMessage', {
    channel: input.channel,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    unfurl_links: false,
    unfurl_media: false,
  })
  return { channel: data.channel ?? input.channel, ts: data.ts ?? '' }
}

export interface UpdateMessageInput {
  channel: string
  ts: string
  text: string
  blocks?: SlackBlocks
}

/**
 * Rewrite a message in place. This is how a decided suggestion loses its
 * buttons everywhere at once rather than staying tappable in a second DM.
 */
export async function updateMessage(input: UpdateMessageInput): Promise<SlackMessageRef> {
  const data = await callSlack<SlackEnvelope & { channel?: string; ts?: string }>('chat.update', {
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    // An explicit empty array is what CLEARS the old blocks. Omitting the
    // field leaves the buttons on screen.
    blocks: input.blocks ?? [],
  })
  return { channel: data.channel ?? input.channel, ts: data.ts ?? input.ts }
}

/** Open (or re-open) the app's 1:1 channel with a user, returning its id. */
export async function openDm(userId: string): Promise<string> {
  const data = await callSlack<SlackEnvelope & { channel?: { id?: string } }>('conversations.open', {
    users: userId,
  })
  const id = data.channel?.id
  if (!id) throw new Error('Slack conversations.open returned no channel id')
  return id
}

export interface SlackUser {
  id: string
  email: string | null
  name: string | null
  isBot: boolean
}

/**
 * The profile, narrowed to what identity resolution needs. `users:read.email`
 * is the scope that makes `email` present; without it every user maps to
 * 'unknown', which is the correct failure but an opaque one, hence the
 * explicit null rather than an absent field.
 */
export async function usersInfo(userId: string): Promise<SlackUser> {
  const data = await getSlack<SlackEnvelope & {
    user?: { id?: string; is_bot?: boolean; profile?: { email?: string; real_name?: string; display_name?: string } }
  }>('users.info', { user: userId })
  const user = data.user
  const profile = user?.profile
  return {
    id: user?.id ?? userId,
    email: profile?.email ?? null,
    name: profile?.real_name ?? profile?.display_name ?? null,
    isBot: user?.is_bot === true,
  }
}

export interface SlackFile {
  id: string
  mimetype: string | null
  /** The authenticated download URL. Useless without the bot token. */
  urlPrivate: string | null
  name: string | null
  size: number | null
}

export async function filesInfo(fileId: string): Promise<SlackFile> {
  const data = await getSlack<SlackEnvelope & {
    file?: { id?: string; mimetype?: string; url_private_download?: string; url_private?: string; name?: string; size?: number }
  }>('files.info', { file: fileId })
  const file = data.file
  return {
    id: file?.id ?? fileId,
    mimetype: file?.mimetype ?? null,
    urlPrivate: file?.url_private_download ?? file?.url_private ?? null,
    name: file?.name ?? null,
    size: typeof file?.size === 'number' ? file.size : null,
  }
}

/**
 * Download a private Slack file. Unlike the Web API calls this one is a plain
 * fetch against files.slack.com, and it answers with real HTTP statuses, so a
 * 403 here is a 403 rather than an ok:false envelope.
 */
export async function downloadFile(urlPrivate: string): Promise<ArrayBuffer> {
  const token = botToken()
  const res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`)
  return res.arrayBuffer()
}

/** Open a modal against a trigger id, returning the view id. */
export async function viewsOpen(triggerId: string, view: unknown): Promise<string> {
  const data = await callSlack<SlackEnvelope & { view?: { id?: string } }>('views.open', {
    trigger_id: triggerId,
    view,
  })
  return data.view?.id ?? ''
}
