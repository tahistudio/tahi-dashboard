import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export const dynamic = 'force-dynamic'

/**
 * GET /api/uploads/serve?key=<storageKey>&download=1
 *
 * Serves a file from R2 Object Storage.
 * Validates auth before serving — files are never publicly accessible.
 *
 * ?download=1 forces Content-Disposition: attachment (browser download)
 * Otherwise serves inline (e.g. images display in-browser).
 */
export async function GET(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  const download = url.searchParams.get('download') === '1'

  if (!key) {
    return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
  }

  const { env } = await getCloudflareContext({ async: true })

  if (!env?.STORAGE) {
    return NextResponse.json({ error: 'Object storage not configured' }, { status: 503 })
  }

  const object = await (env.STORAGE as R2Bucket).get(key)

  if (!object) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const filename = key.split('/').pop() ?? 'file'
  // Strip the timestamp prefix (e.g. "1234567890-myfile.pdf" → "myfile.pdf")
  const cleanFilename = filename.replace(/^\d+-/, '')

  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set(
    'Content-Disposition',
    download
      ? `attachment; filename="${cleanFilename}"`
      : `inline; filename="${cleanFilename}"`
  )

  if (object.size) {
    headers.set('Content-Length', object.size.toString())
  }

  return new NextResponse(object.body as ReadableStream, { headers })
}
