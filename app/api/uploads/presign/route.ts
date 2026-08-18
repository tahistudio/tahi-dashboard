import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { resolveOwnerOrgForUpload } from '@/lib/upload-access'

export const dynamic = 'force-dynamic'

/**
 * POST /api/uploads/presign
 *
 * Generates an R2 presigned URL for direct browser upload.
 * The browser uploads directly to R2 : the file never passes through this server.
 *
 * Body: { filename: string, mimeType: string, requestId?: string, orgId?: string }
 * `orgId` is an admin-only target org (D1 organisations.id) so team uploads
 * land under the client's prefix; it is ignored for clients.
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
      orgId?: string
    }

    if (!body.filename) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    // The key prefix is the OWNING org's D1 id (or the Tahi Clerk org id
    // for Tahi-internal files): same resolution as confirm, so the prefix
    // that proxy/serve check always matches the files row that confirm
    // writes.
    const isAdmin = isTahiAdmin(orgId)
    const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
    const resolution = await resolveOwnerOrgForUpload(drizzle, {
      isAdmin,
      userId,
      callerClerkOrgId: orgId,
      targetOrgId: isAdmin ? body.orgId ?? null : null,
      requestId: body.requestId ?? null,
    })
    if (!resolution.ok) return resolution.response

    const { env } = await getCloudflareContext({ async: true })

    if (!env?.STORAGE) {
      console.error('R2 STORAGE binding is not available on env:', Object.keys(env ?? {}))
      return NextResponse.json(
        { error: 'Object storage (STORAGE) not configured' },
        { status: 503 }
      )
    }

    // Build a scoped storage key: ownerOrgId/requestId?/timestamp-filename
    const timestamp = Date.now()
    const safeFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storageKey = [
      resolution.ownerOrgId,
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
    //
    // CRITICAL: Next.js basePath (/dashboard) is NOT auto-prepended to
    // absolute URLs we construct ourselves. Without this prefix the PUT
    // 404s in production because the actual route lives at
    // `/dashboard/api/uploads/proxy`. We read NEXT_PUBLIC_BASEPATH from
    // env (set in next.config.ts) and prepend explicitly.
    const forwardedHost = req.headers.get('x-forwarded-host')
    const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
    const origin = req.headers.get('origin')
      ?? (forwardedHost ? `${forwardedProto}://${forwardedHost}` : null)
      ?? new URL(req.url).origin
    const basePath = process.env.NEXT_PUBLIC_BASEPATH ?? ''
    const proxyPath = `${basePath}/api/uploads/proxy?key=${encodeURIComponent(storageKey)}&token=${fileId}`

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
