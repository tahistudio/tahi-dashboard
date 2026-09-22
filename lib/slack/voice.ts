/**
 * lib/slack/voice.ts
 *
 * A voice note in a DM becomes text, and the text becomes a note (CN.2
 * section 4).
 *
 * Transcription runs on Workers AI rather than on a hosted API because the
 * audio is already inside the worker and shipping a client's voice out to a
 * third service to come back as a sentence is a bigger decision than this
 * feature is. `@cf/openai/whisper` takes the bytes as an array of unsigned
 * 8 bit integers and answers with the words.
 *
 * THE BINDING IS OPTIONAL ON PURPOSE. `ai` is added to wrangler.json in this
 * slice, but a worker deployed before that config lands, and every local run
 * that has no Cloudflare context at all, has no `env.AI`. That is not an
 * error to report as a failure: it is one sentence saying the feature is off,
 * which is also exactly what the sender needs to hear.
 */

/** The model. One constant so the test and the call cannot drift apart. */
export const WHISPER_MODEL = '@cf/openai/whisper' as const

/** The sentence a voice note gets when the worker has no AI binding. */
export const VOICE_NOT_ENABLED = 'Voice notes are not enabled yet. Send it as text and I will file it.'

/** The sentence a voice note gets when the model answered with nothing. */
export const VOICE_EMPTY = 'I could not hear anything in that. Try again, or send it as text.'

/** The sentence a voice note gets when transcription itself fell over. */
export const VOICE_FAILED = 'I could not transcribe that one. Send it as text and I will file it.'

/**
 * Whisper's own ceiling is generous but a worker's memory is not, and a
 * forty minute recording dropped into a DM is a bill rather than a note.
 */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024

export const VOICE_TOO_LARGE = 'That recording is too long for me. Send a shorter one, or type it.'

/**
 * The slice of the Workers AI binding this file uses.
 *
 * Narrower than the platform's `Ai` class on purpose: a structural type means
 * a test can hand in a two line object instead of faking an abstract class,
 * and the real binding satisfies it.
 */
export interface WhisperBinding {
  run(model: typeof WHISPER_MODEL, input: { audio: number[] }): Promise<{ text?: string }>
}

/** Just enough of a Slack file to decide whether it is worth transcribing. */
export interface AudioFileLike {
  id: string
  name?: string
  mimetype?: string
  filetype?: string
}

/** The extensions Slack's own voice recorder and the common phone recorders use. */
const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'mp4', 'mpga', 'wav', 'webm', 'ogg', 'oga', 'opus', 'aac', 'flac']

/**
 * Audio, or not.
 *
 * The mimetype is checked first because Slack sets it reliably for its own
 * voice messages; the extension is the fallback for a file dragged in from a
 * phone, where the mimetype can arrive as the unhelpfully generic
 * application/octet-stream.
 */
export function isAudioFile(file: AudioFileLike | null | undefined): boolean {
  if (!file) return false
  if (typeof file.mimetype === 'string' && file.mimetype.toLowerCase().startsWith('audio/')) return true
  const extension = (file.filetype ?? file.name?.split('.').pop() ?? '').toLowerCase()
  return AUDIO_EXTENSIONS.includes(extension)
}

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'not_enabled' | 'too_large' | 'empty' | 'failed'; message: string }

/**
 * The AI binding, or null.
 *
 * Every failure mode collapses to null: no Cloudflare context (a unit test, a
 * plain node run), a context with no `AI` key (a worker deployed before this
 * slice), or a binding that does not look like Workers AI. The caller has one
 * branch to write rather than four.
 */
export async function loadAiBinding(): Promise<WhisperBinding | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const cfCtx = await getCloudflareContext({ async: true })
    const binding = cfCtx?.env?.AI
    // `Ai` is generic over the whole model list, so the narrow structural type
    // this file uses is reached through unknown rather than being a subtype of
    // it. The runtime check above is the real guard: an old worker has no AI
    // on its env at all, whatever the types say.
    if (!binding || typeof binding.run !== 'function') return null
    return binding as unknown as WhisperBinding
  } catch {
    return null
  }
}

export type AudioPreflight =
  | { ok: true; ai: WhisperBinding }
  | { ok: false; reason: 'not_enabled' | 'too_large'; message: string }

/**
 * Everything that can be decided about a recording BEFORE a byte of it is
 * downloaded, in the order it has to be decided in.
 *
 * THE BINDING FIRST. A worker with no AI binding can do nothing with audio of
 * any length, so it must answer "voice notes are not enabled yet" even for a
 * two hour recording. Checking the size first would answer "too long" on a
 * deployment where no length would have worked, which sends the sender off to
 * trim a file for nothing.
 *
 * THE SIZE SECOND, and from files.info rather than from the downloaded bytes.
 * A forty minute recording is a worker's memory and a Workers AI bill, and
 * Slack tells us how big it is for free before we spend either.
 *
 * A size we do not know is not a refusal: it passes, and transcribeAudio
 * checks the real byte length as the backstop.
 */
export async function preflightAudio(
  file: { size?: number | null },
  options: { ai?: WhisperBinding | null } = {},
): Promise<AudioPreflight> {
  const ai = options.ai !== undefined ? options.ai : await loadAiBinding()
  if (!ai) return { ok: false, reason: 'not_enabled', message: VOICE_NOT_ENABLED }

  const size = file.size
  if (typeof size === 'number' && size > MAX_AUDIO_BYTES) {
    return { ok: false, reason: 'too_large', message: VOICE_TOO_LARGE }
  }

  return { ok: true, ai }
}

/**
 * Bytes in, words out.
 *
 * The binding is a parameter so a test never has to stand up a Cloudflare
 * context; production passes nothing and gets the real one.
 *
 * Same order as preflightAudio, for the same reason: a missing binding is the
 * answer whatever the length. This is the backstop for a recording whose size
 * Slack did not tell us before the download.
 */
export async function transcribeAudio(
  audio: ArrayBuffer,
  options: { ai?: WhisperBinding | null } = {},
): Promise<TranscribeResult> {
  const ai = options.ai !== undefined ? options.ai : await loadAiBinding()
  if (!ai) return { ok: false, reason: 'not_enabled', message: VOICE_NOT_ENABLED }

  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, reason: 'too_large', message: VOICE_TOO_LARGE }
  }

  try {
    const output = await ai.run(WHISPER_MODEL, { audio: Array.from(new Uint8Array(audio)) })
    const text = (output?.text ?? '').trim()
    if (!text) return { ok: false, reason: 'empty', message: VOICE_EMPTY }
    return { ok: true, text }
  } catch {
    // The Slack sender gets a sentence, not a Workers AI error code. The event
    // route logs the raw failure through its own run record.
    return { ok: false, reason: 'failed', message: VOICE_FAILED }
  }
}
