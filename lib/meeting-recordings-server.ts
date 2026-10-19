import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { schema, type DB } from '@/db/d1'
import { getRequestAuth, isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { discoveryCallScopeCondition, requireDiscoveryCallAccess } from '@/lib/discovery-call-access'
import { scopedOrgIds } from '@/lib/access-scope'
import { IMPERSONATE_ORG_COOKIE, resolvePreviewOrgId } from '@/lib/preview-cookie'
import { attributedUserId } from '@/lib/mcp-actor'
import { logAudit } from '@/lib/audit'
import { resolvePermissions } from '@/lib/permissions'
import { readRecordingOptions, writeRecordingOptions } from '@/lib/recording-options'
import { MAX_RECORDING_GROUP_DURATION_MS, parseRecordingPcmWav, RECORDING_GROUP_LEASE_MS, RECORDING_PCM_HEADER_BYTES, RECORDING_PCM_SAMPLE_RATE, transcribeRecordingGroup, type RecordingGroupAiBinding } from '@/lib/recording-group-audio'
import { hashTranscript, parseCallKind, resolveCallOrgId } from '@/lib/call-transcripts'
import { applySpeakerRenames, parseSpeakerRenames, recordingSpeakerNames, type RecordingSpeakerNames } from '@/lib/recording-speaker-names'
import {
  loadRecordingAi, MAX_RECORDING_CHUNK_BYTES, MAX_RECORDING_DURATION_MS,
  mergeRecordingTranscript, parseSegments, RecordingError, recordingId, recordingTranscriptSpeakers,
  RECORDING_LEASE_MS, transcribeRecordingAudio, validateChunk,
} from '@/lib/meeting-recordings'
import type { MeetingRecording, MeetingRecordingChunk, MeetingRecordingDetail, RecordingSpeaker, RecordingTrack } from '@/lib/meeting-recordings-types'
import { getRecorderDeviceAuth, isRecorderDeviceRequest, RecorderDeviceAuthError, type RecorderDeviceAuth } from '@/lib/recorder-device-auth'
import { assertRecorderOwnership, RECORDER_DAILY_AUDIO_MS, recorderAudioQuota, recorderClientRef, recorderQuotaStart, recorderRecording, recorderRecordingDetail, type RecorderRecording, type RecorderRecordingDetail } from '@/lib/recorder-recordings'
import { recorderUpcomingCalls } from '@/lib/recorder-upcoming-calls'

type RecordingRow = typeof schema.meetingRecordings.$inferSelect
type ChunkRow = typeof schema.meetingRecordingChunks.$inferSelect
const recordings = schema.meetingRecordings
const chunks = schema.meetingRecordingChunks

/** The tray joins up to 10 minutes early plus its 2 minute window lead. */
const RECORDER_EARLY_LINK_MS = 12 * 60_000

export interface RecordingContext {
  database: DB
  auth: RequestAuthResult & { recorderDevice?: RecorderDeviceAuth['recorderDevice'] }
  recording?: RecordingRow
}

function jsonValue<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

function publicRecording(row: RecordingRow, source: 'browser' | 'tray' = 'browser'): MeetingRecording {
  const options = readRecordingOptions(row.tracks)
  return {
    id: row.id, source, title: row.title, orgId: row.orgId, callKind: row.callKind, callId: row.callId,
    createdById: row.createdById, ...options, speakerNames: options.speakerNames ?? {},
    state: row.state, startedAt: row.startedAt, stoppedAt: row.stoppedAt, durationMs: row.durationMs,
    expectedChunks: jsonValue(row.expectedChunks, null), transcriptId: row.transcriptId,
    error: row.error, deletedAt: row.deletedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function publicChunk(row: ChunkRow): MeetingRecordingChunk {
  return {
    id: row.id, recordingId: row.recordingId, track: row.track, sequence: row.sequence,
    startMs: row.startMs, durationMs: row.durationMs, mimeType: row.mimeType, size: row.size,
    state: row.state, text: row.text, segments: parseSegments(jsonValue(row.segments, []), row.durationMs),
    error: row.error, attempts: row.attempts,
  }
}

export async function readRecording(database: DB, id: string): Promise<RecordingRow> {
  const [row] = await database.select().from(recordings).where(eq(recordings.id, id)).limit(1)
  if (!row) throw new RecordingError('Recording not found.', 404)
  return row
}

async function readChunks(database: DB, id: string): Promise<ChunkRow[]> {
  return database.select().from(chunks).where(eq(chunks.recordingId, id)).orderBy(asc(chunks.startMs), asc(chunks.sequence))
}

async function speakerNames(database: DB, row: Pick<RecordingRow, 'createdById' | 'orgId' | 'callKind' | 'callId'>): Promise<RecordingSpeakerNames> {
  const team = await database.select({
    id: schema.teamMembers.id, clerkUserId: schema.teamMembers.clerkUserId,
    name: schema.teamMembers.name, email: schema.teamMembers.email,
  }).from(schema.teamMembers)
  let attendees: string | null = null
  if (row.callId && row.callKind) {
    const table = row.callKind === 'discovery' ? schema.discoveryCalls : schema.scheduledCalls
    const [call] = await database.select({ attendees: table.attendees }).from(table).where(eq(table.id, row.callId)).limit(1)
    attendees = call?.attendees ?? null
  }
  let clientName: string | null = null
  if (row.orgId) {
    const [client] = await database.select({ name: schema.organisations.name }).from(schema.organisations)
      .where(eq(schema.organisations.id, row.orgId)).limit(1)
    clientName = client?.name ?? null
  }
  return recordingSpeakerNames(row.createdById, team, attendees, clientName)
}

/** One renderer for every place transcript text is produced: names, renames and echo removal. */
async function renderTranscript(database: DB, row: RecordingRow, chunkRows: readonly MeetingRecordingChunk[]): Promise<string> {
  return mergeRecordingTranscript(chunkRows, await speakerNames(database, row), readRecordingOptions(row.tracks).speakerNames)
}

export async function recordingDetail(database: DB, id: string, preparedRow?: RecordingRow): Promise<MeetingRecordingDetail> {
  const row = preparedRow ?? await readRecording(database, id)
  const chunkRows = (await readChunks(database, id)).map(publicChunk)
  const names = await speakerNames(database, row)
  const overrides = readRecordingOptions(row.tracks).speakerNames
  let text = mergeRecordingTranscript(chunkRows, names, overrides)
  if (row.transcriptId) {
    const [transcript] = await database.select({ text: schema.callTranscripts.text })
      .from(schema.callTranscripts).where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
    text = transcript?.text ?? text
  }
  const speakers = recordingTranscriptSpeakers(chunkRows, names, overrides)
  return { recording: publicRecording(row), chunks: chunkRows, transcript: { id: row.transcriptId, text }, speakers }
}

export async function scopedRecordingDetail(context: RecordingContext, id: string): Promise<MeetingRecordingDetail> {
  if (context.auth.recorderDevice) throw new RecordingError('Unauthorised', 401)
  const row = await readRecording(context.database, id)
  const parentDenied = await recordingCallAccess(context.database, context.auth, row)
  if (parentDenied) throw new RecordingError('Forbidden', parentDenied.status)
  const detail = await recordingDetail(context.database, id, row)
  const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, detail.recording.orgId)
  if (denied) throw new RecordingError('Forbidden', denied.status)
  return detail
}

async function recordingCallAccess(database: DB, auth: RequestAuthResult, row: Pick<RecordingRow, 'callKind' | 'callId'>) {
  return row.callKind === 'discovery' && row.callId
    ? requireDiscoveryCallAccess(database, auth, row.callId)
    : null
}

/** Device responses never load transcript text, segments or chunk text. */
export async function recordingResponse(context: RecordingContext, id: string): Promise<MeetingRecordingDetail | RecorderRecordingDetail> {
  if (context.auth.recorderDevice) return recorderRecordingDetail(context.database, context.auth as RecorderDeviceAuth, id)
  return scopedRecordingDetail(context, id)
}

/** All routes fail closed before reading any audio or recording metadata. */
export async function withRecordingContext(
  req: NextRequest, id: string | undefined,
  work: (context: RecordingContext) => Promise<NextResponse>,
  options?: { device: 'create' | 'chunk' | 'stop' | 'transcribe' | 'read' },
): Promise<NextResponse> {
  try {
    let auth: RecordingContext['auth'] = await getRequestAuth(req)
    if (isRecorderDeviceRequest(req)) {
      // Even an unrelated session cookie cannot widen a recorder token.
      if (!options || auth.userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
      if (!auth.userId) auth = await getRecorderDeviceAuth(req) ?? auth
    }
    if (!auth.userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isTahiAdmin(auth.orgId) || resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const featureDenied = await requireFeature(auth, 'calls')
    if (featureDenied) return featureDenied
    const database = await db()
    if (id && auth.recorderDevice) await assertRecorderOwnership(database, auth as RecorderDeviceAuth, recordingId(id))
    const row = id ? await readRecording(database, recordingId(id)) : undefined
    if (row) {
      const parentDenied = await recordingCallAccess(database, auth, row)
      if (parentDenied) return parentDenied
      const denied = await requireAccessToOrgOrPreClient(database, auth.userId, row.orgId)
      if (denied) return denied
    }
    return await work({ database, auth, recording: row })
  } catch (error) {
    if (error instanceof RecorderDeviceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Retry-After': String(error.retryAfter) } })
    }
    if (error instanceof RecordingError) {
      return NextResponse.json({ error: error.message, code: error.code, duplicate: error.code === 'duplicate', uploaded: error.code === 'duplicate' }, { status: error.status })
    }
    console.error('Meeting recording route failed:', error)
    return NextResponse.json({ error: 'The recording operation failed. Your saved audio is retained; retry the action.' }, { status: 503 })
  }
}

async function storage(): Promise<R2Bucket> {
  const { env } = await getCloudflareContext({ async: true })
  if (!env?.STORAGE) throw new RecordingError('Audio storage is unavailable. Retry the upload.', 503)
  return env.STORAGE as R2Bucket
}

/** A database compare-and-swap settles concurrent retries before any R2/AI write. */
export async function withRecordingLease<T>(context: RecordingContext, work: (row: RecordingRow, token: string, extendLease: (durationMs: number) => Promise<void>) => Promise<T>, allowDeleted = false, leaseMs = RECORDING_LEASE_MS): Promise<T> {
  const id = context.recording?.id
  if (!id) throw new RecordingError('Recording not found.', 404)
  const now = new Date().toISOString()
  const token = crypto.randomUUID()
  const claimed = await context.database.update(recordings).set({
    leaseToken: token, leaseUntil: new Date(Date.now() + leaseMs).toISOString(),
  }).where(and(eq(recordings.id, id), allowDeleted ? undefined : isNull(recordings.deletedAt),
    or(isNull(recordings.leaseToken), lt(recordings.leaseUntil, now)))).returning()
  if (!claimed.length) {
    if ((await readRecording(context.database, id)).deletedAt) throw new RecordingError('Recording audio has been deleted.', 410)
    throw new RecordingError('Another recording action is finishing. Retry shortly.', 409, 'busy')
  }
  let renewal = Promise.resolve()
  let renewalError: unknown
  let activeLeaseMs = leaseMs
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const startHeartbeat = () => {
    if (heartbeat !== undefined || activeLeaseMs <= RECORDING_LEASE_MS) return
    heartbeat = setInterval(() => {
      renewal = renewal.then(async () => {
        await updateLeased(context, token, { leaseUntil: new Date(Date.now() + activeLeaseMs).toISOString() })
      }).catch(error => { renewalError = error })
    }, 60_000)
  }
  const extendLease = async (durationMs: number) => {
    await updateLeased(context, token, { leaseUntil: new Date(Date.now() + durationMs).toISOString() })
    activeLeaseMs = durationMs
    startHeartbeat()
  }
  startHeartbeat()
  try {
    const parentDenied = await recordingCallAccess(context.database, context.auth, claimed[0])
    if (parentDenied) throw new RecordingError('Forbidden', parentDenied.status)
    const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, claimed[0].orgId)
    if (denied) throw new RecordingError('Forbidden', denied.status)
    const result = await work(claimed[0], token, extendLease)
    if (renewalError) throw renewalError
    return result
  }
  finally {
    if (heartbeat !== undefined) clearInterval(heartbeat)
    await renewal
    await context.database.update(recordings).set({ leaseToken: null, leaseUntil: null })
      .where(and(eq(recordings.id, id), eq(recordings.leaseToken, token)))
  }
}

function chunkFence(id: string, recording: string, token: string) {
  return and(eq(chunks.id, id), sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${recording} AND lease_token = ${token})`)
}

async function updateLeased(context: RecordingContext, token: string, values: Partial<typeof recordings.$inferInsert>): Promise<void> {
  const result = await context.database.update(recordings).set({ ...values, updatedAt: new Date().toISOString() })
    .where(and(eq(recordings.id, context.recording!.id), eq(recordings.leaseToken, token)))
    .returning({ id: recordings.id })
  if (!result.length) throw new RecordingError('The operation expired. Retry the saved recording.', 409, 'busy')
}

async function choice(context: RecordingContext, value: unknown): Promise<{ orgId: string | null; callKind: 'discovery' | 'scheduled' | null; callId: string | null }> {
  const body = value as { orgId?: unknown; callKind?: unknown; callId?: unknown }
  if (body.callId != null || body.callKind != null) {
    if (body.orgId !== undefined) throw new RecordingError('Choose a client or a call, not both.')
    const kind = parseCallKind(body.callKind)
    if (!kind) throw new RecordingError('Choose a discovery or scheduled call.')
    const id = recordingId(body.callId)
    if (kind === 'discovery') {
      const parentDenied = await requireDiscoveryCallAccess(context.database, context.auth, id)
      if (parentDenied) throw new RecordingError('Forbidden', parentDenied.status)
    }
    const target = await resolveCallOrgId(context.database, kind, id)
    if (!target.found) throw new RecordingError('Call not found.', 404)
    const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, target.orgId)
    if (denied) throw new RecordingError('Forbidden', denied.status)
    return { orgId: target.orgId, callKind: kind, callId: id }
  }
  const orgId = body.orgId == null ? null : recordingId(body.orgId)
  if (orgId) {
    const [org] = await context.database.select({ id: schema.organisations.id }).from(schema.organisations).where(eq(schema.organisations.id, orgId)).limit(1)
    if (!org) throw new RecordingError('Client not found.', 404)
  }
  const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, orgId)
  if (denied) throw new RecordingError('Forbidden', denied.status)
  return { orgId, callKind: null, callId: null }
}

async function createDeviceRecording(
  context: RecordingContext, body: Record<string, unknown>, title: string,
): Promise<RecorderRecording> {
  const auth = context.auth as RecorderDeviceAuth
  const clientRef = recorderClientRef(body.clientRef)
  if (body.callId != null && body.callKind == null) throw new RecordingError('callKind is required when callId is supplied.')
  const devices = schema.recorderRecordings
  const existing = async () => {
    const [found] = await context.database.select({ id: devices.recordingId }).from(devices)
      .where(and(eq(devices.deviceId, auth.recorderDevice.id), eq(devices.clientRef, clientRef))).limit(1)
    if (!found) return null
    await assertRecorderOwnership(context.database, auth, found.id)
    return recorderRecording(publicRecording(await readRecording(context.database, found.id), 'tray'))
  }
  const previous = await existing()
  if (previous) return previous
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const openCutoff = new Date(nowMs - MAX_RECORDING_DURATION_MS - 60 * 60 * 1000).toISOString()
  const calls = body.callId ? await recorderUpcomingCalls(context.database, auth, nowMs) : []
  const call = calls.find(candidate => candidate.id === body.callId && candidate.kind === body.callKind
    && nowMs >= candidate.startMs - RECORDER_EARLY_LINK_MS && nowMs <= candidate.endMs + 600_000)
  const target = call ? await choice(context, { callId: call.id, callKind: call.kind })
    : { orgId: null, callKind: null, callId: null }
  const id = crypto.randomUUID()
  // D1 batch is transactional. The guarded insert and side row cannot race a
  // concurrent create, leave an orphan or admit a second open recording.
  await context.database.$client.batch([
    context.database.$client.prepare(`INSERT INTO meeting_recordings
      (id, title, org_id, call_kind, call_id, created_by_id, tracks, state, started_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'recording', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM recorder_recordings WHERE device_id = ? AND client_ref = ?)
      AND NOT EXISTS (SELECT 1 FROM recorder_recordings rr INNER JOIN meeting_recordings mr ON mr.id = rr.recording_id
        WHERE rr.device_id = ? AND mr.stopped_at IS NULL AND mr.deleted_at IS NULL AND mr.created_at >= ?)
      AND (SELECT COALESCE(SUM(c.duration_ms), 0) FROM meeting_recording_chunks c
        INNER JOIN recorder_recordings rr ON rr.recording_id = c.recording_id
        WHERE rr.device_id = ? AND c.track = 'mic' AND c.created_at > ?) < ?`)
      .bind(id, title, target.orgId, target.callKind, target.callId, auth.userId,
        writeRecordingOptions(body.tracks as RecordingTrack[], body.separateSpeakers === true), now, now, now,
        auth.recorderDevice.id, clientRef, auth.recorderDevice.id, openCutoff,
        auth.recorderDevice.id, recorderQuotaStart(new Date(nowMs)), RECORDER_DAILY_AUDIO_MS),
    context.database.$client.prepare(`INSERT INTO recorder_recordings
      (recording_id, device_id, team_member_id, client_ref, call_id, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ?)`)
      .bind(id, auth.recorderDevice.id, auth.recorderDevice.teamMemberId, clientRef, target.callId, now, id),
  ])
  const created = await existing()
  if (!created) {
    const [open] = await context.database.all<{ id: string }>(sql`SELECT mr.id FROM recorder_recordings rr
      INNER JOIN meeting_recordings mr ON mr.id = rr.recording_id
      WHERE rr.device_id = ${auth.recorderDevice.id} AND mr.stopped_at IS NULL AND mr.deleted_at IS NULL
        AND mr.created_at >= ${openCutoff} LIMIT 1`)
    if (open) throw new RecordingError('This device already has an open recording.', 429, 'open_recording')
    throw new RecordingError('This device has reached its rolling 24-hour microphone audio limit.', 429, 'daily_quota')
  }
  return created
}

export async function createRecording(context: RecordingContext, value: unknown): Promise<MeetingRecording | RecorderRecording> {
  if (!value || typeof value !== 'object') throw new RecordingError('Recording details are required.')
  const body = value as Record<string, unknown>
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  if (!title) throw new RecordingError('A recording title is required.')
  if (!Array.isArray(body.tracks) || !body.tracks.includes('mic') || body.tracks.length > 2
    || new Set(body.tracks).size !== body.tracks.length || body.tracks.some(track => track !== 'mic' && track !== 'system')) {
    throw new RecordingError('Choose microphone and optionally system audio.')
  }
  if (body.separateSpeakers !== undefined && typeof body.separateSpeakers !== 'boolean') {
    throw new RecordingError('Separate speakers must be a boolean.')
  }
  if (body.separateSpeakers === true && !body.tracks.includes('system')) {
    throw new RecordingError('Separate speakers requires system audio. Turn it off for a microphone-only recording.')
  }
  if (context.auth.recorderDevice) {
    return createDeviceRecording(context, body, title)
  }
  const target = await choice(context, body)
  const now = new Date().toISOString()
  const [row] = await context.database.insert(recordings).values({
    id: crypto.randomUUID(), title, ...target, createdById: attributedUserId(context.auth)!,
    tracks: writeRecordingOptions(body.tracks as RecordingTrack[], body.separateSpeakers === true), state: 'recording', startedAt: now, createdAt: now, updatedAt: now,
  }).returning()
  return publicRecording(row)
}

export async function listRecordings(context: RecordingContext): Promise<MeetingRecording[] | RecorderRecordingDetail[]> {
  if (context.auth.recorderDevice) {
    const auth = context.auth as RecorderDeviceAuth
    const owned = await context.database.select({
      id: recordings.id, state: recordings.state, expectedChunks: recordings.expectedChunks, error: recordings.error,
    }).from(schema.recorderRecordings).innerJoin(recordings, eq(recordings.id, schema.recorderRecordings.recordingId))
      .where(and(eq(schema.recorderRecordings.deviceId, auth.recorderDevice.id),
        eq(schema.recorderRecordings.teamMemberId, auth.recorderDevice.teamMemberId)))
      .orderBy(desc(schema.recorderRecordings.createdAt)).limit(100)
    if (!owned.length) return []
    const chunkRows = await context.database.select({
      recordingId: chunks.recordingId, track: chunks.track, sequence: chunks.sequence,
      uploadedAt: chunks.uploadedAt, state: chunks.state, error: chunks.error,
    }).from(chunks).where(inArray(chunks.recordingId, owned.map(row => row.id)))
      .orderBy(asc(chunks.startMs), asc(chunks.sequence))
    const grouped = new Map<string, RecorderRecordingDetail['chunks']>()
    for (const { recordingId, uploadedAt, ...chunk } of chunkRows) {
      const list = grouped.get(recordingId) ?? []
      list.push({ ...chunk, uploaded: uploadedAt !== null })
      grouped.set(recordingId, list)
    }
    return owned.map(row => ({ recording: { ...row, expectedChunks: jsonValue(row.expectedChunks, null) }, chunks: grouped.get(row.id) ?? [] }))
  }
  const scope = await scopedOrgIds(context.auth)
  if (scope.kind === 'none') return []
  const callScope = discoveryCallScopeCondition(scope)
  const rows = await context.database.select().from(recordings)
    .where(scope.kind === 'some' ? and(
      or(isNull(recordings.orgId), inArray(recordings.orgId, scope.orgIds)),
      sql`(${recordings.callKind} IS NULL OR ${recordings.callKind} <> 'discovery' OR ${recordings.callId} IS NULL OR EXISTS (
        SELECT 1 FROM ${schema.discoveryCalls} WHERE ${schema.discoveryCalls.id} = ${recordings.callId} AND ${callScope}
      ))`,
    ) : undefined)
    .orderBy(desc(recordings.createdAt)).limit(100)
  const trayRows = rows.length ? await context.database.select({ id: schema.recorderRecordings.recordingId }).from(schema.recorderRecordings)
    .where(inArray(schema.recorderRecordings.recordingId, rows.map(row => row.id))) : []
  const trayIds = new Set(trayRows.map(row => row.id))
  return rows.map(row => publicRecording(row, trayIds.has(row.id) ? 'tray' : 'browser'))
}

export async function reserveChunk(context: RecordingContext, value: unknown): Promise<{ uploadUrl: string; duplicate: boolean; uploaded: boolean }> {
  const metadata = validateChunk(value)
  if (context.auth.recorderDevice && (metadata.mimeType !== 'audio/wav'
    || metadata.size !== RECORDING_PCM_HEADER_BYTES + metadata.durationMs * RECORDING_PCM_SAMPLE_RATE * 2 / 1000)) {
    throw new RecordingError('Tray audio must be mono 16 kHz PCM WAV with its exact duration and size.')
  }
  return withRecordingLease(context, async (row, lease) => {
    if (row.transcriptId) throw new RecordingError('This recording has already been transcribed.', 409)
    const { tracks, separateSpeakers } = readRecordingOptions(row.tracks)
    if (!tracks.includes(metadata.track)) throw new RecordingError('This track was not enabled for this recording.')
    if (separateSpeakers && metadata.track === 'system' && metadata.mimeType !== 'audio/wav') {
      throw new RecordingError('Group speaker separation requires WAV system audio. Start a new recording with the group option enabled.')
    }
    const expected = jsonValue<{ mic: number; system: number } | null>(row.expectedChunks, null)
    if (expected && metadata.sequence >= expected[metadata.track]) throw new RecordingError('Chunk is outside the stopped recording.', 409)
    const now = new Date().toISOString()
    const id = `${row.id}_${metadata.track}_${metadata.sequence}`
    const inserted = await context.database.run(sql`INSERT INTO meeting_recording_chunks
      (id, recording_id, track, sequence, start_ms, duration_ms, mime_type, size, storage_key, upload_token, state, created_at, updated_at)
      SELECT ${id}, ${row.id}, ${metadata.track}, ${metadata.sequence}, ${metadata.startMs}, ${metadata.durationMs},
        ${metadata.mimeType}, ${metadata.size}, ${`meeting-recordings/${row.id}/${metadata.track}/${metadata.sequence}.audio`},
        ${crypto.randomUUID()}, 'reserved', ${now}, ${now}
      WHERE EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease} AND deleted_at IS NULL)
      AND ${context.auth.recorderDevice ? recorderAudioQuota(context.auth.recorderDevice.id, metadata.track, metadata.durationMs) : sql`1 = 1`}
      ON CONFLICT (recording_id, track, sequence) DO NOTHING`)
    const [chunk] = await context.database.select().from(chunks).where(eq(chunks.id, id)).limit(1)
    if (!chunk && context.auth.recorderDevice) throw new RecordingError(`This device has reached its rolling 24-hour ${metadata.track === 'mic' ? 'microphone' : 'system'} audio limit.`, 429, 'daily_quota')
    if (!chunk || (['startMs', 'durationMs', 'mimeType', 'size'] as const).some(key => chunk[key] !== metadata[key])) {
      throw new RecordingError('A different chunk already uses this sequence.', 409)
    }
    return {
      uploadUrl: `/api/admin/recordings/${row.id}/chunks?track=${metadata.track}&sequence=${metadata.sequence}&token=${chunk.uploadToken}`,
      duplicate: context.auth.recorderDevice ? chunk.uploadedAt !== null : inserted.meta.changes === 0,
      uploaded: chunk.uploadedAt !== null,
    }
  })
}

async function boundedBody(req: NextRequest, size: number): Promise<ArrayBuffer> {
  const declared = req.headers.get('content-length')
  if (declared && Number(declared) !== size) throw new RecordingError('Chunk body size does not match its reservation.')
  if (!req.body) throw new RecordingError('Audio body is required.')
  const reader = req.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > size || length > MAX_RECORDING_CHUNK_BYTES) {
      await reader.cancel()
      throw new RecordingError('Audio body exceeds its reservation.', 413)
    }
    parts.push(value)
  }
  if (length !== size) throw new RecordingError('Chunk body size does not match its reservation.')
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result.buffer
}

export async function uploadChunk(context: RecordingContext, req: NextRequest): Promise<void> {
  const url = new URL(req.url)
  const track = url.searchParams.get('track')
  const sequence = Number(url.searchParams.get('sequence'))
  const token = url.searchParams.get('token')
  if ((track !== 'mic' && track !== 'system') || !Number.isInteger(sequence) || sequence < 0 || !token) {
    throw new RecordingError('Upload reservation is invalid.')
  }
  await withRecordingLease(context, async (row, lease) => {
    const [chunk] = await context.database.select().from(chunks)
      .where(and(eq(chunks.recordingId, row.id), eq(chunks.track, track), eq(chunks.sequence, sequence))).limit(1)
    if (!chunk || chunk.uploadToken !== token) throw new RecordingError('Upload reservation not found.', 404)
    if (chunk.uploadedAt) throw new RecordingError('This chunk has already been uploaded.', 409, 'duplicate')
    if (row.transcriptId) throw new RecordingError('This recording is already complete.', 409)
    const audio = await boundedBody(req, chunk.size)
    if (context.auth.recorderDevice) {
      try {
        if (chunk.mimeType !== 'audio/wav' || parseRecordingPcmWav(audio).sampleCount !== chunk.durationMs * RECORDING_PCM_SAMPLE_RATE / 1000) {
          throw new Error('Duration mismatch')
        }
      } catch { throw new RecordingError('Tray audio must be a complete mono 16 kHz PCM WAV matching its reservation.') }
    }
    const bucket = await storage()
    const active = await readRecording(context.database, row.id)
    if (active.leaseToken !== lease || active.deletedAt) throw new RecordingError('Upload expired. Retry the saved audio chunk.', 409, 'busy')
    await context.database.update(chunks).set({ state: 'uploading', error: null }).where(chunkFence(chunk.id, row.id, lease))
    try {
      // R2Conditional's wildcard makes this write atomic and create-only, even
      // if a retry outlives its lease. A UNIQUE(recording_id, track, sequence)
      // reservation owns the upload token; head validates an existing upload
      // before acknowledging a retry instead of overwriting its audio.
      const stored = await bucket.put(chunk.storageKey, audio, {
        onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: chunk.mimeType },
        customMetadata: { recordingId: row.id, track, sequence: String(sequence), uploadToken: token },
      })
      if (!stored) {
        const existing = await bucket.head(chunk.storageKey)
        if (!existing || existing.size !== chunk.size || existing.customMetadata?.uploadToken !== token) {
          throw new RecordingError('Saved audio does not match this chunk reservation.', 409)
        }
      }
      await updateLeased(context, lease, { error: null })
      const now = new Date().toISOString()
      await context.database.update(chunks).set({ state: 'uploaded', uploadedAt: now, error: null, updatedAt: now }).where(chunkFence(chunk.id, row.id, lease))
    } catch (error) {
      await context.database.update(chunks).set({ state: 'reserved', error: 'Upload failed. Retry this saved chunk.' }).where(chunkFence(chunk.id, row.id, lease))
      // A lease can expire while R2 is answering. A late upload must never
      // recreate audio whose deletion has already won the recording lease.
      if ((await readRecording(context.database, row.id)).deletedAt) await bucket.delete(chunk.storageKey)
      throw error
    }
  })
}

function expectedCounts(value: unknown, tracks: RecordingTrack[]): { mic: number; system: number } {
  if (!value || typeof value !== 'object') throw new RecordingError('Expected chunk counts are required.')
  const body = value as Record<string, unknown>
  for (const track of ['mic', 'system'] as const) {
    const count = body[track]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 1501
      || (!tracks.includes(track) && count !== 0)) throw new RecordingError('Expected chunk counts are invalid.')
  }
  return { mic: body.mic as number, system: body.system as number }
}

function allExpected(rows: ChunkRow[], expected: { mic: number; system: number }, uploaded = false): boolean {
  return (['mic', 'system'] as const).every(track => {
    const found = rows.filter(chunk => chunk.track === track).sort((a, b) => a.sequence - b.sequence)
    return found.length === expected[track] && found.every((chunk, index) => chunk.sequence === index && (!uploaded || chunk.uploadedAt !== null))
  })
}

function emptyStoppedRecording(row: RecordingRow): boolean {
  const expected = jsonValue<{ mic: number; system: number } | null>(row.expectedChunks, null)
  return row.state === 'failed' && !!row.stoppedAt && expected?.mic === 0 && expected.system === 0
}

export async function stopRecording(context: RecordingContext, value: unknown): Promise<MeetingRecordingDetail | RecorderRecordingDetail> {
  if (!value || typeof value !== 'object') throw new RecordingError('Stopped recording details are required.')
  const body = value as Record<string, unknown>
  await withRecordingLease(context, async (row, lease) => {
    if (row.state === 'ready' || emptyStoppedRecording(row)) return
    if (typeof body.durationMs !== 'number' || !Number.isInteger(body.durationMs) || body.durationMs < 0
      || (body.durationMs === 0 && !context.auth.recorderDevice)
      || body.durationMs > MAX_RECORDING_DURATION_MS) throw new RecordingError('Recording duration is invalid.')
    const found = await readChunks(context.database, row.id)
    const inferred = { mic: 0, system: 0 }
    for (const chunk of found) inferred[chunk.track] = Math.max(inferred[chunk.track], chunk.sequence + 1)
    // A reopened crashed recording can stop from its durable server chunks.
    const expected = expectedCounts(body.expectedChunks ?? (row.expectedChunks ? jsonValue(row.expectedChunks, inferred) : inferred),
      readRecordingOptions(row.tracks).tracks)
    if (context.auth.recorderDevice && !expected.mic && !expected.system && !found.length) {
      await updateLeased(context, lease, {
        stoppedAt: row.stoppedAt ?? new Date().toISOString(), durationMs: body.durationMs,
        expectedChunks: JSON.stringify(expected), state: 'failed', error: 'No audio was captured. Start a new recording.',
      })
      return
    }
    if (body.durationMs === 0) throw new RecordingError('Recording duration is invalid.')
    if (!expected.mic) throw new RecordingError('No microphone audio was captured. Retry recording.')
    if (readRecordingOptions(row.tracks).tracks.includes('system') && !expected.system) {
      throw new RecordingError('No system audio chunks were captured. Recover and retry their uploads before stopping this recording.')
    }
    if (found.some(chunk => chunk.sequence >= expected[chunk.track] || chunk.startMs + chunk.durationMs > (body.durationMs as number) + 1000)) {
      throw new RecordingError('Stopped recording counts or duration omit an existing chunk.')
    }
    const complete = allExpected(found, expected, true)
    await updateLeased(context, lease, {
      stoppedAt: row.stoppedAt ?? new Date().toISOString(), durationMs: body.durationMs as number,
      expectedChunks: JSON.stringify(expected), state: complete ? 'transcribing' : 'uploading',
      error: complete ? null : 'Some audio chunks are still uploading. Retry their uploads before transcribing.',
    })
  })
  return recordingResponse(context, context.recording!.id)
}

function discoveryMirrorStatement(
  context: RecordingContext, text: string, target: { callKind: string | null; callId: string | null },
  lease: string, previousText?: string,
) {
  if (target.callKind !== 'discovery' || !target.callId) return null
  return context.database.update(schema.discoveryCalls).set({ transcript: text.slice(0, 250_000), transcriptSource: 'manual', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.discoveryCalls.id, target.callId), or(
      isNull(schema.discoveryCalls.transcript), eq(schema.discoveryCalls.transcript, ''),
      previousText === undefined ? undefined : and(eq(schema.discoveryCalls.transcriptSource, 'manual'), eq(schema.discoveryCalls.transcript, previousText.slice(0, 250_000))),
    ),
      sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${context.recording!.id} AND lease_token = ${lease})`))
    .returning({ id: schema.discoveryCalls.id })
}

async function mirrorDiscovery(
  context: RecordingContext, text: string, target: { callKind: string | null; callId: string | null },
  lease: string, previousText?: string,
): Promise<boolean> {
  const statement = discoveryMirrorStatement(context, text, target, lease, previousText)
  return statement ? (await statement).length > 0 : false
}

async function finalizeRecording(context: RecordingContext, row: RecordingRow, lease: string, found: ChunkRow[]): Promise<void> {
  const text = await renderTranscript(context.database, row, found.map(publicChunk))
  if (!text.trim()) {
    await updateLeased(context, lease, { state: 'failed', error: 'No speech was detected in the saved audio.' })
    return
  }
  const transcriptId = row.transcriptId ?? row.id
  const externalId = `recording:${row.id}`
  const [previous] = await context.database.select({ text: schema.callTranscripts.text }).from(schema.callTranscripts)
    .where(and(eq(schema.callTranscripts.source, 'manual'), eq(schema.callTranscripts.externalId, externalId))).limit(1)
  await context.database.run(sql`INSERT INTO call_transcripts
    (id, source, external_id, title, received_at, hash, text, call_kind, call_id, matched_by, unlinked_reason, created_at)
    SELECT ${transcriptId}, 'manual', ${externalId}, ${row.title}, ${row.startedAt}, ${hashTranscript(text)}, ${text},
      ${row.callKind}, ${row.callId}, ${row.callId ? 'manual' : null}, ${row.callId ? null : 'no_match'}, ${new Date().toISOString()}
    WHERE EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})
    ON CONFLICT (source, external_id) DO UPDATE SET text = excluded.text, hash = excluded.hash`)
  const [filed] = await context.database.select({ id: schema.callTranscripts.id }).from(schema.callTranscripts)
    .where(and(eq(schema.callTranscripts.source, 'manual'), eq(schema.callTranscripts.externalId, externalId))).limit(1)
  if (!filed) throw new RecordingError('Transcript could not be saved. Retry the saved audio.', 503)
  await mirrorDiscovery(context, text, row, lease, previous?.text)
  await updateLeased(context, lease, { transcriptId: filed.id, state: 'ready', error: null })
}

async function transcribeSystemGroup(context: RecordingContext, row: RecordingRow, lease: string, found: ChunkRow[]): Promise<void> {
  const system = found.filter(chunk => chunk.track === 'system').sort((a, b) => a.sequence - b.sequence)
  if (!system.length) throw new RecordingError('No system audio is available for speaker separation.', 409)
  await context.database.update(chunks).set({ state: 'transcribing', attempts: sql`${chunks.attempts} + 1`, error: null })
    .where(and(eq(chunks.recordingId, row.id), eq(chunks.track, 'system'),
      sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`))
  const ai = await loadRecordingAi()
  const bucket = await storage()
  const resultKey = `meeting-recordings/${row.id}/system/nova-3.json`
  const readResult = async () => {
    const object = await bucket.get(resultKey)
    return object ? { value: JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as unknown } : null
  }
  const result = await transcribeRecordingGroup(ai as unknown as RecordingGroupAiBinding | null, system, async chunk => {
    const object = await bucket.get(chunk.storageKey)
    if (!object || object.size !== chunk.size || object.size > MAX_RECORDING_CHUNK_BYTES) {
      throw new RecordingError('Saved system audio is unavailable. Retry its upload.', 503)
    }
    return object.arrayBuffer()
  }, {
    read: readResult,
    async create(value) {
      try {
        const saved = await bucket.put(resultKey, JSON.stringify(value), {
          onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' },
        })
        if (saved) return value
      } catch (error) {
        console.error('Could not retain Nova recording results; using the completed inference:', error)
        return value
      }
      const existing = await readResult()
      if (!existing) throw new RecordingError('Speaker results could not be retained. Retry the saved recording.', 503)
      return existing.value
    },
  })
  const segmentsByChunk = system.map(() => [] as typeof result.segments)
  // Assign each word once, by its start time, retaining one inference's speaker ids.
  for (const segment of result.segments) {
    let index = system.findLastIndex(chunk => chunk.startMs <= segment.start * 1000)
    if (index < 0) index = 0
    const chunk = system[index]
    // Nova can place a word in the silence padding between two saved chunks.
    const start = Math.min(chunk.durationMs / 1000, Math.max(0, segment.start - chunk.startMs / 1000))
    const end = Math.max(start, Math.min(segment.end - chunk.startMs / 1000, chunk.durationMs / 1000))
    segmentsByChunk[index].push({ ...segment, start, end })
  }
  await updateLeased(context, lease, { error: null })
  // Batch is transactional. A failed write cannot publish half of the group result.
  // JSON batches bound the number of D1 queries even for a long recording.
  const results = system.map((chunk, index) => ({ id: chunk.id,
    text: segmentsByChunk[index].map(segment => segment.text).join(' '), segments: JSON.stringify(segmentsByChunk[index]) }))
  const writes = []
  for (let offset = 0; offset < results.length; offset += 25) {
    const payload = JSON.stringify(results.slice(offset, offset + 25))
    writes.push(context.database.update(chunks).set({
      state: 'ready', error: null, updatedAt: new Date().toISOString(),
      text: sql`(SELECT json_extract(value, '$.text') FROM json_each(${payload}) WHERE json_extract(value, '$.id') = ${chunks.id})`,
      segments: sql`(SELECT json_extract(value, '$.segments') FROM json_each(${payload}) WHERE json_extract(value, '$.id') = ${chunks.id})`,
    }).where(and(eq(chunks.recordingId, row.id), eq(chunks.track, 'system'),
      sql`${chunks.id} IN (SELECT json_extract(value, '$.id') FROM json_each(${payload}))`,
      sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`)))
  }
  const [firstResult, ...otherResults] = writes
  await context.database.batch([firstResult, ...otherResults])
}

async function useWhisperForSystem(context: RecordingContext, row: RecordingRow, lease: string, resetReady = false): Promise<void> {
  const options = readRecordingOptions(row.tracks)
  // Explicit fallback replaces system results even if only finalization failed.
  // Completed microphone results are never changed.
  const updatedAt = new Date().toISOString()
  const [changed] = await context.database.batch([
    context.database.update(recordings).set({ tracks: writeRecordingOptions(options.tracks, false, options.speakerNames), state: 'transcribing', error: null, updatedAt })
      .where(and(eq(recordings.id, row.id), eq(recordings.leaseToken, lease))).returning({ id: recordings.id }),
    context.database.update(chunks).set({ state: 'uploaded', error: null, ...(resetReady ? { text: null, segments: null } : {}), updatedAt })
      .where(and(eq(chunks.recordingId, row.id), eq(chunks.track, 'system'), resetReady ? undefined : sql`${chunks.state} != 'ready'`,
        sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`)),
  ])
  if (!changed.length) throw new RecordingError('The operation expired. Retry the saved recording.', 409, 'busy')
}

/** Mic and standard mode process one chunk; group mode streams the system track once. */
export async function transcribeNextChunk(context: RecordingContext, withoutSpeakerSeparation = false): Promise<MeetingRecordingDetail | RecorderRecordingDetail> {
  if (withoutSpeakerSeparation && context.auth.userId !== 'api-service') {
    const access = await resolvePermissions(context.database, context.auth)
    if (!access.isAdmin) throw new RecordingError('Only an administrator can transcribe without speaker separation.', 403)
  }
  await withRecordingLease(context, async (row, lease, extendLease) => {
    if (withoutSpeakerSeparation && row.state === 'ready') throw new RecordingError('This recording is already transcribed.', 409)
    if (emptyStoppedRecording(row)) return
    if (row.state === 'ready') {
      await finalizeRecording(context, row, lease, await readChunks(context.database, row.id))
      return
    }
    if (row.deletedAt) throw new RecordingError('Recording audio has been deleted.', 410)
    if (!row.stoppedAt || !row.expectedChunks) throw new RecordingError('Stop the recording before transcribing.', 409)
    let found = await readChunks(context.database, row.id)
    const expected = jsonValue<{ mic: number; system: number }>(row.expectedChunks, { mic: 0, system: 0 })
    if (!allExpected(found, expected, true)) {
      await updateLeased(context, lease, { state: 'uploading', error: 'Some audio chunks are missing. Retry their uploads before transcribing.' })
      return
    }
    const options = readRecordingOptions(row.tracks)
    const system = found.filter(item => item.track === 'system')
    const groupTooLong = system.some(item => item.startMs + Math.max(item.durationMs,
      (item.size - RECORDING_PCM_HEADER_BYTES) * 1000 / (RECORDING_PCM_SAMPLE_RATE * 2)) > MAX_RECORDING_GROUP_DURATION_MS)
    const exhausted = system.some(item => item.state !== 'ready' && item.attempts >= 2)
    const fallback = options.separateSpeakers && (withoutSpeakerSeparation || groupTooLong || exhausted)
    if (fallback) {
      await useWhisperForSystem(context, row, lease, withoutSpeakerSeparation)
      found = await readChunks(context.database, row.id)
    }
    const chunk = found.find(item => item.state !== 'ready')
    if (!chunk) { await finalizeRecording(context, row, lease, found); return }
    await updateLeased(context, lease, { state: 'transcribing', error: null })
    const group = options.separateSpeakers && !fallback && chunk.track === 'system'
    if (!group) await context.database.update(chunks).set({ state: 'transcribing', attempts: chunk.attempts + 1, error: null }).where(chunkFence(chunk.id, row.id, lease))
    try {
      if (group) {
        await extendLease(RECORDING_GROUP_LEASE_MS)
        await transcribeSystemGroup(context, row, lease, found)
      }
      else {
        const bucket = await storage()
        const object = await bucket.get(chunk.storageKey)
        if (!object || object.size > MAX_RECORDING_CHUNK_BYTES || object.size !== chunk.size) throw new RecordingError('Saved audio is unavailable. Retry the upload.', 503)
        const result = await transcribeRecordingAudio(await object.arrayBuffer(), chunk.durationMs, await loadRecordingAi(), chunk.mimeType)
        await updateLeased(context, lease, { error: null })
        await context.database.update(chunks).set({ state: 'ready', text: result.text, segments: JSON.stringify(result.segments), error: null, updatedAt: new Date().toISOString() }).where(chunkFence(chunk.id, row.id, lease))
      }
    } catch (error) {
      const message = error instanceof RecordingError || group && error instanceof Error ? error.message : 'Could not transcribe this audio chunk. Retry the saved audio.'
      // Do not publish a partial transcript, or the suggestions sweep could read it.
      await updateLeased(context, lease, { state: 'failed', error: message })
      if (group) {
        await context.database.update(chunks).set({ state: 'failed', error: message, updatedAt: new Date().toISOString() })
          .where(and(eq(chunks.recordingId, row.id), eq(chunks.track, 'system'), sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`))
        const attempts = await readChunks(context.database, row.id)
        if (attempts.some(item => item.track === 'system' && item.attempts >= 2)) await useWhisperForSystem(context, row, lease)
      }
      else await context.database.update(chunks).set({ state: 'failed', error: message, updatedAt: new Date().toISOString() }).where(chunkFence(chunk.id, row.id, lease))
    }
    const after = await readChunks(context.database, row.id)
    // Finalization failure never turns successfully transcribed audio back
    // into an AI retry. The next request only saves the ready chunk text.
    if (after.every(item => item.state === 'ready')) {
      try { await finalizeRecording(context, row, lease, after) }
      catch { await updateLeased(context, lease, { state: 'failed', error: 'Transcript could not be saved. Retry to save the transcribed chunks.' }) }
    }
  }, true)
  const detail = await recordingResponse(context, context.recording!.id)
  return { ...detail, pending: detail.recording.state === 'transcribing' }
}

export async function linkRecording(context: RecordingContext, value: unknown): Promise<MeetingRecordingDetail & { mirrored: boolean }> {
  if (context.auth.recorderDevice) throw new RecordingError('Unauthorised', 401)
  if (!value || typeof value !== 'object') throw new RecordingError('Choose a client or a call.')
  if (!('orgId' in value) && !('callId' in value)) throw new RecordingError('Choose a client or a call.')
  const mirrored = await withRecordingLease(context, async (row, lease) => {
    const target = await choice(context, value)
    if (row.state !== 'ready' || !row.transcriptId) throw new RecordingError('Finish transcription before linking the recording.', 409)
    if (row.orgId && target.orgId !== row.orgId) {
      throw new RecordingError('This transcript is already assigned to a client. You can attach it to a call for that client.', 409)
    }
    const changesPreClientCall = row.orgId === null && target.orgId === null && row.callId !== null
      && (target.callKind !== row.callKind || target.callId !== row.callId)
    if (target.orgId !== row.orgId || changesPreClientCall) {
      const [transcript] = await context.database.select({ suggestedAt: schema.callTranscripts.suggestedAt }).from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
      const suggestions = await context.database.select({ id: schema.taskSuggestions.id }).from(schema.taskSuggestions)
        .where(eq(schema.taskSuggestions.transcriptId, row.transcriptId)).limit(1)
      if (transcript?.suggestedAt || suggestions.length) throw new RecordingError('This transcript has already entered the suggestions flow. Its client or pre-client call cannot be changed.', 409)
    }
    const writeGuard = sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`
    const [previous] = await context.database.select({ text: schema.callTranscripts.text }).from(schema.callTranscripts)
      .where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
    if (!previous) throw new RecordingError('Transcript not found.', 404)
    const text = await renderTranscript(context.database, { ...row, ...target }, (await readChunks(context.database, row.id)).map(publicChunk))
    const transcriptWrite = context.database.update(schema.callTranscripts).set({
      text, hash: hashTranscript(text), callKind: target.callKind, callId: target.callId,
      matchedBy: target.callId ? 'manual' : null, unlinkedReason: target.callId ? null : 'no_match',
    }).where(and(eq(schema.callTranscripts.id, row.transcriptId), writeGuard))
    // Only refresh our old mirror for this same discovery call. An unrelated
    // or independently edited transcript is never overwritten.
    const mirror = discoveryMirrorStatement(context, text, target, lease,
      target.callKind === row.callKind && target.callId === row.callId ? previous.text : undefined)
    // A process failure cannot move the transcript while leaving its client
    // scope behind. D1 executes the batch as a transaction.
    const results = await context.database.batch([
      transcriptWrite,
      context.database.update(recordings).set({ ...target, updatedAt: new Date().toISOString() })
        .where(and(eq(recordings.id, row.id), eq(recordings.leaseToken, lease))),
      ...(mirror ? [mirror] : []),
    ])
    const mirrored = mirror !== null && Array.isArray(results[2]) && results[2].length > 0
    await updateLeased(context, lease, {})
    await logAudit(context.database, {
      userId: attributedUserId(context.auth), action: 'meeting_recording.linked', entityType: 'meeting_recording', entityId: row.id,
      metadata: { ...target, transcriptId: row.transcriptId },
    })
    return mirrored
  }, true)
  return { ...await scopedRecordingDetail(context, context.recording!.id), mirrored }
}

export type SpeakerChoiceKind = 'team' | 'attendee' | 'contact'

/** Names offered when renaming a voice: team, the linked call's attendees and the client's contacts. */
export async function recordingSpeakerChoices(context: RecordingContext): Promise<{ speakers: RecordingSpeaker[]; options: Array<{ name: string; kind: SpeakerChoiceKind }> }> {
  if (context.auth.recorderDevice) throw new RecordingError('Unauthorised', 401)
  const row = context.recording
  if (!row) throw new RecordingError('Recording not found.', 404)
  const detail = await scopedRecordingDetail(context, row.id)
  const options: Array<{ name: string; kind: SpeakerChoiceKind }> = []
  const seen = new Set<string>()
  const add = (name: unknown, kind: SpeakerChoiceKind) => {
    const cleaned = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key) || options.length >= 60) return
    seen.add(key)
    options.push({ name: cleaned, kind })
  }
  for (const member of await context.database.select({ name: schema.teamMembers.name }).from(schema.teamMembers)) add(member.name, 'team')
  if (row.callId && row.callKind) {
    const table = row.callKind === 'discovery' ? schema.discoveryCalls : schema.scheduledCalls
    const [call] = await context.database.select({ attendees: table.attendees }).from(table).where(eq(table.id, row.callId)).limit(1)
    const parsed = jsonValue<unknown>(call?.attendees ?? null, [])
    if (Array.isArray(parsed)) for (const attendee of parsed) add((attendee as { name?: unknown } | null)?.name, 'attendee')
  }
  if (row.orgId) {
    for (const contact of await context.database.select({ name: schema.contacts.name }).from(schema.contacts)
      .where(eq(schema.contacts.orgId, row.orgId)).limit(60)) add(contact.name, 'contact')
  }
  return { speakers: detail.speakers ?? [], options }
}

/**
 * Rename voices on a recording. The map lives in the recording's options JSON, and the
 * transcript (and the call transcript it owns) is re-rendered from the saved chunks, which
 * also re-applies echo removal to recordings transcribed before it existed.
 */
export async function renameRecordingSpeakers(context: RecordingContext, value: unknown): Promise<MeetingRecordingDetail> {
  if (context.auth.recorderDevice) throw new RecordingError('Unauthorised', 401)
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const parsed = parseSpeakerRenames(body?.speakerNames)
  if (!parsed.ok) throw new RecordingError(parsed.error)
  await withRecordingLease(context, async (row, lease) => {
    // Like linking, a rename edits a finished transcript. Names for unfinished audio are not stored.
    if (row.state !== 'ready' || !row.transcriptId) throw new RecordingError('Finish transcription before renaming speakers.', 409)
    const options = readRecordingOptions(row.tracks)
    const next = applySpeakerRenames(options.speakerNames ?? {}, parsed.value)
    if (!next.ok) throw new RecordingError(next.error)
    const renamed = { ...row, tracks: writeRecordingOptions(options.tracks, options.separateSpeakers, next.value) }
    const optionsWrite = context.database.update(recordings).set({ tracks: renamed.tracks, updatedAt: new Date().toISOString() })
      .where(and(eq(recordings.id, row.id), eq(recordings.leaseToken, lease)))
    const text = row.transcriptId
      ? await renderTranscript(context.database, renamed, (await readChunks(context.database, row.id)).map(publicChunk)) : ''
    if (!row.transcriptId || !text.trim()) {
      await optionsWrite
    } else {
      const [previous] = await context.database.select({ text: schema.callTranscripts.text }).from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
      if (!previous) throw new RecordingError('Transcript not found.', 404)
      const writeGuard = sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`
      // Only our own copy on the discovery call is refreshed; a human edit there is never overwritten.
      const mirror = discoveryMirrorStatement(context, text, row, lease, previous.text)
      // One transaction: the map and every copy of the text change together or not at all.
      await context.database.batch([
        optionsWrite,
        context.database.update(schema.callTranscripts).set({ text, hash: hashTranscript(text) })
          .where(and(eq(schema.callTranscripts.id, row.transcriptId), writeGuard)),
        ...(mirror ? [mirror] : []),
      ])
    }
    await updateLeased(context, lease, {})
    await logAudit(context.database, {
      userId: attributedUserId(context.auth), action: 'meeting_recording.speakers_renamed', entityType: 'meeting_recording', entityId: row.id,
      metadata: { keys: Object.keys(parsed.value) },
    })
  }, true)
  return scopedRecordingDetail(context, context.recording!.id)
}

export async function deleteRecordingAudio(context: RecordingContext): Promise<boolean> {
  if (context.auth.recorderDevice) throw new RecordingError('Unauthorised', 401)
  if (context.auth.userId !== 'api-service') {
    const access = await resolvePermissions(context.database, context.auth)
    if (!access.isAdmin) throw new RecordingError('Only an administrator can delete recording audio.', 403)
  }
  return withRecordingLease(context, async (row, lease) => {
    const found = await readChunks(context.database, row.id)
    const bucket = await storage()
    const keys = [...found.map(chunk => chunk.storageKey), `meeting-recordings/${row.id}/system/nova-3.json`]
    // Tombstone first. A late upload sees deletion and compensates by
    // removing its immutable object. Repeated DELETE cleans up again.
    await updateLeased(context, lease, { deletedAt: row.deletedAt ?? new Date().toISOString() })
    for (let offset = 0; offset < keys.length; offset += 100) await bucket.delete(keys.slice(offset, offset + 100))
    await updateLeased(context, lease, { error: null })
    await logAudit(context.database, {
      userId: attributedUserId(context.auth), action: 'meeting_recording.audio_deleted', entityType: 'meeting_recording', entityId: row.id,
      metadata: { chunks: found.length, transcriptRetained: !!row.transcriptId },
    })
    return !!row.transcriptId
  }, true)
}

/** Recorder transcripts retain explicit client scoping even while unlinked or after audio deletion. */
export async function recordingTranscriptOrg(database: DB, row: { source: string; externalId: string }): Promise<{ recordingId: string; orgId: string | null } | null> {
  if (row.source !== 'manual' || !row.externalId.startsWith('recording:')) return null
  const id = recordingId(row.externalId.slice('recording:'.length))
  const recording = await readRecording(database, id)
  return { recordingId: id, orgId: recording.orgId }
}
