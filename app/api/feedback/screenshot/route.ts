/**
 * POST /api/feedback/screenshot
 *
 * Stores the best-effort screenshot the feedback ball rasterises at send
 * time and hands back the R2 key to attach to the comment. Any signed-in
 * user may post one, matching POST /api/feedback: a client's screenshot of
 * their own portal is exactly as useful as a Tahi one.
 *
 * The key is minted HERE, never accepted from the caller. That is the whole
 * point of a separate route rather than reusing /api/uploads/presign: the
 * presign flow lets the caller keep a key it chose the filename half of, and
 * feedback_comments.screenshot_key is read back by an admin-only viewer, so
 * a caller that could write an arbitrary key into that column could aim the
 * viewer at another client's object. Here the caller supplies bytes and
 * nothing else.
 *
 * The body is the raw image, not multipart: the sender is a canvas blob, so
 * there is nothing else in the envelope worth parsing. WebP only, capped at
 * 3MB, which a 1200px-wide viewport capture at quality 0.8 does not come
 * close to. Over the cap is a 413 rather than a truncated object.
 *
 * There is deliberately no DELETE and no listing. The object's only reader
 * is GET /api/admin/feedback/[id]/screenshot.
 */
import { getRequestAuth } from '@/lib/server-auth'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'

const MAX_BYTES = 3 * 1024 * 1024

export async function POST(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/webp')) {
    return NextResponse.json({ error: 'content-type must be image/webp' }, { status: 415 })
  }

  const bytes = await req.arrayBuffer()
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: 'empty body' }, { status: 400 })
  }
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'screenshot too large' }, { status: 413 })
  }

  const { env } = getCloudflareContext()
  if (!env?.STORAGE) {
    // No binding is not the sender's problem: the comment itself still needs
    // to land, so this answers cleanly and the ball sends without a key.
    return NextResponse.json({ error: 'Object storage (STORAGE) not configured' }, { status: 503 })
  }

  const key = `feedback/${crypto.randomUUID()}.webp`
  await env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType: 'image/webp' },
  })

  return NextResponse.json({ key }, { status: 201 })
}
