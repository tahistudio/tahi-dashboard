import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/requests/[id]/files ───────────────────────────────────────
// Returns all files attached to a request.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const files = await drizzle
    .select({
      id: schema.files.id,
      filename: schema.files.filename,
      storageKey: schema.files.storageKey,
      mimeType: schema.files.mimeType,
      sizeBytes: schema.files.sizeBytes,
      uploadedByType: schema.files.uploadedByType,
      createdAt: schema.files.createdAt,
      // Uploader name : join team_members if uploaded by team
      uploaderName: schema.teamMembers.name,
    })
    .from(schema.files)
    .leftJoin(
      schema.teamMembers,
      and(
        eq(schema.files.uploadedById, schema.teamMembers.id),
        eq(schema.files.uploadedByType, 'team_member'),
      )
    )
    .where(eq(schema.files.requestId, id))
    .orderBy(desc(schema.files.createdAt))

  return NextResponse.json({ items: files, page: 1, limit: files.length })
}

// ── POST /api/admin/requests/[id]/files ─────────────────────────────────────
// Attach a file record to a request. The actual R2 upload is handled
// separately via the presign/proxy/confirm flow. This endpoint creates
// the files table row linked to the given request.
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: requestId } = await params

  const body = await req.json() as {
    fileName?: string
    fileType?: string
    fileSize?: number
    storageKey?: string
  }

  if (!body.fileName || !body.storageKey) {
    return NextResponse.json(
      { error: 'fileName and storageKey are required' },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as DrizzleDB

  // Look up the request to get its orgId
  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Resolve team member ID from Clerk userId
  let uploaderId = userId ?? 'unknown'
  if (userId) {
    const [member] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (member) uploaderId = member.id
  }

  const fileId = crypto.randomUUID()

  await drizzle.insert(schema.files).values({
    id: fileId,
    requestId,
    orgId: request.orgId,
    uploadedById: uploaderId,
    uploadedByType: 'team_member',
    filename: body.fileName,
    storageKey: body.storageKey,
    mimeType: body.fileType ?? null,
    sizeBytes: body.fileSize ?? null,
  })

  return NextResponse.json({ id: fileId }, { status: 201 })
}
