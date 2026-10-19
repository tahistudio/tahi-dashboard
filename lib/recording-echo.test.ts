import { describe, expect, it } from 'vitest'
import { ECHO_WINDOW_MS, MIN_BLEED_RATIO, removeMicEcho, type EchoLine } from './recording-echo'
import { mergeRecordingTranscript, recordingTranscriptSpeakers } from './meeting-recordings'
import type { MeetingRecordingChunk, RecordingSegment } from './meeting-recordings-types'

function chunk(value: Partial<MeetingRecordingChunk>): MeetingRecordingChunk {
  return { id: 'chunk', recordingId: 'rec', track: 'mic', sequence: 0, startMs: 0, durationMs: 120_000,
    mimeType: 'audio/wav', size: 4, state: 'ready', text: 'x', segments: [], error: null, attempts: 1, ...value }
}

/** Nova style: one segment per word at about 0.3 seconds each. */
function novaWords(startSeconds: number, text: string, speaker = 0): RecordingSegment[] {
  return text.split(/\s+/).map((word, index) => ({
    start: startSeconds + index * 0.3, end: startSeconds + index * 0.3 + 0.25, text: word, speaker,
  }))
}

/** Whisper style: one segment per phrase, spread over the words. */
function whisperPhrase(startSeconds: number, text: string): RecordingSegment {
  return { start: startSeconds, end: startSeconds + text.split(/\s+/).length * 0.3, text }
}

const REMOTE = 'Thanks for joining everyone so today we want to walk through the pricing page and the onboarding flow'

describe('mic echo removal when the person records on desktop speakers', () => {
  it('drops a mic phrase that repeats the remote speaker, even reworded and about a second late', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: novaWords(10, REMOTE) }),
      chunk({ track: 'mic', segments: [whisperPhrase(11, 'Thanks for joining everybody. So today we want to walk through the pricing page and the onboarding flow.')] }),
    ], { mic: 'Liam Miller', system: 'Michael Day' })
    expect(text).not.toContain('Liam Miller')
    expect(text).toBe(`[00:10] Them 1: ${REMOTE}`)
  })

  it('tolerates the mic trailing or leading by up to two seconds', () => {
    for (const offset of [-2, -1, 1, 2]) {
      const text = mergeRecordingTranscript([
        chunk({ track: 'system', segments: novaWords(20, REMOTE) }),
        chunk({ track: 'mic', segments: [whisperPhrase(20 + offset, REMOTE)] }),
      ])
      expect(text, `offset ${offset}`).not.toContain('Me:')
    }
  })

  it('keeps identical words spoken far from the remote line (a genuine repeat much later)', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: novaWords(10, REMOTE) }),
      chunk({ track: 'mic', segments: [whisperPhrase(10 + (ECHO_WINDOW_MS / 1000) + 40, REMOTE)] }),
    ])
    expect(text).toContain('Me: Thanks for joining')
  })

  it('keeps genuine crosstalk: the person talking over the remote side with different words', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: novaWords(30, 'and then we should launch on Thursday after the QA pass is signed off') }),
      chunk({ track: 'mic', segments: [whisperPhrase(31, 'Sorry to interrupt but can we check the budget before we commit to a date')] }),
    ], { mic: 'Liam Miller', system: 'Michael Day' })
    expect(text).toContain('Liam Miller: Sorry to interrupt but can we check the budget before we commit to a date')
    expect(text).toContain('launch on Thursday after the QA pass is signed off')
  })

  it('keeps crosstalk that shares only a few common words with the remote line', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: novaWords(5, 'I think that is a fair point about the contract') }),
      chunk({ track: 'mic', segments: [whisperPhrase(5.5, 'I think that we should wait for legal first')] }),
    ])
    expect(text).toContain('Me: I think that we should wait for legal first')
  })

  it('trims only the echoed part of a mic phrase that also holds real speech', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: novaWords(40, 'we will review the quarterly revenue numbers on Friday morning') }),
      chunk({ track: 'mic', segments: [whisperPhrase(40.5, 'Great point and I agree. We will review the quarterly revenue numbers on Friday morning.')] }),
    ], { mic: 'Liam Miller', system: 'Michael Day' })
    expect(text).toContain('Liam Miller: Great point and I agree.')
    expect(text).not.toMatch(/Liam Miller:.*quarterly/)
    expect(text).toContain('review the quarterly revenue numbers on Friday morning')
  })

  it('removes a short echoed phrase but keeps a short genuine acknowledgement', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: [...novaWords(50, 'thank you'), ...novaWords(60, 'yeah okay sure', 1)] }),
      chunk({ track: 'mic', segments: [whisperPhrase(50.4, 'Thank you.'), whisperPhrase(70, 'Yeah.')] }),
    ])
    expect(text).not.toMatch(/\] Me: Thank you/)
    expect(text).toContain('Me: Yeah.')
  })

  it('works against a phrase-level (Whisper) system track too', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', segments: [whisperPhrase(10, 'So the plan is to ship the redesign in two phases starting next sprint.')] }),
      chunk({ track: 'mic', segments: [whisperPhrase(11.2, 'So the plan is to ship the redesign in two phases starting next sprint')] }),
    ])
    expect(text).not.toContain('Me:')
  })

  it('removes echo across a 30 second chunk edge', () => {
    const text = mergeRecordingTranscript([
      chunk({ track: 'system', sequence: 0, startMs: 0, durationMs: 30_000, segments: novaWords(27.5, REMOTE) }),
      chunk({ track: 'mic', sequence: 1, startMs: 30_000, durationMs: 30_000, segments: [whisperPhrase(0.2, 'walk through the pricing page and the onboarding flow')] }),
    ])
    expect(text).not.toContain('Me:')
  })

  it('is deterministic, idempotent and leaves a mic-only recording untouched', () => {
    const lines: EchoLine[] = [
      { at: 0, end: 4000, track: 'mic', index: 0, text: 'Hello there everyone, welcome to the call' },
    ]
    expect(removeMicEcho(lines)).toEqual(lines)
    const mixed: EchoLine[] = [
      { at: 10_000, end: 15_000, track: 'system', index: 0, text: REMOTE },
      { at: 10_800, end: 16_000, track: 'mic', index: 0, text: `${REMOTE}.` },
      { at: 20_000, end: 22_000, track: 'mic', index: 1, text: 'A genuinely different remark of mine' },
    ]
    const once = removeMicEcho(mixed)
    expect(once.map(line => line.text)).toEqual([REMOTE, 'A genuinely different remark of mine'])
    expect(removeMicEcho(once)).toEqual(once)
    expect(removeMicEcho(mixed)).toEqual(once)
    expect(mixed).toHaveLength(3)
  })

  it('still lists a voice whose every word was echo, so it can be renamed', () => {
    const chunks = [
      chunk({ track: 'system', segments: novaWords(10, REMOTE) }),
      chunk({ track: 'mic', segments: [whisperPhrase(10.5, REMOTE)] }),
    ]
    expect(recordingTranscriptSpeakers(chunks).map(speaker => speaker.key)).toEqual(['mic', 'system:0'])
    expect(mergeRecordingTranscript(chunks)).not.toContain('Me:')
  })
})

/** An echoed opening that proves this recording has bleed, so the per-recording gate is open. */
const bleed = (): MeetingRecordingChunk[] => [
  chunk({ track: 'system', segments: novaWords(1, REMOTE) }),
  chunk({ track: 'mic', sequence: 9, segments: [whisperPhrase(1.4, REMOTE)] }),
]

describe('echo removal safeguards', () => {
  it('does not delete a genuine repeat ten seconds later inside one long Whisper line', () => {
    const remote = 'We need the Xero integration working before launch'
    const text = mergeRecordingTranscript([
      ...bleed(),
      chunk({ track: 'system', sequence: 1, segments: novaWords(100, remote) }),
      chunk({ track: 'mic', sequence: 1, segments: [{ start: 100.2, end: 129, text: `${remote} and then a long stretch of thinking aloud about the timeline for the whole team, ${remote}` }] }),
    ])
    const mic = text.split('\n').filter(line => line.includes('Me:')).join(' ')
    // Whisper times a long line evenly, so a word is only removed when its own time sits near its system word.
    // The repeat at the end of the line is about 25 seconds from the remote words and must survive.
    expect(mic).toMatch(/whole team, we need the Xero integration working before launch$/i)
  })

  it('never deletes a word the person changed inside an echoed sentence', () => {
    const text = mergeRecordingTranscript([
      ...bleed(),
      chunk({ track: 'system', sequence: 1, segments: novaWords(40, 'we should approve the deal') }),
      chunk({ track: 'mic', sequence: 1, segments: [whisperPhrase(40.3, 'we should definitely not approve the deal')] }),
    ])
    expect(text).toMatch(/Me: (we should )?definitely not$/m)
    expect(text).not.toMatch(/Me: .*approve/)
  })

  it('drops a lone changed number left behind, which real speaker calls show is misheard echo', () => {
    const text = mergeRecordingTranscript([
      ...bleed(),
      chunk({ track: 'system', sequence: 1, segments: novaWords(40, 'the budget is twenty thousand dollars') }),
      chunk({ track: 'mic', sequence: 1, segments: [whisperPhrase(40.3, 'the budget is twenty five thousand dollars')] }),
    ])
    expect(text).not.toMatch(/Me:.*five/)
  })

  it('drops one and two word leftovers and filler once echo took most of the line, but not a negation that still says something', () => {
    const lines = (micText: string) => mergeRecordingTranscript([
      ...bleed(),
      chunk({ track: 'system', sequence: 1, segments: novaWords(40, 'we are going live tomorrow morning with the new site') }),
      chunk({ track: 'mic', sequence: 1, segments: [whisperPhrase(40.2, micText)] }),
    ]).split('\n').filter(line => line.includes('Me:'))
    expect(lines('In we are going live tomorrow morning with the new site, um')).toEqual([])
    expect(lines('Well we are going live tomorrow morning with the new site')).toEqual([])
    expect(lines('We are going live tomorrow morning with the new site, never')).toEqual([])
    expect(lines('We are going live tomorrow morning with the new site, never again')).toEqual([expect.stringMatching(/Me: never again$/)])
  })

  it('leaves a headphone recording alone, so read-backs after the remote side survive', () => {
    const chunks = [
      chunk({ track: 'system', segments: [
        ...novaWords(10, 'The launch date is March fifteenth'), ...novaWords(30, 'Great sounds good'),
        ...novaWords(50, 'Can you send the invoice today'),
      ] }),
      chunk({ track: 'mic', segments: [
        whisperPhrase(13, 'So the launch date is March fifteenth, got it'), whisperPhrase(32, 'Sounds good'),
        whisperPhrase(53, 'Yes I will send it this afternoon before the end of the day and copy the whole team on it'),
        whisperPhrase(70, 'Now let us move on to the second topic which is about hiring a designer next quarter'),
        whisperPhrase(90, 'I think we should also review the roadmap for the autumn release with the product team'),
      ] }),
    ]
    const text = mergeRecordingTranscript(chunks)
    expect(text).toContain('Me: So the launch date is March fifteenth, got it')
    expect(text).toContain('Me: Sounds good')
    expect(MIN_BLEED_RATIO).toBe(0.15)
  })

  it('opens the gate only when more than 15 percent of mic words repeat the system track', () => {
    const system = chunk({ track: 'system', segments: novaWords(10, 'the quarterly numbers look strong this year') })
    const filler = (n: number) => whisperPhrase(100, Array.from({ length: n }, (_, i) => `unrelated${i}word`).join(' '))
    const run = (others: number) => mergeRecordingTranscript([system,
      chunk({ track: 'mic', segments: [whisperPhrase(10.2, 'the quarterly numbers look strong this year'), filler(others)] })])
    expect(run(35)).not.toContain('Me: the quarterly')
    expect(run(70)).toContain('Me: the quarterly')
  })

  it('treats a mostly matching short line within the window as echo', () => {
    const text = mergeRecordingTranscript([
      ...bleed(),
      chunk({ track: 'system', sequence: 1, segments: novaWords(60, 'that was what was required') }),
      chunk({ track: 'mic', sequence: 1, segments: [whisperPhrase(60.4, 'That was what was required.')] }),
    ])
    expect(text).not.toMatch(/Me: That was what/)
  })
})

describe('speaker renames in the transcript', () => {
  const chunks = [
    chunk({ track: 'system', segments: [...novaWords(0, 'hello from one', 0), ...novaWords(5, 'hello from two', 1)] }),
    chunk({ track: 'mic', segments: [whisperPhrase(10, 'a distinct reply from me')] }),
  ]

  it('applies per-voice names over the defaults and leaves unnamed voices alone', () => {
    expect(mergeRecordingTranscript(chunks, { mic: 'Liam Miller', system: 'Them' }, { 'system:1': 'Mark Ramsey', mic: 'Liam' })).toBe(
      '[00:00] Them 1: hello from one\n[00:05] Mark Ramsey: hello from two\n[00:10] Liam: a distinct reply from me')
  })

  it('reports each voice with its default and current label', () => {
    expect(recordingTranscriptSpeakers(chunks, { mic: 'Liam Miller', system: 'Them' }, { 'system:0': 'Michael Day' })).toEqual([
      { key: 'mic', track: 'mic', defaultLabel: 'Liam Miller', label: 'Liam Miller', custom: false },
      { key: 'system:0', track: 'system', defaultLabel: 'Them 1', label: 'Michael Day', custom: true },
      { key: 'system:1', track: 'system', defaultLabel: 'Them 2', label: 'Them 2', custom: false },
    ])
  })

  it('ignores a rename for a voice that is not in the transcript', () => {
    expect(mergeRecordingTranscript(chunks, undefined, { 'system:9': 'Nobody' })).toContain('Them 1: hello from one')
  })
})
