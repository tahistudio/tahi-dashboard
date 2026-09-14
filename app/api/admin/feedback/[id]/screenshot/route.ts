/**
 * GET /api/admin/feedback/[id]/screenshot
 *
 * Streams the screenshot attached to one feedback comment. Admin only, like
 * the feedback list itself: a comment can carry a picture of a client's
 * portal or of the studio's own finances, so this is not a public object
 * store.
 *
 * Keyed on the comment id rather than the R2 key so there is no way to ask
 * for an arbitrary object through this route even as an admin, and so the
 * stored key stays an implementation detail.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const [row] = await database
    .select({ screenshotKey: schema.feedbackComments.screenshotKey })
    .from(schema.feedbackComments)
    .where(eq(schema.feedbackComments.id, id))
    .limit(1)

  if (!row?.screenshotKey) {
    return NextResponse.json({ error: 'No screenshot for this comment' }, { status: 404 })
  }

  const { env } = getCloudflareContext()
  if (!env?.STORAGE) {
    return NextResponse.json({ error: 'Object storage (STORAGE) not configured' }, { status: 503 })
  }

  const object = await env.STORAGE.get(row.screenshotKey)
  if (!object) {
    return NextResponse.json({ error: 'Screenshot not found in storage' }, { status: 404 })
  }

  return new NextResponse(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'image/webp',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
