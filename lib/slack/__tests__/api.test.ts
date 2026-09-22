/**
 * lib/slack/api.ts, the thin typed wrapper over the Slack Web API.
 *
 * What is pinned here:
 *
 *   SLACK ANSWERS 200 WHEN IT REFUSES. `{"ok":false,"error":"channel_not_found"}`
 *   arrives with an HTTP 200, so a wrapper that trusts `res.ok` reports every
 *   failure as a success and a founder's approval silently goes nowhere. Every
 *   call therefore throws with Slack's own error string.
 *
 *   A MISSING TOKEN IS A THROWN ERROR, not a no-op. lib/slack-notify.ts
 *   deliberately returns quietly, because a missed channel ping is cosmetic;
 *   a DM carrying the only copy of a suggestion is not.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  postMessage,
  updateMessage,
  openDm,
  usersInfo,
  filesInfo,
  downloadFile,
  viewsOpen,
  slackBotToken,
  setStatus,
  setSuggestedPrompts,
} from '../api'

interface Call { url: string; init: RequestInit }

let calls: Call[] = []
let responder: (url: string) => Response

const originalFetch = globalThis.fetch

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  calls = []
  process.env.SLACK_BOT_TOKEN = 'xoxb-test'
  responder = () => json({ ok: true })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init: init ?? {} })
    return responder(url)
  }) as typeof fetch
})

afterEach(() => { globalThis.fetch = originalFetch })

describe('postMessage', () => {
  it('sends the bot token and returns the channel and timestamp', async () => {
    responder = () => json({ ok: true, channel: 'D1', ts: '1758.1' })
    const result = await postMessage({ channel: 'D1', text: 'hello' })
    expect(result).toEqual({ channel: 'D1', ts: '1758.1' })
    expect(calls[0].url).toBe('https://slack.com/api/chat.postMessage')
    const headers = new Headers(calls[0].init.headers)
    expect(headers.get('authorization')).toBe('Bearer xoxb-test')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ channel: 'D1', text: 'hello', unfurl_links: false })
  })

  it('throws Slack’s own error string when Slack refuses inside a 200', async () => {
    responder = () => json({ ok: false, error: 'channel_not_found' })
    await expect(postMessage({ channel: 'D_NOPE', text: 'hi' })).rejects.toThrow('channel_not_found')
  })

  it('throws when the worker has no bot token, rather than dropping the message', async () => {
    delete process.env.SLACK_BOT_TOKEN
    await expect(postMessage({ channel: 'D1', text: 'hi' })).rejects.toThrow('SLACK_BOT_TOKEN')
    expect(calls).toHaveLength(0)
  })
})

describe('the rest of the surface', () => {
  it('updates a message in place', async () => {
    responder = () => json({ ok: true, channel: 'D1', ts: '1758.1' })
    await updateMessage({ channel: 'D1', ts: '1758.1', text: 'Approved by Liam, 09:41' })
    expect(calls[0].url).toBe('https://slack.com/api/chat.update')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ channel: 'D1', ts: '1758.1' })
  })

  it('opens a DM and returns just the channel id', async () => {
    responder = () => json({ ok: true, channel: { id: 'D_LIAM' } })
    expect(await openDm('U_LIAM')).toBe('D_LIAM')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ users: 'U_LIAM' })
  })

  it('reads a profile down to the one field identity needs', async () => {
    responder = () => json({ ok: true, user: { id: 'U_LIAM', is_bot: false, profile: { email: 'business@tahi.studio', real_name: 'Liam' } } })
    expect(await usersInfo('U_LIAM')).toEqual({ id: 'U_LIAM', email: 'business@tahi.studio', name: 'Liam', isBot: false })
    expect(calls[0].url).toContain('users.info?user=U_LIAM')
  })

  it('reads a file’s private url and mime type', async () => {
    responder = () => json({ ok: true, file: { id: 'F1', mimetype: 'audio/mp4', url_private_download: 'https://files.slack.com/f1', name: 'note.m4a', size: 12 } })
    expect(await filesInfo('F1')).toEqual({ id: 'F1', mimetype: 'audio/mp4', urlPrivate: 'https://files.slack.com/f1', name: 'note.m4a', size: 12 })
  })

  it('downloads a private file with the bot token, which is the only way it is readable', async () => {
    responder = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    const bytes = await downloadFile('https://files.slack.com/f1')
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]))
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer xoxb-test')
  })

  it('throws on a download that came back as an error page rather than bytes', async () => {
    responder = () => new Response('nope', { status: 403 })
    await expect(downloadFile('https://files.slack.com/f1')).rejects.toThrow('403')
  })

  it('opens a modal against a trigger id', async () => {
    responder = () => json({ ok: true, view: { id: 'V1' } })
    expect(await viewsOpen('trig1', { type: 'modal' })).toBe('V1')
    expect(calls[0].url).toBe('https://slack.com/api/views.open')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ trigger_id: 'trig1' })
  })
})

describe('slackBotToken', () => {
  it('reads the token off the environment', () => {
    expect(slackBotToken()).toBe('xoxb-test')
  })

  it('is null rather than a throw when the worker has none, which is what the optional callers ask', () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(slackBotToken()).toBeNull()
  })

  it('treats a blank token as no token', () => {
    process.env.SLACK_BOT_TOKEN = '   '
    expect(slackBotToken()).toBeNull()
  })
})

describe('agent mode (contract section 6b)', () => {
  it('sets the status line on the assistant thread', async () => {
    await setStatus({ channelId: 'D1', threadTs: '1758.1', status: 'Reading your note' })
    expect(calls[0].url).toBe('https://slack.com/api/assistant.threads.setStatus')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      channel_id: 'D1',
      thread_ts: '1758.1',
      status: 'Reading your note',
    })
  })

  it('clears the status line with an empty string rather than a second method', async () => {
    await setStatus({ channelId: 'D1', threadTs: '1758.1', status: '' })
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ status: '' })
  })

  it('sets the three suggested prompts', async () => {
    await setSuggestedPrompts({
      channelId: 'D1',
      threadTs: '1758.1',
      prompts: [
        { title: 'Log a task', message: 'Task for me: ' },
        { title: 'New request for a client', message: 'Request for ' },
        { title: 'What is waiting on me', message: 'What is waiting on me?' },
      ],
    })
    expect(calls[0].url).toBe('https://slack.com/api/assistant.threads.setSuggestedPrompts')
    const body = JSON.parse(String(calls[0].init.body)) as { prompts: Array<{ message: string }> }
    expect(body.prompts).toHaveLength(3)
    expect(body.prompts.map(prompt => prompt.message)).toEqual(['Task for me: ', 'Request for ', 'What is waiting on me?'])
  })

  it('says nothing at all when there are no prompts to set', async () => {
    await setSuggestedPrompts({ channelId: 'D1', threadTs: '1758.1', prompts: [] })
    expect(calls).toHaveLength(0)
  })

  it('swallows a refusal, because a status line is never worth failing a note over', async () => {
    responder = () => json({ ok: false, error: 'missing_scope' })
    await expect(setStatus({ channelId: 'D1', threadTs: '1758.1', status: 'Reading your note' })).resolves.toBeUndefined()
    await expect(setSuggestedPrompts({
      channelId: 'D1',
      threadTs: '1758.1',
      prompts: [{ title: 'Log a task', message: 'Task for me: ' }],
    })).resolves.toBeUndefined()
  })
})
