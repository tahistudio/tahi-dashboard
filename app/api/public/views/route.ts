import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Hash an IP with the encryption-key salt so we never store the plaintext.
 * SHA-256 is plenty for unique-counting purposes.
 */
async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null
  const salt = process.env.ENCRYPTION_KEY ?? ''
  const data = new TextEncoder().encode(`${ip}|${salt}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(buf))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate the share token actually belongs to a still-shared resource.
 * Returns the resource ID + its current state, or null if the token is
 * unknown / revoked. Used to reject analytics writes from stale links.
 */
async function validateToken(
  database: D1,
  resourceType: string,
  shareToken: string,
): Promise<string | null> {
  if (resourceType === 'schedule') {
    const [row] = await database
      .select({ id: schema.projectSchedules.id, status: schema.projectSchedules.status })
      .from(schema.projectSchedules)
      .where(eq(schema.projectSchedules.publicShareToken, shareToken))
      .limit(1)
    if (!row || row.status !== 'shared') return null
    return row.id
  }
  // proposal / contract types extended in phase 2 / 3
  return null
}

// ── POST /api/public/views ──────────────────────────────────────────
// Create a new share-view event. Public, no auth — token validates access.
//
// Body: {
//   resourceType: 'schedule' | 'proposal' | 'contract',
//   resourceId: string,    // server cross-checks this matches the token
//   shareToken: string,
//   sessionId: string,     // browser localStorage UUID
//   pagesViewed?: string[], // optional initial slide IDs in view
//   viewerName?: string,
//   viewerEmail?: string,
// }
// Returns: { viewId } so the client can heartbeat into PATCH /[viewId].
export async function POST(req: NextRequest) {
  let body: {
    resourceType?: string
    resourceId?: string
    shareToken?: string
    sessionId?: string
    pagesViewed?: string[]
    viewerName?: string
    viewerEmail?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.resourceType || !body.resourceId || !body.shareToken || !body.sessionId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  // Sanity-check sessionId shape — UUID-ish, prevents arbitrary giant strings.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(body.sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  // Verify the token + resource pair is real and still shared. This
  // prevents analytics writes from stale or made-up tokens.
  const validatedResourceId = await validateToken(database, body.resourceType, body.shareToken)
  if (!validatedResourceId || validatedResourceId !== body.resourceId) {
    // Don't differentiate "not found" vs "wrong resource" — same response.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Pull viewer metadata from request headers. Cloudflare workers always
  // populate CF-Connecting-IP and CF-IPCountry on incoming requests.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')
  const country = req.headers.get('cf-ipcountry')
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200) || null
  const referrer = (req.headers.get('referer') ?? '').slice(0, 500) || null
  const ipHash = await hashIp(ip)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.shareViewEvents).values({
    id,
    resourceType: body.resourceType,
    resourceId: body.resourceId,
    shareToken: body.shareToken,
    sessionId: body.sessionId,
    viewerName: body.viewerName?.trim() || null,
    viewerEmail: body.viewerEmail?.trim() || null,
    viewerIpHash: ipHash,
    viewerCountry: country,
    viewerUa: ua,
    referrer,
    pagesViewed: body.pagesViewed?.length ? JSON.stringify(body.pagesViewed) : null,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    createdAt: now,
  })

  return NextResponse.json({ viewId: id })
}
