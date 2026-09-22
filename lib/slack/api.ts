/**
 * lib/slack/api.ts
 *
 * The Slack Web API calls the app makes, typed (CN.2 section 2).
 *
 * STUB NOTE (slice S3). This file belongs to slice S1, which adds
 * `updateMessage`, `openDm`, `usersInfo` and `viewsOpen` to it. S3 needs to
 * post a reply and pull an audio file down, so those two are here and S1 adds
 * the rest around them. Nothing here reads the database: the bot token comes
 * from the environment, the same way lib/slack-notify.ts reads it today, and
 * that file keeps working unchanged.
 */

/** Slack answers 200 with `ok: false` for real failures, so every call checks it. */
interface SlackEnvelope {
  ok?: boolean
  error?: string
}

export class SlackApiError extends Error {
  constructor(public readonly method: string, public readonly slackError: string) {
    super(`Slack ${method} failed: ${slackError}`)
    this.name = 'SlackApiError'
  }
}

function token(): string {
  const value = process.env.SLACK_BOT_TOKEN
  if (!value) throw new SlackApiError('auth', 'SLACK_BOT_TOKEN is not set')
  return value
}

async function call<T extends SlackEnvelope>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T
  if (!data.ok) throw new SlackApiError(method, data.error ?? 'unknown_error')
  return data
}

export interface PostMessageInput {
  channel: string
  text: string
  blocks?: unknown[]
  threadTs?: string
}

export interface PostedMessage {
  channel: string
  ts: string
}

/** chat.postMessage. Returns where it landed so a copy can be rewritten later. */
export async function postMessage(input: PostMessageInput): Promise<PostedMessage> {
  const data = await call<SlackEnvelope & { channel?: string; ts?: string }>('chat.postMessage', {
    channel: input.channel,
    text: input.text,
    blocks: input.blocks,
    thread_ts: input.threadTs,
    unfurl_links: false,
  })
  return { channel: data.channel ?? input.channel, ts: data.ts ?? '' }
}

/** One file from a `file_shared` event, as much of it as this app reads. */
export interface SlackFile {
  id: string
  name?: string
  mimetype?: string
  filetype?: string
  size?: number
  url_private_download?: string
  url_private?: string
}

/** files.info, for an event that carries only a file id. */
export async function filesInfo(fileId: string): Promise<SlackFile> {
  const data = await call<SlackEnvelope & { file?: SlackFile }>('files.info', { file: fileId })
  if (!data.file) throw new SlackApiError('files.info', 'no_file')
  return data.file
}

/**
 * A private file's bytes.
 *
 * This is NOT a Web API call: the download URL is a plain HTTPS fetch that
 * happens to need the bot token as a bearer header, and it answers with the
 * file rather than a JSON envelope, so it does not go through `call`.
 */
export async function downloadFile(file: SlackFile): Promise<ArrayBuffer> {
  const url = file.url_private_download ?? file.url_private
  if (!url) throw new SlackApiError('files.download', 'no_download_url')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } })
  if (!res.ok) throw new SlackApiError('files.download', `http_${res.status}`)
  return res.arrayBuffer()
}
