import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/portal/requests/[id]/files
 * Returns files attached to a request, scoped to the client's org.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify request belongs to this org
  const [request] = await drizzle
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
    ))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const files = await drizzle
    .select({
      id: schema.files.id,
      filename: schema.files.filename,
      storageKey: schema.files.storageKey,
      mimeType: schema.files.mimeType,
      sizeBytes: schema.files.sizeBytes,
      uploadedByType: schema.files.uploadedByType,
      createdAt: schema.files.createdAt,
    })
    .from(schema.files)
    .where(eq(schema.files.requestId, id))

  return NextResponse.json({ items: files })
}
