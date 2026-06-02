// TEMP migration: paginated R2 key list.
// GET /api/admin/migrate/r2-list?cursor=Y&prefix=P

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.STORAGE) return NextResponse.json({ error: 'No R2 binding' }, { status: 500 })

  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
  const prefix = req.nextUrl.searchParams.get('prefix') ?? undefined

  const res = await env.STORAGE.list({
    cursor,
    prefix,
    limit: 1000,
  })

  return NextResponse.json({
    objects: res.objects.map(o => ({
      key: o.key,
      size: o.size,
      etag: o.etag,
      uploaded: o.uploaded,
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
    })),
    truncated: res.truncated,
    cursor: res.truncated ? res.cursor : null,
    count: res.objects.length,
  })
}
