import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

function mintShareToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// POST /api/admin/proposals/[id]/share — mint or rotate a public token.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const [existing] = await database
    .select({ token: schema.proposals.publicShareToken })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, id))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  let token = existing.token
  if (!token || rotate) {
    token = mintShareToken()
    await database.update(schema.proposals).set({
      publicShareToken: token,
      publicSharedAt: now,
      status: 'shared',
      updatedAt: now,
    }).where(eq(schema.proposals.id, id))
  } else {
    await database.update(schema.proposals).set({
      status: 'shared',
      updatedAt: now,
    }).where(eq(schema.proposals.id, id))
  }
  return NextResponse.json({ token, status: 'shared' })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.update(schema.proposals).set({
    publicShareToken: null,
    publicSharedAt: null,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.proposals.id, id))
  return NextResponse.json({ success: true })
}
