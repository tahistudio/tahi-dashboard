/**
 * lib/call-transcripts.ts: the two-table matcher and the transcript upsert.
 *
 * The matcher is the part that can silently do damage (a wrong match writes
 * one client's conversation onto another client's call), so the cases here
 * are the three outcomes that matter: a discovery call wins, a scheduled
 * call wins, and a near-tie parks the notes instead of guessing.
 */
import { describe, it, expect } from 'vitest'
import {
  MATCH_WINDOW_MS,
  findCallMatch,
  findFiledTranscript,
  hashTranscript,
  pickCallMatch,
  upsertTranscript,
  type CallCandidate,
} from '@/lib/call-transcripts'

const CENTRE = new Date('2026-09-18T02:00:00Z').getTime()

function discovery(over: Partial<CallCandidate> = {}): CallCandidate {
  return {
    kind: 'discovery',
    id: 'disc-1',
    title: 'Intro call',
    scheduledAt: '2026-09-18T02:00:00Z',
    attendees: '[]',
    orgId: null,
    transcript: null,
    transcriptSource: null,
    ...over,
  }
}

function scheduled(over: Partial<CallCandidate> = {}): CallCandidate {
  return {
    kind: 'scheduled',
    id: 'sched-1',
    title: 'Monthly check-in',
    scheduledAt: '2026-09-18T02:00:00Z',
    attendees: '[]',
    orgId: 'org-a',
    transcript: null,
    transcriptSource: null,
    ...over,
  }
}

describe('pickCallMatch, across both call tables', () => {
  it('picks the discovery call when the name is in its title', () => {
    const match = pickCallMatch(
      [
        discovery({ title: 'Discovery (Tim Lyons)' }),
        // Same slot, but nothing ties the name to it.
        scheduled({ scheduledAt: '2026-09-18T03:30:00Z' }),
      ],
      { centre: CENTRE, attendeeGuess: 'Tim Lyons' },
    )
    expect(match.status).toBe('matched')
    if (match.status !== 'matched') return
    expect(match.candidate.kind).toBe('discovery')
    expect(match.candidate.id).toBe('disc-1')
  })

  it('picks the scheduled call when the name is on its attendee list', () => {
    const match = pickCallMatch(
      [
        discovery({ scheduledAt: '2026-09-18T03:30:00Z' }),
        scheduled({
          attendees: JSON.stringify([{ name: 'Tim Lyons', email: 'tim@acme.co' }]),
        }),
      ],
      { centre: CENTRE, attendeeGuess: 'Tim Lyons' },
    )
    expect(match.status).toBe('matched')
    if (match.status !== 'matched') return
    expect(match.candidate.kind).toBe('scheduled')
    expect(match.candidate.id).toBe('sched-1')
  })

  it('parks a near-tie as ambiguous rather than guessing a table', () => {
    const match = pickCallMatch(
      [
        discovery({ title: 'Call with Tim Lyons' }),
        scheduled({ title: 'Check-in with Tim Lyons' }),
      ],
      { centre: CENTRE, attendeeGuess: 'Tim Lyons' },
    )
    expect(match.status).toBe('ambiguous')
    if (match.status !== 'ambiguous') return
    expect(match.top.score - match.runnerUp.score).toBeLessThan(20)
  })

  it('refuses a match when nothing scores', () => {
    const match = pickCallMatch(
      [discovery({ scheduledAt: '2026-09-20T02:00:00Z' })],
      { centre: CENTRE, attendeeGuess: 'Nobody Here' },
    )
    expect(match.status).toBe('no_match')
  })

  it('returns no_match on an empty field', () => {
    expect(pickCallMatch([], { centre: CENTRE, attendeeGuess: 'Tim Lyons' }).status).toBe('no_match')
  })
})

type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, calls: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onOk, onErr)
      }
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) => {
        calls.push({ method: prop, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(results: unknown[] = []) {
  const queries: QueryRecord[][] = []
  const queue = [...results]
  const entry = (method: string, args: unknown[]) => {
    const calls: QueryRecord[] = [{ method, args }]
    queries.push(calls)
    return makeChain(queue.length ? queue.shift() : [], calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args),
    insert: (...args: unknown[]) => entry('insert', args),
    update: (...args: unknown[]) => entry('update', args),
    delete: (...args: unknown[]) => entry('delete', args),
  }
  return { handle, queries }
}

describe('findCallMatch', () => {
  it('reads both tables and lets the best overall row win', async () => {
    const { handle, queries } = makeDb([
      // discovery_calls: right slot, wrong people
      [{ id: 'disc-1', title: 'Internal sync', scheduledAt: '2026-09-18T02:00:00Z', attendees: '[]', orgId: null, transcript: null, transcriptSource: null }],
      // scheduled_calls: right slot AND the name
      [{ id: 'sched-1', title: 'Acme check-in with Tim Lyons', scheduledAt: '2026-09-18T02:00:00Z', attendees: '[]', orgId: 'org-a' }],
    ])

    const match = await findCallMatch(handle as never, {
      centre: CENTRE,
      windowMs: MATCH_WINDOW_MS,
      attendeeGuess: 'Tim Lyons',
    })

    expect(queries).toHaveLength(2)
    expect(match.status).toBe('matched')
    if (match.status !== 'matched') return
    expect(match.candidate.kind).toBe('scheduled')
    expect(match.candidate.orgId).toBe('org-a')
  })

  it('returns no_match when neither table has a row in the window', async () => {
    const { handle } = makeDb([[], []])
    const match = await findCallMatch(handle as never, {
      centre: CENTRE,
      windowMs: MATCH_WINDOW_MS,
      attendeeGuess: 'Tim Lyons',
    })
    expect(match.status).toBe('no_match')
  })
})

describe('upsertTranscript', () => {
  it('inserts a new row when the external id is unseen', async () => {
    const { handle, queries } = makeDb([[]])
    const res = await upsertTranscript(handle as never, {
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      text: 'Tim: hello',
      title: 'Meeting (Tim Lyons) - Notes by Gemini',
      receivedAt: '2026-09-18T03:00:00Z',
      unlinkedReason: 'no_match',
    })

    expect(res.created).toBe(true)
    const insert = queries[1].find(c => c.method === 'values')
    expect(insert?.args[0]).toMatchObject({
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      callId: null,
      unlinkedReason: 'no_match',
      hash: hashTranscript('Tim: hello'),
    })
  })

  it('updates the existing row instead of writing a second one', async () => {
    const { handle, queries } = makeDb([[{ id: 'ct-1', callId: null }]])
    const res = await upsertTranscript(handle as never, {
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      text: 'Tim: hello again',
      unlinkedReason: 'ambiguous',
    })

    expect(res).toEqual({ id: 'ct-1', created: false })
    expect(queries.some(q => q[0].method === 'insert')).toBe(false)
    const set = queries[1].find(c => c.method === 'set')
    expect(set?.args[0]).toMatchObject({ text: 'Tim: hello again', unlinkedReason: 'ambiguous' })
  })

  it('never strips a link a human already made', async () => {
    const { handle, queries } = makeDb([[{ id: 'ct-1', callId: 'sched-9' }]])
    await upsertTranscript(handle as never, {
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      text: 'Tim: hello again',
      unlinkedReason: 'no_match',
    })
    const set = queries[1].find(c => c.method === 'set')
    expect(set?.args[0]).not.toHaveProperty('callId')
    expect(set?.args[0]).not.toHaveProperty('unlinkedReason')
  })

  it('writes the link when the caller supplies one', async () => {
    const { handle, queries } = makeDb([[{ id: 'ct-1', callId: null }]])
    await upsertTranscript(handle as never, {
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      text: 'Tim: hello',
      callKind: 'scheduled',
      callId: 'sched-1',
      matchedBy: 'gemini_title_time',
    })
    const set = queries[1].find(c => c.method === 'set')
    expect(set?.args[0]).toMatchObject({
      callKind: 'scheduled',
      callId: 'sched-1',
      matchedBy: 'gemini_title_time',
      unlinkedReason: null,
    })
  })
})

describe('findFiledTranscript', () => {
  it('returns null when nothing is filed for the doc', async () => {
    const { handle } = makeDb([[]])
    expect(await findFiledTranscript(handle as never, 'gemini_drive', 'drive-x')).toBeNull()
  })

  it('returns the filed row with its link and received time', async () => {
    const { handle } = makeDb([[{ id: 'ct-1', callKind: 'scheduled', callId: 'sched-1', receivedAt: '2026-09-18T03:30:00Z' }]])
    expect(await findFiledTranscript(handle as never, 'gemini_drive', 'drive-x')).toEqual({
      id: 'ct-1', callKind: 'scheduled', callId: 'sched-1', receivedAt: '2026-09-18T03:30:00Z',
    })
  })
})

describe('hashTranscript', () => {
  it('is stable and changes with the body', () => {
    expect(hashTranscript('a')).toBe(hashTranscript('a'))
    expect(hashTranscript('a')).not.toBe(hashTranscript('b'))
  })
})
