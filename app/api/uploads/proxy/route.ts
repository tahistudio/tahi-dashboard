import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/uploads/proxy?key=<storageKey>&token=<fileId>
 *
 * Proxy upload endpoint: streams the request body directly into R2.
 * Used when R2 presigned URLs aren't available via the Workers binding.
 *
 * The client sends a PUT request with the file body here.
 * This route validates auth, then streams to R2.
 */
export async function PUT(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
  }

  const { env } = await getCloudflareContext({ async: true })

  if (!env?.STORAGE) {
    return NextResponse.json(
      { error: 'Object storage not configured' },
      { status: 503 }
    )
  }

  const contentType = req.headers.get('content-type') ?? 'application/octet-stream'
  const body = req.body

  if (!body) {
    return NextResponse.json({ error: 'No file body' }, { status: 400 })
  }

  await (env.STORAGE as R2Bucket).put(key, body, {
    httpMetadata: { contentType },
  })

  return NextResponse.json({ ok: true, key })
}
