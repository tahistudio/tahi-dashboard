import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ fileId: string }> }

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/[fileId] — file metadata (for preview UIs)
 *
 * Returns { id, filename, mimeType, sizeBytes, storageKey, requestId, orgId, uploadedAt }
 * Used by the message attachment menu so the View / Download buttons can
 * compose the correct serve URL without re-fetching the whole message.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { userId, orgId: authOrgId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { fileId } = await ctx.params
  const drizzle = (await db()) as D1
  const [file] = await drizzle.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Same org-scoping as serve.
  if (isTahiAdmin(authOrgId)) {
    const denied = await requireAccessToOrg(drizzle, userId, file.orgId)
    if (denied) return denied
  } else if (authOrgId !== file.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ file })
}

/**
 * DELETE /api/uploads/[fileId]
 *
 * Hard-deletes the file from both R2 and the files table. Caller must
 * have access to the file's org (admin team-member scoping enforced).
 *
 * The row is gone entirely — message attachments referencing this file
 * will have their fileId resolve to null on next render. Keep that in
 * mind: this is destructive.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { userId, orgId: authOrgId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { fileId } = await ctx.params
  const drizzle = (await db()) as D1
  const [file] = await drizzle.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Org-scoping
  if (isTahiAdmin(authOrgId)) {
    const denied = await requireAccessToOrg(drizzle, userId, file.orgId)
    if (denied) return denied
  } else if (authOrgId !== file.orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Best-effort R2 delete. Even if R2 has already lost the object, we
  // still drop the DB row so it stops appearing in lists.
  try {
    const { env } = await getCloudflareContext({ async: true })
    if (env?.STORAGE) {
      await (env.STORAGE as R2Bucket).delete(file.storageKey)
    }
  } catch (err) {
    console.warn('R2 delete failed (proceeding with DB delete):', err)
  }

  await drizzle.delete(schema.files).where(eq(schema.files.id, fileId))

  return NextResponse.json({ success: true })
}
