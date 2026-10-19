import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest, NextResponse } from 'next/server'
import { schema, type DB } from '@/db/d1'
import type { MeetingRecordingDetail } from '@/lib/meeting-recordings-types'

const h = vi.hoisted(() => ({
  database: null as unknown,
  auth: { userId: 'liam' as string | null, orgId: 'tahi' as string | null, sessionId: 'session' },
  deniedOrg: null as string | null,
  featureDenied: false,
  isAdmin: true,
  bucket: null as unknown,
  ai: { run: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: async () => h.database }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: async () => h.auth, isTahiAdmin: (id: string) => id === 'tahi' }))
vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => h.featureDenied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrgOrPreClient: async (_db: unknown, _user: unknown, org: string | null) => org === h.deniedOrg && org !== null ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null }))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: async () => ({ kind: 'all' }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: async () => ({ isAdmin: h.isAdmin }) }))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { STORAGE: h.bucket, AI: h.ai } }) }))

import { POST as reserve, PUT as upload } from '@/app/api/admin/recordings/[id]/chunks/route'
import { POST as stop } from '@/app/api/admin/recordings/[id]/stop/route'
import { POST as transcribe } from '@/app/api/admin/recordings/[id]/transcribe/route'
import { GET as getRecording } from '@/app/api/admin/recordings/[id]/route'
import { GET as speakersGet, PATCH as speakersPatch } from '@/app/api/admin/recordings/[id]/speakers/route'
import { PATCH as linkRecording } from '@/app/api/admin/recordings/[id]/link/route'
import { POST as createRecording } from '@/app/api/admin/recordings/route'
import { MEETING_RECORDING_MIGRATION } from '@/lib/meeting-recordings-migration'
import { hashTranscript } from '@/lib/call-transcripts'
import { encodeRecordingPcmWav } from '@/lib/recording-group-audio'

interface SqlResult { results: Array<Record<string, unknown>>; success: boolean; meta: { changes: number } }
interface SqlStatement {
  bind(...params: SQLInputValue[]): SqlStatement
  execute(): SqlResult
  all(): Promise<SqlResult>
  run(): Promise<SqlResult>
  raw(): Promise<unknown[][]>
}

let sqlite: DatabaseSync
let database: DB
let objects: Map<string, { audio: ArrayBuffer; metadata: Record<string, string> }>
let puts: ReturnType<typeof vi.fn>
let failTranscript: boolean
let failLinkBatch: boolean
let failGroupBatch: boolean
let failTranscriptUpdate: boolean

function adapter(sqliteDb: DatabaseSync) {
  const prepare = (query: string): SqlStatement => {
    const bind = (...params: SQLInputValue[]): SqlStatement => {
      const execute = (): SqlResult => {
        if (failTranscript && /^INSERT INTO call_transcripts/.test(query)) { failTranscript = false; throw new Error('Injected D1 failure') }
        if (failTranscriptUpdate && /^update "call_transcripts"/i.test(query)) { failTranscriptUpdate = false; throw new Error('Injected transcript update failure') }
        if (failLinkBatch && /^update "meeting_recordings"/i.test(query) && query.includes('"call_kind"')) {
          failLinkBatch = false; throw new Error('Injected recorder link failure')
        }
        if (failGroupBatch && /^update "meeting_recording_chunks"/i.test(query) && query.includes('json_each')) {
          failGroupBatch = false; throw new Error('Injected group result D1 failure')
        }
        const statement = sqliteDb.prepare(query)
        if (/^\s*select\b|\breturning\b/i.test(query)) {
          const results = statement.all(...params) as Array<Record<string, unknown>>
          return { results, success: true, meta: { changes: /^\s*select/i.test(query) ? 0 : results.length } }
        }
        return { results: [], success: true, meta: { changes: Number(statement.run(...params).changes) } }
      }
      return { bind, execute, all: async () => execute(), run: async () => execute(), raw: async () => execute().results.map(row => Object.values(row)) }
    }
    return bind()
  }
  return {
    prepare,
    async batch(statements: SqlStatement[]) {
      sqliteDb.exec('BEGIN')
      try {
        const results = statements.map(statement => statement.execute())
        sqliteDb.exec('COMMIT')
        return results
      } catch (error) { sqliteDb.exec('ROLLBACK'); throw error }
    },
  }
}

const params = { params: Promise.resolve({ id: 'rec' }) }
const metadata = { track: 'mic', sequence: 0, startMs: 0, durationMs: 30_000, mimeType: 'audio/webm', size: 3 }
function req(path: string, body?: unknown, method = 'POST', cookie?: string) {
  return new NextRequest(`http://localhost/api/admin/recordings/rec/${path}`, {
    method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MEETING_RECORDING_MIGRATION.join(';'))
  sqlite.exec(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0105_call_transcripts.sql'), 'utf8'))
  sqlite.exec(`ALTER TABLE call_transcripts ADD COLUMN suggested_at text;
    CREATE TABLE organisations (id text PRIMARY KEY, name text);
    CREATE TABLE task_suggestions (id text, transcript_id text);
    CREATE TABLE team_members (id text PRIMARY KEY, clerk_user_id text, name text, email text);
    CREATE TABLE contacts (id text PRIMARY KEY, org_id text, name text);
    CREATE TABLE scheduled_calls (id text PRIMARY KEY,org_id text,attendees text DEFAULT '[]');
    CREATE TABLE discovery_calls (id text PRIMARY KEY,org_id text,attendees text DEFAULT '[]', transcript text, transcript_source text, updated_at text);`)
  sqlite.exec("INSERT INTO organisations VALUES ('client-a', 'Acme'), ('client-b', 'Beta')")
  sqlite.exec("INSERT INTO team_members VALUES ('member-liam','liam','Liam Miller','business@tahi.studio'), ('member-staci','staci','Staci Miller','staci@tahi.studio')")
  sqlite.exec("INSERT INTO meeting_recordings (id,title,org_id,created_by_id,tracks,state,started_at,created_at,updated_at) VALUES ('rec','A call','client-a','liam','[\"mic\",\"system\"]','recording','2026-10-13T00:00:00Z','2026-10-13T00:00:00Z','2026-10-13T00:00:00Z')")
  database = drizzle(adapter(sqlite) as unknown as AnyD1Database, { schema })
  h.database = database
  h.auth = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
  h.featureDenied = false
  h.isAdmin = true
  h.deniedOrg = null
  objects = new Map()
  failTranscript = false
  failLinkBatch = false
  failGroupBatch = false
  failTranscriptUpdate = false
  puts = vi.fn(async (key: string, value: ArrayBuffer | string, options: { onlyIf?: R2Conditional; customMetadata?: Record<string, string> }) => {
    if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null
    const audio = typeof value === 'string' ? new TextEncoder().encode(value).buffer : value
    objects.set(key, { audio, metadata: options.customMetadata ?? {} })
    return { key }
  })
  h.bucket = {
    put: puts,
    head: async (key: string) => objects.has(key) ? { size: objects.get(key)!.audio.byteLength, customMetadata: objects.get(key)!.metadata } : null,
    get: async (key: string) => objects.has(key) ? { size: objects.get(key)!.audio.byteLength, arrayBuffer: async () => objects.get(key)!.audio } : null,
    delete: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) objects.delete(key) },
  }
  h.ai.run.mockReset().mockResolvedValue({ text: 'Hello', segments: [{ start: 0, end: 1, text: 'Hello' }] })
})

afterEach(() => { sqlite.close(); vi.restoreAllMocks(); vi.useRealTimers() })

const REMOTE = 'Thanks for joining everyone so today we want to walk through the pricing page and the onboarding flow'
const word = (start: number, text: string, speaker: number) => text.split(' ').map((token, index) => ({
  start: start + index * 0.3, end: start + index * 0.3 + 0.25, text: token, speaker,
}))

/** A stopped, fully transcribed pair of tracks ready for finalisation, including mic echo of the remote voice. */
function seedTranscribedChunks(id = 'rec') {
  const now = '2026-10-13T00:00:00Z'
  sqlite.prepare("UPDATE meeting_recordings SET stopped_at = ?, duration_ms = 60000, expected_chunks = ?, state = 'transcribing' WHERE id = ?")
    .run(now, JSON.stringify({ mic: 1, system: 1 }), id)
  const insert = sqlite.prepare(`INSERT INTO meeting_recording_chunks
    (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,text,segments,attempts,uploaded_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const system = [...word(10, REMOTE, 0), ...word(30, 'Happy to help with that', 1)]
  insert.run(`${id}_system_0`, id, 'system', 0, 0, 60_000, 'audio/wav', 4, `k/${id}/s`, 't1', 'ready', 'remote', JSON.stringify(system), 1, now, now, now)
  const mic = [
    { start: 10.9, end: 16, text: `${REMOTE}.` },
    { start: 20, end: 23, text: 'Can you show me the pricing page first' },
  ]
  insert.run(`${id}_mic_0`, id, 'mic', 0, 0, 60_000, 'audio/wav', 4, `k/${id}/m`, 't2', 'ready', 'mine', JSON.stringify(mic), 1, now, now, now)
}

async function finalise(id = 'rec') {
  const response = await transcribe(req('transcribe'), { params: Promise.resolve({ id }) })
  expect(response.status).toBe(200)
  return response.json() as Promise<MeetingRecordingDetail>
}

const patch = (body: unknown, cookie?: string) => speakersPatch(req('speakers', body, 'PATCH', cookie), params)
const transcriptRow = () => sqlite.prepare('SELECT text,hash FROM call_transcripts').get() as { text: string; hash: string }
const rawChunks = () => sqlite.prepare('SELECT id,text,segments,state FROM meeting_recording_chunks ORDER BY id').all()

describe('echo removal on every render', () => {
  it('files an echo-free transcript and re-renders a legacy transcript that still holds the echo', async () => {
    seedTranscribedChunks()
    const ready = await finalise()
    expect(ready.recording.state).toBe('ready')
    expect(ready.transcript.text).toBe([
      `[00:10] Them 1: ${REMOTE}`,
      '[00:20] Liam Miller: Can you show me the pricing page first',
      '[00:30] Them 2: Happy to help with that',
    ].join('\n'))
    // A transcript filed before echo removal existed still has the duplicate under the user's name.
    sqlite.prepare("UPDATE call_transcripts SET text = ?, hash = 'old'").run(`[00:10] Them 1: ${REMOTE}\n[00:11] Liam Miller: ${REMOTE}.`)
    const rerendered = await finalise()
    expect(rerendered.transcript.text).toBe(ready.transcript.text)
    expect(transcriptRow()).toEqual({ text: ready.transcript.text, hash: hashTranscript(ready.transcript.text) })
    expect(h.ai.run).not.toHaveBeenCalled()
  })
})

describe('renaming speakers after transcription', () => {
  it('stores the map in the recording options, re-renders every copy and leaves audio results untouched', async () => {
    seedTranscribedChunks()
    sqlite.prepare('INSERT INTO discovery_calls (id,org_id,attendees) VALUES (?, ?, ?)').run('discovery-a', 'client-a', '[]')
    const before = (await finalise()).transcript.text
    expect((await linkRecording(req('link', { callKind: 'discovery', callId: 'discovery-a' }, 'PATCH'), params)).status).toBe(200)
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: before })
    const raw = rawChunks()

    const response = await patch({ speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' } })
    expect(response.status).toBe(200)
    const detail = await response.json() as MeetingRecordingDetail
    const expected = [
      `[00:10] Michael Day: ${REMOTE}`,
      '[00:20] Liam: Can you show me the pricing page first',
      '[00:30] Them 2: Happy to help with that',
    ].join('\n')
    expect(detail.transcript.text).toBe(expected)
    expect(detail.recording.speakerNames).toEqual({ mic: 'Liam', 'system:0': 'Michael Day' })
    expect(detail.speakers).toEqual([
      { key: 'mic', track: 'mic', defaultLabel: 'Liam Miller', label: 'Liam', custom: true },
      { key: 'system:0', track: 'system', defaultLabel: 'Them 1', label: 'Michael Day', custom: true },
      { key: 'system:1', track: 'system', defaultLabel: 'Them 2', label: 'Them 2', custom: false },
    ])
    expect(JSON.parse(String(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()?.tracks))).toEqual({
      version: 1, tracks: ['mic', 'system'], separateSpeakers: false, speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' },
    })
    expect(transcriptRow()).toEqual({ text: expected, hash: hashTranscript(expected) })
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: expected })
    expect(rawChunks()).toEqual(raw)
    expect(h.ai.run).not.toHaveBeenCalled()

    // The names survive a refresh, a re-link and a second read.
    expect((await finalise()).transcript.text).toBe(expected)
    const relinked = await (await linkRecording(req('link', { callKind: 'discovery', callId: 'discovery-a' }, 'PATCH'), params)).json() as MeetingRecordingDetail
    expect(relinked.transcript.text).toBe(expected)
    expect((await (await getRecording(req(''), params)).json() as MeetingRecordingDetail).recording.speakerNames).toEqual({ mic: 'Liam', 'system:0': 'Michael Day' })
  })

  it('merges partial renames and resets a voice with null, returning to the plain legacy options when empty', async () => {
    seedTranscribedChunks()
    await finalise()
    await patch({ speakerNames: { mic: 'Liam' } })
    const second = await (await patch({ speakerNames: { 'system:1': 'Priya' } })).json() as MeetingRecordingDetail
    expect(second.recording.speakerNames).toEqual({ mic: 'Liam', 'system:1': 'Priya' })
    expect(second.transcript.text).toContain('Liam: Can you show me')
    expect(second.transcript.text).toContain('Priya: Happy to help')
    await patch({ speakerNames: { mic: null, 'system:1': '   ' } })
    const reset = await (await getRecording(req(''), params)).json() as MeetingRecordingDetail
    expect(reset.recording.speakerNames).toEqual({})
    expect(reset.transcript.text).toContain('Liam Miller: Can you show me')
    expect(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()).toEqual({ tracks: '["mic","system"]' })
  })

  it('keeps a human edit on the discovery call and never writes a name that could forge a line', async () => {
    seedTranscribedChunks()
    sqlite.prepare('INSERT INTO discovery_calls (id,org_id,attendees) VALUES (?, ?, ?)').run('discovery-a', 'client-a', '[]')
    await finalise()
    await linkRecording(req('link', { callKind: 'discovery', callId: 'discovery-a' }, 'PATCH'), params)
    sqlite.prepare("UPDATE discovery_calls SET transcript = 'Human correction'").run()
    const detail = await (await patch({ speakerNames: { mic: 'Liam\n[99] Michael Day  fake' } })).json() as MeetingRecordingDetail
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: 'Human correction' })
    expect(detail.transcript.text.split('\n')).toHaveLength(3)
    expect(detail.recording.speakerNames?.mic).toBe('Liam [99] Michael Day fake')
  })

  it('refuses to rename before the transcript is ready, like linking does', async () => {
    seedTranscribedChunks()
    const before = sqlite.prepare('SELECT tracks FROM meeting_recordings').get()
    const early = await patch({ speakerNames: { mic: 'Liam' } })
    expect(early.status).toBe(409)
    expect(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()).toEqual(before)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
  })

  it('refuses a colon in a name so it cannot fake a timestamped line', async () => {
    seedTranscribedChunks()
    await finalise()
    for (const name of ['Liam: hi', '[00:01] Michael Day: fake', ':']) {
      expect((await patch({ speakerNames: { mic: name } })).status, name).toBe(400)
    }
    expect(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()).toEqual({ tracks: '["mic","system"]' })
  })

  it('rejects malformed requests without changing anything', async () => {
    seedTranscribedChunks()
    await finalise()
    const before = sqlite.prepare('SELECT tracks,updated_at FROM meeting_recordings').get()
    for (const body of [null, {}, { speakerNames: null }, { speakerNames: [] }, { speakerNames: {} }, { speakerNames: { Me: 'x' } },
      { speakerNames: { 'system:abc': 'x' } }, { speakerNames: { mic: 7 } }, { speakerNames: { mic: 'x'.repeat(501) } }]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect(sqlite.prepare('SELECT tracks,updated_at FROM meeting_recordings').get()).toEqual(before)
    expect((await speakersPatch(new NextRequest('http://localhost/api/admin/recordings/rec/speakers', { method: 'PATCH', body: '{bad' }), params)).status).toBe(400)
    expect((await speakersPatch(req('speakers', { speakerNames: { mic: 'x' } }, 'PATCH'), { params: Promise.resolve({ id: 'missing' }) })).status).toBe(404)
  })

  it('bounds names to 80 characters on one line', async () => {
    seedTranscribedChunks()
    await finalise()
    const detail = await (await patch({ speakerNames: { mic: `  ${'A'.repeat(200)}  ` } })).json() as MeetingRecordingDetail
    expect(detail.recording.speakerNames?.mic).toBe('A'.repeat(80))
  })

  it('follows the same access rules as the other recording routes', async () => {
    seedTranscribedChunks()
    await finalise()
    const before = sqlite.prepare('SELECT tracks FROM meeting_recordings').get()
    h.auth.userId = null
    expect((await patch({ speakerNames: { mic: 'x' } })).status).toBe(401)
    expect((await speakersGet(req('speakers', undefined, 'GET'), params)).status).toBe(401)
    h.auth.userId = 'client'; h.auth.orgId = 'client-org'
    expect((await patch({ speakerNames: { mic: 'x' } })).status).toBe(403)
    h.auth.userId = 'liam'; h.auth.orgId = 'tahi'
    expect((await patch({ speakerNames: { mic: 'x' } }, 'tahi-impersonate-org=client-a')).status).toBe(403)
    h.featureDenied = true
    expect((await patch({ speakerNames: { mic: 'x' } })).status).toBe(403)
    h.featureDenied = false
    h.deniedOrg = 'client-a'
    expect((await patch({ speakerNames: { mic: 'x' } })).status).toBe(403)
    expect((await speakersGet(req('speakers', undefined, 'GET'), params)).status).toBe(403)
    expect(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()).toEqual(before)
  })

  it('refuses while another action holds the recording, rather than racing it', async () => {
    seedTranscribedChunks()
    await finalise()
    sqlite.prepare("UPDATE meeting_recordings SET lease_token = 'other', lease_until = ?").run(new Date(Date.now() + 60_000).toISOString())
    const response = await patch({ speakerNames: { mic: 'x' } })
    expect(response.status).toBe(409)
  })

  it('rolls back the map when the transcript write fails', async () => {
    seedTranscribedChunks()
    await finalise()
    const before = sqlite.prepare('SELECT tracks FROM meeting_recordings').get()
    const textBefore = transcriptRow()
    failTranscriptUpdate = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await patch({ speakerNames: { mic: 'Liam' } })).status).toBe(503)
    expect(sqlite.prepare('SELECT tracks FROM meeting_recordings').get()).toEqual(before)
    expect(transcriptRow()).toEqual(textBefore)
  })

  it('keeps the names when speaker separation falls back to Whisper', async () => {
    const created = await createRecording(req('', { title: 'Group', tracks: ['mic', 'system'], orgId: 'client-a', separateSpeakers: true }))
    const { recording } = await created.json() as MeetingRecordingDetail
    const groupParams = { params: Promise.resolve({ id: recording.id }) }
    expect((await speakersPatch(req('speakers', { speakerNames: { mic: 'x' } }, 'PATCH'), groupParams)).status).toBe(409)
    // Renames need a finished transcript, so seed the saved map the way an earlier rename would have.
    sqlite.prepare('UPDATE meeting_recordings SET tracks = ? WHERE id = ?').run(JSON.stringify({
      version: 1, tracks: ['mic', 'system'], separateSpeakers: true, speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' },
    }), recording.id)
    const audio = encodeRecordingPcmWav(new Float32Array(16_000).fill(0.1))
    const mic = await (await reserve(req('chunks', { ...metadata, durationMs: 1000 }), groupParams)).json() as { uploadUrl: string }
    expect((await upload(new NextRequest(`http://localhost${mic.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), groupParams)).status).toBe(200)
    const system = await (await reserve(req('chunks', { track: 'system', sequence: 0, startMs: 0, durationMs: 1000, mimeType: 'audio/wav', size: audio.byteLength }), groupParams)).json() as { uploadUrl: string }
    expect((await upload(new NextRequest(`http://localhost${system.uploadUrl}`, { method: 'PUT', body: audio }), groupParams)).status).toBe(200)
    expect((await stop(req('stop', { expectedChunks: { mic: 1, system: 1 }, durationMs: 1000 }), groupParams)).status).toBe(200)
    h.ai.run.mockResolvedValue({ text: 'Spoken', segments: [{ start: 0, end: 0.5, text: 'Spoken' }] })
    const fallback = await transcribe(req('transcribe', { separateSpeakers: false }), groupParams)
    expect(fallback.status).toBe(200)
    expect((await fallback.json() as MeetingRecordingDetail).recording).toMatchObject({ separateSpeakers: false, speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' } })
    expect(JSON.parse(String(sqlite.prepare('SELECT tracks FROM meeting_recordings WHERE id = ?').get(recording.id)?.tracks))).toMatchObject({
      separateSpeakers: false, speakerNames: { mic: 'Liam', 'system:0': 'Michael Day' },
    })
  })
})

describe('speaker name suggestions', () => {
  it('offers team members, the linked call attendees and the client contacts once each', async () => {
    seedTranscribedChunks()
    await finalise()
    sqlite.prepare('INSERT INTO scheduled_calls (id,org_id,attendees) VALUES (?, ?, ?)').run('call-a', 'client-a', JSON.stringify([
      { name: 'Michael Day', email: 'michael@giant.example' }, { name: 'liam miller' }, { email: 'no-name@example.com' },
    ]))
    sqlite.prepare("UPDATE meeting_recordings SET call_kind = 'scheduled', call_id = 'call-a'").run()
    sqlite.exec("INSERT INTO contacts VALUES ('c1','client-a','Mark Ramsey'), ('c2','client-a','Michael Day'), ('c3','client-b','Other Client Person')")
    const response = await speakersGet(req('speakers', undefined, 'GET'), params)
    expect(response.status).toBe(200)
    const body = await response.json() as { speakers: Array<{ key: string }>; options: Array<{ name: string; kind: string }> }
    expect(body.speakers.map(speaker => speaker.key)).toEqual(['mic', 'system:0', 'system:1'])
    expect(body.options).toEqual([
      { name: 'Liam Miller', kind: 'team' }, { name: 'Staci Miller', kind: 'team' },
      { name: 'Michael Day', kind: 'attendee' }, { name: 'Mark Ramsey', kind: 'contact' },
    ])
  })

  it('returns an empty list rather than failing for an unlinked recording', async () => {
    sqlite.prepare('UPDATE meeting_recordings SET org_id = NULL').run()
    const body = await (await speakersGet(req('speakers', undefined, 'GET'), params)).json() as { speakers: unknown[]; options: Array<{ kind: string }> }
    expect(body.speakers).toEqual([])
    expect(body.options.every(option => option.kind === 'team')).toBe(true)
  })
})
