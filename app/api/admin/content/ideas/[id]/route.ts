/**
 * PATCH /api/admin/content/ideas/[id]
 *
 * Triage action on a single content idea. Used by the Ideas tab when
 * Liam clicks Approve / Reject or saves opinion fields from the
 * SlideOver.
 *
 * Body:
 *   {
 *     action?: 'approve' | 'reject',     // optional — when set, flips status
 *     liamOpinion?: string | null,       // free-form opinion paragraph
 *     liamAnswers?: Array<{q,a}> | null, // per-question answers (JSON)
 *   }
 *
 * Returns the updated row. Approving sets `status='approved'` so the
 * next slice's drafting pipeline can pick it up. Reject is final for
 * the current week (Liam can re-approve later if he changes his mind).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface PatchBody {
  action?: 'approve' | 'reject'
  liamOpinion?: string | null
  liamAnswers?: Array<{ q: string; a: string }> | null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as PatchBody

  const database = await db()
  const [existing] = await database
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, id))
    .limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }

  const updates: Partial<typeof schema.contentIdeas.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.action === 'approve') {
    updates.status = 'approved'
  } else if (body.action === 'reject') {
    updates.status = 'rejected'
  }

  if (Object.prototype.hasOwnProperty.call(body, 'liamOpinion')) {
    const v = body.liamOpinion
    updates.liamOpinion = v == null ? null : String(v)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'liamAnswers')) {
    const v = body.liamAnswers
    updates.liamAnswers = v == null ? null : JSON.stringify(v)
  }

  await database
    .update(schema.contentIdeas)
    .set(updates)
    .where(eq(schema.contentIdeas.id, id))

  const [updated] = await database
    .select()
    .from(schema.contentIdeas)
    .where(eq(schema.contentIdeas.id, id))
    .limit(1)

  return NextResponse.json({ idea: updated })
}
