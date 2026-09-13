import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { decideUploadDelete, decideUploadRead, resolveD1OrgId } from '@/lib/upload-access'
import { logAudit } from '@/lib/audit'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ fileId: string }> }

/**
 * Shared org-scoping for GET: authorize off the files row (files.orgId is
 * the canonical D1 organisations.id; legacy rows may carry a Clerk org id,
 * which decideUploadRead also accepts). Returns a NextResponse when denied,
 * null when allowed.
 */
async function denyUnlessFileAccess(
  drizzle: D1,
  userId: string,
  authOrgId: string | null,
  fileOrgId: string,
): Promise<NextResponse | null> {
  const isAdmin = isTahiAdmin(authOrgId)
  const decision = decideUploadRead({
    isAdmin,
    fileOrgId,
    keyOrgId: null,
    requesterClerkOrgId: authOrgId,
    requesterD1OrgId: isAdmin ? null : await resolveD1OrgId(drizzle, authOrgId),
  })
  if (decision.outcome === 'admin_scope_check') {
    return requireAccessToOrg(drizzle, userId, decision.targetOrgId)
  }
  if (decision.outcome === 'deny') {
    return NextResponse.json({ error: decision.error }, { status: decision.status })
  }
  return null
}

/**
 * Org + ownership scoping for DELETE. Same org check GET uses, plus the
 * extra tightening: a non-admin may only delete a file their OWN org
 * uploaded (uploadedByType 'contact'), never a studio deliverable.
 */
async function denyUnlessFileDeleteAccess(
  drizzle: D1,
  userId: string,
  authOrgId: string | null,
  file: { orgId: string; uploadedByType: string },
): Promise<NextResponse | null> {
  const isAdmin = isTahiAdmin(authOrgId)
  const decision = decideUploadDelete({
    isAdmin,
    uploadedByType: file.uploadedByType,
    fileOrgId: file.orgId,
    keyOrgId: null,
    requesterClerkOrgId: authOrgId,
    requesterD1OrgId: isAdmin ? null : await resolveD1OrgId(drizzle, authOrgId),
  })
  if (decision.outcome === 'admin_scope_check') {
    return requireAccessToOrg(drizzle, userId, decision.targetOrgId)
  }
  if (decision.outcome === 'deny') {
    return NextResponse.json({ error: decision.error }, { status: decision.status })
  }
  return null
}

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/[fileId] - file metadata (for preview UIs)
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
  const denied = await denyUnlessFileAccess(drizzle, userId, authOrgId, file.orgId)
  if (denied) return denied
  return NextResponse.json({ file })
}

/**
 * DELETE /api/uploads/[fileId]
 *
 * Hard-deletes the file from both R2 and the files table. Admins are
 * scoped to the file's org (team-member access scoping enforced); a client
 * (contact) may only delete a file their own org uploaded, uploadedByType
 * 'contact' - never a studio deliverable, even one they can read and
 * download from the same org.
 *
 * The R2 object is removed first. If that fails the D1 row is left exactly
 * as it was and the caller gets a plain 502: better an object nobody could
 * remove than a row that still claims to exist while its bytes are gone
 * (message attachments referencing this file would resolve to nothing).
 * A successful delete writes one audit_log row, same as every other
 * destructive admin write.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { userId, orgId: authOrgId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { fileId } = await ctx.params
  const drizzle = (await db()) as D1
  const [file] = await drizzle.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1)
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Org + ownership scoping.
  const denied = await denyUnlessFileDeleteAccess(drizzle, userId, authOrgId, file)
  if (denied) return denied

  try {
    const { env } = await getCloudflareContext({ async: true })
    if (!env?.STORAGE) {
      console.error('R2 STORAGE binding is not available on env')
      return NextResponse.json(
        { error: 'File storage is not available right now. Try again shortly.' },
        { status: 502 },
      )
    }
    await (env.STORAGE as R2Bucket).delete(file.storageKey)
  } catch (err) {
    console.error('R2 delete failed, leaving the file row in place:', err)
    return NextResponse.json(
      { error: 'Could not delete the file from storage. Try again shortly.' },
      { status: 502 },
    )
  }

  await drizzle.delete(schema.files).where(eq(schema.files.id, fileId))

  const isAdmin = isTahiAdmin(authOrgId)
  await logAudit(drizzle as unknown as DB, {
    action: 'file.deleted',
    userId,
    userType: isAdmin ? 'team_member' : 'contact',
    entityType: 'file',
    entityId: fileId,
    metadata: {
      filename: file.filename,
      orgId: file.orgId,
      uploadedByType: file.uploadedByType,
    },
  })

  return NextResponse.json({ success: true })
}
