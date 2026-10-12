/**
 * POST /api/admin/developer-handoff
 *
 * Body: { subjectType: 'task' | 'request', subjectId, note }
 *
 * A designer hands a task or request to the developer: the developer is added
 * to it (without removing anyone), an internal note says what developer work
 * is needed, and the developer gets an in-app notification. No email.
 * The logic lives in lib/developer-handoff.ts.
 *
 * Scoped like the neighbouring routes: Tahi admin org, the feature for the
 * subject (tasks or requests), and team member access scoping on the
 * subject's client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAccessToOrg } from '@/lib/require-access'
import { guardTask } from '@/lib/task-access'
import { attributedUserId } from '@/lib/mcp-actor'
import {
  handOffToDeveloper,
  MAX_HANDOFF_NOTE_LENGTH,
  sanitiseHandoffNote,
} from '@/lib/developer-handoff'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { subjectType?: unknown; subjectId?: unknown; note?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { subjectType } = body
  if (subjectType !== 'task' && subjectType !== 'request') {
    return NextResponse.json({ error: 'subjectType must be "task" or "request".' }, { status: 400 })
  }
  const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : ''
  if (!subjectId) {
    return NextResponse.json({ error: 'subjectId is required.' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? sanitiseHandoffNote(body.note) : ''
  if (!note) {
    return NextResponse.json({ error: 'A note saying what developer work is needed is required.' }, { status: 400 })
  }
  if (note.length > MAX_HANDOFF_NOTE_LENGTH) {
    return NextResponse.json({ error: `The note must be at most ${MAX_HANDOFF_NOTE_LENGTH} characters.` }, { status: 400 })
  }

  const featureDenied = await requireFeature(auth, subjectType === 'task' ? 'tasks' : 'requests')
  if (featureDenied) return featureDenied

  const database = await db()
  const drizzle = database as Drizzle

  if (subjectType === 'task') {
    const denied = await guardTask(drizzle, auth.userId, subjectId)
    if (denied) return denied
  } else {
    const [request] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, subjectId))
      .limit(1)
    if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    const denied = await requireAccessToOrg(drizzle, auth.userId, request.orgId)
    if (denied) return denied
  }

  const result = await handOffToDeveloper(drizzle, {
    subjectType,
    subjectId,
    note,
    actorUserId: attributedUserId(auth),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status })
  }

  return NextResponse.json({
    developerTeamMemberId: result.developerTeamMemberId,
    developerName: result.developerName,
    addedAsAssignee: result.addedAsAssignee,
    noteId: result.noteId,
    notified: result.notified,
  }, { status: 201 })
}
