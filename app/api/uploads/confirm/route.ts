import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { resolveOwnerOrgForUpload } from '@/lib/upload-access'
import { ACTING_AUDIT_PREFIX } from '@/lib/acting-as'
import { logAuditStrict } from '@/lib/audit'
import {
  IMPERSONATE_MODE_COOKIE,
  IMPERSONATE_ORG_COOKIE,
  readPreviewMode,
  resolvePreviewOrgId,
} from '@/lib/preview-cookie'

export const dynamic = 'force-dynamic'

/**
 * POST /api/uploads/confirm
 *
 * Called after the browser has successfully uploaded a file to R2.
 * Records the file metadata in the `files` table.
 *
 * Body: {
 *   fileId: string       : from presign response
 *   storageKey: string   : from presign response
 *   filename: string
 *   mimeType: string
 *   sizeBytes: number
 *   requestId?: string   : link file to a specific request
 *   orgId?: string       : admin-only target org (D1 organisations.id);
 *                          ignored for clients, who are always forced to
 *                          their own resolved D1 org
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await getRequestAuth(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const body = await req.json() as {
      fileId?: string
      storageKey?: string
      filename?: string
      mimeType?: string
      sizeBytes?: number
      requestId?: string
      orgId?: string
    }

    if (!body.storageKey || !body.filename) {
      return NextResponse.json({ error: 'storageKey and filename are required' }, { status: 400 })
    }

    const isAdmin = isTahiAdmin(orgId)
    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    // Canonical file identity is the D1 organisations.id. Clients can never
    // pick the owning org (body.orgId is ignored for them); admins may name
    // a target org, validated + access-scoped inside the resolver.
    const resolution = await resolveOwnerOrgForUpload(drizzle, {
      isAdmin,
      userId,
      callerClerkOrgId: orgId,
      targetOrgId: isAdmin ? body.orgId ?? null : null,
      requestId: body.requestId ?? null,
    })
    if (!resolution.ok) return resolution.response
    const ownerOrgId = resolution.ownerOrgId

    // The row must describe a key the caller could legitimately have
    // written: the key's org prefix has to be the owning org or the
    // caller's own Clerk org (legacy presigns in flight). Without this a
    // caller could register a row in their own org pointing at another
    // tenant's R2 key and read it through serve.
    const [keyOrgId] = body.storageKey.split('/', 1)
    const prefixOk = keyOrgId === ownerOrgId || (orgId !== null && keyOrgId === orgId)
    if (!prefixOk) {
      return NextResponse.json({ error: 'Storage key does not match the target org' }, { status: 403 })
    }

    const uploaderType = isAdmin ? 'team_member' : 'contact'
    let uploaderId = userId
    if (isAdmin) {
      const [member] = await drizzle
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.clerkUserId, userId))
        .limit(1)
      if (member) uploaderId = member.id
    } else {
      const [contact] = await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.clerkUserId, userId))
        .limit(1)
      if (contact) uploaderId = contact.id
    }

    const id = body.fileId ?? crypto.randomUUID()

    // Idempotent: a retried confirm updates the existing row (also
    // normalising a legacy Clerk-id orgId to the D1 id) instead of failing
    // on the primary key. Non-admins may only touch rows already in their
    // own org (either id space, for legacy rows).
    const [existing] = await drizzle
      .select({ id: schema.files.id, orgId: schema.files.orgId })
      .from(schema.files)
      .where(eq(schema.files.id, id))
      .limit(1)

    if (existing) {
      const ownsExisting = existing.orgId === ownerOrgId || (orgId !== null && existing.orgId === orgId)
      if (!isAdmin && !ownsExisting) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      await drizzle
        .update(schema.files)
        .set({
          requestId: body.requestId ?? null,
          orgId: ownerOrgId,
          filename: body.filename,
          storageKey: body.storageKey,
          mimeType: body.mimeType ?? null,
          sizeBytes: body.sizeBytes ?? null,
        })
        .where(eq(schema.files.id, id))
      return NextResponse.json({ id }, { status: 200 })
    }

    await drizzle.insert(schema.files).values({
      id,
      requestId: body.requestId ?? null,
      orgId: ownerOrgId,
      uploadedById: uploaderId,
      uploadedByType: uploaderType,
      filename: body.filename,
      storageKey: body.storageKey,
      mimeType: body.mimeType ?? null,
      sizeBytes: body.sizeBytes ?? null,
    })

    // This route is the one write path that already behaved like Act as
    // client: it is admin-authenticated, it lets an admin name the owning org,
    // and it has always stamped uploaded_by_type 'team_member'. So the file row
    // needed no change at all, only the record that the upload was made from
    // inside a client's own surface rather than from the studio side.
    //
    // The cookies are read through lib/preview-cookie.ts, the same rule
    // everything else uses, and the org must match the previewed one: an admin
    // uploading to a DIFFERENT client while a preview happens to be open is an
    // ordinary studio upload and is not tagged as acting.
    const actingOrgId = isAdmin
      ? resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)
      : null
    const actingHere =
      actingOrgId === ownerOrgId &&
      readPreviewMode(req.cookies.get(IMPERSONATE_MODE_COOKIE)?.value) === 'act'

    if (actingHere) {
      await logAuditStrict(drizzle as unknown as DB, {
        action: `${ACTING_AUDIT_PREFIX}file.uploaded`,
        userId,
        userType: 'team_member',
        entityType: 'file',
        entityId: id,
        metadata: {
          mode: 'act',
          route: 'POST /api/uploads/confirm',
          orgId: ownerOrgId,
          adminTeamMemberId: uploaderId,
          requestId: body.requestId ?? null,
          filename: body.filename,
        },
      })
    }

    return NextResponse.json({ id }, { status: 201 })
  } catch (err) {
    console.error('Upload confirm error:', err)
    return NextResponse.json(
      { error: 'Failed to confirm upload' },
      { status: 500 }
    )
  }
}
