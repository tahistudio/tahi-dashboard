/**
 * PATCH /api/admin/discovery-calls/[id]
 *
 * Update a discovery call. Accepts any subset of:
 *   - Pre-call fields: title, scheduledAt, durationMinutes,
 *     googleMeetUrl, attendees, status
 *   - Post-call fields: transcript, transcriptSource, summary,
 *     outcome, outcomeNotes, scopeNotes, budgetMin, budgetMax,
 *     budgetCurrency, timeline
 *
 * Side effect: when status flips to "completed" (or outcome is set on
 * a call that wasn't completed), a lead_call_completed activity is
 * written so the lead timeline picks it up.
 *
 * DELETE /api/admin/discovery-calls/[id] — hard delete.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

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
    'title', 'scheduledAt', 'googleMeetUrl', 'googleCalendarEventId',
    'status', 'transcriptSource', 'summary', 'outcome', 'outcomeNotes',
    'scopeNotes', 'budgetCurrency', 'timeline', 'meetingType',
  ] as const
  for (const f of stringFields) {
    if (f in body) {
      const v = body[f]
      updates[f] = typeof v === 'string' ? (v.trim() || null) : (v === null ? null : (updates[f] ?? null))
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
