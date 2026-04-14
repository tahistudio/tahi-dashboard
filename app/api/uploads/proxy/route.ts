import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { db } from '@/lib/db'
import { requireAccessToOrg } from '@/lib/require-access'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/uploads/proxy?key=<storageKey>&token=<fileId>
 *
 * Proxy upload endpoint: buffers the request body and writes it to R2.
 * Used because R2 Workers bindings do not support presigned PUT URLs.
 *
 * The client sends a PUT request with the file body here.
 * Validates auth + that the caller's org matches the first segment of
 * the storage key (prevents a client writing to another org's prefix).
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId, orgId: authOrgId } = await getRequestAuth(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }

    const url = new URL(req.url)
    const key = url.searchParams.get('key')

    if (!key) {
      return NextResponse.json({ error: 'Missing storage key' }, { status: 400 })
    }

    // The first segment of the key must match the caller's org.
    const [keyOrgId] = key.split('/', 1)
    if (!keyOrgId || keyOrgId === 'anon') {
      return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 })
    }
    if (isTahiAdmin(authOrgId)) {
      const drizzle = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
      const denied = await requireAccessToOrg(drizzle, userId, keyOrgId)
      if (denied) return denied
    } else if (authOrgId !== keyOrgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { env } = await getCloudflareContext({ async: true })

    if (!env?.STORAGE) {
      console.error('R2 STORAGE binding is not available on env:', Object.keys(env ?? {}))
      return NextResponse.json(
        { error: 'Object storage not configured' },
        { status: 503 }
      )
    }

    const contentType = req.headers.get('content-type') ?? 'application/octet-stream'

    // Buffer the request body as ArrayBuffer. Streaming req.body directly to
    // R2 put() fails on Cloudflare Workers via OpenNext because the
    // ReadableStream wrapper is not a native Workers ReadableStream.
    const arrayBuffer = await req.arrayBuffer()

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'No file body' }, { status: 400 })
    }

    await (env.STORAGE as R2Bucket).put(key, arrayBuffer, {
      httpMetadata: { contentType },
    })

    return NextResponse.json({ ok: true, key })
  } catch (err) {
    console.error('Upload proxy error:', err)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}
