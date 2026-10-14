import { discoveryCallScopeCondition } from '@/lib/discovery-call-access'
import { orgColumnInScope } from '../_scoping/org-scope'
/**
 * GET /api/admin/call-transcripts
 *
 * Call notes that have landed, newest first. Backs the "Unlinked call notes"
 * section on /calls and the MCP tool list_call_transcripts.
 *
 * Query:
 *   ?unlinked=1   only notes still waiting to be attached to a call
 *   ?limit=N      cap (default 20, max 100)
 *
 * SCOPING. An unlinked transcript has no client attached to it yet, so it
 * follows the same "allow if any scope" convention the /calls index uses for
 * a pre-client call: visible to any caller with some access, denied to a
 * caller with none. A LINKED transcript inherits its call's org and is
 * filtered against the caller's scope, because the body of these rows is
 * verbatim client conversation.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { transcriptPreview } from '@/lib/gemini-transcript-parser'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, inArray, isNull, sql } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { columnInIds, isOrgInScope } from '../_scoping/org-scope'
import type { CallTranscriptRow } from '@/lib/call-transcripts'
import { requireFeature } from '@/lib/require-feature'
import { IMPERSONATE_ORG_COOKIE, resolvePreviewOrgId } from '@/lib/preview-cookie'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How much of the notes the list shows before you open one. */
const PREVIEW_CHARS = 160

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const featureDenied = await requireFeature({ userId, orgId }, 'calls')
  if (featureDenied) return featureDenied
  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const unlinkedOnly = url.searchParams.get('unlinked') === '1' || url.searchParams.get('unlinked') === 'true'
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20

  const database = await db() as unknown as D1

  const transcriptScope = scope.kind === 'some' ? and(
    sql`(${schema.callTranscripts.callId} IS NULL OR (${schema.callTranscripts.callKind} = 'discovery' AND EXISTS (SELECT 1 FROM discovery_calls WHERE discovery_calls.id = ${schema.callTranscripts.callId} AND ${discoveryCallScopeCondition(scope)})) OR (${schema.callTranscripts.callKind} = 'scheduled' AND EXISTS (SELECT 1 FROM scheduled_calls WHERE scheduled_calls.id = ${schema.callTranscripts.callId} AND ${orgColumnInScope(schema.scheduledCalls.orgId, scope.orgIds)})))`,
    sql`(${schema.callTranscripts.source} != 'manual' OR ${schema.callTranscripts.externalId} NOT LIKE 'recording:%' OR EXISTS (SELECT 1 FROM meeting_recordings WHERE meeting_recordings.id = substr(${schema.callTranscripts.externalId}, 11) AND ${orgColumnInScope(schema.meetingRecordings.orgId, scope.orgIds, { includeNull: true })}))`,
  ) : undefined
  const rows: CallTranscriptRow[] = await database
        .select({
          id: schema.callTranscripts.id,
          callKind: schema.callTranscripts.callKind,
          callId: schema.callTranscripts.callId,
          source: schema.callTranscripts.source,
          externalId: schema.callTranscripts.externalId,
          title: schema.callTranscripts.title,
          receivedAt: schema.callTranscripts.receivedAt,
          summary: schema.callTranscripts.summary,
          unlinkedReason: schema.callTranscripts.unlinkedReason,
          matchedBy: schema.callTranscripts.matchedBy,
          text: schema.callTranscripts.text,
        })
        .from(schema.callTranscripts)
        .where(and(unlinkedOnly ? isNull(schema.callTranscripts.callId) : undefined, transcriptScope))
        .orderBy(desc(schema.callTranscripts.receivedAt))
        .limit(limit)

  // Resolve the org behind every linked row so a restricted caller cannot
  // read another client's conversation through this list. Two bounded
  // queries, not one per row.
  let visible = rows
  if (rows.some(row => row.source === 'manual' && row.externalId.startsWith('recording:'))) {
    const recorderDenied = resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)
      || await requireFeature({ userId, orgId }, 'calls')
    if (recorderDenied) visible = visible.filter(row => row.source !== 'manual' || !row.externalId.startsWith('recording:'))
  }
  if (scope.kind === 'some') {
    const recorderIds = rows.filter(row => row.source === 'manual' && row.externalId.startsWith('recording:'))
      .map(row => row.externalId.slice('recording:'.length))
    const recorderOrgs = new Map<string, string | null>()
    if (recorderIds.length) {
      const recorderRows = await database.select({ id: schema.meetingRecordings.id, orgId: schema.meetingRecordings.orgId })
        .from(schema.meetingRecordings).where(inArray(schema.meetingRecordings.id, recorderIds))
      for (const recording of recorderRows) recorderOrgs.set(recording.id, recording.orgId)
    }
    const discoveryIds = [...new Set(rows.filter(r => r.callKind === 'discovery' && r.callId).map(r => r.callId as string))]
    const scheduledIds = [...new Set(rows.filter(r => r.callKind === 'scheduled' && r.callId).map(r => r.callId as string))]

    const orgByCall = new Map<string, string | null>()
    if (discoveryIds.length > 0) {
      const found = await database
        .select({ id: schema.discoveryCalls.id, orgId: schema.discoveryCalls.orgId })
        .from(schema.discoveryCalls)
        .where(columnInIds(schema.discoveryCalls.id, discoveryIds))
      for (const c of found) orgByCall.set(`discovery:${c.id}`, c.orgId)
    }
    if (scheduledIds.length > 0) {
      const found = await database
        .select({ id: schema.scheduledCalls.id, orgId: schema.scheduledCalls.orgId })
        .from(schema.scheduledCalls)
        .where(columnInIds(schema.scheduledCalls.id, scheduledIds))
      for (const c of found) orgByCall.set(`scheduled:${c.id}`, c.orgId)
    }

    visible = visible.filter(r => {
      if (r.source === 'manual' && r.externalId.startsWith('recording:')) {
        const recordingId = r.externalId.slice('recording:'.length)
        if (!recorderOrgs.has(recordingId)
          || !isOrgInScope(scope, recorderOrgs.get(recordingId) ?? null, 'allow-if-any-scope')) return false
      }
      if (!r.callId) return true  // unplaced: allow-if-any-scope, already true here
      return isOrgInScope(scope, orgByCall.get(`${r.callKind}:${r.callId}`) ?? null, 'allow-if-any-scope')
    })
  }

  const items = visible.map(r => ({
    id: r.id,
    callKind: r.callKind,
    callId: r.callId,
    source: r.source,
    externalId: r.externalId,
    title: r.title,
    receivedAt: r.receivedAt,
    summary: r.summary,
    matchedBy: r.matchedBy,
    unlinkedReason: r.unlinkedReason,
    // A doc can parse to a summary with no transcript (Gemini sometimes
    // writes notes without one), so the preview falls back rather than
    // rendering an empty row a human cannot judge.
    preview: transcriptPreview(r.text || r.summary || '', PREVIEW_CHARS),
    textLength: r.text.length,
  }))

  return NextResponse.json({ items })
}
