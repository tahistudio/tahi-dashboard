/**
 * The two Slack webhook routes.
 *
 * What is pinned here:
 *
 *   THE THREE SECOND ACK. Slack retries any delivery it does not see a 200 for
 *   within three seconds, up to three times, so the route must answer BEFORE
 *   the work is done. Every handler hands the work to ctx.waitUntil and
 *   returns immediately; a route that awaited the work would turn one DM into
 *   three replies.
 *
 *   VERIFY BEFORE ANYTHING ELSE. Nothing is parsed, nothing is written and no
 *   identity is resolved until the signature checks out, and a worker with no
 *   signing secret answers 500 rather than 401 so the install is debuggable.
 *
 *   THE CHALLENGE ECHO, which is the one reply Slack reads as prose: the
 *   url_verification handshake has to come back with the bare challenge or the
 *   events URL never turns green.
 *
 *   THE DEDUPE RUNS AT THE ROUTE, not inside a handler, because it is the
 *   retry that it defends against and a retry never reaches a handler.
 *
 *   THE MODAL ACK. A view_submission is answered with response_action clear,
 *   decided from the payload type alone, so a submit closes cleanly whatever
 *   the work behind it does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Verdict = { ok: true } | { ok: false; reason: string }

let verdict: Verdict = { ok: true }
let firstSeen = true
let handled = true

const events: Array<Record<string, unknown>> = []
const interactions: Array<Record<string, unknown>> = []
const remembered: Array<string | null> = []
const deferred: Array<Promise<unknown>> = []

vi.mock('@/lib/slack/verify', () => ({
  verifySlackRequest: async () => verdict,
}))

vi.mock('@/lib/slack/dispatch', async (importOriginal) => ({
  // The real ack body, so the test below pins what Slack is actually sent.
  VIEW_SUBMISSION_ACK: (await importOriginal<typeof import('@/lib/slack/dispatch')>()).VIEW_SUBMISSION_ACK,
  isHandledEvent: () => handled,
  rememberSlackEvent: async (_db: unknown, id: string | null) => { remembered.push(id); return firstSeen },
  handleSlackEvent: async (_db: unknown, envelope: Record<string, unknown>) => { events.push(envelope) },
  handleSlackInteraction: async (_db: unknown, payload: Record<string, unknown>) => { interactions.push(payload) },
  parseInteractivePayload: (raw: string) => {
    const encoded = new URLSearchParams(raw).get('payload')
    if (!encoded) return null
    try { return JSON.parse(encoded) as Record<string, unknown> } catch { return null }
  },
}))

vi.mock('@/lib/db', () => ({ db: async () => ({}) }))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => ({ ctx: { waitUntil: (p: Promise<unknown>) => { deferred.push(p) } } }),
}))

const { POST: eventsRoute } = await import('../events/route')
const { POST: interactiveRoute } = await import('../interactive/route')

function post(body: string, contentType = 'application/json'): Request {
  return new Request('https://portal.tahi.studio/api/webhooks/slack/events', {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-slack-request-timestamp': '1760000000', 'x-slack-signature': 'v0=abc' },
    body,
  })
}

/** Let the waitUntil work settle, the way the worker does after the flush. */
async function settle(): Promise<void> { await Promise.all(deferred) }

beforeEach(() => {
  verdict = { ok: true }
  firstSeen = true
  handled = true
  events.length = 0
  interactions.length = 0
  remembered.length = 0
  deferred.length = 0
})

describe('POST /api/webhooks/slack/events', () => {
  it('echoes the url_verification challenge, which is what turns the events URL green', async () => {
    const res = await eventsRoute(post(JSON.stringify({ type: 'url_verification', challenge: 'c-123' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: 'c-123' })
  })

  it('answers 401 on a bad signature and parses nothing', async () => {
    verdict = { ok: false, reason: 'bad_signature' }
    const res = await eventsRoute(post(JSON.stringify({ type: 'url_verification', challenge: 'c-123' })))
    expect(res.status).toBe(401)
    expect(events).toHaveLength(0)
    expect(remembered).toHaveLength(0)
  })

  it('answers 401 on a replayed timestamp', async () => {
    verdict = { ok: false, reason: 'stale_timestamp' }
    expect((await eventsRoute(post('{}'))).status).toBe(401)
  })

  it('answers 500, not 401, when the worker has no signing secret', async () => {
    verdict = { ok: false, reason: 'not_configured' }
    expect((await eventsRoute(post('{}'))).status).toBe(500)
  })

  it('acks immediately and does the work after the response', async () => {
    const envelope = { type: 'event_callback', event_id: 'Ev1', team_id: 'T_TAHI', event: { type: 'message', channel_type: 'im', user: 'U_LIAM', channel: 'D1', text: 'hi' } }
    const res = await eventsRoute(post(JSON.stringify(envelope)))
    expect(res.status).toBe(200)
    // The work is queued, not awaited: nothing has run at the moment we answer.
    expect(events).toHaveLength(0)
    expect(deferred).toHaveLength(1)
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_id: 'Ev1' })
  })

  it('drops Slack retrying a delivery it already got a 200 for', async () => {
    firstSeen = false
    const res = await eventsRoute(post(JSON.stringify({ type: 'event_callback', event_id: 'Ev1', event: { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'hi' } })))
    expect(res.status).toBe(200)
    await settle()
    expect(remembered).toEqual(['Ev1'])
    expect(events).toHaveLength(0)
  })

  it('does not even spend a dedupe row on an event it would ignore', async () => {
    handled = false
    const res = await eventsRoute(post(JSON.stringify({ type: 'event_callback', event_id: 'Ev1', event: { type: 'message', subtype: 'message_changed', channel_type: 'im', channel: 'D1' } })))
    expect(res.status).toBe(200)
    await settle()
    expect(remembered).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('answers 200 to an envelope type it does not know, so Slack stops retrying it', async () => {
    const res = await eventsRoute(post(JSON.stringify({ type: 'something_new' })))
    expect(res.status).toBe(200)
    expect(events).toHaveLength(0)
  })

  it('answers 400 to a body that is not JSON', async () => {
    expect((await eventsRoute(post('not json'))).status).toBe(400)
  })

  // Agent mode, contract section 6b. Which of the two assistant events is
  // acted on is lib/slack/dispatch.ts#isHandledEvent's call and is pinned
  // there; what the route owes each one is the 200, and that is pinned here.
  it('carries a new assistant thread through to the handler', async () => {
    const envelope = {
      type: 'event_callback',
      event_id: 'Ev_assist',
      team_id: 'T_TAHI',
      event: {
        type: 'assistant_thread_started',
        assistant_thread: { user_id: 'U_LIAM', channel_id: 'D_LIAM', thread_ts: '1758.1' },
      },
    }
    const res = await eventsRoute(post(JSON.stringify(envelope)))
    expect(res.status).toBe(200)
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_id: 'Ev_assist' })
  })

  it('acks a context change and spends nothing on it', async () => {
    handled = false
    const res = await eventsRoute(post(JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev_ctx',
      team_id: 'T_TAHI',
      event: {
        type: 'assistant_thread_context_changed',
        assistant_thread: { user_id: 'U_LIAM', channel_id: 'D_LIAM', thread_ts: '1758.1' },
      },
    })))
    expect(res.status).toBe(200)
    await settle()
    expect(remembered).toHaveLength(0)
    expect(events).toHaveLength(0)
  })
})

describe('POST /api/webhooks/slack/interactive', () => {
  const click = {
    type: 'block_actions',
    team: { id: 'T_TAHI' },
    user: { id: 'U_LIAM' },
    trigger_id: 'trig1',
    container: { channel_id: 'D_LIAM', message_ts: '1758.1' },
    actions: [{ action_id: 'sugg:approve:s1', value: 's1' }],
  }
  const form = () => new URLSearchParams({ payload: JSON.stringify(click) }).toString()

  it('acks a button click immediately and handles it after the response', async () => {
    const res = await interactiveRoute(post(form(), 'application/x-www-form-urlencoded'))
    expect(res.status).toBe(200)
    expect(interactions).toHaveLength(0)
    await settle()
    expect(interactions).toHaveLength(1)
    expect(interactions[0]).toMatchObject({ type: 'block_actions' })
  })

  it('dedupes on the trigger id, which is the one thing unique per interaction', async () => {
    await interactiveRoute(post(form(), 'application/x-www-form-urlencoded'))
    await settle()
    expect(remembered).toEqual(['trig1'])
  })

  it('drops a replayed click rather than deciding a suggestion twice', async () => {
    firstSeen = false
    const res = await interactiveRoute(post(form(), 'application/x-www-form-urlencoded'))
    expect(res.status).toBe(200)
    await settle()
    expect(interactions).toHaveLength(0)
  })

  it('answers 401 on a bad signature without parsing the payload', async () => {
    verdict = { ok: false, reason: 'bad_signature' }
    const res = await interactiveRoute(post(form(), 'application/x-www-form-urlencoded'))
    expect(res.status).toBe(401)
    expect(interactions).toHaveLength(0)
  })

  it('answers 400 to a body with no payload field', async () => {
    expect((await interactiveRoute(post('', 'application/x-www-form-urlencoded'))).status).toBe(400)
  })

  it('answers a click with an empty body, because a click ack carries nothing', async () => {
    const res = await interactiveRoute(post(form(), 'application/x-www-form-urlencoded'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    await settle()
  })

  // A modal submit is the one payload whose answer Slack reads. A body it does
  // not accept is an error shown inside the modal, so the answer is pinned to
  // Slack's own shape here, not to the constant's name.
  describe('a modal submit', () => {
    const submit = {
      type: 'view_submission',
      team: { id: 'T_TAHI' },
      user: { id: 'U_LIAM' },
      trigger_id: 'trig_view',
      view: { id: 'V1', callback_id: 'tweak:s1', private_metadata: 's1', state: { values: {} } },
    }
    const submitForm = () => new URLSearchParams({ payload: JSON.stringify(submit) }).toString()

    it('closes the modal stack with response_action clear, as JSON', async () => {
      const res = await interactiveRoute(post(submitForm(), 'application/x-www-form-urlencoded'))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(await res.json()).toEqual({ response_action: 'clear' })
      await settle()
    })

    it('still does the work after the response, behind the same dedupe', async () => {
      await interactiveRoute(post(submitForm(), 'application/x-www-form-urlencoded'))
      expect(interactions).toHaveLength(0)
      await settle()
      expect(remembered).toEqual(['trig_view'])
      expect(interactions).toHaveLength(1)
      expect(interactions[0]).toMatchObject({ type: 'view_submission' })
    })

    it('closes the modal even for a replayed submit that does no work', async () => {
      firstSeen = false
      const res = await interactiveRoute(post(submitForm(), 'application/x-www-form-urlencoded'))
      expect(await res.json()).toEqual({ response_action: 'clear' })
      await settle()
      expect(interactions).toHaveLength(0)
    })
  })
})
