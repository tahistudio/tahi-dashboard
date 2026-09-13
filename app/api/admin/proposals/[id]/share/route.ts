import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireProposalAccess } from '@/app/api/admin/_sales-access/artifact-scope'
import { buildProposalSnapshot } from '@/lib/proposal-snapshot'

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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  const denied = await requireProposalAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const [existing] = await database
    .select({
      token: schema.proposals.publicShareToken,
      publishedSnapshot: schema.proposals.publishedSnapshot,
    })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, id))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  // Sharing publishes a first snapshot. The public viewer falls back to the
  // LIVE rows when there is none, so a proposal that was shared and never
  // published served whatever the studio happened to be typing at the time:
  // a renamed package, a half-written scope, a price mid-edit.
  //
  // Only when there is none. An existing published state is never clobbered
  // by a re-share (or a token rotation), because that would silently publish
  // edits nobody pressed Republish on.
  const firstSnapshot = existing.publishedSnapshot ? null : await buildProposalSnapshot(database, id)

  const published = firstSnapshot
    ? { publishedSnapshot: JSON.stringify(firstSnapshot), publishedAt: now }
    : {}

  let token = existing.token
  if (!token || rotate) {
    token = mintShareToken()
    await database.update(schema.proposals).set({
      publicShareToken: token,
      publicSharedAt: now,
      status: 'shared',
      updatedAt: now,
      ...published,
    }).where(eq(schema.proposals.id, id))
  } else {
    await database.update(schema.proposals).set({
      status: 'shared',
      updatedAt: now,
      ...published,
    }).where(eq(schema.proposals.id, id))
  }

  // publishedAt, not only a boolean. The caller keeps a local copy of the
  // proposal and its header button reads Publish or Republish off that
  // field, so returning only "yes a snapshot happened" left an admin who
  // shared a skeleton and carried on building with no sign anywhere that the
  // client is pinned to the version they shared until they press Republish.
  return NextResponse.json({
    token,
    status: 'shared',
    published: !!firstSnapshot,
    publishedAt: firstSnapshot ? now : null,
  })
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const denied = await requireProposalAccess(database, { userId, orgId }, id)
  if (denied) return denied

  // The published state goes with the link. POST only ever takes a snapshot
  // when there is none, so leaving one behind meant a revoke, a heavy
  // rewrite and a re-share served the client the version from the FIRST
  // share, with nothing in the UI saying so.
  await database.update(schema.proposals).set({
    publicShareToken: null,
    publicSharedAt: null,
    publishedSnapshot: null,
    publishedAt: null,
    status: 'draft',
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.proposals.id, id))
  return NextResponse.json({ success: true })
}
