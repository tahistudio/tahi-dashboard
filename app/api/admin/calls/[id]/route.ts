import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// PATCH /api/admin/calls/[id] - update call
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    status?: string
    notes?: string
    recordingUrl?: string
    title?: string
    scheduledAt?: string
    durationMinutes?: number
    meetingUrl?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.status) updates.status = body.status
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.recordingUrl !== undefined) updates.recordingUrl = body.recordingUrl
  if (body.title) updates.title = body.title
  if (body.scheduledAt) updates.scheduledAt = body.scheduledAt
  if (body.durationMinutes !== undefined) updates.durationMinutes = body.durationMinutes
  if (body.meetingUrl !== undefined) updates.meetingUrl = body.meetingUrl

  await drizzle
    .update(schema.scheduledCalls)
    .set(updates)
    .where(eq(schema.scheduledCalls.id, id))

  return NextResponse.json({ success: true })
}
