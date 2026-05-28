/**
 * POST /api/admin/content/drafts/[id]/set-cover
 *
 * Sets the draft's cover image from a URL Liam pastes (after Staci hands
 * back the designed image and he uploads it somewhere reachable — R2,
 * Webflow assets, etc). Replaces the weak AI-generated cover.
 *
 * Contract:
 *   POST { coverUrl: string }
 *     -> { coverUrl }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { coverUrl?: string }
  const coverUrl = body.coverUrl?.trim()
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
    return NextResponse.json({ error: 'A valid http(s) cover URL is required' }, { status: 400 })
  }

  const database = await db()
  const [draft] = await database
    .select({ id: schema.contentDrafts.id })
    .from(schema.contentDrafts)
    .where(eq(schema.contentDrafts.id, id))
    .limit(1)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  await database.update(schema.contentDrafts).set({
    coverSvgUrl: coverUrl,
    coverTemplate: 'staci-upload',
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.contentDrafts.id, id))

  return NextResponse.json({ coverUrl })
}
