import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { loadRoundPage, targetOrigin } from '@/lib/qa/server'
import { commentUpdateFields, numberComments, parseCommentPatch, rowToComment, toCommentDetail } from '@/lib/qa/comments'
import type { QaTarget } from '@/lib/qa/types'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** One comment with its pin number, page URL, viewport guidance and element context. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const loaded = await loadRoundPage(database, existing.roundPageId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The pin number counts every comment on the page, so read the page's comments.
  const siblings = await database
    .select()
    .from(schema.qaComments)
    .where(eq(schema.qaComments.roundPageId, existing.roundPageId))
    .orderBy(asc(schema.qaComments.createdAt), asc(schema.qaComments.id))
  const numbers = numberComments(siblings)
  const target: QaTarget = loaded.round.target === 'live' ? 'live' : 'staging'
  const comment = toCommentDetail(existing, numbers.get(existing.id) ?? 0, loaded.roundPage.path, {
    roundId: loaded.round.id,
    roundName: loaded.round.name,
    siteName: loaded.site.name,
    target,
    siteUrl: targetOrigin(loaded.site, target),
  })
  return NextResponse.json({ comment })
}

/** Edits a comment: body, status (resolve or reopen) or the request it created. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const raw: unknown = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }
  const parsed = parseCommentPatch(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const loaded = await loadRoundPage(database, existing.roundPageId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  const [updated] = await database
    .update(schema.qaComments)
    .set(commentUpdateFields(parsed.value, new Date().toISOString()))
    .where(eq(schema.qaComments.id, id))
    .returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ comment: rowToComment(updated) })
}

/** Deletes a comment from an open round. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = await db() as Drizzle
  const [existing] = await database.select().from(schema.qaComments).where(eq(schema.qaComments.id, id)).limit(1)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const loaded = await loadRoundPage(database, existing.roundPageId)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  await database.delete(schema.qaComments).where(eq(schema.qaComments.id, id))
  return NextResponse.json({ ok: true })
}
