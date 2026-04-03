import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export const dynamic = 'force-dynamic'

/**
 * POST /api/uploads/presign
 *
 * Generates an R2 presigned URL for direct browser upload.
 * The browser uploads directly to R2 : the file never passes through this server.
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
  try {
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
      console.error('R2 STORAGE binding is not available on env:', Object.keys(env ?? {}))
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
    // We proxy the upload through the /api/uploads/proxy endpoint.
    // The client PUTs the file body to that URL; the proxy route buffers
    // it and writes to R2 via the STORAGE binding.

    // Build an absolute upload URL so it works regardless of environment
    // (production, preview, localhost). Use the request's own origin.
    const forwardedHost = req.headers.get('x-forwarded-host')
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
    const origin = req.headers.get('origin')
      ?? (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null)
      ?? new URL(req.url).origin
    const proxyPath = `/api/uploads/proxy?key=${encodeURIComponent(storageKey)}&token=${fileId}`

    return NextResponse.json({
      uploadUrl: `${origin}${proxyPath}`,
      storageKey,
      fileId,
      method: 'PUT',
    })
  } catch (err) {
    console.error('Presign error:', err)
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
