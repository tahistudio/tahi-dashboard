import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** DELETE /api/admin/qa/pages/[id]  sets removedAt (the row is kept). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = (await db()) as D1
  const [page] = await database.select().from(schema.qaPages).where(eq(schema.qaPages.id, id)).limit(1)
  if (!page) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  await database.update(schema.qaPages)
    .set({ removedAt: now, updatedAt: now })
    .where(eq(schema.qaPages.id, id))
  return NextResponse.json({ ok: true })
}
