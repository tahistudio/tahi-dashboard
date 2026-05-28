/**
 * PATCH /api/admin/content/conflicts/[id]
 *
 * Records Liam's side-with-decision on an editor conflict resolution.
 * The override is what powers the long-term calibration loop — after N
 * overrides per intent type, we can adjust default voice weights.
 *
 * Contract:
 *   PATCH { liamSidedWith: 'a' | 'b' | 'editor', liamReasoning?: string }
 *     -> 200 { override }
 *     -> 404 if conflict id unknown
 *     -> 400 if liamSidedWith invalid
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const VALID_SIDES = ['a', 'b', 'editor'] as const
type Side = typeof VALID_SIDES[number]

interface PatchBody {
  liamSidedWith?: Side
  liamReasoning?: string
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing conflict id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  if (!body.liamSidedWith || !VALID_SIDES.includes(body.liamSidedWith)) {
    return NextResponse.json({ error: `liamSidedWith must be one of: ${VALID_SIDES.join(', ')}` }, { status: 400 })
  }

  const database = await db()
  const [existing] = await database
    .select({ id: schema.editorOverrides.id })
    .from(schema.editorOverrides)
    .where(eq(schema.editorOverrides.id, id))
    .limit(1)
  if (!existing) return NextResponse.json({ error: 'Conflict not found' }, { status: 404 })

  await database.update(schema.editorOverrides).set({
    liamSidedWith: body.liamSidedWith,
    liamReasoning: body.liamReasoning?.trim() || null,
    reviewedAt: new Date().toISOString(),
  }).where(eq(schema.editorOverrides.id, id))

  const [updated] = await database
    .select()
    .from(schema.editorOverrides)
    .where(eq(schema.editorOverrides.id, id))
    .limit(1)

  return NextResponse.json({ override: updated })
}
