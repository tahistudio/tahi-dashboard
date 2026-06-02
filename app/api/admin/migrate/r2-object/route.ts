// TEMP migration: stream one R2 object's body.
// GET /api/admin/migrate/r2-object?key=X

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = req.nextUrl.searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.STORAGE) return NextResponse.json({ error: 'No R2 binding' }, { status: 500 })

  const obj = await env.STORAGE.get(key)
  if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const headers = new Headers()
  if (obj.httpMetadata?.contentType) headers.set('content-type', obj.httpMetadata.contentType)
  if (obj.httpMetadata?.contentLanguage) headers.set('content-language', obj.httpMetadata.contentLanguage)
  if (obj.httpMetadata?.contentDisposition) headers.set('content-disposition', obj.httpMetadata.contentDisposition)
  if (obj.httpMetadata?.contentEncoding) headers.set('content-encoding', obj.httpMetadata.contentEncoding)
  if (obj.httpMetadata?.cacheControl) headers.set('cache-control', obj.httpMetadata.cacheControl)
  headers.set('content-length', String(obj.size))
  headers.set('etag', obj.etag)
  if (obj.customMetadata) {
    headers.set('x-r2-custom-metadata', JSON.stringify(obj.customMetadata))
  }

  return new NextResponse(obj.body as ReadableStream, { headers })
}
