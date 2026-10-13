import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { schema, type DB } from '@/db/d1'
import { getRequestAuth, isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { scopedOrgIds } from '@/lib/access-scope'
import { IMPERSONATE_ORG_COOKIE, resolvePreviewOrgId } from '@/lib/preview-cookie'
import { attributedUserId } from '@/lib/mcp-actor'
import { logAudit } from '@/lib/audit'
import { resolvePermissions } from '@/lib/permissions'
import { hashTranscript, linkTranscriptStatement, parseCallKind, resolveCallOrgId } from '@/lib/call-transcripts'
import {
  loadRecordingAi, MAX_RECORDING_CHUNK_BYTES, MAX_RECORDING_DURATION_MS,
  mergeRecordingTranscript, parseSegments, RecordingError, recordingId,
  RECORDING_LEASE_MS, transcribeRecordingAudio, validateChunk,
} from '@/lib/meeting-recordings'
import type { MeetingRecording, MeetingRecordingChunk, MeetingRecordingDetail, RecordingTrack } from '@/lib/meeting-recordings-types'

type RecordingRow = typeof schema.meetingRecordings.$inferSelect
type ChunkRow = typeof schema.meetingRecordingChunks.$inferSelect
const recordings = schema.meetingRecordings
const chunks = schema.meetingRecordingChunks

export interface RecordingContext {
  database: DB
  auth: RequestAuthResult
  recording?: RecordingRow
}

function jsonValue<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}

function publicRecording(row: RecordingRow): MeetingRecording {
  return {
    id: row.id, title: row.title, orgId: row.orgId, callKind: row.callKind, callId: row.callId,
    createdById: row.createdById, tracks: jsonValue<RecordingTrack[]>(row.tracks, []),
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

export async function recordingDetail(database: DB, id: string): Promise<MeetingRecordingDetail> {
  const row = await readRecording(database, id)
  const chunkRows = (await readChunks(database, id)).map(publicChunk)
  let text = mergeRecordingTranscript(chunkRows)
  if (row.transcriptId) {
    const [transcript] = await database.select({ text: schema.callTranscripts.text })
      .from(schema.callTranscripts).where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
    text = transcript?.text ?? text
  }
  return { recording: publicRecording(row), chunks: chunkRows, transcript: { id: row.transcriptId, text } }
}

export async function scopedRecordingDetail(context: RecordingContext, id: string): Promise<MeetingRecordingDetail> {
  const detail = await recordingDetail(context.database, id)
  const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, detail.recording.orgId)
  if (denied) throw new RecordingError('Forbidden', denied.status)
  return detail
}

/** All routes fail closed before reading any audio or recording metadata. */
export async function withRecordingContext(
  req: NextRequest, id: string | undefined,
  work: (context: RecordingContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const auth = await getRequestAuth(req)
    if (!auth.userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isTahiAdmin(auth.orgId) || resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const featureDenied = await requireFeature(auth, 'calls')
    if (featureDenied) return featureDenied
    const database = await db()
    const row = id ? await readRecording(database, recordingId(id)) : undefined
    if (row) {
      const denied = await requireAccessToOrgOrPreClient(database, auth.userId, row.orgId)
      if (denied) return denied
    }
    return await work({ database, auth, recording: row })
  } catch (error) {
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
export async function withRecordingLease<T>(context: RecordingContext, work: (row: RecordingRow, token: string) => Promise<T>, allowDeleted = false): Promise<T> {
  const id = context.recording?.id
  if (!id) throw new RecordingError('Recording not found.', 404)
  const now = new Date().toISOString()
  const token = crypto.randomUUID()
  const claimed = await context.database.update(recordings).set({
    leaseToken: token, leaseUntil: new Date(Date.now() + RECORDING_LEASE_MS).toISOString(),
  }).where(and(eq(recordings.id, id), allowDeleted ? undefined : isNull(recordings.deletedAt),
    or(isNull(recordings.leaseToken), lt(recordings.leaseUntil, now)))).returning()
  if (!claimed.length) {
    if ((await readRecording(context.database, id)).deletedAt) throw new RecordingError('Recording audio has been deleted.', 410)
    throw new RecordingError('Another recording action is finishing. Retry shortly.', 409, 'busy')
  }
  try {
    const denied = await requireAccessToOrgOrPreClient(context.database, context.auth.userId, claimed[0].orgId)
    if (denied) throw new RecordingError('Forbidden', denied.status)
    return await work(claimed[0], token)
  }
  finally {
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

export async function createRecording(context: RecordingContext, value: unknown): Promise<MeetingRecording> {
  if (!value || typeof value !== 'object') throw new RecordingError('Recording details are required.')
  const body = value as Record<string, unknown>
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  if (!title) throw new RecordingError('A recording title is required.')
  if (!Array.isArray(body.tracks) || !body.tracks.includes('mic') || body.tracks.length > 2
    || new Set(body.tracks).size !== body.tracks.length || body.tracks.some(track => track !== 'mic' && track !== 'system')) {
    throw new RecordingError('Choose microphone and optionally system audio.')
  }
  const target = await choice(context, body)
  const now = new Date().toISOString()
  const [row] = await context.database.insert(recordings).values({
    id: crypto.randomUUID(), title, ...target, createdById: attributedUserId(context.auth)!,
    tracks: JSON.stringify(body.tracks), state: 'recording', startedAt: now, createdAt: now, updatedAt: now,
  }).returning()
  return publicRecording(row)
}

export async function listRecordings(context: RecordingContext): Promise<MeetingRecording[]> {
  const scope = await scopedOrgIds(context.auth)
  if (scope.kind === 'none') return []
  const rows = await context.database.select().from(recordings)
    .where(scope.kind === 'some' ? or(isNull(recordings.orgId), inArray(recordings.orgId, scope.orgIds)) : undefined)
    .orderBy(desc(recordings.createdAt)).limit(100)
  return rows.map(publicRecording)
}

export async function reserveChunk(context: RecordingContext, value: unknown): Promise<{ uploadUrl: string; duplicate: boolean; uploaded: boolean }> {
  const metadata = validateChunk(value)
  return withRecordingLease(context, async (row, lease) => {
    if (row.transcriptId) throw new RecordingError('This recording has already been transcribed.', 409)
    const tracks = jsonValue<RecordingTrack[]>(row.tracks, [])
    if (!tracks.includes(metadata.track)) throw new RecordingError('This track was not enabled for this recording.')
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
      ON CONFLICT (recording_id, track, sequence) DO NOTHING`)
    const [chunk] = await context.database.select().from(chunks).where(eq(chunks.id, id)).limit(1)
    if (!chunk || (['startMs', 'durationMs', 'mimeType', 'size'] as const).some(key => chunk[key] !== metadata[key])) {
      throw new RecordingError('A different chunk already uses this sequence.', 409)
    }
    return {
      uploadUrl: `/api/admin/recordings/${row.id}/chunks?track=${metadata.track}&sequence=${metadata.sequence}&token=${chunk.uploadToken}`,
      duplicate: inserted.meta.changes === 0, uploaded: chunk.uploadedAt !== null,
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
    const bucket = await storage()
    const active = await readRecording(context.database, row.id)
    if (active.leaseToken !== lease || active.deletedAt) throw new RecordingError('Upload expired. Retry the saved audio chunk.', 409, 'busy')
    await context.database.update(chunks).set({ state: 'uploading', error: null }).where(chunkFence(chunk.id, row.id, lease))
    try {
      const stored = await bucket.put(chunk.storageKey, audio, {
        onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: chunk.mimeType },
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

export async function stopRecording(context: RecordingContext, value: unknown): Promise<MeetingRecordingDetail> {
  if (!value || typeof value !== 'object') throw new RecordingError('Stopped recording details are required.')
  const body = value as Record<string, unknown>
  await withRecordingLease(context, async (row, lease) => {
    if (row.state === 'ready') return
    if (typeof body.durationMs !== 'number' || !Number.isInteger(body.durationMs) || body.durationMs <= 0
      || body.durationMs > MAX_RECORDING_DURATION_MS) throw new RecordingError('Recording duration is invalid.')
    const found = await readChunks(context.database, row.id)
    const inferred = { mic: 0, system: 0 }
    for (const chunk of found) inferred[chunk.track] = Math.max(inferred[chunk.track], chunk.sequence + 1)
    // A reopened crashed recording can stop from its durable server chunks.
    const expected = expectedCounts(body.expectedChunks ?? (row.expectedChunks ? jsonValue(row.expectedChunks, inferred) : inferred),
      jsonValue<RecordingTrack[]>(row.tracks, []))
    if (!expected.mic) throw new RecordingError('No microphone audio was captured. Retry recording.')
    if (jsonValue<RecordingTrack[]>(row.tracks, []).includes('system') && !expected.system) {
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
  return scopedRecordingDetail(context, context.recording!.id)
}

async function mirrorDiscovery(context: RecordingContext, text: string, target: { callKind: string | null; callId: string | null }, lease: string): Promise<void> {
  if (target.callKind !== 'discovery' || !target.callId) return
  await context.database.update(schema.discoveryCalls).set({ transcript: text.slice(0, 250_000), transcriptSource: 'manual', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.discoveryCalls.id, target.callId), or(isNull(schema.discoveryCalls.transcript), eq(schema.discoveryCalls.transcript, '')),
      sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${context.recording!.id} AND lease_token = ${lease})`))
}

async function finalizeRecording(context: RecordingContext, row: RecordingRow, lease: string, found: ChunkRow[]): Promise<void> {
  const text = mergeRecordingTranscript(found.map(publicChunk))
  if (!text.trim()) {
    await updateLeased(context, lease, { state: 'failed', error: 'No speech was detected in the saved audio.' })
    return
  }
  const transcriptId = row.transcriptId ?? row.id
  const externalId = `recording:${row.id}`
  await context.database.run(sql`INSERT INTO call_transcripts
    (id, source, external_id, title, received_at, hash, text, call_kind, call_id, matched_by, unlinked_reason, created_at)
    SELECT ${transcriptId}, 'manual', ${externalId}, ${row.title}, ${row.startedAt}, ${hashTranscript(text)}, ${text},
      ${row.callKind}, ${row.callId}, ${row.callId ? 'manual' : null}, ${row.callId ? null : 'no_match'}, ${new Date().toISOString()}
    WHERE EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})
    ON CONFLICT (source, external_id) DO NOTHING`)
  const [filed] = await context.database.select({ id: schema.callTranscripts.id }).from(schema.callTranscripts)
    .where(and(eq(schema.callTranscripts.source, 'manual'), eq(schema.callTranscripts.externalId, externalId))).limit(1)
  if (!filed) throw new RecordingError('Transcript could not be saved. Retry the saved audio.', 503)
  await mirrorDiscovery(context, text, row, lease)
  await updateLeased(context, lease, { transcriptId: filed.id, state: 'ready', error: null })
}

/** One chunk per call keeps CPU, memory and invocation duration bounded. */
export async function transcribeNextChunk(context: RecordingContext): Promise<MeetingRecordingDetail> {
  await withRecordingLease(context, async (row, lease) => {
    if (row.state === 'ready') return
    if (!row.stoppedAt || !row.expectedChunks) throw new RecordingError('Stop the recording before transcribing.', 409)
    const found = await readChunks(context.database, row.id)
    const expected = jsonValue<{ mic: number; system: number }>(row.expectedChunks, { mic: 0, system: 0 })
    if (!allExpected(found, expected, true)) {
      await updateLeased(context, lease, { state: 'uploading', error: 'Some audio chunks are missing. Retry their uploads before transcribing.' })
      return
    }
    const chunk = found.find(item => item.state !== 'ready')
    if (!chunk) { await finalizeRecording(context, row, lease, found); return }
    await updateLeased(context, lease, { state: 'transcribing', error: null })
    await context.database.update(chunks).set({ state: 'transcribing', attempts: chunk.attempts + 1, error: null }).where(chunkFence(chunk.id, row.id, lease))
    try {
      const bucket = await storage()
      const object = await bucket.get(chunk.storageKey)
      if (!object || object.size > MAX_RECORDING_CHUNK_BYTES || object.size !== chunk.size) throw new RecordingError('Saved audio is unavailable. Retry the upload.', 503)
      const result = await transcribeRecordingAudio(await object.arrayBuffer(), chunk.durationMs, await loadRecordingAi())
      await updateLeased(context, lease, { error: null })
      await context.database.update(chunks).set({ state: 'ready', text: result.text, segments: JSON.stringify(result.segments), error: null, updatedAt: new Date().toISOString() }).where(chunkFence(chunk.id, row.id, lease))
    } catch (error) {
      const message = error instanceof RecordingError ? error.message : 'Could not transcribe this audio chunk. Retry the saved audio.'
      // Do not publish a partial transcript, or the suggestions sweep could read it.
      await updateLeased(context, lease, { state: 'failed', error: message })
      await context.database.update(chunks).set({ state: 'failed', error: message, updatedAt: new Date().toISOString() }).where(chunkFence(chunk.id, row.id, lease))
    }
    const after = await readChunks(context.database, row.id)
    // Finalization failure never turns successfully transcribed audio back
    // into an AI retry. The next request only saves the ready chunk text.
    if (after.every(item => item.state === 'ready')) {
      try { await finalizeRecording(context, row, lease, after) }
      catch { await updateLeased(context, lease, { state: 'failed', error: 'Transcript could not be saved. Retry to save the transcribed chunks.' }) }
    }
  })
  const detail = await scopedRecordingDetail(context, context.recording!.id)
  return { ...detail, pending: detail.recording.state === 'transcribing' }
}

export async function linkRecording(context: RecordingContext, value: unknown): Promise<MeetingRecordingDetail> {
  if (!value || typeof value !== 'object') throw new RecordingError('Choose a client or a call.')
  if (!('orgId' in value) && !('callId' in value)) throw new RecordingError('Choose a client or a call.')
  await withRecordingLease(context, async (row, lease) => {
    const target = await choice(context, value)
    if (row.state !== 'ready' || !row.transcriptId) throw new RecordingError('Finish transcription before linking the recording.', 409)
    if (row.orgId && target.orgId !== row.orgId) {
      throw new RecordingError('This transcript is already assigned to a client. You can attach it to a call for that client.', 409)
    }
    if (target.orgId !== row.orgId) {
      const [transcript] = await context.database.select({ suggestedAt: schema.callTranscripts.suggestedAt }).from(schema.callTranscripts)
        .where(eq(schema.callTranscripts.id, row.transcriptId)).limit(1)
      const suggestions = await context.database.select({ id: schema.taskSuggestions.id }).from(schema.taskSuggestions)
        .where(eq(schema.taskSuggestions.transcriptId, row.transcriptId)).limit(1)
      if (transcript?.suggestedAt || suggestions.length) throw new RecordingError('This transcript has already entered the suggestions flow. Its client cannot be changed.', 409)
    }
    const writeGuard = sql`EXISTS (SELECT 1 FROM meeting_recordings WHERE id = ${row.id} AND lease_token = ${lease})`
    const transcriptWrite = target.callId && target.callKind
      ? linkTranscriptStatement(context.database, row.transcriptId, target.callKind, target.callId, 'manual', writeGuard)
      : context.database.update(schema.callTranscripts).set({ callKind: null, callId: null, matchedBy: null, unlinkedReason: 'no_match' })
          .where(and(eq(schema.callTranscripts.id, row.transcriptId), writeGuard))
    // A process failure cannot move the transcript while leaving its client
    // scope behind. D1 executes the batch as a transaction.
    await context.database.batch([
      transcriptWrite,
      context.database.update(recordings).set({ ...target, updatedAt: new Date().toISOString() })
        .where(and(eq(recordings.id, row.id), eq(recordings.leaseToken, lease))),
    ])
    const detail = await recordingDetail(context.database, row.id)
    await mirrorDiscovery(context, detail.transcript.text, target, lease)
    await updateLeased(context, lease, {})
    await logAudit(context.database, {
      userId: attributedUserId(context.auth), action: 'meeting_recording.linked', entityType: 'meeting_recording', entityId: row.id,
      metadata: { ...target, transcriptId: row.transcriptId },
    })
  }, true)
  return scopedRecordingDetail(context, context.recording!.id)
}

export async function deleteRecordingAudio(context: RecordingContext): Promise<boolean> {
  if (context.auth.userId !== 'api-service') {
    const access = await resolvePermissions(context.database, context.auth)
    if (!access.isAdmin) throw new RecordingError('Only an administrator can delete recording audio.', 403)
  }
  return withRecordingLease(context, async (row, lease) => {
    const found = await readChunks(context.database, row.id)
    const bucket = found.length ? await storage() : null
    // Tombstone first. A late upload sees deletion and compensates by
    // removing its immutable object. Repeated DELETE cleans up again.
    await updateLeased(context, lease, { deletedAt: row.deletedAt ?? new Date().toISOString() })
    for (let offset = 0; offset < found.length; offset += 100) await bucket!.delete(found.slice(offset, offset + 100).map(chunk => chunk.storageKey))
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
