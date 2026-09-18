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
import { desc } from 'drizzle-orm'
import { scopedOrgIds } from '@/lib/access-scope'
import { columnInIds, isOrgInScope } from '../_scoping/org-scope'
import { listUnlinked, type CallTranscriptRow } from '@/lib/call-transcripts'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How much of the notes the list shows before you open one. */
const PREVIEW_CHARS = 160

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const scope = await scopedOrgIds({ userId, orgId })
  if (scope.kind === 'none') return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const unlinkedOnly = url.searchParams.get('unlinked') === '1' || url.searchParams.get('unlinked') === 'true'
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20

  const database = await db() as unknown as D1

  const rows: CallTranscriptRow[] = unlinkedOnly
    ? await listUnlinked(database, limit)
    : await database
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
        .orderBy(desc(schema.callTranscripts.receivedAt))
        .limit(limit)

  // Resolve the org behind every linked row so a restricted caller cannot
  // read another client's conversation through this list. Two bounded
  // queries, not one per row.
  let visible = rows
  if (scope.kind === 'some') {
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

    visible = rows.filter(r => {
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
