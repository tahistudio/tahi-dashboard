/**
 * GET   /api/admin/call-transcripts/[id]   the full text and the wrap up
 * PATCH /api/admin/call-transcripts/[id]   attach parked notes to a call
 *
 * The PATCH is the human half of the matcher. The Drive sync refuses to guess
 * when the top two candidate calls are within 20 points of each other, and
 * parks the notes instead; this is where Liam says which call they were.
 *
 * Attaching to a DISCOVERY call with no transcript of its own also copies the
 * text and summary onto that call, exactly as the sync would have done had it
 * matched, so everything already reading discovery_calls.transcript (the
 * extract route, the /calls "Transcript" chip) sees the same thing either
 * way. A SCHEDULED call gets the link alone: scheduled_calls has no transcript
 * column and its `notes` column is the prep note (migration 0102), which a
 * transcript must not clobber.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg, requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { linkTranscript, parseCallKind, resolveCallOrgId } from '@/lib/call-transcripts'
import { logAudit } from '@/lib/audit'
import type { DB } from '@/db/d1'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Matches the cap the discovery-calls PATCH route puts on a transcript. */
const TRANSCRIPT_MAX_CHARS = 250_000

async function loadTranscript(database: D1, id: string) {
  const [row] = await database
    .select({
      id: schema.callTranscripts.id,
      callKind: schema.callTranscripts.callKind,
      callId: schema.callTranscripts.callId,
      source: schema.callTranscripts.source,
      externalId: schema.callTranscripts.externalId,
      title: schema.callTranscripts.title,
      receivedAt: schema.callTranscripts.receivedAt,
      hash: schema.callTranscripts.hash,
      text: schema.callTranscripts.text,
      summary: schema.callTranscripts.summary,
      wrapUp: schema.callTranscripts.wrapUp,
      matchedBy: schema.callTranscripts.matchedBy,
      unlinkedReason: schema.callTranscripts.unlinkedReason,
      createdAt: schema.callTranscripts.createdAt,
    })
    .from(schema.callTranscripts)
    .where(eq(schema.callTranscripts.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Guard a transcript against the caller's org scope. Parked notes carry no
 * client yet, so they follow the same allow-if-any-scope rule as a pre-client
 * call; a linked one is checked against the org of the call it sits on.
 */
async function guardTranscript(
  database: D1,
  userId: string | null,
  row: { callKind: string | null; callId: string | null },
): Promise<NextResponse | null> {
  if (!row.callId) return requireAccessToOrgOrPreClient(database, userId, null)
  const kind = parseCallKind(row.callKind)
  if (!kind) return requireAccessToOrgOrPreClient(database, userId, null)
  const { found, orgId } = await resolveCallOrgId(database, kind, row.callId)
  if (!found) return requireAccessToOrgOrPreClient(database, userId, null)
  return requireAccessToOrgOrPreClient(database, userId, orgId)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db() as unknown as D1

  const row = await loadTranscript(database, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await guardTranscript(database, userId, row)
  if (denied) return denied

  return NextResponse.json({ transcript: row })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { callKind?: unknown; callId?: unknown }

  const callKind = parseCallKind(body.callKind)
  if (!callKind) {
    return NextResponse.json({ error: "callKind must be 'discovery' or 'scheduled'" }, { status: 400 })
  }
  const callId = typeof body.callId === 'string' ? body.callId.trim() : ''
  if (!callId) {
    return NextResponse.json({ error: 'callId is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  const row = await loadTranscript(database, id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The caller has to be allowed to see the notes they are moving as well as
  // the call they are moving them to, or an attach becomes a way to read a
  // transcript you could not otherwise open.
  const deniedSource = await guardTranscript(database, userId, row)
  if (deniedSource) return deniedSource

  const target = await resolveCallOrgId(database, callKind, callId)
  if (!target.found) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }
  // A scheduled call always has an org (NOT NULL); a discovery call may
  // legitimately be pre-client, so it uses the org-less variant.
  const deniedTarget = callKind === 'scheduled'
    ? await requireAccessToOrg(database, userId, target.orgId)
    : await requireAccessToOrgOrPreClient(database, userId, target.orgId)
  if (deniedTarget) return deniedTarget

  await linkTranscript(database, id, callKind, callId, 'manual')

  // Mirror onto the discovery call, but never over the top of a transcript
  // that is already there (Liam may have pasted his own).
  let mirrored = false
  if (callKind === 'discovery') {
    const [call] = await database
      .select({
        transcript: schema.discoveryCalls.transcript,
        summary: schema.discoveryCalls.summary,
      })
      .from(schema.discoveryCalls)
      .where(eq(schema.discoveryCalls.id, callId))
      .limit(1)

    if (call && !call.transcript) {
      const updates: Record<string, string | null> = {
        transcript: row.text.slice(0, TRANSCRIPT_MAX_CHARS),
        transcriptSource: row.source,
        updatedAt: new Date().toISOString(),
      }
      if (row.summary && !call.summary) updates.summary = row.summary
      await database
        .update(schema.discoveryCalls)
        .set(updates)
        .where(eq(schema.discoveryCalls.id, callId))
      mirrored = true
    }
  }

  await logAudit(database as unknown as DB, {
    userId,
    action: 'call_transcript.linked',
    entityType: 'call_transcript',
    entityId: id,
    metadata: { callKind, callId, mirrored, previousReason: row.unlinkedReason },
  })

  return NextResponse.json({ ok: true, id, callKind, callId, mirrored })
}
