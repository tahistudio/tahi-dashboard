import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { requireAccessToOrg } from '@/lib/require-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/serve?key=<storageKey>&download=1
 *
 * Serves a file from R2 Object Storage.
 * Validates auth + org-scoping before serving.
 *
 * Storage keys are formatted as `orgId/requestId/timestamp-filename`
 * (see /api/uploads/presign). We extract the first path segment and
 * verify the caller has access to that org:
 *   - Tahi admins (NEXT_PUBLIC_TAHI_ORG_ID): allowed (team-member scoping
 *     still applies via requireAccessToOrg).
 *   - Client users: orgId from their Clerk org must match the key's orgId.
 *
 * ?download=1 forces Content-Disposition: attachment (browser download)
 * Otherwise serves inline (e.g. images display in-browser).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, orgId: authOrgId } = await getRequestAuth(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const url = new URL(req.url)
    const key = url.searchParams.get('key')
    const download = url.searchParams.get('download') === '1'

    if (!key) {
      return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
    }

    // Extract the orgId prefix from the key and verify access.
    // Keys look like: `{orgId}/{requestId|'general'}/{timestamp}-{filename}`.
    // Legacy keys starting with 'anon' are not served here.
    const [keyOrgId] = key.split('/', 1)
    if (!keyOrgId || keyOrgId === 'anon') {
      return NextResponse.json({ error: 'Invalid or legacy file key' }, { status: 400 })
    }

    if (isTahiAdmin(authOrgId)) {
      // Admin path: apply team-member scoping (restricted team members can
      // only serve files for orgs they're allowed to see).
      const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
      const denied = await requireAccessToOrg(drizzle, userId, keyOrgId)
      if (denied) return denied
    } else {
      // Client path: their Clerk org must match the file's org
      if (authOrgId !== keyOrgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const { env } = await getCloudflareContext({ async: true })

    if (!env?.STORAGE) {
      console.error('R2 STORAGE binding is not available on env:', Object.keys(env ?? {}))
      return NextResponse.json({ error: 'Object storage not configured' }, { status: 503 })
    }

    const object = await (env.STORAGE as R2Bucket).get(key)

    if (!object) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const filename = key.split('/').pop() ?? 'file'
    // Strip the timestamp prefix (e.g. "1234567890-myfile.pdf" -> "myfile.pdf")
    const cleanFilename = filename.replace(/^\d+-/, '')

    // Detect MIME type from extension if R2 metadata is missing
    const ext = cleanFilename.split('.').pop()?.toLowerCase() ?? ''
    const MIME_MAP: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml',
      mp4: 'video/mp4', webm: 'video/webm',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip',
      fig: 'application/x-figma',
      sketch: 'application/x-sketch',
      ai: 'application/postscript',
      psd: 'image/vnd.adobe.photoshop',
    }
    const detectedMime = object.httpMetadata?.contentType ?? MIME_MAP[ext] ?? 'application/octet-stream'

    // Read the R2 object as an ArrayBuffer to avoid ReadableStream
    // compatibility issues between the R2 native stream and the
    // NextResponse constructor on OpenNext/Cloudflare Workers.
    const arrayBuffer = await object.arrayBuffer()

    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', detectedMime)
    responseHeaders.set('Cache-Control', 'private, max-age=3600')
    responseHeaders.set(
      'Content-Disposition',
      download
        ? `attachment; filename="${cleanFilename}"`
        : `inline; filename="${cleanFilename}"`
    )
    responseHeaders.set('Content-Length', arrayBuffer.byteLength.toString())

    return new NextResponse(arrayBuffer, { headers: responseHeaders })
  } catch (err) {
    console.error('File serve error:', err)
    return NextResponse.json({ error: 'Failed to serve file' }, { status: 500 })
  }
}
