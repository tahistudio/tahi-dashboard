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
import { MEETING_RECORDING_MIGRATION } from '@/lib/meeting-recordings-migration'

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

function adapter(sqliteDb: DatabaseSync) {
  const prepare = (query: string): SqlStatement => {
    const bind = (...params: SQLInputValue[]): SqlStatement => {
      const execute = (): SqlResult => {
        if (failTranscript && /^INSERT INTO call_transcripts/.test(query)) { failTranscript = false; throw new Error('Injected D1 failure') }
        if (failLinkBatch && /^update "meeting_recordings"/i.test(query) && query.includes('"call_kind"')) {
          failLinkBatch = false; throw new Error('Injected recorder link failure')
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
  sqlite.exec('ALTER TABLE call_transcripts ADD COLUMN suggested_at text; CREATE TABLE organisations (id text PRIMARY KEY); CREATE TABLE task_suggestions (id text, transcript_id text); CREATE TABLE scheduled_calls (id text PRIMARY KEY,org_id text);')
  sqlite.exec("INSERT INTO organisations VALUES ('client-a'), ('client-b')")
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
  puts = vi.fn(async (key: string, audio: ArrayBuffer, options: { customMetadata: Record<string, string> }) => {
    if (objects.has(key)) return null
    objects.set(key, { audio, metadata: options.customMetadata })
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

afterEach(() => { sqlite.close(); vi.restoreAllMocks() })

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
    const options = puts.mock.calls[0][2] as { onlyIf: Headers }
    expect(options.onlyIf.get('If-None-Match')).toBe('*')
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks').all()).toHaveLength(1)
    expect((await reserve(req('chunks', { ...metadata, size: 4 }), params)).status).toBe(409)
  })

  it('settles concurrent reservation retries with the database lease and unique key', async () => {
    const responses = await Promise.all([reserve(req('chunks', metadata), params), reserve(req('chunks', metadata), params)])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect(sqlite.prepare('SELECT * FROM meeting_recording_chunks').all()).toHaveLength(1)
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
})

describe('recording transcription recovery', () => {
  async function stoppedTwoTracks() {
    await reserveAndUpload('mic')
    await reserveAndUpload('system')
    const stopped = await stop(req('stop', { expectedChunks: { mic: 1, system: 1 }, durationMs: 30_000 }), params)
    expect(stopped.status).toBe(200)
  }

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
    expect(ready.transcript.text).toBe('[00:01] Liam: Liam first\n[00:04] Them: Them later')
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
    sqlite.prepare("INSERT INTO scheduled_calls VALUES ('call-a','client-a')").run()
    const linked = await linkRecording(req('link', { callKind: 'scheduled', callId: 'call-a' }, 'PATCH'), params)
    expect(linked.status).toBe(200)
    expect(sqlite.prepare('SELECT org_id,call_id FROM meeting_recordings').get()).toEqual({ org_id: 'client-a', call_id: 'call-a' })
    expect(sqlite.prepare('SELECT call_kind,call_id FROM call_transcripts').get()).toEqual({ call_kind: 'scheduled', call_id: 'call-a' })
  })

  it('rolls back the transcript link if its recording identity write fails', async () => {
    await stoppedTwoTracks(); await transcribe(req('transcribe'), params); await transcribe(req('transcribe'), params)
    sqlite.prepare("INSERT INTO scheduled_calls VALUES ('call-a','client-a')").run()
    failLinkBatch = true
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect((await linkRecording(req('link', { callKind: 'scheduled', callId: 'call-a' }, 'PATCH'), params)).status).toBe(503)
    expect(sqlite.prepare('SELECT org_id,call_id FROM meeting_recordings').get()).toEqual({ org_id: 'client-a', call_id: null })
    expect(sqlite.prepare('SELECT call_kind,call_id FROM call_transcripts').get()).toEqual({ call_kind: null, call_id: null })
  })
})
