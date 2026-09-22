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
 *   THE UNKNOWN REPLY. Until S2 and S3 land, the hooks answer "not wired yet",
 *   but an unknown identity already gets the refusal line and nothing else,
 *   because that branch is a security answer rather than a placeholder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { schema } from '@/db/d1'

const posted: Array<Record<string, unknown>> = []

vi.mock('../api', () => ({
  postMessage: async (input: Record<string, unknown>) => { posted.push(input); return { ts: '1.1', channel: String(input.channel) } },
  openDm: async (userId: string) => `D_${userId}`,
}))

const {
  isHandledEvent,
  rememberSlackEvent,
  parseInteractivePayload,
  readAction,
  handleDm,
  handleAction,
  NOT_WIRED_LINE,
} = await import('../dispatch')

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

beforeEach(() => { posted.length = 0 })

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

describe('the default hooks', () => {
  it('answers a DM with the placeholder until S3 fills the hook', async () => {
    await handleDm(identity('founder'), { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'note this' })
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ channel: 'D1', text: NOT_WIRED_LINE })
  })

  it('answers a button click with the placeholder until S2 fills the hook', async () => {
    await handleAction(identity('founder'), {
      type: 'block_actions', actionId: 'sugg:approve:s1', value: 's1',
      channelId: 'D_LIAM', messageTs: '1758.1', triggerId: 't', responseUrl: null, userId: 'U', teamId: 'T',
    })
    expect(posted[0]).toMatchObject({ channel: 'D_LIAM', text: NOT_WIRED_LINE })
  })

  it('answers an unknown identity with the refusal line and nothing else, in both directions', async () => {
    await handleDm(identity('unknown'), { type: 'message', channel_type: 'im', user: 'U', channel: 'D1', text: 'hello?' })
    await handleAction(identity('unknown'), {
      type: 'block_actions', actionId: 'sugg:approve:s1', value: 's1',
      channelId: 'D1', messageTs: '1', triggerId: 't', responseUrl: null, userId: 'U', teamId: 'T',
    })
    expect(posted.map((p) => p.text)).toEqual([DENIAL_LINE, DENIAL_LINE])
  })

  it('never posts when there is nowhere to post to', async () => {
    await handleAction(identity('founder'), {
      type: 'view_submission', actionId: 'x', value: null,
      channelId: null, messageTs: null, triggerId: 't', responseUrl: null, userId: 'U', teamId: 'T',
    })
    expect(posted).toHaveLength(0)
  })
})
