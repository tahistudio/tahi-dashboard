import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * Token format: 32-character URL-safe base64 derived from 24 random bytes.
 * crypto.getRandomValues is used (Workers-safe, cryptographically random).
 * Collisions over the lifetime of this app are vanishingly improbable.
 */
function mintShareToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  // Convert to URL-safe base64 (replace + → -, / → _, strip padding).
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── POST /api/admin/schedules/[id]/share ───────────────────────────────
// Mint (or rotate) a public share token for the schedule. Returns the
// token; caller composes the URL on the client side.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // If a token already exists, return it (idempotent share). Pass ?rotate=1
  // to force a new token (revokes the previous one).
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const [existing] = await database
    .select({ token: schema.projectSchedules.publicShareToken })
    .from(schema.projectSchedules)
    .where(eq(schema.projectSchedules.id, id))
    .limit(1)

  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  let token = existing.token
  if (!token || rotate) {
    token = mintShareToken()
    await database
      .update(schema.projectSchedules)
      .set({
        publicShareToken: token,
        publicSharedAt: now,
        status: 'shared',
        updatedAt: now,
      })
      .where(eq(schema.projectSchedules.id, id))
  } else {
    // Token exists, but make sure status reflects shared state.
    await database
      .update(schema.projectSchedules)
      .set({ status: 'shared', updatedAt: now })
      .where(eq(schema.projectSchedules.id, id))
  }

  return NextResponse.json({ token, status: 'shared' })
}

// ── DELETE /api/admin/schedules/[id]/share ─────────────────────────────
// Revoke the public share token. Existing public links will 404 after this.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database
    .update(schema.projectSchedules)
    .set({
      publicShareToken: null,
      publicSharedAt: null,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.projectSchedules.id, id))

  return NextResponse.json({ success: true })
}
