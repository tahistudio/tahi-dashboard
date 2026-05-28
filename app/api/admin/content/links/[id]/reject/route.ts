/**
 * POST /api/admin/content/links/[id]/reject
 *
 * Phase I · Slice 6 — Rejects a pending link suggestion.
 *
 * No Webflow side-effect. Just flips status='rejected' so the row drops
 * out of the default pending list. Audit history persists for analysis
 * (which patches Liam rejected, why, etc).
 *
 * Contract:
 *   POST /api/admin/content/links/{id}/reject
 *   200: { success: true, id }
 *   404: { error: 'Suggestion not found' }
 *   422: { error: 'Suggestion already <status>' }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const database = await db()
  const [row] = await database
    .select({ id: schema.linkSuggestions.id, status: schema.linkSuggestions.status })
    .from(schema.linkSuggestions)
    .where(eq(schema.linkSuggestions.id, id))
    .limit(1)
  if (!row) {
    return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
  }
  if (row.status === 'applied') {
    return NextResponse.json({
      error: 'Suggestion already applied',
    }, { status: 422 })
  }

  const nowIso = new Date().toISOString()
  await database.update(schema.linkSuggestions)
    .set({ status: 'rejected', updatedAt: nowIso })
    .where(eq(schema.linkSuggestions.id, id))

  return NextResponse.json({ success: true, id })
}
