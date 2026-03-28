import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

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
 *   orgId?: string       : required if admin uploading on behalf of a client
 * }
 */
export async function POST(req: NextRequest) {
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

  // Resolve the org ID: clients use their own, admins pass an orgId
  const resolvedOrgId = body.orgId ?? orgId
  if (!resolvedOrgId) {
    return NextResponse.json({ error: 'Cannot determine org' }, { status: 400 })
  }

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const uploaderType = isAdmin ? 'team_member' : 'contact'

  // Look up team member or contact ID
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  let uploaderId = userId
  if (isAdmin) {
    const { eq } = await import('drizzle-orm')
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (member) uploaderId = member.id
  } else {
    const { eq } = await import('drizzle-orm')
    const [contact] = await drizzle
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.clerkUserId, userId))
      .limit(1)
    if (contact) uploaderId = contact.id
  }

  const id = body.fileId ?? crypto.randomUUID()
  await drizzle.insert(schema.files).values({
    id,
    requestId: body.requestId ?? null,
    orgId: resolvedOrgId,
    uploadedById: uploaderId,
    uploadedByType: uploaderType,
    filename: body.filename,
    storageKey: body.storageKey,
    mimeType: body.mimeType ?? null,
    sizeBytes: body.sizeBytes ?? null,
  })

  return NextResponse.json({ id }, { status: 201 })
}
