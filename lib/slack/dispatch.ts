/**
 * lib/slack/dispatch.ts
 *
 * The seam between a verified Slack delivery and the slices that answer it.
 *
 * The two webhook routes do one job each: prove the delivery came from Slack,
 * answer 200 inside three seconds, and hand what arrived to this module. All
 * the judgement lives here, so a route never grows a branch.
 *
 * Four things this file is responsible for:
 *
 *   WHAT WE REFUSE TO LOOK AT. The bot's own messages, because a bot that
 *   answers itself is an infinite loop one reply at a time. Edits, deletions
 *   and joins, because none of them is a person saying something. Channel
 *   messages, because this phase is DMs only (section 7 of the CN.2 contract).
 *
 *   THE RETRY GUARD. Slack re-delivers anything it does not see a 200 for
 *   within three seconds, up to three times. rememberSlackEvent claims the
 *   delivery id in slack_events_seen, and that id is the table's PRIMARY KEY,
 *   so two concurrent retries are settled by the database rather than by a
 *   read-then-write that both sides win.
 *
 *   WHO IS TALKING. Every delivery resolves to a SlackIdentity before a
 *   handler sees it, so a handler can never act for somebody it has not
 *   identified, and an unmapped stranger is refused here rather than deeper in.
 *
 *   THE TWO HOOKS. handleDm delegates to lib/slack/dispatch-dm.ts (S3: a
 *   note, a voice note, a client's request) and handleAction delegates to
 *   whatever has claimed the action id on lib/slack/action-registry.ts (S2:
 *   Approve, Tweak, Tonight, This week, Reject). Both check the identity
 *   FIRST: the 'unknown' branch is a security answer, not a placeholder, and
 *   nothing is delegated to before it has run.
 *
 *   THE ASSISTANT PANE. The app runs in Slack's Agents and Apps mode, so a
 *   new 1:1 opens as an assistant thread rather than an empty DM. That
 *   arrives as assistant_thread_started and is answered here with a welcome
 *   line and three suggested prompts (contract section 6b).
 */

import { schema } from '@/db/d1'
import {
  filesInfo,
  postMessage,
  setStatus,
  setSuggestedPrompts,
  usersInfo,
  type SlackFile,
  type SlackSuggestedPrompt,
} from './api'
import { DENIAL_LINE, resolveSlackIdentity, type SlackIdentity, type SlackLevel } from './identity'
import { dispatchSlackDm, type SlackDmEvent } from './dm-hook'
import { resolveBlockActionHandler } from './action-registry'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * What the bot says when a delivery reached a handler that does not exist: a
 * button from a feature that has been removed, or a message the registry has
 * nothing registered for. It states that nothing was created, because the
 * worst possible reply here is one that leaves somebody believing a task
 * exists.
 */
export const NOT_WIRED_LINE =
  'Got your message. I can hear you, but this part of me is not switched on yet, so nothing has been created.'

/** The one line a fresh assistant thread opens with, per level. */
const WELCOME_LINES: Record<SlackLevel, string> = {
  founder: 'Tell me what happened, typed or recorded, and I will draft the tasks and requests it should become. Nothing is created until you press a button.',
  member: 'Tell me what happened, typed or recorded, and I will draft the work it should become for you to approve.',
  client: 'Tell me what you need and I will draft the request. You confirm it before it reaches the studio.',
  unknown: DENIAL_LINE,
}

/**
 * The three openers from the contract, which are the same three in the app
 * manifest. A trailing space on the first two is deliberate: the prompt drops
 * the sender straight into typing the rest of the sentence.
 */
export const ASSISTANT_PROMPTS: readonly SlackSuggestedPrompt[] = [
  { title: 'Log a task', message: 'Task for me: ' },
  { title: 'New request for a client', message: 'Request for ' },
  { title: 'What is waiting on me', message: 'What is waiting on me?' },
]

/**
 * The fields of a Slack event this phase reads. Slack sends plenty more, and
 * sends different names for the same idea (a message carries `user` and
 * `channel`, a file_shared carries `user_id` and `channel_id`), which is why
 * the readers below exist rather than direct property access.
 */
export interface SlackEventLike {
  type?: string
  subtype?: string
  channel_type?: string
  user?: string
  user_id?: string
  channel?: string
  channel_id?: string
  text?: string
  ts?: string
  event_ts?: string
  thread_ts?: string
  /** Present on anything the bot itself posted. */
  bot_id?: string
  bot_profile?: unknown
  file_id?: string
  files?: unknown
  /** Present on the two assistant_thread_* events, and nowhere else. */
  assistant_thread?: {
    user_id?: string
    channel_id?: string
    thread_ts?: string
    context?: unknown
  }
}

export interface SlackEventEnvelope {
  type?: string
  challenge?: string
  team_id?: string
  event_id?: string
  event?: SlackEventLike
}

/** A message that carries a file, as opposed to a message that was edited. */
const FILE_SHARE_SUBTYPE = 'file_share'

export function eventUserId(event: SlackEventLike): string | null {
  return event.user ?? event.user_id ?? event.assistant_thread?.user_id ?? null
}

export function eventChannelId(event: SlackEventLike): string | null {
  return event.channel ?? event.channel_id ?? event.assistant_thread?.channel_id ?? null
}

/**
 * The assistant thread a delivery belongs to, when it is in one.
 *
 * In Agents and Apps mode every message in the 1:1 is threaded, so the reply
 * has to carry thread_ts or it lands in the channel behind the pane where
 * nobody is looking. `ts` is the fallback because the FIRST message of a
 * thread is its own parent.
 */
export function eventThreadTs(event: SlackEventLike): string | null {
  return event.assistant_thread?.thread_ts ?? event.thread_ts ?? event.ts ?? null
}

/**
 * Slack DM channel ids start with a D. Checked before caching a channel id as
 * somebody's DM, so a button pressed in a channel never overwrites the 1:1.
 */
function isDmChannel(channelId: string | null): boolean {
  return typeof channelId === 'string' && channelId.startsWith('D')
}

/**
 * Is this an event a human sent to the bot, in a place this phase answers?
 *
 * Answering false is not an error: the route still returns 200 (so Slack stops
 * retrying) and spends no dedupe row, because an event we never act on cannot
 * be acted on twice.
 */
export function isHandledEvent(event: SlackEventLike | null | undefined): boolean {
  if (!event || typeof event !== 'object') return false

  // The bot talking to itself. Both markers, because Slack sets bot_id on some
  // deliveries and only bot_profile on others.
  if (event.bot_id || event.bot_profile) return false

  // A voice note. Slack sends this alongside the message.im delivery, and the
  // file id is the only place the audio is named.
  if (event.type === 'file_shared') return true

  // A fresh assistant thread: the welcome line and the suggested prompts.
  if (event.type === 'assistant_thread_started') return true

  // assistant_thread_context_changed is deliberately NOT handled. Slack sends
  // it whenever the sender moves between channels with the pane open, it says
  // nothing the bot acts on, and the route's 200 is the whole of the ack the
  // contract asks for. Answering false here also spends no dedupe row on it.
  if (event.type === 'assistant_thread_context_changed') return false

  if (event.type === 'app_mention') return true

  if (event.type === 'message') {
    // An edit, a deletion, a join or a bot post. Only a shared file survives,
    // because that is the voice note path in section 4 of the contract.
    if (event.subtype && event.subtype !== FILE_SHARE_SUBTYPE) return false
    return event.channel_type === 'im'
  }

  return false
}

/**
 * Claim a delivery id, returning true only for the first claim.
 *
 * An id we cannot read is treated as already seen: a delivery we cannot
 * identify is one we cannot make idempotent, and doing nothing is the safe
 * half of that choice. Any database failure that is NOT the uniqueness
 * constraint is rethrown, because swallowing "no such table" would quietly
 * drop every DM until somebody noticed.
 */
export async function rememberSlackEvent(
  database: Drizzle,
  eventId: string | null | undefined,
): Promise<boolean> {
  const id = (eventId ?? '').trim()
  if (!id) return false

  try {
    await database.insert(schema.slackEventsSeen).values({
      id,
      seenAt: new Date().toISOString(),
    })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/UNIQUE constraint failed/i.test(message)) return false
    throw err
  }
}

export interface SlackInteractivePayload {
  type: string
  team?: { id?: string }
  user: { id: string }
  trigger_id?: string
  response_url?: string
  container?: { channel_id?: string; message_ts?: string }
  message?: { ts?: string }
  channel?: { id?: string }
  actions?: Array<{
    action_id?: string
    value?: string
    type?: string
    selected_option?: { value?: string }
  }>
  view?: {
    id?: string
    callback_id?: string
    private_metadata?: string
    state?: { values?: Record<string, Record<string, unknown>> }
  }
}

/**
 * Slack posts an interaction as `application/x-www-form-urlencoded` with the
 * whole thing JSON encoded in a single `payload` field. Nothing else about the
 * body matters, and a body we cannot read answers 400 rather than throwing, so
 * a malformed delivery never looks like an outage.
 */
export function parseInteractivePayload(rawBody: string): SlackInteractivePayload | null {
  const encoded = new URLSearchParams(rawBody).get('payload')
  if (!encoded) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const payload = parsed as Partial<SlackInteractivePayload>
  if (typeof payload.type !== 'string') return null
  if (!payload.user || typeof payload.user.id !== 'string') return null

  return payload as SlackInteractivePayload
}

/**
 * One interaction, flattened to what a handler acts on.
 *
 * A button click and a modal submit arrive in completely different shapes and
 * mean the same thing ("this person chose this, about this id, here"), so the
 * handlers see one shape and the difference is settled once, here.
 */
export interface SlackActionInput {
  type: 'block_actions' | 'view_submission'
  /** `sugg:<action>:<id>` for a button, the modal's callback_id for a submit. */
  actionId: string
  /** The button's value, or the modal's private_metadata. */
  value: string | null
  channelId: string | null
  messageTs: string | null
  triggerId: string | null
  /** Usable for 30 minutes, five times. Present on clicks, not on submits. */
  responseUrl: string | null
  userId: string
  teamId: string
  /** The modal's submitted values, for S2's Tweak flow. */
  viewState?: Record<string, Record<string, unknown>> | null
}

export function readAction(payload: SlackInteractivePayload): SlackActionInput | null {
  const userId = payload.user.id
  const teamId = payload.team?.id ?? ''
  const triggerId = payload.trigger_id ?? null

  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0]
    if (!action?.action_id) return null
    return {
      type: 'block_actions',
      actionId: action.action_id,
      value: action.value ?? action.selected_option?.value ?? null,
      channelId: payload.container?.channel_id ?? payload.channel?.id ?? null,
      messageTs: payload.container?.message_ts ?? payload.message?.ts ?? null,
      triggerId,
      responseUrl: payload.response_url ?? null,
      userId,
      teamId,
      viewState: null,
    }
  }

  if (payload.type === 'view_submission') {
    const view = payload.view
    if (!view?.callback_id) return null
    return {
      type: 'view_submission',
      actionId: view.callback_id,
      value: view.private_metadata ?? null,
      // A submit arrives with no channel, because a modal is not in one. S2
      // carries whatever channel it needs in private_metadata instead.
      channelId: null,
      messageTs: null,
      triggerId,
      responseUrl: null,
      userId,
      teamId,
      viewState: view.state?.values ?? null,
    }
  }

  return null
}

// ── The two hooks ────────────────────────────────────────────────────────────
// handleDm delegates to S3 (a note, a voice note, a client's request) and
// handleAction to S2 (Approve, Tweak, Tonight, This week, Reject). The
// 'unknown' branch runs in both BEFORE any delegation: a stranger must not be
// able to spend a model call, a download, or a database read.

/** Slack's own file shape on a message event, which is not api.ts's. */
interface RawSlackFile {
  id?: string
  mimetype?: string
  filetype?: string
  name?: string
  size?: number
  url_private_download?: string
  url_private?: string
}

function toSlackFile(raw: RawSlackFile): SlackFile | null {
  if (!raw.id) return null
  return {
    id: raw.id,
    mimetype: raw.mimetype ?? raw.filetype ?? null,
    urlPrivate: raw.url_private_download ?? raw.url_private ?? null,
    name: raw.name ?? null,
    size: typeof raw.size === 'number' ? raw.size : null,
  }
}

/**
 * The files on a delivery, in api.ts's shape.
 *
 * A message.im carrying a recording lists it inline, WITH its size, which is
 * what lets the voice preflight refuse an oversized one for free. A
 * file_shared carries a file id and nothing else, so that one costs a
 * files.info call. A lookup that fails yields no files rather than throwing:
 * the typed half of the same message is still worth filing.
 */
async function eventFiles(event: SlackEventLike): Promise<SlackFile[]> {
  const inline = Array.isArray(event.files)
    ? (event.files as RawSlackFile[]).map(toSlackFile).filter((file): file is SlackFile => file !== null)
    : []
  if (inline.length > 0) return inline

  if (event.file_id) {
    try {
      return [await filesInfo(event.file_id)]
    } catch {
      return []
    }
  }
  return []
}

/**
 * Somebody said something to the bot.
 *
 * `event.channel` is where the reply belongs, falling back to the identity's
 * cached DM channel. When there is neither, there is nowhere to answer, and
 * saying nothing beats opening a conversation nobody started.
 *
 * Every reply carries the thread: in the assistant pane an unthreaded message
 * lands behind the pane rather than in it.
 */
export async function handleDm(
  identity: SlackIdentity,
  event: SlackEventLike,
  database: Drizzle,
): Promise<void> {
  const channel = eventChannelId(event) ?? identity.dmChannelId
  if (!channel) return

  if (identity.level === 'unknown') {
    await postMessage({ channel, text: DENIAL_LINE })
    return
  }

  const threadTs = eventThreadTs(event)
  const dmEvent: SlackDmEvent = {
    teamId: identity.slackTeamId,
    channelId: channel,
    userId: identity.slackUserId,
    text: typeof event.text === 'string' ? event.text : '',
    ts: event.ts ?? event.event_ts ?? '',
    files: await eventFiles(event),
    subtype: event.subtype,
  }

  await dispatchSlackDm(dmEvent, {
    database,
    identity,
    postMessage: async (input) => postMessage({
      channel: input.channel,
      text: input.text,
      blocks: input.blocks,
      ...(threadTs ? { threadTs } : {}),
    }),
    filesInfo,
    setStatus: threadTs
      ? async (status: string) => setStatus({ channelId: channel, threadTs, status })
      : undefined,
  })
}

/**
 * Somebody pressed a button or submitted a modal.
 *
 * Only the channel the interaction happened in is answered. The identity's
 * cached DM is deliberately NOT a fallback here: a modal submit has no
 * channel, and replying to it in a DM the person is not looking at would be a
 * message arriving out of nowhere. That also means a view_submission reaches
 * no handler this phase, which is correct: the only modal the app opens is
 * Tweak, and Tweak is a link to the dashboard.
 */
export async function handleAction(
  identity: SlackIdentity,
  action: SlackActionInput,
  database: Drizzle,
): Promise<void> {
  if (!action.channelId) return

  if (identity.level === 'unknown') {
    await postMessage({ channel: action.channelId, text: DENIAL_LINE })
    return
  }

  const handler = resolveBlockActionHandler(action.actionId)
  const result = handler
    ? await handler({
      drizzle: database,
      identity,
      payload: {
        actionId: action.actionId,
        value: action.value,
        slackUserId: action.userId,
        slackTeamId: action.teamId,
        channelId: action.channelId,
        messageTs: action.messageTs,
      },
    })
    : { handled: false, reply: null }

  // Nothing claimed this button. Say so plainly rather than silently: a
  // founder who pressed Approve and heard nothing back has to go and check.
  if (!result.handled) {
    await postMessage({ channel: action.channelId, text: NOT_WIRED_LINE })
    return
  }

  if (result.reply) {
    await postMessage({ channel: action.channelId, text: result.reply })
  }
}

/**
 * A fresh assistant thread (contract section 6b).
 *
 * One welcome line for the level, then the three prompts. A stranger gets the
 * refusal line and no prompts: the openers name the studio's verbs, and
 * offering them to somebody who cannot use them is both a tease and a leak.
 */
export async function handleAssistantThreadStarted(
  identity: SlackIdentity,
  event: SlackEventLike,
): Promise<void> {
  const channel = eventChannelId(event) ?? identity.dmChannelId
  const threadTs = eventThreadTs(event)
  if (!channel || !threadTs) return

  await postMessage({ channel, text: WELCOME_LINES[identity.level], threadTs })

  if (identity.level === 'unknown') return
  await setSuggestedPrompts({ channelId: channel, threadTs, prompts: ASSISTANT_PROMPTS })
}

// ── What the routes call ─────────────────────────────────────────────────────

/** The email lookup resolveSlackIdentity needs, as one users.info call. */
function profileReader(userId: string): () => Promise<{ email: string | null }> {
  return async () => {
    const profile = await usersInfo(userId)
    // A bot's email, if it even has one, must never map to a person.
    return { email: profile.isBot ? null : profile.email }
  }
}

/**
 * Handle one verified, deduped event_callback.
 *
 * Runs after the 200 has gone back to Slack, inside ctx.waitUntil, so a slow
 * model call in a later slice costs nobody a retry.
 */
export async function handleSlackEvent(
  database: Drizzle,
  envelope: SlackEventEnvelope,
): Promise<void> {
  const event = envelope.event
  if (!event || !isHandledEvent(event)) return

  const teamId = envelope.team_id ?? ''
  const userId = eventUserId(event)
  if (!teamId || !userId) return

  const channelId = eventChannelId(event)
  const identity = await resolveSlackIdentity(database, {
    teamId,
    userId,
    dmChannelId: isDmChannel(channelId) ? channelId : null,
    fetchProfile: profileReader(userId),
  })

  if (event.type === 'assistant_thread_started') {
    await handleAssistantThreadStarted(identity, event)
    return
  }

  // An app_mention is still somebody addressing the bot, so it goes through the
  // same hook; S3 decides whether a mention in a channel is answered at all.
  await handleDm(identity, event, database)
}

/** Handle one verified, deduped interaction. Same deferred position as above. */
export async function handleSlackInteraction(
  database: Drizzle,
  payload: SlackInteractivePayload,
): Promise<void> {
  const action = readAction(payload)
  if (!action) return
  if (!action.teamId) return

  const identity = await resolveSlackIdentity(database, {
    teamId: action.teamId,
    userId: action.userId,
    dmChannelId: isDmChannel(action.channelId) ? action.channelId : null,
    fetchProfile: profileReader(action.userId),
  })

  await handleAction(identity, action, database)
}
