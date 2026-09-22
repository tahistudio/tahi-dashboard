/**
 * lib/slack/dispatch.ts, the seam between a verified Slack delivery and the
 * slices that actually answer it.
 *
 * What is pinned here:
 *
 *   THE DEDUPE, because Slack retries a delivery three times when it does not
 *   see a 200 fast enough, and the second delivery of "approve this" must do
 *   nothing rather than approve twice. The primary key is the event id, so the
 *   race is settled by the database rather than by a read-then-write.
 *
 *   WHAT WE REFUSE TO LOOK AT: the bot's own messages (an infinite loop, one
 *   reply at a time), edits and deletions, and anything that is not a DM.
 *
 *   THE UNKNOWN REPLY, which runs BEFORE either hook is delegated to: a
 *   stranger must not be able to spend a model call, a download or a database
 *   read, and must not learn from the wording whether anything was looked up.
 *
 *   THE DELEGATION. handleDm hands the flattened event to S3's DM handler and
 *   handleAction hands the button to whatever claimed its prefix. A button
 *   nothing has claimed says so rather than going quiet.
 *
 *   THE ASSISTANT PANE (contract section 6b): a new thread gets one welcome
 *   line for the level and the three suggested prompts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { schema } from '@/db/d1'

const posted: Array<Record<string, unknown>> = []
const statuses: Array<Record<string, unknown>> = []
const prompts: Array<Record<string, unknown>> = []

vi.mock('../api', () => ({
  postMessage: async (input: Record<string, unknown>) => { posted.push(input); return { ts: '1.1', channel: String(input.channel) } },
  openDm: async (userId: string) => `D_${userId}`,
  filesInfo: async (fileId: string) => ({ id: fileId, mimetype: 'audio/mp4', urlPrivate: 'https://files.slack.com/f', name: 'note.m4a', size: 2048 }),
  setStatus: async (input: Record<string, unknown>) => { statuses.push(input) },
  setSuggestedPrompts: async (input: Record<string, unknown>) => { prompts.push(input) },
}))

const {
  isHandledEvent,
  rememberSlackEvent,
  parseInteractivePayload,
  readAction,
  handleDm,
  handleAction,
  handleAssistantThreadStarted,
  ASSISTANT_PROMPTS,
  NOT_WIRED_LINE,
} = await import('../dispatch')

const { registerSlackDmHandler, resetSlackDmHandler } = await import('../dm-hook')
const { registerBlockActionHandler, clearBlockActionHandlers } = await import('../action-registry')

const { DENIAL_LINE } = await import('../identity')

type Row = Record<string, unknown>

function fakeDb(existing: string[]) {
  const seen = new Set(existing)
  const database = {
    insert: (table: unknown) => ({
      values: async (values: Row) => {
        if (table !== schema.slackEventsSeen) throw new Error('wrong table')
        const id = String(values.id)
        if (seen.has(id)) throw new Error('D1_ERROR: UNIQUE constraint failed: slack_events_seen.id')
        seen.add(id)
      },
    }),
  }
  return { database: database as unknown as Parameters<typeof rememberSlackEvent>[0], seen }
}

function identity(level: 'founder' | 'member' | 'client' | 'unknown') {
  return {
    id: 'si', slackTeamId: 'T', slackUserId: 'U', email: null, level,
    teamMemberId: null, contactId: null, orgId: null, dmChannelId: 'D1',
  }
}

beforeEach(() => {
  posted.length = 0
  statuses.length = 0
  prompts.length = 0
  resetSlackDmHandler()
  clearBlockActionHandlers()
})

describe('isHandledEvent', () => {
  it('handles a plain DM', () => {
    expect(isHandledEvent({ type: 'message', channel_type: 'im', user: 'U1', text: 'hi', channel: 'D1' })).toBe(true)
  })

  it('handles an audio file shared in a DM', () => {
    expect(isHandledEvent({ type: 'message', subtype: 'file_share', channel_type: 'im', user: 'U1', channel: 'D1' })).toBe(true)
    expect(isHandledEvent({ type: 'file_shared', user: 'U1', channel: 'D1' })).toBe(true)
  })

  it('handles an app mention', () => {
    expect(isHandledEvent({ type: 'app_mention', user: 'U1', text: '<@B> hi', channel: 'C1' })).toBe(true)
  })

  it('ignores the bot talking to itself, which is what an infinite loop looks like', () => {
    expect(isHandledEvent({ type: 'message', channel_type: 'im', bot_id: 'B1', channel: 'D1', text: 'hi' })).toBe(false)
    expect(isHandledEvent({ type: 'message', channel_type: 'im', user: 'U1', channel: 'D1', text: 'hi', bot_profile: { id: 'B1' } })).toBe(false)
  })

  it('ignores edits, deletions and joins, which are not somebody saying something', () => {
    for (const subtype of ['message_changed', 'message_deleted', 'channel_join', 'bot_message']) {
      expect(isHandledEvent({ type: 'message', subtype, channel_type: 'im', user: 'U1', channel: 'D1' })).toBe(false)
    }
  })

  it('ignores a channel message, because this phase is DMs only', () => {
    expect(isHandledEvent({ type: 'message', channel_type: 'channel', user: 'U1', channel: 'C1', text: 'hi' })).toBe(false)
  })

  it('ignores an absent event rather than throwing at the route', () => {
    expect(isHandledEvent(undefined)).toBe(false)
  })
})

describe('rememberSlackEvent', () => {
  it('is true the first time and false on Slack retrying the same delivery', async () => {
    const { database } = fakeDb([])
    expect(await rememberSlackEvent(database, 'Ev123')).toBe(true)
    expect(await rememberSlackEvent(database, 'Ev123')).toBe(false)
    expect(await rememberSlackEvent(database, 'Ev124')).toBe(true)
  })

  it('treats a missing event id as already seen, so an unidentifiable delivery is dropped', async () => {
    const { database } = fakeDb([])
    expect(await rememberSlackEvent(database, null)).toBe(false)
  })

  it('lets a non-uniqueness database failure through as first-seen rather than silently dropping work', async () => {
    const database = {
      insert: () => ({ values: async () => { throw new Error('D1_ERROR: no such table: slack_events_seen') } }),
    } as unknown as Parameters<typeof rememberSlackEvent>[0]
    await expect(rememberSlackEvent(database, 'Ev9')).rejects.toThrow('no such table')
  })
})

describe('parseInteractivePayload and readAction', () => {
  const blockActions = {
    type: 'block_actions',
    team: { id: 'T_TAHI' },
    user: { id: 'U_LIAM' },
    trigger_id: 'trig1',
    response_url: 'https://hooks.slack.com/x',
    container: { channel_id: 'D_LIAM', message_ts: '1758.1' },
    actions: [{ action_id: 'sugg:approve:s1', value: 's1', type: 'button' }],
  }

  it('reads the form-encoded payload Slack posts for a button click', () => {
    const body = new URLSearchParams({ payload: JSON.stringify(blockActions) }).toString()
    const parsed = parseInteractivePayload(body)
    expect(parsed?.type).toBe('block_actions')
    expect(parsed?.user.id).toBe('U_LIAM')
  })

  it('returns null rather than throwing on a body with no payload field or bad JSON', () => {
    expect(parseInteractivePayload('')).toBeNull()
    expect(parseInteractivePayload(new URLSearchParams({ payload: '{oops' }).toString())).toBeNull()
  })

  it('flattens a block_actions click into the one action a handler needs', () => {
    const parsed = parseInteractivePayload(new URLSearchParams({ payload: JSON.stringify(blockActions) }).toString())
    const action = parsed ? readAction(parsed) : null
    expect(action).toMatchObject({
      type: 'block_actions',
      actionId: 'sugg:approve:s1',
      value: 's1',
      channelId: 'D_LIAM',
      messageTs: '1758.1',
      triggerId: 'trig1',
      responseUrl: 'https://hooks.slack.com/x',
    })
  })

  it('flattens a view_submission into the same shape, carrying the callback id', () => {
    const view = {
      type: 'view_submission',
      team: { id: 'T_TAHI' },
      user: { id: 'U_LIAM' },
      trigger_id: 'trig2',
      view: { id: 'V1', callback_id: 'sugg:tweak:s1', state: { values: {} }, private_metadata: 's1' },
    }
    const parsed = parseInteractivePayload(new URLSearchParams({ payload: JSON.stringify(view) }).toString())
    const action = parsed ? readAction(parsed) : null
    expect(action).toMatchObject({ type: 'view_submission', actionId: 'sugg:tweak:s1', value: 's1', triggerId: 'trig2' })
  })
})

const fakeDrizzle = {} as Parameters<typeof handleDm>[2]

function click(overrides: Record<string, unknown> = {}) {
  return {
    type: 'block_actions' as const,
    actionId: 'sugg:approve:s1',
    value: 's1',
    channelId: 'D_LIAM',
    messageTs: '1758.1',
    triggerId: 't',
    responseUrl: null,
    userId: 'U',
    teamId: 'T',
    ...overrides,
  }
}

describe('handleDm', () => {
  it('hands the flattened event to the DM handler, with the identity and the database', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerSlackDmHandler(async (event, deps) => {
      seen.push({ event, identity: deps.identity })
      return { handled: true, reason: 'ok', voice: false, posted: 0 }
    })

    await handleDm(
      identity('founder'),
      { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'note this', ts: '1758.1' },
      fakeDrizzle,
    )

    expect(seen).toHaveLength(1)
    expect(seen[0].event).toMatchObject({ channelId: 'D1', userId: 'U', text: 'note this', ts: '1758.1' })
    // The hook posts its own replies through the injected poster, so dispatch
    // itself says nothing.
    expect(posted).toHaveLength(0)
  })

  it('reads a file_shared through files.info, because the event names no size', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerSlackDmHandler(async (event) => {
      seen.push({ files: event.files })
      return { handled: true, reason: 'ok', voice: true, posted: 0 }
    })

    await handleDm(identity('founder'), { type: 'file_shared', user_id: 'U', channel_id: 'D1', file_id: 'F1' }, fakeDrizzle)
    expect(seen[0].files).toEqual([
      { id: 'F1', mimetype: 'audio/mp4', urlPrivate: 'https://files.slack.com/f', name: 'note.m4a', size: 2048 },
    ])
  })

  it('threads every reply, because an unthreaded message lands behind the assistant pane', async () => {
    registerSlackDmHandler(async (_event, deps) => {
      await deps.postMessage({ channel: 'D1', text: 'Here is what I understood.' })
      return { handled: true, reason: 'ok', voice: false, posted: 1 }
    })

    await handleDm(
      identity('founder'),
      { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'note this', ts: '1758.9' },
      fakeDrizzle,
    )
    expect(posted[0]).toMatchObject({ channel: 'D1', threadTs: '1758.9' })
  })

  it('refuses an unknown identity before the handler is ever reached', async () => {
    let called = false
    registerSlackDmHandler(async () => {
      called = true
      return { handled: true, reason: 'ok', voice: false, posted: 0 }
    })

    await handleDm(identity('unknown'), { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'hello?' }, fakeDrizzle)
    expect(called).toBe(false)
    expect(posted.map((p) => p.text)).toEqual([DENIAL_LINE])
  })
})

describe('handleAction', () => {
  it('hands the button to whatever claimed its prefix, and says back what it answers', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerBlockActionHandler('sugg', async (ctx) => {
      seen.push({ payload: ctx.payload, level: ctx.identity?.level })
      return { handled: true, reply: 'That one was already decided.' }
    })

    await handleAction(identity('founder'), click(), fakeDrizzle)
    expect(seen[0].payload).toMatchObject({ actionId: 'sugg:approve:s1', value: 's1', slackUserId: 'U', slackTeamId: 'T', channelId: 'D_LIAM', messageTs: '1758.1' })
    expect(seen[0].level).toBe('founder')
    expect(posted).toEqual([{ channel: 'D_LIAM', text: 'That one was already decided.' }])
  })

  it('says nothing when the handler answered with nothing to say', async () => {
    registerBlockActionHandler('sugg', async () => ({ handled: true, reply: null }))
    await handleAction(identity('founder'), click(), fakeDrizzle)
    expect(posted).toHaveLength(0)
  })

  it('answers a button nothing has claimed rather than going quiet', async () => {
    await handleAction(identity('founder'), click({ actionId: 'nudge:send:n1' }), fakeDrizzle)
    expect(posted[0]).toMatchObject({ channel: 'D_LIAM', text: NOT_WIRED_LINE })
  })

  it('refuses an unknown identity before the handler is ever reached', async () => {
    let called = false
    registerBlockActionHandler('sugg', async () => {
      called = true
      return { handled: true, reply: null }
    })
    await handleAction(identity('unknown'), click({ channelId: 'D1' }), fakeDrizzle)
    expect(called).toBe(false)
    expect(posted.map((p) => p.text)).toEqual([DENIAL_LINE])
  })

  it('never posts when there is nowhere to post to', async () => {
    await handleAction(identity('founder'), {
      type: 'view_submission', actionId: 'x', value: null,
      channelId: null, messageTs: null, triggerId: 't', responseUrl: null, userId: 'U', teamId: 'T',
    }, fakeDrizzle)
    expect(posted).toHaveLength(0)
  })
})

describe('the assistant pane (contract section 6b)', () => {
  const started = {
    type: 'assistant_thread_started',
    assistant_thread: { user_id: 'U_LIAM', channel_id: 'D_LIAM', thread_ts: '1758.1' },
  }

  it('is an event this route acts on', () => {
    expect(isHandledEvent(started)).toBe(true)
  })

  it('acks a context change and does nothing else with it', () => {
    expect(isHandledEvent({ type: 'assistant_thread_context_changed', assistant_thread: { channel_id: 'D_LIAM', thread_ts: '1758.1' } })).toBe(false)
  })

  it('opens a founder thread with one line and the three prompts', async () => {
    await handleAssistantThreadStarted(identity('founder'), started)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ channel: 'D_LIAM', threadTs: '1758.1' })
    expect(String(posted[0].text)).toContain('press a button')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ channelId: 'D_LIAM', threadTs: '1758.1' })
    expect(ASSISTANT_PROMPTS.map((prompt) => prompt.message)).toEqual([
      'Task for me: ',
      'Request for ',
      'What is waiting on me?',
    ])
  })

  it('opens a client thread with the client line', async () => {
    await handleAssistantThreadStarted(identity('client'), started)
    expect(String(posted[0].text)).toContain('draft the request')
    expect(prompts).toHaveLength(1)
  })

  it('gives a stranger the refusal line and no prompts to press', async () => {
    await handleAssistantThreadStarted(identity('unknown'), started)
    expect(posted[0]).toMatchObject({ text: DENIAL_LINE })
    expect(prompts).toHaveLength(0)
  })
})
