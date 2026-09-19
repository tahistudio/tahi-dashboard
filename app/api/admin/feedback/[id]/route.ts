/**
 * DELETE /api/admin/feedback/[id]
 *
 * Admin-only hard delete of one beta feedback comment row. Removes the R2
 * screenshot object first when the row has one, then the row itself, so
 * a dangling object never outlives the row that referenced it. A missing
 * R2 object is not an error: R2's delete is idempotent, and a best-effort
 * screenshot capture (see POST /api/feedback/screenshot) may already have
 * failed to land one.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = (await db()) as D1

  const [row] = await database
    .select({ id: schema.feedbackComments.id, screenshotKey: schema.feedbackComments.screenshotKey })
    .from(schema.feedbackComments)
    .where(eq(schema.feedbackComments.id, id))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (row.screenshotKey) {
    const { env } = getCloudflareContext()
    if (env?.STORAGE) {
      await env.STORAGE.delete(row.screenshotKey)
    }
  }

  await database.delete(schema.feedbackComments).where(eq(schema.feedbackComments.id, id))

  return NextResponse.json({ deleted: true, id })
}
