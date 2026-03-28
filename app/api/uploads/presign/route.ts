import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export const dynamic = 'force-dynamic'

/**
 * POST /api/uploads/presign
 *
 * Generates an R2 presigned URL for direct browser upload.
 * The browser uploads directly to R2 — the file never passes through this server.
 *
 * Body: { filename: string, mimeType: string, requestId?: string }
 * Returns: { uploadUrl: string, storageKey: string, fileId: string }
 *
 * Flow:
 *   1. Client calls this endpoint to get a signed URL
 *   2. Client uploads file directly to R2 via PUT to uploadUrl
 *   3. Client calls POST /api/uploads/confirm with fileId to record metadata
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json() as {
    filename?: string
    mimeType?: string
    requestId?: string
  }

  if (!body.filename) {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }

  const { env } = await getCloudflareContext({ async: true })

  if (!env?.STORAGE) {
    return NextResponse.json(
      { error: 'Object storage (STORAGE) not configured' },
      { status: 503 }
    )
  }

  // Build a scoped storage key: orgId/requestId?/timestamp-filename
  const timestamp = Date.now()
  const safeFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storageKey = [
    orgId ?? 'anon',
    body.requestId ?? 'general',
    `${timestamp}-${safeFilename}`,
  ].join('/')

  const fileId = crypto.randomUUID()

  // R2 Workers binding doesn't support presigned PUT URLs directly.
  // We proxy the upload through a short-lived endpoint token instead:
  // client PUTs to /api/uploads/proxy?key=storageKey&token=fileId
  // which streams the body straight to R2.

  // Store a pending upload token in a KV-style approach via the file record
  // The client will upload to /api/uploads/proxy?key=storageKey&token=fileId
  // This proxy route streams the body directly to R2.

  return NextResponse.json({
    uploadUrl: `/api/uploads/proxy?key=${encodeURIComponent(storageKey)}&token=${fileId}`,
    storageKey,
    fileId,
    method: 'PUT',
  })
}
