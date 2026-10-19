import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest, NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { MEETING_RECORDING_MIGRATION } from '@/lib/meeting-recordings-migration'
import { RECORDER_DEVICES_MIGRATION } from '@/lib/recorder-devices-migration'
import { RECORDER_DAILY_AUDIO_MS } from '@/lib/recorder-recordings'
import { MAX_RECORDING_DURATION_MS } from '@/lib/meeting-recordings'
import { encodeRecordingPcmWav } from '@/lib/recording-group-audio'

const h = vi.hoisted(() => ({
  database: null as unknown,
  session: { userId: null as string | null, orgId: null as string | null, sessionId: null as string | null },
  device: { userId: 'liam', orgId: 'tahi', sessionId: null, recorderDevice: { id: 'device', teamMemberId: 'member-liam' } },
  valid: true, unavailable: false, failSideInsert: false, deniedOrg: null as string | null, bucket: { put: vi.fn() }, queries: [] as string[],
}))
vi.mock('@/lib/db', () => ({ db: async () => h.database }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: async () => h.session, isTahiAdmin: (org: string) => org === 'tahi' }))
vi.mock('@/lib/recorder-device-auth', async () => {
  const { isRecorderDeviceBearer } = await import('@/lib/recorder-device-routes')
  class RecorderDeviceAuthError extends Error { status = 503; retryAfter = 30 }
  return { RecorderDeviceAuthError, isRecorderDeviceRequest: (req: NextRequest) => isRecorderDeviceBearer(req.headers.get('authorization')),
    getRecorderDeviceAuth: async () => { if (h.unavailable) throw new RecorderDeviceAuthError(); return h.valid ? h.device : null } }
})
vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => null }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrgOrPreClient: async (_database: unknown, _user: string, org: string | null) =>
  h.deniedOrg && h.deniedOrg === org ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null }))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: async () => ({ kind: 'all' }) }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: async () => ({ isAdmin: true }) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { STORAGE: h.bucket, AI: { run: vi.fn() } } }) }))

import { GET as listRecordings, POST as createRecording } from '@/app/api/admin/recordings/route'
import { GET as readRecording, DELETE as deleteRecording } from '@/app/api/admin/recordings/[id]/route'
import { POST as reserve, PUT as upload } from '@/app/api/admin/recordings/[id]/chunks/route'
import { PATCH as link } from '@/app/api/admin/recordings/[id]/link/route'
import { POST as stop } from '@/app/api/admin/recordings/[id]/stop/route'
import { POST as transcribe } from '@/app/api/admin/recordings/[id]/transcribe/route'
import { GET as upcomingCalls } from '@/app/api/admin/recordings/upcoming-calls/route'

interface SqlResult { results: Record<string, unknown>[]; success: boolean; meta: { changes: number } }
interface Statement {
  bind(...params: SQLInputValue[]): Statement
  execute(): SqlResult
  all(): Promise<SqlResult>
  run(): Promise<SqlResult>
  raw(): Promise<unknown[][]>
}
let sqlite: DatabaseSync
const NOW = Date.parse('2026-10-14T00:00:00Z')
const REF = 'e854a350-392a-40ed-9701-0fd76ba09db1'
function adapter() {
  const prepare = (query: string): Statement => {
    const bind = (...params: SQLInputValue[]): Statement => {
      const execute = (): SqlResult => {
        h.queries.push(query)
        if (h.failSideInsert && /^insert into "?recorder_recordings"?/i.test(query)) throw new Error('Injected side insert failure')
        const statement = sqlite.prepare(query)
        if (/^\s*select\b|\breturning\b/i.test(query)) {
          const results = statement.all(...params) as Record<string, unknown>[]
          return { results, success: true, meta: { changes: /^\s*select/i.test(query) ? 0 : results.length } }
        }
        return { results: [], success: true, meta: { changes: Number(statement.run(...params).changes) } }
      }
      return { bind, execute, all: async () => execute(), run: async () => execute(), raw: async () => execute().results.map(row => Object.values(row)) }
    }
    return bind()
  }
  return { prepare, async batch(statements: Statement[]) {
    sqlite.exec('BEGIN')
    try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result }
    catch (error) { sqlite.exec('ROLLBACK'); throw error }
  } }
}

function request(path = '', body?: unknown, method = body === undefined ? 'GET' : 'POST', device = true) {
  return new NextRequest(`https://portal.tahi.studio/api/admin/recordings${path}`, {
    method, headers: { ...(device ? { authorization: 'Bearer tahi_rec_secret' } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const input = (extra = {}) => ({ clientRef: REF, title: 'A call', tracks: ['mic', 'system'], ...extra })
async function create(extra = {}) {
  const response = await createRecording(request('', input(extra)))
  expect(response.status).toBe(201)
  return (await response.json() as { recording: { id: string } }).recording.id
}
function close(id: string) { sqlite.prepare("UPDATE meeting_recordings SET stopped_at = ?, state = 'uploading' WHERE id = ?").run(new Date(NOW).toISOString(), id) }
function seedCall(id: string, changes: { kind?: 'discovery' | 'scheduled'; status?: string; email?: string; offset?: number; durationMinutes?: number } = {}) {
  const table = changes.kind === 'scheduled' ? 'scheduled_calls' : 'discovery_calls'
  const url = changes.kind === 'scheduled' ? 'meeting_url' : 'google_meet_url'
  sqlite.prepare(`INSERT INTO ${table} (id,org_id,title,scheduled_at,duration_minutes,status,attendees,${url}) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, 'client-a', 'Planning', new Date(NOW + (changes.offset ?? 0)).toISOString(), changes.durationMinutes ?? 30, changes.status ?? 'scheduled',
      JSON.stringify([{ email: changes.email ?? 'business@tahi.studio' }]), 'https://meet.google.com/private-room')
}
const metadata = (extra = {}) => ({ track: 'mic', sequence: 0, startMs: 0, durationMs: 30_000, mimeType: 'audio/wav', size: 960_044, ...extra })

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MEETING_RECORDING_MIGRATION.join(';'))
  sqlite.exec(RECORDER_DEVICES_MIGRATION.join(';'))
  sqlite.exec(readFileSync(resolve(process.cwd(), 'drizzle/migrations/0105_call_transcripts.sql'), 'utf8'))
  sqlite.exec(`ALTER TABLE call_transcripts ADD COLUMN suggested_at text;
    CREATE TABLE organisations (id text PRIMARY KEY, name text);
    CREATE TABLE task_suggestions (id text, transcript_id text);
    CREATE TABLE team_members (id text PRIMARY KEY, clerk_user_id text, name text, email text);
    CREATE TABLE scheduled_calls (id text PRIMARY KEY,org_id text,title text,scheduled_at text,duration_minutes integer,status text,attendees text,meeting_url text,created_by_id text);
    CREATE TABLE discovery_calls (id text PRIMARY KEY,org_id text,title text,scheduled_at text,duration_minutes integer,status text,attendees text,google_meet_url text,transcript text,transcript_source text,updated_at text,created_by_id text,google_calendar_event_id text);
    CREATE TABLE integrations (id text PRIMARY KEY, service text, config text, status text);
    INSERT INTO organisations VALUES ('client-a', 'Client A');
    INSERT INTO team_members VALUES ('member-liam','liam','Liam Miller','business@tahi.studio');`)
  h.database = drizzle(adapter() as unknown as AnyD1Database, { schema })
  h.session = { userId: null, orgId: null, sessionId: null }
  h.device = { userId: 'liam', orgId: 'tahi', sessionId: null, recorderDevice: { id: 'device', teamMemberId: 'member-liam' } }
  h.valid = true; h.unavailable = false; h.failSideInsert = false
  h.deniedOrg = null
  h.queries = []
  h.bucket.put.mockReset()
})
afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('tray recording create', () => {
  it('is idempotent for concurrent retries and returns the same id after stopping', async () => {
    const [a, b] = await Promise.all([create(), create()])
    expect(a).toBe(b)
    close(a)
    expect(await create({ title: 'Changed retry title' })).toBe(a)
    expect(sqlite.prepare('SELECT count(*) AS count FROM meeting_recordings').get()?.count).toBe(1)
    expect(sqlite.prepare('SELECT count(*) AS count FROM recorder_recordings').get()?.count).toBe(1)
  })

  it('requires a UUID clientRef', async () => {
    for (const extra of [{ clientRef: undefined }, { clientRef: '../bad' }]) {
      expect((await createRecording(request('', input(extra)))).status).toBe(400)
    }
  })

  it('atomically refuses a second open recording and permits a new one after stopping', async () => {
    const first = await create()
    const response = await createRecording(request('', input({ clientRef: crypto.randomUUID() })))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'open_recording' })
    close(first)
    expect(await create({ clientRef: crypto.randomUUID() })).not.toBe(first)
  })

  it('ignores abandoned open recordings older than the maximum duration plus one hour', async () => {
    const first = await create()
    vi.setSystemTime(NOW + MAX_RECORDING_DURATION_MS + 60 * 60 * 1000)
    expect((await createRecording(request('', input({ clientRef: crypto.randomUUID() })))).status).toBe(429)
    vi.setSystemTime(NOW + MAX_RECORDING_DURATION_MS + 60 * 60 * 1000 + 1)
    expect(await create({ clientRef: crypto.randomUUID() })).not.toBe(first)
  })

  it('rejects callId without callKind before creating any rows', async () => {
    const response = await createRecording(request('', input({ callId: 'call' })))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'callKind is required when callId is supplied.' })
    expect(sqlite.prepare('SELECT count(*) AS count FROM meeting_recordings').get()?.count).toBe(0)
  })

  it('rolls back the primary row when the side-table write fails', async () => {
    h.failSideInsert = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await createRecording(request('', input()))).status).toBe(503)
    expect(sqlite.prepare('SELECT count(*) AS count FROM meeting_recordings').get()?.count).toBe(0)
  })

  it('revalidates membership, scheduled status, time window and call kind before linking', async () => {
    seedCall('allowed')
    seedCall('other', { email: 'staci@tahi.studio' })
    seedCall('cancelled', { status: 'cancelled' })
    seedCall('later', { offset: 13 * 60_000 })
    seedCall('stale', { offset: -180_000 })
    seedCall('in-progress', { offset: -20 * 60_000, durationMinutes: 60 })
    seedCall('ended', { offset: -41 * 60_000 })
    seedCall('grace-boundary', { offset: -40 * 60_000 })
    seedCall('opens-now', { offset: 120_000 })
    seedCall('early-11', { offset: 11 * 60_000 })
    for (const [id, kind, expected] of [['allowed', 'discovery', 'allowed'], ['other', 'discovery', null],
      ['cancelled', 'discovery', null], ['later', 'discovery', null], ['stale', 'discovery', 'stale'],
      ['in-progress', 'discovery', 'in-progress'], ['ended', 'discovery', null],
      ['grace-boundary', 'discovery', 'grace-boundary'], ['opens-now', 'discovery', 'opens-now'], ['early-11', 'discovery', 'early-11'],
      ['allowed', 'scheduled', null], ['missing', 'discovery', null]]) {
      const recording = await create({ clientRef: crypto.randomUUID(), callId: id, callKind: kind, orgId: 'forged-client' })
      expect(sqlite.prepare('SELECT call_id,org_id FROM meeting_recordings WHERE id=?').get(recording))
        .toEqual({ call_id: expected, org_id: expected ? 'client-a' : null })
      close(recording)
    }
  })
})

describe('owned slim recording responses', () => {
  it('stops an empty device recording in a terminal failed state and frees its open slot', async () => {
    const id = await create()
    const response = await stop(request(`/${id}/stop`, { durationMs: 0, expectedChunks: { mic: 0, system: 0 } }), params(id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ recording: { id, state: 'failed', expectedChunks: { mic: 0, system: 0 },
      error: 'No audio was captured. Start a new recording.' }, chunks: [] })
    expect(sqlite.prepare('SELECT stopped_at FROM meeting_recordings WHERE id=?').get(id)?.stopped_at).toBe(new Date(NOW).toISOString())
    const replay = await stop(request(`/${id}/stop`, { durationMs: 30_000, expectedChunks: { mic: 1, system: 1 } }), params(id))
    expect(await replay.json()).toMatchObject({ recording: { state: 'failed', expectedChunks: { mic: 0, system: 0 }, error: 'No audio was captured. Start a new recording.' } })
    const attemptedTranscription = await transcribe(request(`/${id}/transcribe`, {}), params(id))
    expect(attemptedTranscription.status).toBe(200)
    expect(await attemptedTranscription.json()).toMatchObject({ recording: { state: 'failed', error: 'No audio was captured. Start a new recording.' }, pending: false })
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(409)
    expect(await create({ clientRef: crypto.randomUUID() })).not.toBe(id)
  })

  it('does not let an empty stop discard reserved chunks', async () => {
    const id = await create()
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(200)
    expect((await stop(request(`/${id}/stop`, { durationMs: 0, expectedChunks: { mic: 0, system: 0 } }), params(id))).status).toBe(400)
    expect(sqlite.prepare('SELECT state FROM meeting_recordings WHERE id=?').get(id)?.state).toBe('recording')
  })

  it('loads all listed chunk summaries in one query without reading other device chunks', async () => {
    const ids: string[] = []
    for (let index = 0; index < 3; index++) {
      const id = await create({ clientRef: crypto.randomUUID() })
      await reserve(request(`/${id}/chunks`, metadata()), params(id))
      ids.push(id)
      close(id)
    }
    h.device.recorderDevice.id = 'another-device'
    const other = await create({ clientRef: crypto.randomUUID() })
    await reserve(request(`/${other}/chunks`, metadata()), params(other))
    h.device.recorderDevice.id = 'device'
    h.queries = []
    const response = await listRecordings(request())
    expect(await response.json()).toMatchObject({ items: ids.map(id => ({ recording: { id }, chunks: [{ track: 'mic', sequence: 0 }] })) })
    expect(h.queries.filter(query => /from "meeting_recording_chunks"/i.test(query))).toHaveLength(1)
    expect(h.queries).toHaveLength(2)
  })
  it('never returns transcript, chunk text, segments or upload secrets on reads or list', async () => {
    const id = await create()
    sqlite.prepare("INSERT INTO meeting_recording_chunks (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,text,segments,uploaded_at,created_at,updated_at) VALUES ('chunk',?,'mic',0,0,30000,'audio/wav',960044,'secret-key','secret-token','ready','Secret transcript','[]',?,?,?)")
      .run(id, new Date(NOW).toISOString(), new Date(NOW).toISOString(), new Date(NOW).toISOString())
    const response = await readRecording(request(`/${id}`), params(id))
    expect(await response.json()).toEqual({ recording: { id, state: 'recording', expectedChunks: null, error: null },
      chunks: [{ track: 'mic', sequence: 0, uploaded: true, state: 'ready', error: null }] })
    const listed = await (await listRecordings(request())).text()
    expect(listed).not.toMatch(/Secret transcript|secret-key|secret-token|segments|transcript/)
    h.device.recorderDevice.id = 'another-device'
    expect((await readRecording(request(`/${id}`), params(id))).status).toBe(404)
    expect(await (await listRecordings(request())).json()).toEqual({ items: [] })
    h.device.recorderDevice.id = 'device'; h.device.recorderDevice.teamMemberId = 'other-member'
    expect((await readRecording(request(`/${id}`), params(id))).status).toBe(404)
  })

  it('opts in stop and transcription but refuses deletion, linking and mixed session identity', async () => {
    const id = await create()
    expect((await deleteRecording(request(`/${id}`, undefined, 'DELETE'), params(id))).status).toBe(401)
    expect((await link(request(`/${id}/link`, {}, 'PATCH'), params(id))).status).toBe(401)
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(200)
    const stopped = await stop(request(`/${id}/stop`, { durationMs: 30_000, expectedChunks: { mic: 1, system: 1 } }), params(id))
    expect(stopped.status).toBe(200)
    expect(await stopped.text()).not.toMatch(/transcript|segments|storageKey/)
    const transcription = await transcribe(request(`/${id}/transcribe`, {}), params(id))
    expect(transcription.status).toBe(200)
    expect(await transcription.text()).not.toMatch(/transcript|segments|storageKey/)
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    expect((await readRecording(request(`/${id}`), params(id))).status).toBe(401)
    expect((await readRecording(new NextRequest(`https://portal.tahi.studio/api/admin/recordings/${id}`, {
      headers: { authorization: 'bEaReR tahi_rec_secret' },
    }), params(id))).status).toBe(401)
  })

  it('fails closed for invalid devices and returns Retry-After for a membership outage', async () => {
    h.valid = false
    expect((await listRecordings(request())).status).toBe(401)
    h.valid = true; h.unavailable = true
    const response = await listRecordings(request())
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('marks tray rows on the normal dashboard list', async () => {
    const id = await create()
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    expect(await (await listRecordings(request('', undefined, 'GET', false))).json()).toMatchObject({ items: [{ id, source: 'tray' }] })
  })
})

describe('device audio quotas and payloads', () => {
  it('requires exact PCM duration/size and WAV MIME before allocating storage', async () => {
    const id = await create()
    for (const extra of [{ size: 160_044 }, { durationMs: 1 }, { mimeType: 'audio/webm' }]) {
      expect((await reserve(request(`/${id}/chunks`, metadata(extra)), params(id))).status).toBe(400)
    }
    expect(sqlite.prepare('SELECT count(*) AS count FROM meeting_recording_chunks').get()?.count).toBe(0)
  })

  it('checks canonical PCM headers before R2 and retains the reservation for retry', async () => {
    const id = await create()
    const reserved = await (await reserve(request(`/${id}/chunks`, metadata()), params(id))).json() as { uploadUrl: string }
    expect(await (await reserve(request(`/${id}/chunks`, metadata()), params(id))).json()).toMatchObject({ duplicate: false, uploaded: false })
    const bad = new Uint8Array(960_044)
    expect((await upload(new NextRequest(`https://portal.tahi.studio${reserved.uploadUrl}`, {
      method: 'PUT', headers: { authorization: 'Bearer tahi_rec_secret' }, body: bad,
    }), params(id))).status).toBe(400)
    expect(h.bucket.put).not.toHaveBeenCalled()
    h.bucket.put.mockResolvedValue({ key: 'saved' })
    const good = encodeRecordingPcmWav(new Float32Array(480_000))
    expect((await upload(new NextRequest(`https://portal.tahi.studio${reserved.uploadUrl}`, {
      method: 'PUT', headers: { authorization: 'Bearer tahi_rec_secret' }, body: good,
    }), params(id))).status).toBe(200)
    expect(h.bucket.put).toHaveBeenCalledOnce()
    expect(await (await reserve(request(`/${id}/chunks`, metadata()), params(id))).json()).toMatchObject({ duplicate: true, uploaded: true })
  })

  it('counts mic reservations over a rolling 24 hours, allows the exact limit and preserves duplicates', async () => {
    const id = await create()
    sqlite.prepare("INSERT INTO meeting_recording_chunks (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,created_at,updated_at) VALUES ('used',?,'mic',999,0,?,'audio/wav',960044,'key','token','reserved',?,?)")
      .run(id, RECORDER_DAILY_AUDIO_MS - 30_000, new Date(NOW - 60_000).toISOString(), new Date(NOW - 60_000).toISOString())
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(200)
    const exceeded = await reserve(request(`/${id}/chunks`, metadata({ sequence: 1, startMs: 30_000 })), params(id))
    expect(exceeded.status).toBe(429)
    expect(await exceeded.json()).toMatchObject({ code: 'daily_quota' })
    expect((await reserve(request(`/${id}/chunks`, metadata({ track: 'system' })), params(id))).status).toBe(200)
    const duplicate = await reserve(request(`/${id}/chunks`, metadata()), params(id))
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toMatchObject({ duplicate: false, uploaded: false })
    close(id)
    const blocked = await createRecording(request('', input({ clientRef: crypto.randomUUID() })))
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toMatchObject({ code: 'daily_quota' })
    vi.setSystemTime(NOW + 86400_000)
    const next = await create({ clientRef: crypto.randomUUID() })
    expect((await reserve(request(`/${next}/chunks`, metadata()), params(next))).status).toBe(200)
  })

  it('limits system reservations independently while the create check stays mic-only', async () => {
    const id = await create()
    sqlite.prepare("INSERT INTO meeting_recording_chunks (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,created_at,updated_at) VALUES ('used',?,'system',999,0,?,'audio/wav',960044,'key','token','reserved',?,?)")
      .run(id, RECORDER_DAILY_AUDIO_MS - 30_000, new Date(NOW - 60_000).toISOString(), new Date(NOW - 60_000).toISOString())
    const system = metadata({ track: 'system' })
    expect((await reserve(request(`/${id}/chunks`, system), params(id))).status).toBe(200)
    const exceeded = await reserve(request(`/${id}/chunks`, metadata({ track: 'system', sequence: 1, startMs: 30_000, durationMs: 1, size: 76 })), params(id))
    expect(exceeded.status).toBe(429)
    expect(await exceeded.json()).toMatchObject({ code: 'daily_quota' })
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(200)
    const duplicate = await reserve(request(`/${id}/chunks`, system), params(id))
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toMatchObject({ duplicate: false, uploaded: false })
    close(id)
    const next = await create({ clientRef: crypto.randomUUID() })
    expect((await reserve(request(`/${next}/chunks`, system), params(next))).status).toBe(429)
    vi.setSystemTime(NOW + 86400_000)
    expect((await reserve(request(`/${next}/chunks`, system), params(next))).status).toBe(200)
  })

  it('accepts seven hours on each track under their independent limits', async () => {
    const id = await create()
    for (const track of ['mic', 'system']) {
      sqlite.prepare("INSERT INTO meeting_recording_chunks (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,created_at,updated_at) VALUES (?, ?, ?,999,0,?,'audio/wav',960044,'key','token','reserved',?,?)")
        .run(`used-${track}`, id, track, 7 * 60 * 60 * 1000, new Date(NOW).toISOString(), new Date(NOW).toISOString())
    }
    expect((await reserve(request(`/${id}/chunks`, metadata()), params(id))).status).toBe(200)
    expect((await reserve(request(`/${id}/chunks`, metadata({ track: 'system' })), params(id))).status).toBe(200)
    close(id)
    expect(await create({ clientRef: crypto.randomUUID() })).not.toBe(id)
  })

  it('keeps previous UTC-day mic audio charged until it is 24 hours old', async () => {
    const id = await create()
    sqlite.prepare("INSERT INTO meeting_recording_chunks (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,created_at,updated_at) VALUES ('used',?,'mic',999,0,?,'audio/wav',960044,'key','token','reserved',?,?)")
      .run(id, RECORDER_DAILY_AUDIO_MS, new Date(NOW - 60_000).toISOString(), new Date(NOW - 60_000).toISOString())
    close(id)
    expect((await createRecording(request('', input({ clientRef: crypto.randomUUID() })))).status).toBe(429)
    vi.setSystemTime(NOW + 86400_000 - 60_000)
    expect(await create({ clientRef: crypto.randomUUID() })).not.toBe(id)
  })
})

describe('upcoming calls endpoint', () => {
  it('does not widen an ordinary caller org scope just because their email is an attendee', async () => {
    seedCall('restricted-client')
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    h.deniedOrg = 'client-a'
    expect(await (await upcomingCalls(request('/upcoming-calls', undefined, 'GET', false))).json()).toEqual({ items: [] })
  })

  it('reads both call tables and never returns raw meeting URLs', async () => {
    seedCall('discovery')
    seedCall('scheduled', { kind: 'scheduled', offset: 60_000 })
    seedCall('other', { email: 'staci@tahi.studio' })
    const response = await upcomingCalls(request('/upcoming-calls'))
    expect(response.status).toBe(200)
    const body = await response.json() as { items: { id: string; kind: string }[] }
    expect(body.items.map(row => [row.id, row.kind])).toEqual([['discovery', 'discovery'], ['scheduled', 'scheduled']])
    expect(JSON.stringify(body)).not.toContain('private-room')
    expect(JSON.stringify(body)).not.toContain('business@')
  })
})
