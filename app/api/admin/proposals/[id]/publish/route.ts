import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireProposalAccess } from '@/app/api/admin/_sales-access/artifact-scope'
import { buildProposalSnapshot } from '@/lib/proposal-snapshot'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/proposals/[id]/publish
 *
 * Snapshots the current sections + variants + cover-page metadata into
 * `publishedSnapshot`. The public viewer reads from this snapshot so
 * admin edits to the live tables don't leak until the next publish.
 *
 * Idempotent — calling repeatedly just re-snapshots the latest state.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const denied = await requireProposalAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const snapshot = await buildProposalSnapshot(database, id)
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  await database.update(schema.proposals).set({
    publishedSnapshot: JSON.stringify(snapshot),
    publishedAt: now,
    updatedAt: now,
  }).where(eq(schema.proposals.id, id))

  return NextResponse.json({ publishedAt: now, sectionCount: snapshot.sections.length, variantCount: snapshot.variants.length })
}
