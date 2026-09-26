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
 *
 *   A MENTION IN A CHANNEL is answered once, in its thread, with a line
 *   pointing to the DM, and never reaches the note path; a stranger gets the
 *   refusal line there instead.
 *
 *   A MODAL SUBMIT goes to whatever claimed its callback_id on the registry,
 *   never to a button handler, never for a stranger, and says nothing itself.
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
  usersInfo: async () => ({ email: null, isBot: false }),
}))

// The whole-delivery tests below (handleSlackEvent, handleSlackInteraction)
// decide who is talking through resolveSlackIdentity, which reads D1 and
// calls users.info. Everything else in the module stays real, DENIAL_LINE
// included, so the refusal these tests expect is the one a stranger gets.
let resolvedLevel: 'founder' | 'member' | 'client' | 'unknown' = 'founder'
vi.mock('../identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../identity')>()),
  resolveSlackIdentity: async () => identity(resolvedLevel),
}))

const {
  isHandledEvent,
  rememberSlackEvent,
  parseInteractivePayload,
  readAction,
  handleDm,
  handleAction,
  handleAssistantThreadStarted,
  handleSlackEvent,
  handleSlackInteraction,
  ASSISTANT_PROMPTS,
  NOT_WIRED_LINE,
  CHANNEL_MENTION_LINE,
  VIEW_SUBMISSION_ACK,
} = await import('../dispatch')

const { registerSlackDmHandler, resetSlackDmHandler } = await import('../dm-hook')
const {
  registerBlockActionHandler,
  registerViewSubmissionHandler,
  resolveBlockActionHandler,
  resolveViewSubmissionHandler,
  clearBlockActionHandlers,
} = await import('../action-registry')

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
  resolvedLevel = 'founder'
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
    // The shape Slack actually sends: user_id and channel_id.
    expect(isHandledEvent({ type: 'file_shared', user_id: 'U1', channel_id: 'D1', file_id: 'F1' })).toBe(true)
  })

  it('ignores a file shared in a channel, which Slack sends for any channel the bot has joined', () => {
    expect(isHandledEvent({ type: 'file_shared', user_id: 'U1', channel_id: 'C_GENERAL', file_id: 'F1' })).toBe(false)
    expect(isHandledEvent({ type: 'file_shared', user_id: 'U1', channel_id: 'G_PRIVATE', file_id: 'F1' })).toBe(false)
  })

  it('ignores a file_shared that names no channel, because where it was shared cannot be told', () => {
    expect(isHandledEvent({ type: 'file_shared', user_id: 'U1', file_id: 'F1' })).toBe(false)
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

/** Registers a DM handler that only records that it was reached. */
function spyOnDmHook(): { calls: number } {
  const spy = { calls: 0 }
  registerSlackDmHandler(async () => {
    spy.calls += 1
    return { handled: true, reason: 'ok', voice: false, posted: 0 }
  })
  return spy
}

describe('a mention in a channel (channels come later, contract section 7)', () => {
  function mention(event: Record<string, unknown> = {}) {
    return {
      type: 'event_callback',
      team_id: 'T',
      event_id: 'Ev_mention',
      event: {
        type: 'app_mention',
        user: 'U',
        channel: 'C_GENERAL',
        text: '<@B1> can you log the Verandela header fix',
        ts: '1758.5',
        event_ts: '1758.5',
        ...event,
      },
    }
  }

  it('answers in a thread under the mention, pointing to a DM, and drafts nothing', async () => {
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, mention())
    expect(dm.calls).toBe(0)
    expect(posted).toEqual([{ channel: 'C_GENERAL', text: CHANNEL_MENTION_LINE, threadTs: '1758.5' }])
  })

  it('answers inside the thread the mention was made in', async () => {
    await handleSlackEvent(fakeDrizzle, mention({ ts: '1758.9', thread_ts: '1758.1' }))
    expect(posted).toEqual([{ channel: 'C_GENERAL', text: CHANNEL_MENTION_LINE, threadTs: '1758.1' }])
  })

  it('says plainly that nothing was created, and never uses a dash', () => {
    expect(CHANNEL_MENTION_LINE).toContain('nothing was created')
    expect(CHANNEL_MENTION_LINE).toContain('direct message')
    // En dash and em dash, by code point so this file carries neither.
    const dashes = [0x2013, 0x2014].map((code) => String.fromCharCode(code))
    for (const dash of dashes) expect(CHANNEL_MENTION_LINE).not.toContain(dash)
  })

  it('points every known level to the DM, a client included', async () => {
    for (const level of ['member', 'client'] as const) {
      posted.length = 0
      resolvedLevel = level
      const dm = spyOnDmHook()
      await handleSlackEvent(fakeDrizzle, mention())
      expect(dm.calls).toBe(0)
      expect(posted.map((p) => p.text)).toEqual([CHANNEL_MENTION_LINE])
    }
  })

  it('gives a stranger the refusal line in the thread, and still no note', async () => {
    resolvedLevel = 'unknown'
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, mention())
    expect(dm.calls).toBe(0)
    expect(posted).toEqual([{ channel: 'C_GENERAL', text: DENIAL_LINE, threadTs: '1758.5' }])
  })

  it('answers a mention in a private channel the same way', async () => {
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, mention({ channel: 'G_PRIVATE' }))
    expect(dm.calls).toBe(0)
    expect(posted[0]).toMatchObject({ channel: 'G_PRIVATE', text: CHANNEL_MENTION_LINE })
  })

  it('treats a mention inside the 1:1 as the DM it is', async () => {
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, mention({ channel: 'D1' }))
    expect(dm.calls).toBe(1)
    expect(posted).toHaveLength(0)
  })

  it('still sends an ordinary DM to the note path', async () => {
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, {
      type: 'event_callback',
      team_id: 'T',
      event_id: 'Ev_dm',
      event: { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'note this', ts: '1758.2' },
    })
    expect(dm.calls).toBe(1)
  })
})

describe('a file shared in a channel (the file_shared twin of a mention)', () => {
  // Slack sends file_shared for every file the app can see. A mention with a
  // voice clip attached in #general arrives as an app_mention AND as this,
  // under a different event_id, so the retry guard does not pair them up.
  function fileShared(channelId: string) {
    return {
      type: 'event_callback',
      team_id: 'T',
      event_id: `Ev_file_${channelId}`,
      event: {
        type: 'file_shared',
        user_id: 'U',
        channel_id: channelId,
        file_id: 'F1',
        file: { id: 'F1' },
        event_ts: '1758.6',
      },
    }
  }

  it('never reaches the note path and posts nothing, not even at the channel top level', async () => {
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, fileShared('C_GENERAL'))
    expect(dm.calls).toBe(0)
    expect(posted).toHaveLength(0)
    expect(statuses).toHaveLength(0)
  })

  it('gives a stranger no public refusal for a file they posted in a channel', async () => {
    resolvedLevel = 'unknown'
    const dm = spyOnDmHook()
    await handleSlackEvent(fakeDrizzle, fileShared('C_GENERAL'))
    expect(dm.calls).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('still sends a file shared in the 1:1 to the voice path', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerSlackDmHandler(async (event) => {
      seen.push({ channelId: event.channelId, files: event.files })
      return { handled: true, reason: 'ok', voice: true, posted: 0 }
    })

    await handleSlackEvent(fakeDrizzle, fileShared('D1'))

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ channelId: 'D1', files: [{ id: 'F1' }] })
  })
})

describe('a modal submit (view_submission)', () => {
  function submit(callbackId: string) {
    return {
      type: 'view_submission',
      team: { id: 'T' },
      user: { id: 'U' },
      trigger_id: 'trig_view',
      view: {
        id: 'V1',
        callback_id: callbackId,
        private_metadata: '{"suggestionId":"s1","channel":"D1"}',
        state: { values: { title: { title_input: { type: 'plain_text_input', value: 'Header fix' } } } },
      },
    }
  }

  it('closes the whole modal stack, which is a body Slack accepts for a submit', () => {
    expect(VIEW_SUBMISSION_ACK).toEqual({ response_action: 'clear' })
  })

  it('hands the submit to whatever claimed the callback id prefix, flattened', async () => {
    const seen: Array<Record<string, unknown>> = []
    registerViewSubmissionHandler('tweak', async (ctx) => {
      seen.push({ payload: ctx.payload, level: ctx.identity.level })
    })

    await handleSlackInteraction(fakeDrizzle, submit('tweak:s1'))

    expect(seen).toHaveLength(1)
    expect(seen[0].level).toBe('founder')
    expect(seen[0].payload).toEqual({
      callbackId: 'tweak:s1',
      privateMetadata: '{"suggestionId":"s1","channel":"D1"}',
      values: { title: { title_input: { type: 'plain_text_input', value: 'Header fix' } } },
      slackUserId: 'U',
      slackTeamId: 'T',
    })
    // The modal is already closed by the ack; the handler says what it wants
    // to say itself, so dispatch posts nothing.
    expect(posted).toHaveLength(0)
  })

  it('never reaches a button handler, even one that owns the same prefix', async () => {
    let buttonCalls = 0
    registerBlockActionHandler('sugg', async () => {
      buttonCalls += 1
      return { handled: true, reply: 'should not be said' }
    })

    await handleSlackInteraction(fakeDrizzle, submit('sugg:tweak:s1'))

    expect(buttonCalls).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('posts nothing for a callback id nothing has claimed, which is every one today', async () => {
    await handleSlackInteraction(fakeDrizzle, submit('nudge:s1'))
    expect(posted).toHaveLength(0)
  })

  it('never reaches the handler for a stranger, and says nothing to them', async () => {
    resolvedLevel = 'unknown'
    let calls = 0
    registerViewSubmissionHandler('tweak', async () => { calls += 1 })

    await handleSlackInteraction(fakeDrizzle, submit('tweak:s1'))

    expect(calls).toBe(0)
    expect(posted).toHaveLength(0)
  })

  it('still routes a button click to the button handler', async () => {
    const seen: string[] = []
    registerBlockActionHandler('sugg', async (ctx) => {
      seen.push(ctx.payload.actionId)
      return { handled: true, reply: null }
    })

    await handleSlackInteraction(fakeDrizzle, {
      type: 'block_actions',
      team: { id: 'T' },
      user: { id: 'U' },
      trigger_id: 'trig_click',
      container: { channel_id: 'D1', message_ts: '1758.1' },
      actions: [{ action_id: 'sugg:approve:s1', value: 's1' }],
    })

    expect(seen).toEqual(['sugg:approve:s1'])
  })
})

describe('the registry keeps buttons and modals apart', () => {
  it('resolves a modal handler by the callback id prefix, and only as a modal', () => {
    const modal = async () => {}
    registerViewSubmissionHandler('tweak', modal)
    expect(resolveViewSubmissionHandler('tweak:s1')).toBe(modal)
    expect(resolveBlockActionHandler('tweak:s1')).toBeNull()
    expect(resolveViewSubmissionHandler('other:s1')).toBeNull()
    expect(resolveViewSubmissionHandler('')).toBeNull()
  })

  it('clears both maps for the next test', () => {
    registerViewSubmissionHandler('tweak', async () => {})
    registerBlockActionHandler('sugg', async () => ({ handled: true, reply: null }))
    clearBlockActionHandlers()
    expect(resolveViewSubmissionHandler('tweak:s1')).toBeNull()
    expect(resolveBlockActionHandler('sugg:approve:s1')).toBeNull()
  })
})
