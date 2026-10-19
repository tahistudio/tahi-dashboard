import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest, NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { MEETING_RECORDING_MIGRATION } from '@/lib/meeting-recordings-migration'
import { RECORDER_DEVICES_MIGRATION } from '@/lib/recorder-devices-migration'
import { RECORDING_MODEL } from '@/lib/meeting-recordings'
import { encodeRecordingPcmWav, parseRecordingPcmWav, RECORDING_GROUP_MODEL } from '@/lib/recording-group-audio'
import { readRecordingOptions } from '@/lib/recording-options'

const h = vi.hoisted(() => ({
  database: null as unknown,
  session: { userId: null as string | null, orgId: null as string | null, sessionId: null as string | null },
  device: { userId: 'liam', orgId: 'tahi', sessionId: null, recorderDevice: { id: 'device', teamMemberId: 'member-liam' } },
  valid: true, unavailable: false, failSideInsert: false, deniedOrg: null as string | null, bucket: null as unknown, ai: { run: vi.fn() }, queries: [] as string[],
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
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: { STORAGE: h.bucket, AI: h.ai } }) }))

import { GET as listRecordings, POST as createRecording } from '@/app/api/admin/recordings/route'
import { GET as readRecording } from '@/app/api/admin/recordings/[id]/route'
import { POST as reserve, PUT as upload } from '@/app/api/admin/recordings/[id]/chunks/route'
import { POST as stop } from '@/app/api/admin/recordings/[id]/stop/route'
import { POST as transcribe } from '@/app/api/admin/recordings/[id]/transcribe/route'
import { PATCH as rename } from '@/app/api/admin/recordings/[id]/speakers/route'
import type { MeetingRecordingDetail } from '@/lib/meeting-recordings-types'

interface SqlResult { results: Record<string, unknown>[]; success: boolean; meta: { changes: number } }
interface Statement {
  bind(...params: SQLInputValue[]): Statement
  execute(): SqlResult
  all(): Promise<SqlResult>
  run(): Promise<SqlResult>
  raw(): Promise<unknown[][]>
}
let sqlite: DatabaseSync
let objects: Map<string, ArrayBuffer>
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
  objects = new Map()
  h.bucket = {
    put: async (key: string, value: ArrayBuffer | string, options: { onlyIf?: R2Conditional }) => {
      if (options.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null
      objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value).buffer : value)
      return { key }
    },
    head: async (key: string) => objects.has(key) ? { size: objects.get(key)!.byteLength, customMetadata: {} } : null,
    get: async (key: string) => objects.has(key) ? { size: objects.get(key)!.byteLength, arrayBuffer: async () => objects.get(key)! } : null,
    delete: async () => undefined,
  }
  h.ai.run.mockReset()
})
afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks() })

const DEVICE_HEADERS = { authorization: 'Bearer tahi_rec_secret' }
/** 30 seconds of mono 16 kHz PCM, exactly what CanonicalWav.Write produces for a full tray chunk. */
const wav30 = encodeRecordingPcmWav(new Float32Array(30 * 16_000).fill(0.05))
/** The tray folds a 1.5 second tail into the last full chunk, so the final chunk can be up to 31.999 seconds. */
const wavTail = encodeRecordingPcmWav(new Float32Array(31.5 * 16_000).fill(0.05))

async function putChunk(id: string, track: 'mic' | 'system', sequence: number, audio: ArrayBuffer = wav30) {
  const durationMs = (audio.byteLength - 44) / 32
  const reserved = await reserve(request(`/${id}/chunks`, { track, sequence, startMs: sequence * 30_000, durationMs, mimeType: 'audio/wav', size: audio.byteLength }), params(id))
  expect(reserved.status).toBe(200)
  const { uploadUrl } = await reserved.json() as { uploadUrl: string }
  const stored = await upload(new NextRequest(`https://portal.tahi.studio${uploadUrl}`, { method: 'PUT', headers: DEVICE_HEADERS, body: audio }), params(id))
  expect(stored.status).toBe(200)
}

async function drain(id: string, limit = 120): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {}
  for (let step = 0; step < limit; step += 1) {
    const response = await transcribe(request(`/${id}/transcribe`, {}), params(id))
    expect(response.status).toBe(200)
    last = await response.json() as Record<string, unknown>
    const recording = last.recording as { state: string }
    if (recording.state === 'ready') return last
  }
  throw new Error('Transcription did not finish')
}

const modelCalls = (model: string) => h.ai.run.mock.calls.filter(call => call[0] === model)
const row = (id: string) => sqlite.prepare('SELECT * FROM meeting_recordings WHERE id = ?').get(id) as Record<string, unknown>

describe('tray recordings with speaker separation', () => {
  it('accepts separateSpeakers on create, stores it in the existing options JSON and marks the row as tray', async () => {
    const id = await create({ separateSpeakers: true })
    expect(readRecordingOptions(String(row(id).tracks))).toEqual({ tracks: ['mic', 'system'], separateSpeakers: true })
    expect(JSON.parse(String(row(id).tracks))).toEqual({ version: 1, tracks: ['mic', 'system'], separateSpeakers: true })
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    expect(await (await listRecordings(request('', undefined, 'GET', false))).json()).toMatchObject({
      items: [{ id, source: 'tray', separateSpeakers: true, tracks: ['mic', 'system'] }],
    })
    // The slim device response still never carries options, transcript text or speaker names.
    h.session = { userId: null, orgId: null, sessionId: null }
    expect(await (await readRecording(request(`/${id}`), params(id))).json()).toEqual({
      recording: { id, state: 'recording', expectedChunks: null, error: null }, chunks: [],
    })
  })

  it('leaves a tray recording without the flag on standard transcription and validates the flag', async () => {
    const standard = await create()
    expect(String(row(standard).tracks)).toBe('["mic","system"]')
    close(standard)
    for (const extra of [{ tracks: ['mic'], separateSpeakers: true }, { separateSpeakers: 'true' }, { separateSpeakers: 1 }]) {
      const response = await createRecording(request('', input({ clientRef: crypto.randomUUID(), ...extra })))
      expect(response.status, JSON.stringify(extra)).toBe(400)
    }
    const off = await create({ clientRef: crypto.randomUUID(), separateSpeakers: false })
    expect(String(row(off).tracks)).toBe('["mic","system"]')
  })

  it('returns the existing recording for a retried create and does not change its stored option', async () => {
    const first = await create({ separateSpeakers: true })
    const retry = await create({ separateSpeakers: false })
    expect(retry).toBe(first)
    expect(readRecordingOptions(String(row(first).tracks)).separateSpeakers).toBe(true)
  })

  it('runs one Nova inference over many 30 second tray chunks and keeps speaker identity across every chunk edge', async () => {
    const id = await create({ separateSpeakers: true })
    const full = 40
    for (let sequence = 0; sequence < full; sequence += 1) {
      await putChunk(id, 'mic', sequence)
      await putChunk(id, 'system', sequence)
    }
    await putChunk(id, 'mic', full, wavTail)
    await putChunk(id, 'system', full, wavTail)
    const durationMs = full * 30_000 + 31_500
    const stopped = await stop(request(`/${id}/stop`, { durationMs, expectedChunks: { mic: full + 1, system: full + 1 } }), params(id))
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({ recording: { state: 'transcribing' } })

    let whisper = 0
    h.ai.run.mockImplementation(async (model: string, body: { audio: unknown }) => {
      if (model === RECORDING_MODEL) { whisper += 1; return { text: `Mic ${whisper}`, segments: [{ start: 0, end: 1, text: `Mic ${whisper}` }] } }
      expect(model).toBe(RECORDING_GROUP_MODEL)
      const combined = parseRecordingPcmWav(await new Response((body.audio as { body: ReadableStream<Uint8Array> }).body).arrayBuffer())
      // Contiguous 30 second chunks plus the 31.5 second tail become one gapless timeline.
      expect(combined.sampleCount).toBe(durationMs * 16)
      return { results: { channels: [{ alternatives: [{ transcript: 'edge across mid tail', words: [
        { start: 29.8, end: 30.4, word: 'edge', speaker: 0 },
        { start: 30.5, end: 31, word: 'across', speaker: 1 },
        { start: 600.5, end: 601, word: 'mid', speaker: 0 },
        { start: 1230.2, end: 1231.4, word: 'tail', speaker: 1 },
      ] }] }] } }
    })
    const finished = await drain(id)
    // Slim device payload: no text of any kind.
    expect(JSON.stringify(finished)).not.toMatch(/edge|Mic 1|transcript|segments/)
    expect(modelCalls(RECORDING_GROUP_MODEL)).toHaveLength(1)
    expect(modelCalls(RECORDING_MODEL)).toHaveLength(full + 1)

    const system = sqlite.prepare("SELECT sequence,state,segments,attempts FROM meeting_recording_chunks WHERE recording_id = ? AND track = 'system' ORDER BY sequence").all(id)
    expect(system).toHaveLength(full + 1)
    expect(system.every(item => item.state === 'ready' && item.attempts === 1)).toBe(true)
    // A word that starts before a chunk edge stays in that chunk, clamped to its duration.
    const first = JSON.parse(String(system[0].segments)) as Array<{ end: number; text: string; speaker: number }>
    expect(first).toEqual([{ start: expect.closeTo(29.8), end: 30, text: 'edge', speaker: 0 }])
    expect(JSON.parse(String(system[1].segments))).toEqual([{ start: expect.closeTo(0.5), end: expect.closeTo(1), text: 'across', speaker: 1 }])
    expect(JSON.parse(String(system[20].segments))).toEqual([{ start: expect.closeTo(0.5), end: expect.closeTo(1), text: 'mid', speaker: 0 }])
    expect(JSON.parse(String(system[full].segments))).toEqual([{ start: expect.closeTo(30.2), end: expect.closeTo(31.4), text: 'tail', speaker: 1 }])
    expect(options(id).separateSpeakers).toBe(true)

    // The administrator sees speaker-labelled text and can rename a voice.
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    const detail = await (await readRecording(request(`/${id}`, undefined, 'GET', false), params(id))).json() as MeetingRecordingDetail
    expect(detail.transcript.text).toContain('Them 1: edge')
    expect(detail.transcript.text).toContain('Them 2: across')
    expect(detail.transcript.text).toContain('Liam Miller: Mic 1')
    const renamed = await rename(request(`/${id}/speakers`, { speakerNames: { 'system:0': 'Michael Day' } }, 'PATCH', false), params(id))
    expect(renamed.status).toBe(200)
    const after = await renamed.json() as MeetingRecordingDetail
    expect(after.transcript.text).toContain('Michael Day: edge')
    expect(after.transcript.text).toContain('Them 2: across')
    expect(sqlite.prepare('SELECT text FROM call_transcripts').get()).toEqual({ text: after.transcript.text })
    expect(options(id)).toMatchObject({ separateSpeakers: true, speakerNames: { 'system:0': 'Michael Day' } })
  })

  it('does not let a recorder device read or rename speakers', async () => {
    const id = await create({ separateSpeakers: true })
    expect((await rename(request(`/${id}/speakers`, { speakerNames: { mic: 'Liam' } }, 'PATCH'), params(id))).status).toBe(401)
    expect(options(id).speakerNames).toBeUndefined()
  })

  it('retries a failed Nova attempt and then falls back to per-chunk Whisper while keeping mic text', async () => {
    const id = await create({ separateSpeakers: true })
    for (const sequence of [0, 1]) { await putChunk(id, 'mic', sequence); await putChunk(id, 'system', sequence) }
    expect((await stop(request(`/${id}/stop`, { durationMs: 60_000, expectedChunks: { mic: 2, system: 2 } }), params(id))).status).toBe(200)
    const spoken = ['Starting the weekly review now', 'Pricing needs another look', 'Budget approvals arrive Friday', 'Contracts go out Monday']
    let whisper = 0
    h.ai.run.mockImplementation(async (model: string) => {
      if (model === RECORDING_GROUP_MODEL) throw new Error('Nova unavailable')
      const text = spoken[whisper % spoken.length]
      whisper += 1
      return { text, segments: [{ start: 1, end: 2, text }] }
    })
    const finished = await drain(id)
    expect(finished.recording).toMatchObject({ state: 'ready' })
    expect(modelCalls(RECORDING_GROUP_MODEL)).toHaveLength(2)
    expect(options(id).separateSpeakers).toBe(false)
    h.session = { userId: 'liam', orgId: 'tahi', sessionId: 'session' }
    const detail = await (await readRecording(request(`/${id}`, undefined, 'GET', false), params(id))).json() as MeetingRecordingDetail
    expect(detail.transcript.text.match(/Liam Miller: /g)).toHaveLength(2)
    expect(detail.transcript.text.match(/] Them: /g)).toHaveLength(2)
  })

  it('falls back to Whisper without calling Nova when the padded system timeline passes two hours', async () => {
    const id = await create({ separateSpeakers: true })
    const now = new Date(NOW).toISOString()
    const insert = sqlite.prepare(`INSERT INTO meeting_recording_chunks
      (id,recording_id,track,sequence,start_ms,duration_ms,mime_type,size,storage_key,upload_token,state,text,segments,attempts,uploaded_at,created_at,updated_at)
      VALUES (?,?,?,?,?,30000,'audio/wav',960044,?,?,?,?,?,1,?,?,?)`)
    for (let sequence = 0; sequence <= 240; sequence += 1) {
      insert.run(`${id}_system_${sequence}`, id, 'system', sequence, sequence * 30_000, `k/${id}/s${sequence}`, `t${sequence}`,
        sequence === 240 ? 'uploaded' : 'ready', sequence === 240 ? null : 'earlier', sequence === 240 ? null : '[{"start":1,"end":2,"text":"earlier"}]', now, now, now)
    }
    insert.run(`${id}_mic_0`, id, 'mic', 0, 0, `k/${id}/m0`, 'tm', 'ready', 'mine', '[{"start":1,"end":2,"text":"mine"}]', now, now, now)
    objects.set(`k/${id}/s240`, wav30)
    expect((await stop(request(`/${id}/stop`, { durationMs: 241 * 30_000, expectedChunks: { mic: 1, system: 241 } }), params(id))).status).toBe(200)
    h.ai.run.mockResolvedValue({ text: 'Last words', segments: [{ start: 1, end: 2, text: 'Last words' }] })
    const finished = await drain(id)
    expect(finished.recording).toMatchObject({ state: 'ready' })
    expect(modelCalls(RECORDING_GROUP_MODEL)).toHaveLength(0)
    expect(modelCalls(RECORDING_MODEL)).toHaveLength(1)
    expect(options(id).separateSpeakers).toBe(false)
  })
})

function options(id: string) { return readRecordingOptions(String(row(id).tracks)) }
