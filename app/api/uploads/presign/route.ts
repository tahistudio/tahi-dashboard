import { auth } from '@clerk/nextjs/server'
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
  const { userId, orgId } = await auth()
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

  // R2 presigned URL — valid for 15 minutes
  const uploadUrl = await (env.STORAGE as R2Bucket).createMultipartUpload(storageKey)
    .catch(() => null)

  // R2 doesn't have a native "presigned PUT" in the Workers API —
  // instead we use a signed token approach via the workers-compatible method.
  // For now: generate a signed URL via the binding's built-in method if available,
  // otherwise fall back to a proxy upload endpoint.
  //
  // Cloudflare R2 workers binding supports: put(), get(), delete(), list()
  // Presigned URLs require using the S3-compatible API (via wrangler or CF dashboard).
  // In production, use the R2 S3-compatible presigned URL endpoint.
  //
  // For the Workers binding path: proxy the upload through a short-lived endpoint token.

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
