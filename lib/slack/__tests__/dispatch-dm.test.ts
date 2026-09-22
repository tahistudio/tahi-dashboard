/**
 * lib/slack/dispatch-dm.ts and lib/slack/voice.ts: one DM in, one reply out
 * (CN.2 section 4).
 *
 * What is pinned here:
 *
 *   THE VOICE FALLBACK. Workers AI is a binding, and a binding that is not on
 *   the deployed worker is not an error the sender should read as "the bot is
 *   broken". It is one sentence saying the feature is off, which is also the
 *   only honest thing to say before Liam adds the binding and redeploys.
 *
 *   THE TRANSCRIPT BECOMES THE NOTE, unchanged. A voice note that is
 *   summarised before it reaches the suggester would break the one rule the
 *   whole feature rests on: every suggestion quotes words somebody actually
 *   said.
 *
 *   THE UNKNOWN USER, who gets one sentence and never learns whether anything
 *   was even looked up.
 *
 *   THE HOOK, because S1's events route dispatches through it and a handler
 *   that silently fails to register is a DM that vanishes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SlackIdentity } from '../identity'
import type { NoteDraftResult } from '../notes'

const cfEnv: { AI?: unknown } = {}
let cfThrows = false

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => {
    if (cfThrows) throw new Error('no context')
    return { env: cfEnv, ctx: {} }
  },
}))

const noteCalls: Array<Record<string, unknown>> = []
let noteResult: NoteDraftResult

vi.mock('../notes', async () => {
  const actual = await vi.importActual<typeof import('../notes')>('../notes')
  return {
    ...actual,
    draftFromNote: async (input: Record<string, unknown>) => {
      noteCalls.push(input)
      return noteResult
    },
  }
})

const { handleSlackDm, READING_STATUS } = await import('../dispatch-dm')
const { registerSlackDmHandler, resetSlackDmHandler, dispatchSlackDm } = await import('../dm-hook')
const {
  transcribeAudio,
  preflightAudio,
  loadAiBinding,
  VOICE_NOT_ENABLED,
  VOICE_TOO_LARGE,
  MAX_AUDIO_BYTES,
  WHISPER_MODEL,
  isAudioFile,
} = await import('../voice')
const { SLACK_DENIED_REPLY } = await import('../identity')

function identity(overrides: Partial<SlackIdentity> = {}): SlackIdentity {
  return {
    id: 'si1',
    slackTeamId: 'T1',
    slackUserId: 'U1',
    email: 'liam@tahi.studio',
    level: 'founder',
    teamMemberId: 'tm_liam',
    contactId: null,
    orgId: null,
    dmChannelId: 'D1',
    ...overrides,
  }
}

const posted: Array<{ channel: string; text: string }> = []

function deps(overrides: Record<string, unknown> = {}) {
  return {
    database: {} as never,
    identity: identity(),
    postMessage: async (message: { channel: string; text: string }) => {
      posted.push({ channel: message.channel, text: message.text })
    },
    ...overrides,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    teamId: 'T1',
    channelId: 'D1',
    userId: 'U1',
    text: 'I will send the font headers to Giant Group',
    ts: '1758500000.000100',
    files: [],
    ...overrides,
  }
}

const AUDIO_FILE = {
  id: 'F1',
  mimetype: 'audio/mp4',
  name: 'audio_message.m4a',
  url_private_download: 'https://files.slack.com/F1/download',
}

beforeEach(() => {
  posted.length = 0
  noteCalls.length = 0
  cfThrows = false
  delete cfEnv.AI
  resetSlackDmHandler()
  noteResult = {
    ok: true,
    reason: 'ok',
    reply: 'Here is what I understood.',
    orgId: 'o_giant',
    orgName: 'Giant Group',
    approverType: 'member',
    approverId: 'tm_liam',
    inserted: 1,
    duplicates: 0,
    rows: [{ id: 's1', kind: 'create_task', proposal: { title: 'Send the font headers' }, quote: 'I will send the font headers' }],
  }
})

describe('isAudioFile', () => {
  it('recognises a Slack voice note', () => {
    expect(isAudioFile(AUDIO_FILE)).toBe(true)
  })

  it('leaves a screenshot alone', () => {
    expect(isAudioFile({ id: 'F2', mimetype: 'image/png', name: 'shot.png' })).toBe(false)
  })
})

describe('loadAiBinding', () => {
  it('is null when the worker has no AI binding', async () => {
    expect(await loadAiBinding()).toBeNull()
  })

  it('is null rather than a throw when there is no Cloudflare context at all', async () => {
    cfThrows = true
    expect(await loadAiBinding()).toBeNull()
  })

  it('hands back the binding when it is there', async () => {
    cfEnv.AI = { run: async () => ({ text: 'hi' }) }
    expect(await loadAiBinding()).not.toBeNull()
  })
})

describe('transcribeAudio', () => {
  it('says voice is not enabled when the binding is missing', async () => {
    const result = await transcribeAudio(new Uint8Array([1, 2, 3]).buffer)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not_enabled')
      expect(result.message).toBe(VOICE_NOT_ENABLED)
    }
  })

  it('runs whisper over the bytes and returns the text', async () => {
    const seen: Array<{ model: string; input: { audio: number[] } }> = []
    const ai = {
      run: async (model: string, input: { audio: number[] }) => {
        seen.push({ model, input })
        return { text: '  Send the font headers to Giant Group.  ' }
      },
    }
    const result = await transcribeAudio(new Uint8Array([7, 8, 9]).buffer, { ai })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('Send the font headers to Giant Group.')
    expect(seen[0].model).toBe(WHISPER_MODEL)
    expect(seen[0].input.audio).toEqual([7, 8, 9])
  })

  it('reports an empty transcription rather than filing an empty note', async () => {
    const ai = { run: async () => ({ text: '   ' }) }
    const result = await transcribeAudio(new Uint8Array([1]).buffer, { ai })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })

  it('turns a model failure into a sentence rather than a stack trace', async () => {
    const ai = { run: async () => { throw new Error('5015 worker threw') } }
    const result = await transcribeAudio(new Uint8Array([1]).buffer, { ai })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('failed')
  })
})

describe('handleSlackDm', () => {
  it('turns a typed DM into a note and replies with one message per suggestion', async () => {
    const outcome = await handleSlackDm(event(), deps())
    expect(outcome.handled).toBe(true)
    expect(outcome.reason).toBe('ok')
    expect(noteCalls).toHaveLength(1)
    expect(noteCalls[0].text).toBe('I will send the font headers to Giant Group')
    // The lead line plus one card.
    expect(posted).toHaveLength(2)
    expect(posted[0].text).toBe('Here is what I understood.')
    expect(posted[0].channel).toBe('D1')
  })

  it('answers an unknown user with one sentence and never reaches the note path', async () => {
    const outcome = await handleSlackDm(event(), deps({ identity: identity({ level: 'unknown', teamMemberId: null }) }))
    expect(outcome.reason).toBe('denied')
    expect(noteCalls).toHaveLength(0)
    expect(posted).toEqual([{ channel: 'D1', text: SLACK_DENIED_REPLY }])
  })

  it('answers a DM with no identity the same way', async () => {
    const outcome = await handleSlackDm(event(), deps({ identity: null }))
    expect(outcome.reason).toBe('denied')
    expect(posted[0].text).toBe(SLACK_DENIED_REPLY)
  })

  it('ignores its own messages', async () => {
    const outcome = await handleSlackDm(event({ botId: 'B1' }), deps())
    expect(outcome.handled).toBe(false)
    expect(posted).toHaveLength(0)
  })

  it('transcribes a voice note and files the transcript as the note', async () => {
    cfEnv.AI = { run: async () => ({ text: 'Send the font headers to Giant Group.' }) }
    const outcome = await handleSlackDm(
      event({ text: '', files: [AUDIO_FILE] }),
      deps({ downloadFile: async () => new Uint8Array([1, 2, 3]).buffer }),
    )
    expect(outcome.reason).toBe('ok')
    expect(outcome.voice).toBe(true)
    expect(noteCalls[0].text).toBe('Send the font headers to Giant Group.')
  })

  it('says voice notes are not enabled yet when the binding is missing', async () => {
    const outcome = await handleSlackDm(
      event({ text: '', files: [AUDIO_FILE] }),
      deps({ downloadFile: async () => new Uint8Array([1, 2, 3]).buffer }),
    )
    expect(outcome.reason).toBe('voice_not_enabled')
    expect(posted).toEqual([{ channel: 'D1', text: VOICE_NOT_ENABLED }])
    expect(noteCalls).toHaveLength(0)
  })

  it('keeps going on the typed text when a DM carries a screenshot rather than audio', async () => {
    const outcome = await handleSlackDm(
      event({ files: [{ id: 'F2', mimetype: 'image/png', name: 'shot.png' }] }),
      deps(),
    )
    expect(outcome.reason).toBe('ok')
    expect(outcome.voice).toBe(false)
    expect(noteCalls).toHaveLength(1)
  })

  it('does nothing at all for an empty DM', async () => {
    const outcome = await handleSlackDm(event({ text: '   ' }), deps())
    expect(outcome.handled).toBe(false)
    expect(posted).toHaveLength(0)
    expect(noteCalls).toHaveLength(0)
  })

  it('reports the note failure back to the sender in words', async () => {
    noteResult = {
      ok: false,
      reason: 'nothing_understood',
      reply: 'I could not find anything to file from that.',
      orgId: null,
      orgName: null,
      approverType: 'member',
      approverId: 'tm_liam',
      inserted: 0,
      duplicates: 0,
      rows: [],
    }
    const outcome = await handleSlackDm(event(), deps())
    expect(outcome.reason).toBe('nothing_understood')
    expect(posted).toEqual([{ channel: 'D1', text: 'I could not find anything to file from that.' }])
  })
})

describe('the DM hook', () => {
  it('falls back to the handler in this slice when nothing is registered', async () => {
    const outcome = await dispatchSlackDm(event({ text: '   ' }), deps())
    expect(outcome.handled).toBe(false)
  })

  it('uses whatever S1 registers', async () => {
    let called = false
    registerSlackDmHandler(async () => {
      called = true
      return { handled: true, reason: 'ok', voice: false, posted: 0 }
    })
    await dispatchSlackDm(event(), deps())
    expect(called).toBe(true)
  })
})

describe('the voice preflight', () => {
  it('answers not enabled before it looks at the size, so a worker with no binding never says "too long"', async () => {
    const result = await preflightAudio({ size: MAX_AUDIO_BYTES + 1 }, { ai: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_enabled')
  })

  it('refuses an oversized recording once the binding is there', async () => {
    const result = await preflightAudio({ size: MAX_AUDIO_BYTES + 1 }, { ai: { run: async () => ({ text: 'x' }) } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too_large')
  })

  it('passes a size nobody could tell us, and leaves the byte length as the backstop', async () => {
    const result = await preflightAudio({ size: null }, { ai: { run: async () => ({ text: 'x' }) } })
    expect(result.ok).toBe(true)
  })
})

describe('the size check happens before the download', () => {
  it('refuses a recording Slack already said was too big, without spending the download', async () => {
    cfEnv.AI = { run: async () => ({ text: 'never reached' }) }
    let downloaded = false
    const outcome = await handleSlackDm(
      event({ text: '', files: [{ ...AUDIO_FILE, size: MAX_AUDIO_BYTES + 1 }] }),
      deps({
        downloadFile: async () => {
          downloaded = true
          return new Uint8Array([1]).buffer
        },
      }),
    )
    expect(outcome.reason).toBe('voice_too_large')
    expect(downloaded).toBe(false)
    expect(posted).toEqual([{ channel: 'D1', text: VOICE_TOO_LARGE }])
    expect(noteCalls).toHaveLength(0)
  })

  it('asks files.info for a size the event did not carry, and refuses on that', async () => {
    cfEnv.AI = { run: async () => ({ text: 'never reached' }) }
    let downloaded = false
    const outcome = await handleSlackDm(
      event({ text: '', files: [AUDIO_FILE] }),
      deps({
        filesInfo: async (fileId: string) => ({
          id: fileId, mimetype: 'audio/mp4', urlPrivate: null, name: 'note.m4a', size: MAX_AUDIO_BYTES + 1,
        }),
        downloadFile: async () => {
          downloaded = true
          return new Uint8Array([1]).buffer
        },
      }),
    )
    expect(outcome.reason).toBe('voice_too_large')
    expect(downloaded).toBe(false)
  })

  it('says voice notes are not enabled yet for an oversized recording on a worker with no binding', async () => {
    const outcome = await handleSlackDm(
      event({ text: '', files: [{ ...AUDIO_FILE, size: MAX_AUDIO_BYTES + 1 }] }),
      deps({ downloadFile: async () => new Uint8Array([1]).buffer }),
    )
    expect(outcome.reason).toBe('voice_not_enabled')
  })
})

describe('the assistant status line (contract section 6b)', () => {
  it('goes up before the note is read and comes back down once the reply is out', async () => {
    const statuses: string[] = []
    await handleSlackDm(event(), deps({ setStatus: async (status: string) => { statuses.push(status) } }))
    expect(statuses).toEqual([READING_STATUS, ''])
  })

  it('comes down even when the note could not be read', async () => {
    const statuses: string[] = []
    noteResult = {
      ok: false,
      reason: 'suggester_failed',
      reply: 'I could not read that one just now. Try again in a minute.',
      orgId: null,
      orgName: null,
      approverType: 'member',
      approverId: 'tm_liam',
      inserted: 0,
      duplicates: 0,
      rows: [],
    }
    await handleSlackDm(event(), deps({ setStatus: async (status: string) => { statuses.push(status) } }))
    expect(statuses).toEqual([READING_STATUS, ''])
  })

  it('is never set for a stranger, who is refused before any work starts', async () => {
    const statuses: string[] = []
    await handleSlackDm(event(), deps({
      identity: identity({ level: 'unknown', teamMemberId: null }),
      setStatus: async (status: string) => { statuses.push(status) },
    }))
    expect(statuses).toEqual([])
  })
})
