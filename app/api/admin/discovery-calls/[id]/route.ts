/**
 * PATCH /api/admin/discovery-calls/[id]
 *
 * Update a discovery call. Accepts any subset of:
 *   - Pre-call fields: title, scheduledAt, durationMinutes,
 *     googleMeetUrl, attendees, status
 *   - Post-call fields: transcript, transcriptSource, summary,
 *     outcome, outcomeNotes, scopeNotes, budgetMin, budgetMax,
 *     budgetCurrency, timeline
 *   - Link + purpose fields: orgId, leadId, dealId, requestId (each
 *     nullable, pass null to unlink, omit to leave alone; a non-null
 *     value must reference an existing row or the request 400s) and
 *     meetingType (must be one of MEETING_TYPES or the request 400s).
 *
 * Side effect: when status flips to "completed" (or outcome is set on
 * a call that wasn't completed), a lead_call_completed activity is
 * written so the lead timeline picks it up. A change to any of
 * orgId/leadId/dealId/requestId/meetingType/title also writes an
 * audit_log row (see lib/audit.ts) so a relink is traceable.
 *
 * DELETE /api/admin/discovery-calls/[id] — hard delete.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { normalizeCallInstant } from '@/lib/call-time'
import { isMeetingType, validateCallLinkFields } from '@/lib/calls'
import { logAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// Transcripts can run long — a 60-minute Meet call easily produces
// 100k+ chars of Gemini transcript. Cap is here to stop a runaway paste
// blowing the D1 row size budget (~1MB hard limit), not to be miserly.
// 250k is roughly a 3-hour call at typical transcript density.
const TRANSCRIPT_MAX_CHARS = 250_000

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const database = await db()

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const existing = await database
    .select()
    .from(schema.discoveryCalls)
    .where(eq(schema.discoveryCalls.id, id))
    .limit(1)
  if (existing.length === 0) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }
  const prev = existing[0]

  const updates: Record<string, string | number | null> = {}

  const stringFields = [
    'title', 'googleMeetUrl', 'googleCalendarEventId',
    'status', 'transcriptSource', 'summary', 'outcome', 'outcomeNotes',
    'scopeNotes', 'budgetCurrency', 'timeline',
  ] as const
  for (const f of stringFields) {
    if (f in body) {
      const v = body[f]
      updates[f] = typeof v === 'string' ? (v.trim() || null) : (v === null ? null : (updates[f] ?? null))
    }
  }

  // meetingType: classifier vocabulary only. A non-empty value that isn't
  // one of MEETING_TYPES is a caller mistake (typo, stale enum), not a
  // silent "unclassified", so it 400s rather than writing garbage the
  // /calls index filter can never match again.
  if ('meetingType' in body) {
    const v = body.meetingType
    if (v === null || v === '') {
      updates.meetingType = null
    } else if (isMeetingType(v)) {
      updates.meetingType = v
    } else {
      return NextResponse.json({
        error: `meetingType must be one of: discovery, client, partnership, unclassified`,
      }, { status: 400 })
    }
  }

  // Link fields: who/what this call is for. Each is independently
  // nullable (a call can be unlinked from a lead without touching its
  // org, etc). null clears the link; a non-null id must resolve to a
  // real row.
  const linkFields = ['orgId', 'leadId', 'dealId', 'requestId'] as const
  const linkPatch: { orgId?: string | null; leadId?: string | null; dealId?: string | null; requestId?: string | null } = {}
  for (const f of linkFields) {
    if (f in body) {
      const v = body[f]
      if (v === null) {
        linkPatch[f] = null
      } else if (typeof v === 'string' && v.trim()) {
        linkPatch[f] = v.trim()
      } else {
        return NextResponse.json({ error: `${f} must be a non-empty string or null` }, { status: 400 })
      }
    }
  }
  if (Object.keys(linkPatch).length > 0) {
    const linkError = await validateCallLinkFields(database, linkPatch)
    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 400 })
    }
    Object.assign(updates, linkPatch)
  }

  // scheduledAt gets its own path (not the generic stringFields loop
  // above): it must always end up an absolute UTC instant, never
  // whatever string the caller happened to send. A naive value (no
  // offset) is read as Pacific/Auckland wall-clock time. See
  // lib/call-time.ts, this is the exact bug that sent "Pre-call" emails
  // hours off the real call.
  if ('scheduledAt' in body) {
    const v = body.scheduledAt
    if (typeof v === 'string' && v.trim()) {
      const normalized = normalizeCallInstant(v)
      if (!normalized) {
        return NextResponse.json({ error: 'scheduledAt is not a valid date' }, { status: 400 })
      }
      updates.scheduledAt = normalized
    } else if (v === null) {
      return NextResponse.json({ error: 'scheduledAt cannot be cleared' }, { status: 400 })
    }
  }

  // Transcript: cap at TRANSCRIPT_MAX_CHARS so a bad paste can't blow
  // the row size budget.
  if ('transcript' in body) {
    const t = body.transcript
    if (typeof t === 'string') {
      updates.transcript = t.length > TRANSCRIPT_MAX_CHARS
        ? t.slice(0, TRANSCRIPT_MAX_CHARS)
        : t
    } else if (t === null) {
      updates.transcript = null
    }
  }

  // Attendees: accept array, serialise to JSON string for storage.
  if ('attendees' in body) {
    const a = body.attendees
    if (Array.isArray(a)) {
      updates.attendees = JSON.stringify(a)
    }
  }

  // Numeric fields.
  for (const f of ['durationMinutes', 'budgetMin', 'budgetMax'] as const) {
    if (f in body) {
      const v = body[f]
      updates[f] = typeof v === 'number' ? v : (v === null ? null : null)
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const now = new Date().toISOString()
  await database
    .update(schema.discoveryCalls)
    .set({ ...updates, updatedAt: now })
    .where(eq(schema.discoveryCalls.id, id))

  // Audit the "who is this for / what is this" fields specifically:
  // these are the ones a relink can silently misattribute a call against,
  // so the before/after is worth a durable trail beyond the updatedAt bump.
  const AUDITED_FIELDS = ['orgId', 'leadId', 'dealId', 'requestId', 'meetingType', 'title'] as const
  const auditedChanges: Record<string, { before: string | number | null; after: string | number | null }> = {}
  for (const f of AUDITED_FIELDS) {
    if (f in updates && updates[f] !== (prev as Record<string, unknown>)[f]) {
      auditedChanges[f] = { before: (prev as Record<string, string | number | null>)[f] ?? null, after: updates[f] }
    }
  }
  if (Object.keys(auditedChanges).length > 0) {
    await logAudit(database, {
      action: 'discovery_call_updated',
      userId,
      userType: 'team_member',
      entityType: 'discovery_call',
      entityId: id,
      metadata: { changes: auditedChanges },
    })
  }

  // Activity hook: writing an outcome OR flipping to completed both
  // count as "the call happened". Fire once per transition, not on
  // every transcript-edit afterwards.
  const becameCompleted =
    (updates.status === 'completed' && prev.status !== 'completed')
    || (typeof updates.outcome === 'string' && updates.outcome && !prev.outcome)

  if (becameCompleted && prev.leadId) {
    const outcomeStr =
      typeof updates.outcome === 'string' && updates.outcome
        ? OUTCOME_LABELS[updates.outcome] ?? updates.outcome
        : 'Completed'
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_call_completed',
      title: `Call completed: ${prev.title} (${outcomeStr})`,
      description: typeof updates.outcomeNotes === 'string' ? updates.outcomeNotes : null,
      leadId: prev.leadId,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const database = await db()
  await database.delete(schema.discoveryCalls).where(eq(schema.discoveryCalls.id, id))
  return NextResponse.json({ ok: true })
}

const OUTCOME_LABELS: Record<string, string> = {
  good_call: 'Good call',
  promote: 'Ready to promote',
  nurture: 'Nurture',
  archive: 'Archive',
  no_show: 'No-show',
}
