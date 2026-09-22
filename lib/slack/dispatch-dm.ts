/**
 * lib/slack/dispatch-dm.ts
 *
 * One DM in, one reply out (CN.2 section 4).
 *
 * This is the whole of the bot's private side: a message arrives in the app's
 * DM channel, and by the time this function returns the sender has either a
 * card they can approve, one sentence saying why not, or nothing at all.
 *
 * It is deliberately the only place that knows the ORDER of the checks, and
 * the order is the security property:
 *
 *   1. A message from a bot is not a note. Ours included, or the bot answers
 *      its own answers.
 *   2. A message with no words and no audio is nothing. Silence is the right
 *      reply to a stray emoji, not a card.
 *   3. THE PERMISSION CHECK COMES BEFORE THE MODEL AND BEFORE THE DOWNLOAD.
 *      A stranger who finds the app in a workspace search box must not be
 *      able to spend a cent of Workers AI or Anthropic credit, and must not
 *      learn from the wording of the reply whether their email was found.
 *   4. Audio becomes text before anything else looks at it, and the text that
 *      goes on to the suggester is the transcript VERBATIM. Summarising it
 *      first would break the one rule every suggestion rests on: the quote is
 *      words somebody actually said.
 *
 * Nothing here writes a task or a request. It writes `task_suggestions` rows
 * through lib/slack/notes.ts, and a human presses the button.
 */

import { publicUrl } from '@/lib/app-url'
import { suggestionMessage } from './blocks'
import { SLACK_DENIED_REPLY, type SlackIdentity } from './identity'
import { draftFromNote, type NoteSuggestionRow } from './notes'
import { isAudioFile, transcribeAudio, type WhisperBinding } from './voice'
import { downloadFile as downloadSlackFile, type SlackFile } from './api'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * A `message.im` or `file_shared` event, flattened to the fields a handler
 * needs. S1's route does the flattening, so this file never sees Slack's
 * envelope and a test never has to build one.
 */
export interface SlackDmEvent {
  teamId: string
  channelId: string
  userId: string
  text: string
  ts: string
  files?: readonly SlackFile[]
  /** Set by Slack on anything a bot posted, which is never a note. */
  botId?: string
  /** `file_share` is the only subtype that carries work; S1 filters the rest. */
  subtype?: string
}

export interface SlackDmPostInput {
  channel: string
  text: string
  blocks?: unknown[]
}

/** Injected so a test needs no network and the route needs no globals. */
export interface SlackDmDeps {
  database: Drizzle
  identity: SlackIdentity | null
  postMessage: (input: SlackDmPostInput) => Promise<unknown>
  downloadFile?: (file: SlackFile) => Promise<ArrayBuffer>
  /**
   * The Workers AI binding. Undefined means "look it up", which is what
   * production wants; null means "there is none", which is what a test that
   * pins the not-enabled reply wants.
   */
  ai?: WhisperBinding | null
  now?: Date
}

export type SlackDmReason =
  | 'ok'
  | 'ignored_bot'
  | 'empty'
  | 'denied'
  | 'nothing_understood'
  | 'suggester_failed'
  | 'voice_not_enabled'
  | 'voice_too_large'
  | 'voice_empty'
  | 'voice_failed'
  | 'voice_download_failed'

export interface SlackDmOutcome {
  /** False only when the bot deliberately said nothing. */
  handled: boolean
  reason: SlackDmReason
  /** True when the words came out of a recording rather than a keyboard. */
  voice: boolean
  /** How many Slack messages went out, so the route can log a real number. */
  posted: number
}

function outcome(
  handled: boolean,
  reason: SlackDmReason,
  voice: boolean,
  posted: number,
): SlackDmOutcome {
  return { handled, reason, voice, posted }
}

/** The audio in a DM, if any. One recording per message is the real case. */
function firstAudio(files: readonly SlackFile[] | undefined): SlackFile | null {
  if (!files) return null
  for (const file of files) {
    if (isAudioFile(file)) return file
  }
  return null
}

/**
 * The assignee line, when slice A1's field is on the proposal.
 *
 * Read rather than required: this slice does not own the shape, and a card
 * that renders the line when it is there and omits it when it is not needs no
 * change when A1 lands.
 */
function suggestedAssigneeName(proposal: unknown): string | null {
  if (!proposal || typeof proposal !== 'object') return null
  const value = (proposal as Record<string, unknown>).suggestedAssigneeName
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The bot's own copy of the sender's words, as a card per filed row.
 *
 * Studio people get the Tweak deep link because /tasks is theirs; a client
 * does not, because the link would land them on a page they cannot open. The
 * button itself stays on the card either way, so S2's interactive route is
 * the one place that decides what a client's Tweak does.
 */
async function postCards(
  deps: SlackDmDeps,
  channel: string,
  rows: readonly NoteSuggestionRow[],
  options: { orgName: string | null; deepLink: boolean },
): Promise<number> {
  let posted = 0
  for (const row of rows) {
    const message = suggestionMessage(
      {
        id: row.id,
        kind: row.kind,
        proposal: row.proposal,
        quote: row.quote,
        orgName: options.orgName,
        suggestedAssigneeName: suggestedAssigneeName(row.proposal),
      },
      options.deepLink
        ? { tweakUrl: publicUrl(`/tasks?view=suggestions&focus=${encodeURIComponent(row.id)}`) }
        : {},
    )
    await deps.postMessage({ channel, text: message.text, blocks: message.blocks })
    posted += 1
  }
  return posted
}

/**
 * The handler S1's events route dispatches to through lib/slack/dm-hook.ts.
 *
 * It never throws for anything a sender did: every refusal and every failure
 * comes back as an outcome with the sentence already sent. A throw from here
 * would land in the route's waitUntil, where nobody reads it and the sender
 * waits forever for a reply that is not coming.
 */
export async function handleSlackDm(event: SlackDmEvent, deps: SlackDmDeps): Promise<SlackDmOutcome> {
  if (event.botId) return outcome(false, 'ignored_bot', false, 0)

  const typed = (event.text ?? '').trim()
  const audio = firstAudio(event.files)

  // Nothing said and nothing recorded. A reply here would mean the bot
  // answers every file upload and every reaction-only message.
  if (!typed && !audio) return outcome(false, 'empty', false, 0)

  const identity = deps.identity
  const voice = audio !== null

  // Before the download and before the model, on purpose. See the header.
  if (!identity || identity.level === 'unknown') {
    await deps.postMessage({ channel: event.channelId, text: SLACK_DENIED_REPLY })
    return outcome(true, 'denied', voice, 1)
  }

  let text = typed

  if (audio) {
    const download = deps.downloadFile ?? downloadSlackFile
    let bytes: ArrayBuffer
    try {
      bytes = await download(audio)
    } catch {
      await deps.postMessage({
        channel: event.channelId,
        text: 'I could not open that recording. Send it again, or type it.',
      })
      return outcome(true, 'voice_download_failed', true, 1)
    }

    const transcript = await transcribeAudio(bytes, deps.ai !== undefined ? { ai: deps.ai } : {})
    if (!transcript.ok) {
      await deps.postMessage({ channel: event.channelId, text: transcript.message })
      return outcome(true, `voice_${transcript.reason}` as SlackDmReason, true, 1)
    }

    // The transcript wins over any caption typed alongside the recording: the
    // words in the audio are the ones the sender said, and the suggester's
    // quote has to be checkable against them.
    text = transcript.text
  }

  const draft = await draftFromNote({
    database: deps.database,
    text,
    identity,
    now: deps.now,
  })

  let posted = 0
  if (draft.reply) {
    await deps.postMessage({ channel: event.channelId, text: draft.reply })
    posted += 1
  }

  if (!draft.ok) {
    return outcome(posted > 0, draft.reason as SlackDmReason, voice, posted)
  }

  posted += await postCards(deps, event.channelId, draft.rows, {
    orgName: draft.orgName,
    deepLink: identity.level !== 'client',
  })

  return outcome(true, 'ok', voice, posted)
}
