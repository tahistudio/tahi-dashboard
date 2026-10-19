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
import { GET as getRecording, DELETE as deleteRecording } from '@/app/api/admin/recordings/[id]/route'
import { GET as getTranscript } from '@/app/api/admin/call-transcripts/[id]/route'
import { PATCH as linkRecording } from '@/app/api/admin/recordings/[id]/link/route'
import { POST as createRecording } from '@/app/api/admin/recordings/route'
import { MEETING_RECORDING_MIGRATION } from '@/lib/meeting-recordings-migration'
import { hashTranscript } from '@/lib/call-transcripts'
import { RECORDING_MODEL } from '@/lib/meeting-recordings'
import { encodeRecordingPcmWav, MAX_RECORDING_GROUP_DURATION_MS, parseRecordingPcmWav, RECORDING_GROUP_MODEL } from '@/lib/recording-group-audio'

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

function adapter(sqliteDb: DatabaseSync) {
  const prepare = (query: string): SqlStatement => {
    const bind = (...params: SQLInputValue[]): SqlStatement => {
      const execute = (): SqlResult => {
        if (failTranscript && /^INSERT INTO call_transcripts/.test(query)) { failTranscript = false; throw new Error('Injected D1 failure') }
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
async function reserveAndUpload(track = 'mic', sequence = 0) {
  const reserved = await reserve(req('chunks', { ...metadata, track, sequence, startMs: sequence * 30_000 }), params)
  const body = await reserved.json() as { uploadUrl: string }
  const result = await upload(new NextRequest(`http://localhost${body.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), params)
  expect(result.status).toBe(200)
  return body.uploadUrl
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MEETING_RECORDING_MIGRATION.join(';'))
  sqlite.exec(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0105_call_transcripts.sql'), 'utf8'))
  sqlite.exec(`ALTER TABLE call_transcripts ADD COLUMN suggested_at text;
    CREATE TABLE organisations (id text PRIMARY KEY, name text);
    CREATE TABLE task_suggestions (id text, transcript_id text);
    CREATE TABLE team_members (id text PRIMARY KEY, clerk_user_id text, name text, email text);
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
  // The microphone and system tracks must say different things here: identical words at the same instant are speaker bleed and are removed.
  let aiCall = 0
  h.ai.run.mockReset().mockImplementation(async () => {
    aiCall += 1
    const text = aiCall % 2 ? 'Hello' : 'Welcome'
    return { text, segments: [{ start: 0, end: 1, text }] }
  })
})

afterEach(() => { sqlite.close(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('recording speaker separation option', () => {
  it('defaults to off and stores an explicit opt-in without a schema change', async () => {
    const ordinary = await createRecording(req('', { title: 'Ordinary call', tracks: ['mic', 'system'], orgId: 'client-a' }))
    expect(ordinary.status).toBe(201)
    expect(await ordinary.json()).toMatchObject({ recording: { separateSpeakers: false, tracks: ['mic', 'system'] } })
    const group = await createRecording(req('', { title: 'Group call', tracks: ['mic', 'system'], orgId: 'client-a', separateSpeakers: true }))
    expect(group.status).toBe(201)
    const body = await group.json() as { recording: { id: string; separateSpeakers: boolean } }
    expect(body.recording.separateSpeakers).toBe(true)
    const row = sqlite.prepare('SELECT tracks FROM meeting_recordings WHERE id = ?').get(body.recording.id)
    expect(JSON.parse(String(row?.tracks))).toMatchObject({ version: 1, separateSpeakers: true })
  })

  it('rejects mic-only separation and untyped opt-in values', async () => {
    expect((await createRecording(req('', { title: 'Mic only', tracks: ['mic'], separateSpeakers: true }))).status).toBe(400)
    expect((await createRecording(req('', { title: 'Invalid option', tracks: ['mic', 'system'], separateSpeakers: 'true' }))).status).toBe(400)
  })
})

describe('recording chunks route guards and uniqueness', () => {
  it('requires authentication, studio membership and the calls feature', async () => {
    h.auth.userId = null
    expect((await reserve(req('chunks', metadata), params)).status).toBe(401)
    h.auth.userId = 'client'; h.auth.orgId = 'client-org'
    expect((await reserve(req('chunks', metadata), params)).status).toBe(403)
    h.auth.orgId = 'tahi'; h.featureDenied = true
    expect((await reserve(req('chunks', metadata), params)).status).toBe(403)
    expect(puts).not.toHaveBeenCalled()
  })

  it('rejects client preview and inaccessible recording orgs before storing audio', async () => {
    expect((await reserve(req('chunks', metadata, 'POST', 'tahi-impersonate-org=client-a'), params)).status).toBe(403)
    h.deniedOrg = 'client-a'
    expect((await reserve(req('chunks', metadata), params)).status).toBe(403)
    expect(puts).not.toHaveBeenCalled()
  })

  it('reuses reservations but never writes a committed sequence twice', async () => {
    const first = await reserve(req('chunks', metadata), params)
    const firstBody = await first.json() as { uploadUrl: string }
    const duplicate = await reserve(req('chunks', metadata), params)
    expect(await duplicate.json()).toMatchObject({ uploadUrl: firstBody.uploadUrl, duplicate: true, uploaded: false })
    const putReq = () => new NextRequest(`http://localhost${firstBody.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) })
    expect((await upload(putReq(), params)).status).toBe(200)
    const again = await upload(putReq(), params)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ duplicate: true, uploaded: true })
    expect(puts).toHaveBeenCalledTimes(1)
    expect(puts.mock.calls[0][2].onlyIf).toEqual({ etagDoesNotMatch: '*' })
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks').all()).toHaveLength(1)
    expect((await reserve(req('chunks', { ...metadata, size: 4 }), params)).status).toBe(409)
  })

  it('settles concurrent reservation retries with the database lease and unique key', async () => {
    const responses = await Promise.all([reserve(req('chunks', metadata), params), reserve(req('chunks', metadata), params)])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks').all()).toHaveLength(1)
  })

  it('acknowledges audio retained in R2 after its D1 upload acknowledgement failed', async () => {
    const uploadUrl = await reserveAndUpload()
    const [key, saved] = [...objects.entries()][0]
    sqlite.prepare("UPDATE meeting_recording_chunks SET state='reserved', uploaded_at=NULL").run()
    const response = await upload(new NextRequest(`http://localhost${uploadUrl}`, { method: 'PUT', body: Uint8Array.from([4, 5, 6]) }), params)
    expect(response.status).toBe(200)
    expect(objects.get(key)).toBe(saved)
    expect(sqlite.prepare('SELECT state, uploaded_at FROM meeting_recording_chunks').get()).toMatchObject({ state: 'uploaded', uploaded_at: expect.any(String) })
  })

  it('refuses an existing R2 object owned by a different reservation without overwriting it', async () => {
    const reserved = await reserve(req('chunks', metadata), params)
    const { uploadUrl } = await reserved.json() as { uploadUrl: string }
    const key = 'meeting-recordings/rec/mic/0.audio'
    const saved = { audio: Uint8Array.from([7, 8, 9]).buffer, metadata: { uploadToken: 'different-reservation' } }
    objects.set(key, saved)
    const response = await upload(new NextRequest(`http://localhost${uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), params)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Saved audio does not match this chunk reservation.' })
    expect(objects.get(key)).toBe(saved)
    expect(sqlite.prepare('SELECT state, uploaded_at FROM meeting_recording_chunks').get()).toMatchObject({ state: 'reserved', uploaded_at: null })
  })

  it('rejects forged upload tokens and over-limit metadata', async () => {
    await reserve(req('chunks', metadata), params)
    expect((await upload(new NextRequest('http://localhost/api/admin/recordings/rec/chunks?track=mic&sequence=0&token=forged', { method: 'PUT', body: 'abc' }), params)).status).toBe(404)
    expect((await reserve(req('chunks', { ...metadata, size: 2 * 1024 * 1024 + 1 }), params)).status).toBe(400)
    expect(puts).not.toHaveBeenCalled()
  })

  it('does not finalize a two-track recording with no system audio', async () => {
    await reserveAndUpload()
    expect((await stop(req('stop', { expectedChunks: { mic: 1, system: 0 }, durationMs: 30_000 }), params)).status).toBe(400)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
  })

  it('requires an administrator to delete retained audio and permits orphan cleanup', async () => {
    await reserveAndUpload()
    h.isAdmin = false
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(403)
    expect(objects.size).toBe(1)
    h.isAdmin = true
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(200)
    expect(objects.size).toBe(0)
    expect((await reserve(req('chunks', metadata), params)).status).toBe(410)
  })

  it('removes an upload that returns from R2 after deletion has taken its expired lease', async () => {
    const reserved = await reserve(req('chunks', metadata), params)
    const body = await reserved.json() as { uploadUrl: string }
    let resumePut: (() => void) | undefined
    let enteredPut: (() => void) | undefined
    const entered = new Promise<void>(resolve => { enteredPut = resolve })
    const paused = new Promise<void>(resolve => { resumePut = resolve })
    puts.mockImplementationOnce(async (key: string, audio: ArrayBuffer, options: { customMetadata: Record<string, string> }) => {
      enteredPut?.(); await paused
      objects.set(key, { audio, metadata: options.customMetadata })
      return { key }
    })
    const uploading = upload(new NextRequest(`http://localhost${body.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), params)
    await entered
    sqlite.prepare("UPDATE meeting_recordings SET lease_until='2020-01-01T00:00:00Z'").run()
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(200)
    resumePut?.()
    expect((await uploading).status).toBe(409)
    expect(objects.size).toBe(0)
    expect(sqlite.prepare('SELECT deleted_at FROM meeting_recordings').get()).toMatchObject({ deleted_at: expect.any(String) })
  })

  it('deletes retained Nova JSON even when no audio chunks remain', async () => {
    const key = 'meeting-recordings/rec/system/nova-3.json'
    objects.set(key, { audio: new TextEncoder().encode('{}').buffer, metadata: {} })
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks').all()).toHaveLength(0)
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(200)
    expect(objects.has(key)).toBe(false)
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(200)
  })
})

describe('recording transcription recovery', () => {
  async function stoppedTwoTracks() {
    await reserveAndUpload('mic')
    await reserveAndUpload('system')
    const stopped = await stop(req('stop', { expectedChunks: { mic: 1, system: 1 }, durationMs: 30_000 }), params)
    expect(stopped.status).toBe(200)
  }

  it('keeps the three-minute lease for ordinary Whisper transcription', async () => {
    await stoppedTwoTracks()
    vi.useFakeTimers()
    const leaseDurations: number[] = []
    h.ai.run.mockImplementation(async () => {
      const row = sqlite.prepare('SELECT lease_until FROM meeting_recordings WHERE id = ?').get('rec')
      leaseDurations.push(new Date(String(row?.lease_until)).getTime() - Date.now())
      return { text: 'Hello', segments: [{ start: 0, end: 1, text: 'Hello' }] }
    })
    await transcribe(req('transcribe'), params)
    await transcribe(req('transcribe'), params)
    expect(leaseDurations).toEqual([3 * 60_000, 3 * 60_000])
  })

  it('preserves successful chunks, retries only a failed chunk and files one transcript', async () => {
    await stoppedTwoTracks()
    h.ai.run.mockResolvedValueOnce({ text: 'Liam first', segments: [{ start: 1, end: 2, text: 'Liam first' }] })
    const first = await transcribe(req('transcribe'), params)
    expect((await first.json() as MeetingRecordingDetail).pending).toBe(true)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
    h.ai.run.mockRejectedValueOnce(new Error('Temporary AI failure'))
    const failed = await transcribe(req('transcribe'), params)
    const failedDetail = await failed.json() as MeetingRecordingDetail
    expect(failedDetail.recording.state).toBe('failed')
    expect(failedDetail.chunks.filter(chunk => chunk.state === 'ready')).toHaveLength(1)
    h.ai.run.mockResolvedValueOnce({ text: 'Them later', segments: [{ start: 4, end: 5, text: 'Them later' }] })
    const recovered = await transcribe(req('transcribe'), params)
    const ready = await recovered.json() as MeetingRecordingDetail
    expect(ready.recording.state).toBe('ready')
    expect(ready.transcript.text).toBe('[00:01] Liam Miller: Liam first\n[00:04] Them (Acme): Them later')
    expect(ready.transcript.id).toBe('rec')
    await transcribe(req('transcribe'), params)
    expect(h.ai.run).toHaveBeenCalledTimes(3)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
  })

  it('retries final transcript save without transcribing any successful chunk again', async () => {
    await stoppedTwoTracks()
    await transcribe(req('transcribe'), params)
    failTranscript = true
    const failed = await transcribe(req('transcribe'), params)
    const detail = await failed.json() as MeetingRecordingDetail
    expect(detail.recording.state).toBe('failed')
    expect(detail.chunks.every(chunk => chunk.state === 'ready')).toBe(true)
    expect((await (await transcribe(req('transcribe'), params)).json() as MeetingRecordingDetail).recording.state).toBe('ready')
    expect(h.ai.run).toHaveBeenCalledTimes(2)
  })

  it('recovers an expired lease and preserves client scoping after audio deletion', async () => {
    await stoppedTwoTracks()
    sqlite.prepare("UPDATE meeting_recordings SET lease_token='crashed',lease_until='2020-01-01T00:00:00Z'").run()
    await transcribe(req('transcribe'), params)
    await transcribe(req('transcribe'), params)
    expect((await deleteRecording(req('', undefined, 'DELETE'), params)).status).toBe(200)
    expect(objects.size).toBe(0)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
    h.deniedOrg = 'client-a'
    expect((await getRecording(req('', undefined, 'GET'), params)).status).toBe(403)
    expect((await getTranscript(req('', undefined, 'GET'), params)).status).toBe(403)
    h.deniedOrg = null; h.featureDenied = true
    expect((await getTranscript(req('', undefined, 'GET'), params)).status).toBe(403)
  })

  it('refuses changing the client after suggestions have read its transcript', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    sqlite.prepare("UPDATE call_transcripts SET suggested_at='2026-10-13T00:01:00Z'").run()
    const linked = await linkRecording(req('link', { orgId: 'client-b' }, 'PATCH'), params)
    expect(linked.status).toBe(409)
    expect(sqlite.prepare('SELECT org_id FROM meeting_recordings').get()).toEqual({ org_id: 'client-a' })
  })

  it('keeps an explicitly chosen client immutable but allows attaching its real call', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    expect((await linkRecording(req('link', { orgId: 'client-b' }, 'PATCH'), params)).status).toBe(409)
    sqlite.prepare("INSERT INTO scheduled_calls (id,org_id) VALUES ('call-a','client-a')").run()
    const linked = await linkRecording(req('link', { callKind: 'scheduled', callId: 'call-a' }, 'PATCH'), params)
    expect(linked.status).toBe(200)
    expect(sqlite.prepare('SELECT org_id,call_id FROM meeting_recordings').get()).toEqual({ org_id: 'client-a', call_id: 'call-a' })
    expect(sqlite.prepare('SELECT call_kind,call_id FROM call_transcripts').get()).toEqual({ call_kind: 'scheduled', call_id: 'call-a' })
  })

  it('rolls back the transcript link if its recording identity write fails', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    sqlite.prepare("INSERT INTO scheduled_calls (id,org_id) VALUES ('call-a','client-a')").run()
    failLinkBatch = true
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect((await linkRecording(req('link', { callKind: 'scheduled', callId: 'call-a' }, 'PATCH'), params)).status).toBe(503)
    expect(sqlite.prepare('SELECT org_id,call_id FROM meeting_recordings').get()).toEqual({ org_id: 'client-a', call_id: null })
    expect(sqlite.prepare('SELECT call_kind,call_id FROM call_transcripts').get()).toEqual({ call_kind: null, call_id: null })
  })

  it('refreshes speaker names and the stored suggester input when linking a ready recording', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    const raw = sqlite.prepare('SELECT text,segments FROM meeting_recording_chunks ORDER BY id').all()
    sqlite.prepare('INSERT INTO scheduled_calls (id,org_id,attendees) VALUES (?, ?, ?)').run('call-a', 'client-a', JSON.stringify([
      { id: 'member-liam', type: 'team_member', name: 'Liam Miller' },
      { id: 'contact-a', type: 'contact', name: 'Michael Day', email: 'michael@giant.example' },
    ]))
    const linked = await linkRecording(req('link', { callKind: 'scheduled', callId: 'call-a' }, 'PATCH'), params)
    expect(linked.status).toBe(200)
    const detail = await linked.json() as MeetingRecordingDetail
    expect(detail.transcript.text).toBe('[00:00] Liam Miller: Hello\n[00:00] Michael Day: Welcome')
    expect(sqlite.prepare('SELECT text,hash FROM call_transcripts').get()).toEqual({ text: detail.transcript.text, hash: hashTranscript(detail.transcript.text) })
    expect(sqlite.prepare('SELECT text,segments FROM meeting_recording_chunks ORDER BY id').all()).toEqual(raw)
    await linkRecording(req('link', { orgId: 'client-a' }, 'PATCH'), params)
    expect(sqlite.prepare('SELECT text FROM call_transcripts').get()).toEqual({ text: '[00:00] Liam Miller: Hello\n[00:00] Them (Acme): Welcome' })
    expect(h.ai.run).toHaveBeenCalledTimes(2)
  })

  it('re-merges a finished legacy transcript deterministically without another AI call', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    sqlite.prepare("UPDATE call_transcripts SET text='[00:00] Liam: old text', hash='old'").run()
    const first = await transcribe(req('transcribe'), params)
    const second = await transcribe(req('transcribe'), params)
    const once = await first.json() as MeetingRecordingDetail
    const twice = await second.json() as MeetingRecordingDetail
    expect(once.transcript.text).toBe('[00:00] Liam Miller: Hello\n[00:00] Them (Acme): Welcome')
    expect(twice.transcript).toEqual(once.transcript)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
    expect(h.ai.run).toHaveBeenCalledTimes(2)
  })

  it('names the microphone from its creator rather than the teammate viewing or retrying it', async () => {
    sqlite.prepare("UPDATE meeting_recordings SET created_by_id='staci'").run()
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    expect(sqlite.prepare('SELECT text FROM call_transcripts').get()).toEqual({ text: '[00:00] Staci Miller: Hello\n[00:00] Them (Acme): Welcome' })
    sqlite.prepare("UPDATE meeting_recordings SET created_by_id='missing-member'").run()
    expect((await transcribe(req('transcribe'), params)).status).toBe(200)
    expect(sqlite.prepare('SELECT text FROM call_transcripts').get()).toEqual({ text: '[00:00] Me: Hello\n[00:00] Them (Acme): Welcome' })
    expect(h.ai.run).toHaveBeenCalledTimes(2)
  })

  it('re-renders the recorder-owned discovery mirror but preserves independently edited text', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    const attendees = JSON.stringify([{ name: 'Michael Day', email: 'michael@giant.example' }])
    sqlite.prepare('INSERT INTO discovery_calls (id,org_id,attendees) VALUES (?, ?, ?)').run('discovery-a', 'client-a', attendees)
    const body = { callKind: 'discovery', callId: 'discovery-a' }
    const first = await linkRecording(req('link', body, 'PATCH'), params)
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ mirrored: true })
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: '[00:00] Liam Miller: Hello\n[00:00] Michael Day: Welcome' })
    sqlite.prepare('UPDATE discovery_calls SET attendees = ?').run(JSON.stringify([{ name: 'Mark Ramsey', email: 'mark@giant.example' }]))
    expect((await linkRecording(req('link', body, 'PATCH'), params)).status).toBe(200)
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: '[00:00] Liam Miller: Hello\n[00:00] Mark Ramsey: Welcome' })
    sqlite.prepare("UPDATE discovery_calls SET transcript='Human correction'").run()
    const again = await linkRecording(req('link', body, 'PATCH'), params)
    expect(await again.json()).toMatchObject({ mirrored: false })
    expect(sqlite.prepare('SELECT transcript FROM discovery_calls').get()).toEqual({ transcript: 'Human correction' })
  })
})

describe('whole-system group recording transcription', () => {
  async function groupRecording() {
    const created = await createRecording(req('', { title: 'Group call', tracks: ['mic', 'system'], orgId: 'client-a', separateSpeakers: true }))
    expect(created.status).toBe(201)
    const { recording } = await created.json() as MeetingRecordingDetail
    return { id: recording.id, params: { params: Promise.resolve({ id: recording.id }) } }
  }

  async function stoppedGroup(gapMs = 0, systemChunkSeconds = 30) {
    const group = await groupRecording()
    const mic = await reserve(req('chunks', metadata), group.params)
    expect(mic.status).toBe(200)
    const micBody = await mic.json() as { uploadUrl: string }
    expect((await upload(new NextRequest(`http://localhost${micBody.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), group.params)).status).toBe(200)
    const audio = encodeRecordingPcmWav(new Float32Array(systemChunkSeconds * 16_000).fill(0.1))
    for (const sequence of [0, 1]) {
      const reserved = await reserve(req('chunks', { track: 'system', sequence, startMs: sequence * (systemChunkSeconds * 1000 + gapMs), durationMs: systemChunkSeconds * 1000, mimeType: 'audio/wav', size: audio.byteLength }), group.params)
      expect(reserved.status).toBe(200)
      const body = await reserved.json() as { uploadUrl: string }
      expect((await upload(new NextRequest(`http://localhost${body.uploadUrl}`, { method: 'PUT', body: audio }), group.params)).status).toBe(200)
    }
    expect((await stop(req('stop', { expectedChunks: { mic: 1, system: 2 }, durationMs: systemChunkSeconds * 2000 + gapMs }), group.params)).status).toBe(200)
    return group
  }

  function novaOutput() {
    return { results: { channels: [{ alternatives: [{ transcript: 'Start continued. Another Back.', words: [
      { start: 28.5, end: 29.8, word: 'Start', speaker: 0 },
      { start: 30.1, end: 30.8, word: 'continued', punctuated_word: 'continued.', speaker: 0 },
      { start: 32, end: 33, word: 'Another', speaker: 1 },
      { start: 33.3, end: 34, word: 'Back', punctuated_word: 'Back.', speaker: 0 },
    ] }] }] } }
  }

  function successfulModels(onInference?: (model: string) => void) {
    h.ai.run.mockImplementation(async (model: string, input: unknown) => {
      onInference?.(model)
      if (model === RECORDING_MODEL) {
        expect(input).toMatchObject({ audio: 'AQID', task: 'transcribe', language: 'en' })
        return { text: 'Microphone speech', segments: [{ start: 1, end: 2, text: 'Microphone speech' }] }
      }
      expect(model).toBe(RECORDING_GROUP_MODEL)
      expect(input).toMatchObject({ diarize: true, punctuate: true, language: 'en', audio: { contentType: 'audio/wav' } })
      const { audio } = input as { audio: { body: ReadableStream<Uint8Array> } }
      const combined = parseRecordingPcmWav(await new Response(audio.body).arrayBuffer())
      expect(combined.sampleCount).toBe(60 * 16_000)
      return novaOutput()
    })
  }

  it('extends the lease only when processing the Nova system group', async () => {
    const group = await stoppedGroup()
    vi.useFakeTimers()
    const leases: Array<{ model: string; durationMs: number }> = []
    successfulModels(model => {
      const row = sqlite.prepare('SELECT lease_until FROM meeting_recordings WHERE id = ?').get(group.id)
      leases.push({ model, durationMs: new Date(String(row?.lease_until)).getTime() - Date.now() })
    })
    await transcribe(req('transcribe'), group.params)
    await transcribe(req('transcribe'), group.params)
    expect(leases).toEqual([
      { model: RECORDING_MODEL, durationMs: 3 * 60_000 },
      { model: RECORDING_GROUP_MODEL, durationMs: 15 * 60_000 },
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('finishes with the paid Nova result when retaining its JSON in R2 throws', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    puts.mockRejectedValueOnce(new Error('Injected Nova JSON R2 failure'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const finished = await transcribe(req('transcribe'), group.params)
    expect(finished.status).toBe(200)
    const detail = await finished.json() as MeetingRecordingDetail
    expect(detail.recording).toMatchObject({ state: 'ready', error: null })
    expect(detail.transcript.text).toContain('Them 1: Start continued.')
    expect(detail.chunks.every(chunk => chunk.state === 'ready')).toBe(true)
    expect(objects.has(`meeting-recordings/${group.id}/system/nova-3.json`)).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('using the completed inference'), expect.any(Error))
    expect((await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail).transcript).toEqual(detail.transcript)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
  })

  it('deletes the cached Nova response and raw audio while retaining the filed transcript', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    const detail = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    const key = `meeting-recordings/${group.id}/system/nova-3.json`
    expect(objects.has(key)).toBe(true)
    const unrelatedKey = 'meeting-recordings/other/system/nova-3.json'
    objects.set(unrelatedKey, { audio: new TextEncoder().encode('{}').buffer, metadata: {} })
    expect((await deleteRecording(req('', undefined, 'DELETE'), group.params)).status).toBe(200)
    expect([...objects.keys()]).toEqual([unrelatedKey])
    expect(sqlite.prepare('SELECT text FROM call_transcripts WHERE id = ?').get(detail.transcript.id)).toEqual({ text: detail.transcript.text })
    expect((await deleteRecording(req('', undefined, 'DELETE'), group.params)).status).toBe(200)
    expect(objects.has(unrelatedKey)).toBe(true)
  })

  it('uses Whisper for mic and one streamed Nova inference, retaining speaker identity across stored chunk edges', async () => {
    const group = await stoppedGroup()
    successfulModels()
    const micResponse = await transcribe(req('transcribe'), group.params)
    expect(await micResponse.json()).toMatchObject({ pending: true, recording: { separateSpeakers: true } })
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
    const finished = await transcribe(req('transcribe'), group.params)
    expect(finished.status).toBe(200)
    const detail = await finished.json() as MeetingRecordingDetail
    expect(detail.recording.state).toBe('ready')
    expect(detail.transcript.text).toBe('[00:01] Liam Miller: Microphone speech\n[00:28] Them 1: Start continued.\n[00:32] Them 2: Another\n[00:33] Them 1: Back.')
    expect(detail.chunks.filter(chunk => chunk.track === 'system').map(chunk => chunk.segments.map(segment => segment.speaker))).toEqual([[0], [0, 1, 0]])
    const stored = sqlite.prepare('SELECT sequence,text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ? ORDER BY sequence').all(group.id, 'system')
    expect(stored.map(row => [row.sequence, row.text, row.attempts])).toEqual([[0, 'Start', 1], [1, 'continued. Another Back.', 1]])
    expect(JSON.parse(String(stored[1].segments))).toEqual([
      { start: expect.closeTo(0.1), end: expect.closeTo(0.8), text: 'continued.', speaker: 0 },
      { start: 2, end: 3, text: 'Another', speaker: 1 }, { start: expect.closeTo(3.3), end: 4, text: 'Back.', speaker: 0 },
    ])
    const retried = await transcribe(req('transcribe'), group.params)
    expect((await retried.json() as MeetingRecordingDetail).transcript).toEqual(detail.transcript)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
    expect(sqlite.prepare('SELECT sequence,text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ? ORDER BY sequence').all(group.id, 'system')).toEqual(stored)
    expect(JSON.parse(new TextDecoder().decode(objects.get(`meeting-recordings/${group.id}/system/nova-3.json`)!.audio))).toEqual(novaOutput())
    expect(puts).toHaveBeenCalledWith(`meeting-recordings/${group.id}/system/nova-3.json`, JSON.stringify(novaOutput()), expect.objectContaining({ onlyIf: { etagDoesNotMatch: '*' } }))
  })

  it('clamps a Nova word inside a 50 ms inter-chunk gap without failing the group', async () => {
    const group = await stoppedGroup(50)
    h.ai.run.mockImplementation(async (model: string) => model === RECORDING_MODEL
      ? { text: 'Mic', segments: [{ start: 0, end: 1, text: 'Mic' }] }
      : { results: { channels: [{ alternatives: [{ transcript: 'Gap Next', words: [
        { start: 30.025, end: 30.04, word: 'Gap', speaker: 0 },
        { start: 30.1, end: 31, word: 'Next', speaker: 1 },
      ] }] }] } })
    await transcribe(req('transcribe'), group.params)
    const detail = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(detail.recording.state).toBe('ready')
    expect(detail.chunks.filter(chunk => chunk.track === 'system').map(chunk => chunk.segments)).toEqual([
      [{ start: 30, end: 30, text: 'Gap', speaker: 0 }],
      [{ start: expect.closeTo(0.05), end: expect.closeTo(0.95), text: 'Next', speaker: 1 }],
    ])
  })

  function whisperFallback() {
    h.ai.run.mockImplementation(async (model: string, input: { audio: string }) => {
      expect(model).toBe(RECORDING_MODEL)
      if (input.audio === 'AQID') return { text: 'Mic', segments: [{ start: 0, end: 1, text: 'Mic' }] }
      const audio = Uint8Array.from(atob(input.audio), char => char.charCodeAt(0)).buffer
      expect(audio.byteLength).toBeLessThan(1024 * 1024)
      expect(parseRecordingPcmWav(audio).sampleCount).toBe(30 * 16_000)
      return { text: 'Remote speech', segments: [{ start: 1, end: 2, text: 'Remote speech' }] }
    })
  }

  it('falls back after two failed group attempts and preserves mic text while Whisper processes system chunks', async () => {
    const group = await stoppedGroup()
    whisperFallback()
    await transcribe(req('transcribe'), group.params)
    const mic = sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')
    h.ai.run.mockRejectedValueOnce(new Error('Nova unavailable')).mockRejectedValueOnce(new Error('Nova unavailable again'))
    expect((await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail).recording.state).toBe('failed')
    const fallback = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(fallback).toMatchObject({ pending: true, recording: { separateSpeakers: false, state: 'transcribing' } })
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
    await transcribe(req('transcribe'), group.params)
    const finished = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(finished.recording.state).toBe('ready')
    expect(finished.transcript.text).toContain('Mic')
    expect(finished.transcript.text).toContain('Remote speech')
    expect(sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')).toEqual(mic)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL, RECORDING_GROUP_MODEL, RECORDING_MODEL, RECORDING_MODEL])
  })

  it('denies explicit speaker fallback for non-admins before changing recording or chunk state', async () => {
    const group = await stoppedGroup()
    const recording = sqlite.prepare('SELECT * FROM meeting_recordings WHERE id = ?').get(group.id)
    const chunks = sqlite.prepare('SELECT * FROM meeting_recording_chunks WHERE recording_id = ? ORDER BY track, sequence').all(group.id)
    h.isAdmin = false

    const response = await transcribe(req('transcribe', { separateSpeakers: false }), group.params)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Only an administrator can transcribe without speaker separation.' })
    expect(sqlite.prepare('SELECT * FROM meeting_recordings WHERE id = ?').get(group.id)).toEqual(recording)
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks WHERE recording_id = ? ORDER BY track, sequence').all(group.id)).toEqual(chunks)
    expect(h.ai.run).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed transcription JSON without changing recording or chunk state', async () => {
    const group = await stoppedGroup()
    const recording = sqlite.prepare('SELECT * FROM meeting_recordings WHERE id = ?').get(group.id)
    const chunks = sqlite.prepare('SELECT * FROM meeting_recording_chunks WHERE recording_id = ? ORDER BY track, sequence').all(group.id)

    const response = await transcribe(new NextRequest(`http://localhost/api/admin/recordings/${group.id}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    }), group.params)

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Invalid JSON.' })
    expect(sqlite.prepare('SELECT * FROM meeting_recordings WHERE id = ?').get(group.id)).toEqual(recording)
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks WHERE recording_id = ? ORDER BY track, sequence').all(group.id)).toEqual(chunks)
    expect(h.ai.run).not.toHaveBeenCalled()
  })

  it('manually disables separation and decodes maximum three-minute system WAV chunks through Whisper', async () => {
    const group = await stoppedGroup(0, 180)
    whisperFallback()
    await transcribe(req('transcribe'), group.params)
    const mic = sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')
    expect((await transcribe(req('transcribe', { separateSpeakers: true }), group.params)).status).toBe(400)
    const fallback = await (await transcribe(req('transcribe', { separateSpeakers: false }), group.params)).json() as MeetingRecordingDetail
    expect(fallback.recording.separateSpeakers).toBe(false)
    expect(fallback.chunks.find(chunk => chunk.track === 'system' && chunk.sequence === 0)?.segments.map(segment => segment.start)).toEqual([1, 31, 61, 91, 121, 151])
    const finished = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(finished.recording.state).toBe('ready')
    expect(h.ai.run.mock.calls.every(call => call[0] === RECORDING_MODEL)).toBe(true)
    expect(h.ai.run).toHaveBeenCalledTimes(13)
    expect(sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')).toEqual(mic)
    expect((await transcribe(req('transcribe', { separateSpeakers: false }), group.params)).status).toBe(409)
  })

  it('automatically uses Whisper for system timelines longer than two hours without a Nova call', async () => {
    const group = await stoppedGroup(MAX_RECORDING_GROUP_DURATION_MS - 30_000)
    whisperFallback()
    const first = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(first.recording.separateSpeakers).toBe(false)
    await transcribe(req('transcribe'), group.params)
    expect((await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail).recording.state).toBe('ready')
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_MODEL, RECORDING_MODEL])
  })

  it('reuses create-only raw Nova JSON after parsing fails instead of billing another inference', async () => {
    const group = await stoppedGroup()
    whisperFallback()
    await transcribe(req('transcribe'), group.params)
    const invalid = { results: { channels: [{ alternatives: [{ transcript: 'Missing labels', words: [] }] }] } }
    h.ai.run.mockResolvedValueOnce(invalid)
    expect((await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail).recording.state).toBe('failed')
    const resultKey = `meeting-recordings/${group.id}/system/nova-3.json`
    expect(JSON.parse(new TextDecoder().decode(objects.get(resultKey)!.audio))).toEqual(invalid)
    const retry = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(retry.recording.separateSpeakers).toBe(false)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
    expect(puts.mock.calls.filter(call => call[0] === resultKey)).toHaveLength(1)
    await transcribe(req('transcribe'), group.params)
    expect((await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail).recording.state).toBe('ready')
  })

  it('reuses raw Nova JSON after a transactional D1 group-result failure without another AI call', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    failGroupBatch = true
    const failed = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(failed.recording.state).toBe('failed')
    expect(failed.chunks.filter(chunk => chunk.track === 'system').every(chunk => chunk.state === 'failed')).toBe(true)
    expect(objects.has(`meeting-recordings/${group.id}/system/nova-3.json`)).toBe(true)
    const retry = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(retry.recording.state).toBe('ready')
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
  })

  it('renews the inference lease and retains a result arriving after the old timeout without concurrent billing', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    vi.useFakeTimers()
    let resolveNova: (value: unknown) => void = () => { throw new Error('Nova has not started') }
    let markStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { markStarted = resolve })
    h.ai.run.mockImplementationOnce(() => new Promise(resolve => { resolveNova = resolve; markStarted() }))
    const pending = transcribe(req('transcribe'), group.params)
    await started
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect((await transcribe(req('transcribe'), group.params)).status).toBe(409)
    resolveNova(novaOutput())
    const finished = await (await pending).json() as MeetingRecordingDetail
    expect(finished.recording.state).toBe('ready')
    expect(objects.has(`meeting-recordings/${group.id}/system/nova-3.json`)).toBe(true)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
  })

  it('retains successful mic text after Nova fails and retries only the whole system track', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    const mic = sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')
    h.ai.run.mockRejectedValueOnce(new Error('Temporary Nova failure'))
    const failed = await transcribe(req('transcribe'), group.params)
    const failure = await failed.json() as MeetingRecordingDetail
    expect(failure.recording).toMatchObject({ state: 'failed', error: 'Temporary Nova failure', transcriptId: null })
    expect(failure.chunks.filter(chunk => chunk.track === 'system').map(chunk => chunk.state)).toEqual(['failed', 'failed'])
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
    const retry = await transcribe(req('transcribe'), group.params)
    expect((await retry.json() as MeetingRecordingDetail).recording.state).toBe('ready')
    expect(sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')).toEqual(mic)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL, RECORDING_GROUP_MODEL])
    expect(sqlite.prepare('SELECT attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').all(group.id, 'system')).toEqual([{ attempts: 2 }, { attempts: 2 }])
  })

  it('retries failed finalization using saved group results without another Nova or Whisper inference', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    failTranscript = true
    const failed = await transcribe(req('transcribe'), group.params)
    const failure = await failed.json() as MeetingRecordingDetail
    expect(failure.recording.state).toBe('failed')
    expect(failure.chunks.every(chunk => chunk.state === 'ready')).toBe(true)
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(0)
    const retry = await transcribe(req('transcribe'), group.params)
    expect((await retry.json() as MeetingRecordingDetail).recording.state).toBe('ready')
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
  })

  it('explicit fallback replaces ready Nova system results after finalization fails while retaining mic', async () => {
    const group = await stoppedGroup()
    successfulModels()
    await transcribe(req('transcribe'), group.params)
    failTranscript = true
    const failed = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(failed.recording.state).toBe('failed')
    expect(failed.chunks.every(chunk => chunk.state === 'ready')).toBe(true)
    const mic = sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')
    whisperFallback()
    const fallback = await (await transcribe(req('transcribe', { separateSpeakers: false }), group.params)).json() as MeetingRecordingDetail
    expect(fallback).toMatchObject({ pending: true, recording: { separateSpeakers: false } })
    const finished = await (await transcribe(req('transcribe'), group.params)).json() as MeetingRecordingDetail
    expect(finished.recording.state).toBe('ready')
    expect(finished.transcript.text).toContain('Remote speech')
    expect(finished.transcript.text).not.toMatch(/Them [12]:/)
    expect(sqlite.prepare('SELECT text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ?').get(group.id, 'mic')).toEqual(mic)
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL, RECORDING_MODEL, RECORDING_MODEL])
  })

  it('accepts a full three-minute PCM reservation above the compressed limit and rejects raw group WebM', async () => {
    const group = await groupRecording()
    const rejected = await reserve(req('chunks', { ...metadata, track: 'system' }), group.params)
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('requires WAV system audio') })
    const accepted = await reserve(req('chunks', { track: 'system', sequence: 0, startMs: 0, durationMs: 180_000, mimeType: 'audio/wav', size: 44 + 180 * 16_000 * 2 }), group.params)
    expect(accepted.status).toBe(200)
    expect(sqlite.prepare('SELECT size,mime_type,duration_ms FROM meeting_recording_chunks WHERE recording_id = ?').get(group.id)).toEqual({ size: 5_760_044, mime_type: 'audio/wav', duration_ms: 180_000 })
    expect(puts).not.toHaveBeenCalled()
  })

  it('persists every group result exactly once across the 25-chunk result batch boundary', async () => {
    const group = await groupRecording()
    const mic = await reserve(req('chunks', { ...metadata, durationMs: 1000 }), group.params)
    expect(mic.status).toBe(200)
    const micBody = await mic.json() as { uploadUrl: string }
    expect((await upload(new NextRequest(`http://localhost${micBody.uploadUrl}`, { method: 'PUT', body: Uint8Array.from([1, 2, 3]) }), group.params)).status).toBe(200)
    const audio = encodeRecordingPcmWav(new Float32Array(16_000).fill(0.1))
    for (let sequence = 0; sequence < 26; sequence += 1) {
      const reserved = await reserve(req('chunks', { track: 'system', sequence, startMs: sequence * 1000, durationMs: 1000, mimeType: 'audio/wav', size: audio.byteLength }), group.params)
      expect(reserved.status).toBe(200)
      const body = await reserved.json() as { uploadUrl: string }
      expect((await upload(new NextRequest(`http://localhost${body.uploadUrl}`, { method: 'PUT', body: audio }), group.params)).status).toBe(200)
    }
    expect((await stop(req('stop', { expectedChunks: { mic: 1, system: 26 }, durationMs: 26_000 }), group.params)).status).toBe(200)
    const words = Array.from({ length: 26 }, (_, sequence) => ({ start: sequence + 0.2, end: sequence + 0.3, word: `word${sequence}`, speaker: sequence % 2 }))
    h.ai.run.mockImplementation(async (model: string, input: unknown) => {
      if (model === RECORDING_MODEL) return { text: 'Mic', segments: [{ start: 0, end: 0.1, text: 'Mic' }] }
      expect(model).toBe(RECORDING_GROUP_MODEL)
      const { audio: systemAudio } = input as { audio: { body: ReadableStream<Uint8Array> } }
      expect(parseRecordingPcmWav(await new Response(systemAudio.body).arrayBuffer()).sampleCount).toBe(26 * 16_000)
      return { results: { channels: [{ alternatives: [{ transcript: words.map(word => word.word).join(' '), words }] }] } }
    })
    await transcribe(req('transcribe'), group.params)
    const completed = await transcribe(req('transcribe'), group.params)
    expect(completed.status).toBe(200)
    expect((await completed.json() as MeetingRecordingDetail).recording.state).toBe('ready')
    const stored = sqlite.prepare('SELECT sequence,state,text,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = ? ORDER BY sequence').all(group.id, 'system')
    expect(stored).toHaveLength(26)
    stored.forEach((row, sequence) => {
      expect(row).toMatchObject({ sequence, state: 'ready', text: `word${sequence}`, attempts: 1 })
      expect(JSON.parse(String(row.segments))).toEqual([{ start: expect.closeTo(0.2), end: expect.closeTo(0.3), text: `word${sequence}`, speaker: sequence % 2 }])
    })
    expect(h.ai.run.mock.calls.map(call => call[0])).toEqual([RECORDING_MODEL, RECORDING_GROUP_MODEL])
    expect(sqlite.prepare('SELECT * FROM call_transcripts').all()).toHaveLength(1)
  })
})
