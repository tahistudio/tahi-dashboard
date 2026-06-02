// TEMP migration: write a single R2 object body. Idempotent (overwrites).
// PUT /api/admin/migrate/r2-put?key=X  (also accepts POST). Body is raw bytes.

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

async function handle(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.STORAGE) return NextResponse.json({ error: 'No R2 binding' }, { status: 500 })

  const ct = req.headers.get('content-type') ?? undefined
  const customRaw = req.headers.get('x-r2-custom-metadata')
  let customMetadata: Record<string, string> | undefined
  if (customRaw) {
    try {
      customMetadata = JSON.parse(customRaw)
    } catch { /* ignore malformed */ }
  }

  const body = req.body
  if (!body) return NextResponse.json({ error: 'Missing body' }, { status: 400 })

  const written = await env.STORAGE.put(key, body, {
    httpMetadata: ct ? { contentType: ct } : undefined,
    customMetadata,
  })

  return NextResponse.json({
    key,
    size: written?.size ?? null,
    etag: written?.etag ?? null,
  })
}

export const PUT = handle
export const POST = handle
