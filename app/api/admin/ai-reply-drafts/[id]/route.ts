/**
 * PATCH /api/admin/ai-reply-drafts/[id]
 *   Update the draft before sending. Accepts finalSubject + finalBody.
 *   Returns { ok: true }.
 *
 * POST /api/admin/ai-reply-drafts/[id]/send  (see ../[id]/send/route.ts)
 *   Fires the email via Resend, flips status to 'sent'.
 *
 * DELETE /api/admin/ai-reply-drafts/[id]
 *   Dismiss the draft. Status flips to 'dismissed' (kept for the
 *   tone-learning corpus — "what Liam rejected" is also information).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  let body: { finalSubject?: string; finalBody?: string }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const database = await db()
  const updates: Record<string, string | null> = {}
  if (typeof body.finalSubject === 'string') updates.finalSubject = body.finalSubject.trim() || null
  if (typeof body.finalBody === 'string') updates.finalBody = body.finalBody.trim() || null
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true })
  }

  await database
    .update(schema.aiReplyDrafts)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.aiReplyDrafts.id, id))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const database = await db()
  await database
    .update(schema.aiReplyDrafts)
    .set({ status: 'dismissed', updatedAt: new Date().toISOString() })
    .where(eq(schema.aiReplyDrafts.id, id))
  return NextResponse.json({ ok: true })
}
