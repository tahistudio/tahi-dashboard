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

import { suggestionMessage } from './blocks'
import { SLACK_DENIED_REPLY, type SlackIdentity } from './identity'
import { draftFromNote, type NoteSuggestionRow } from './notes'
import { isAudioFile, preflightAudio, transcribeAudio, type AudioFileLike, type WhisperBinding } from './voice'
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
   * files.info, for a recording whose size the event did not carry. Optional:
   * when it is absent an unknown size simply passes the preflight and the
   * byte length is checked after the download instead.
   */
  filesInfo?: (fileId: string) => Promise<SlackFile>
  /**
   * The assistant pane's status line (contract section 6b). Called with
   * "Reading your note" before any model work and with '' once the reply is
   * out. Optional, because a plain DM has no status line to set.
   */
  setStatus?: (status: string) => Promise<void>
  /**
   * The Workers AI binding. Undefined means "look it up", which is what
   * production wants; null means "there is none", which is what a test that
   * pins the not-enabled reply wants.
   */
  ai?: WhisperBinding | null
  now?: Date
}

/** The assistant pane's status line while the bot is working on a note. */
export const READING_STATUS = 'Reading your note'

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

/**
 * A Slack file as the audio sniffer reads one.
 *
 * lib/slack/api.ts models an absent field as null (it is reading a JSON
 * envelope where the field may not be there) and lib/slack/voice.ts models it
 * as undefined (it is an optional property on a structural type). Both are
 * right in their own file, so the seam is adapted here, once, rather than
 * either side loosening its own shape.
 */
function toAudioFile(file: SlackFile): AudioFileLike {
  return {
    id: file.id,
    name: file.name ?? undefined,
    mimetype: file.mimetype ?? undefined,
  }
}

/** The audio in a DM, if any. One recording per message is the real case. */
function firstAudio(files: readonly SlackFile[] | undefined): SlackFile | null {
  if (!files) return null
  for (const file of files) {
    if (isAudioFile(toAudioFile(file))) return file
  }
  return null
}

/** The bytes behind a Slack file, through the authenticated download URL. */
async function downloadDefault(file: SlackFile): Promise<ArrayBuffer> {
  if (!file.urlPrivate) throw new Error('Slack file has no download URL')
  return downloadSlackFile(file.urlPrivate)
}

/**
 * How big the recording is, from files.info when the event did not say.
 *
 * Null means "we do not know", never "it is fine": the preflight treats an
 * unknown size as a pass and the byte length after the download is the
 * backstop. A files.info that fails is not worth a refusal on its own.
 */
async function audioSize(deps: SlackDmDeps, file: SlackFile): Promise<number | null> {
  if (typeof file.size === 'number') return file.size
  if (!deps.filesInfo) return null
  try {
    const info = await deps.filesInfo(file.id)
    return typeof info.size === 'number' ? info.size : null
  } catch {
    return null
  }
}

/**
 * The assignee line, when slice A1's field is on the proposal.
 *
 * Read rather than required: this slice does not own the shape, and a card
 * that renders the line when it is there and omits it when it is not needs no
 * change when A1 lands.
 */
function suggestedAssignee(proposal: unknown): { name: string | null; reason: string | null } {
  if (!proposal || typeof proposal !== 'object') return { name: null, reason: null }
  const record = proposal as Record<string, unknown>
  const name = typeof record.suggestedAssigneeName === 'string' && record.suggestedAssigneeName.trim()
    ? record.suggestedAssigneeName.trim()
    : null
  const reason = typeof record.assigneeReason === 'string' && record.assigneeReason.trim()
    ? record.assigneeReason.trim()
    : null
  return { name, reason: name ? reason : null }
}

/**
 * The bot's own copy of the sender's words, as a card per filed row.
 *
 * Studio people get the Tweak deep link because /tasks is theirs; a client's
 * card carries no Tweak button at all, because the link would land them on a
 * page they cannot open. Every other button is the same on both, and the
 * interactive route gates what each one is allowed to do.
 */
async function postCards(
  deps: SlackDmDeps,
  channel: string,
  rows: readonly NoteSuggestionRow[],
  options: { orgName: string | null; deepLink: boolean },
): Promise<number> {
  let posted = 0
  for (const row of rows) {
    const assignee = suggestedAssignee(row.proposal)
    const message = suggestionMessage(
      {
        id: row.id,
        kind: row.kind,
        proposal: row.proposal,
        quote: row.quote,
        orgName: options.orgName,
        suggestedAssigneeName: assignee.name,
        assigneeReason: assignee.reason,
      },
      // A studio card gets the dashboard link (the default). A client's card
      // gets no Tweak button at all, because /tasks is not theirs to open.
      options.deepLink ? {} : { tweakUrl: null },
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

  // The status line goes up before the first expensive thing and comes down
  // in the finally below, whichever way this ends (contract section 6b).
  const status = deps.setStatus ?? (async () => {})
  await status(READING_STATUS)

  try {
    let text = typed

    if (audio) {
      // Both of these are decided before a byte is downloaded: a worker with
      // no AI binding answers "not enabled" whatever the length, and a
      // recording Slack has already told us is too big is refused for free.
      const preflight = await preflightAudio(
        { size: await audioSize(deps, audio) },
        deps.ai !== undefined ? { ai: deps.ai } : {},
      )
      if (!preflight.ok) {
        await deps.postMessage({ channel: event.channelId, text: preflight.message })
        return outcome(true, `voice_${preflight.reason}` as SlackDmReason, true, 1)
      }

      const download = deps.downloadFile ?? downloadDefault
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

      const transcript = await transcribeAudio(bytes, { ai: preflight.ai })
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
  } finally {
    // An empty status is how Slack clears the line. In a finally because a
    // sender left looking at "Reading your note" forever is worse than any of
    // the failures above.
    await status('')
  }
}
