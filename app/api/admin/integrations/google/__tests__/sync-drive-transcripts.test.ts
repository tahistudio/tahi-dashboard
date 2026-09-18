/**
 * POST /api/admin/integrations/google/sync-drive-transcripts
 *
 * Phase 0 behaviour: every parsed Gemini doc leaves a call_transcripts row
 * behind. Before this, a doc the matcher could not place was dropped with
 * nothing for a human to pick up, and a doc that belonged to a client
 * check-in (scheduled_calls) was dropped too because that table has nowhere
 * to put a transcript.
 *
 * Drive is mocked at lib/google; the parser is real for titles and mocked for
 * bodies so these cases are about what the route writes, not about Gemini's
 * markdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/cron-runs', () => ({ logCronRun: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/google', () => ({
  getGoogleAccessToken: vi.fn().mockResolvedValue({ accessToken: 'tok' }),
  listDriveFiles: vi.fn(),
  exportDriveDocAsText: vi.fn().mockResolvedValue('raw doc text'),
}))

vi.mock('@/lib/gemini-transcript-parser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/gemini-transcript-parser')>()),
  parseGeminiTranscript: vi.fn(),
}))

import { db } from '@/lib/db'
import { listDriveFiles } from '@/lib/google'
import { parseGeminiTranscript } from '@/lib/gemini-transcript-parser'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/integrations/google/sync-drive-transcripts/route'

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

const DOC = {
  id: 'drive-file-1',
  name: 'Meeting (Tim Lyons) - 2026/09/18 14:00 NZST - Notes by Gemini',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-09-18T03:30:00Z',
}

/** The parsed title above resolves to 2026-09-18T02:00:00Z (NZST is +12). */
const CALL_TIME = '2026-09-18T02:00:00Z'

const PARSED = {
  summary: 'Agreed the homepage scope.',
  nextSteps: ['[Liam] Send the proposal.'],
  details: ['**Homepage**: three sections.'],
  transcript: 'Tim: we agreed on the new homepage',
  invitedEmails: [],
  durationFormatted: null,
}

function request() {
  return new NextRequest('http://localhost:3000/api/admin/integrations/google/sync-drive-transcripts', {
    method: 'POST',
  })
}

function insertedValues(queries: QueryRecord[][]): Record<string, unknown> | undefined {
  const insert = queries.find(q => q[0].method === 'insert')
  return insert?.find(c => c.method === 'values')?.args[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listDriveFiles).mockResolvedValue([DOC])
  vi.mocked(parseGeminiTranscript).mockReturnValue(PARSED)
})

describe('sync-drive-transcripts, matched docs', () => {
  it('files a linked row and still writes the discovery call', async () => {
    const { handle, queries } = makeDb([
      // discovery_calls in the window: the clear winner
      [{ id: 'disc-1', title: 'Discovery (Tim Lyons)', scheduledAt: CALL_TIME, attendees: '[]', orgId: null, transcript: null, transcriptSource: null }],
      // scheduled_calls in the window: none
      [],
      // upsert lookup: nothing filed yet
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    expect(res.status).toBe(200)
    const body = await res.json() as { written: number; filed: number; parked: number; results: Array<{ status: string; callKind?: string }> }
    expect(body).toMatchObject({ written: 1, filed: 1, parked: 0 })
    expect(body.results[0]).toMatchObject({ status: 'matched', callKind: 'discovery' })

    expect(insertedValues(queries)).toMatchObject({
      source: 'gemini_drive',
      externalId: 'drive-file-1',
      callKind: 'discovery',
      callId: 'disc-1',
      matchedBy: 'gemini_title_time',
      unlinkedReason: null,
      receivedAt: DOC.modifiedTime,
    })
    // The discovery mirror is still written, unchanged.
    expect(queries.filter(q => q[0].method === 'update')).toHaveLength(2)  // discovery_calls + integrations
  })

  it('files a scheduled call without touching scheduled_calls', async () => {
    const { handle, queries } = makeDb([
      [],
      [{ id: 'sched-1', title: 'Acme check-in with Tim Lyons', scheduledAt: CALL_TIME, attendees: '[]', orgId: 'org-a' }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { written: number; filed: number; results: Array<{ status: string; callKind?: string }> }
    expect(body).toMatchObject({ written: 0, filed: 1 })
    expect(body.results[0]).toMatchObject({ status: 'matched', callKind: 'scheduled' })

    expect(insertedValues(queries)).toMatchObject({
      callKind: 'scheduled',
      callId: 'sched-1',
      matchedBy: 'gemini_title_time',
    })
    // Only the integrations last-synced stamp: scheduled_calls is untouched.
    expect(queries.filter(q => q[0].method === 'update')).toHaveLength(1)
  })
})

describe('sync-drive-transcripts, unmatched docs', () => {
  it('parks notes with no candidate call as no_match', async () => {
    const { handle, queries } = makeDb([[], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { filed: number; parked: number; results: Array<{ status: string; transcriptId?: string }> }
    expect(body).toMatchObject({ filed: 1, parked: 1 })
    expect(body.results[0].status).toBe('no_match')
    expect(body.results[0].transcriptId).toBeTruthy()

    expect(insertedValues(queries)).toMatchObject({
      callKind: null,
      callId: null,
      unlinkedReason: 'no_match',
      text: PARSED.transcript,
    })
  })

  it('parks a near-tie across the two tables as ambiguous', async () => {
    const { handle, queries } = makeDb([
      [{ id: 'disc-1', title: 'Call with Tim Lyons', scheduledAt: CALL_TIME, attendees: '[]', orgId: null, transcript: null, transcriptSource: null }],
      [{ id: 'sched-1', title: 'Check-in with Tim Lyons', scheduledAt: CALL_TIME, attendees: '[]', orgId: 'org-a' }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { parked: number; results: Array<{ status: string }> }
    expect(body.parked).toBe(1)
    expect(body.results[0].status).toBe('multiple_matches')
    expect(insertedValues(queries)).toMatchObject({ unlinkedReason: 'ambiguous', callId: null })
  })

  it('keeps the wrap up beside the transcript so Liam can read one or the other', async () => {
    const { handle, queries } = makeDb([[], [], []])
    vi.mocked(db).mockResolvedValue(handle as never)

    await POST(request())
    const values = insertedValues(queries)
    expect(values?.summary).toBe(PARSED.summary)
    expect(String(values?.wrapUp)).toContain('SUMMARY')
    expect(String(values?.wrapUp)).toContain('NEXT STEPS')
    expect(String(values?.wrapUp)).toContain('DETAILS')
  })
})

describe('sync-drive-transcripts, idempotence', () => {
  it('skips a discovery call already stamped, writing no second row', async () => {
    const { handle, queries } = makeDb([
      [{ id: 'disc-1', title: 'Discovery (Tim Lyons)', scheduledAt: CALL_TIME, attendees: '[]', orgId: null, transcript: 'already here', transcriptSource: 'gemini_drive' }],
      [],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { filed: number; results: Array<{ status: string }> }
    expect(body.results[0].status).toBe('already_synced')
    expect(body.filed).toBe(0)
    expect(queries.some(q => q[0].method === 'insert')).toBe(false)
  })

  it('updates the existing row when the same doc comes round again', async () => {
    const { handle, queries } = makeDb([
      [],
      [],
      // upsert lookup finds the row filed on the previous run
      [{ id: 'ct-1', callId: null }],
    ])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await POST(request())
    const body = await res.json() as { filed: number }
    expect(body.filed).toBe(1)
    expect(queries.some(q => q[0].method === 'insert')).toBe(false)
  })
})
