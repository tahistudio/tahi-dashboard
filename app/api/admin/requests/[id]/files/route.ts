import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

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
      // Uploader name — join team_members if uploaded by team
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
