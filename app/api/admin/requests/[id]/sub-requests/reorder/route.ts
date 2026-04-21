/**
 * PATCH /api/admin/requests/[id]/sub-requests/reorder
 *
 * Body : { order: Array<{ id: string; subPosition: number }> }
 *
 * Atomically updates subPosition for each listed child. Any child not
 * listed is left as-is. Children must belong to this parent — rows
 * referencing the wrong parent are silently skipped.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: parentId } = await params
  const body = await req.json().catch(() => null) as {
    order?: Array<{ id: string; subPosition: number }>
  } | null
  if (!Array.isArray(body?.order)) {
    return NextResponse.json({ error: 'Body must be { order: [{id, subPosition}] }' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const [parent] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, parentId))
    .limit(1)
  if (!parent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, parent.orgId)
  if (denied) return denied

  let updated = 0
  for (const row of body!.order!) {
    if (!row.id || typeof row.subPosition !== 'number') continue
    await drizzle
      .update(schema.requests)
      .set({ subPosition: row.subPosition })
      .where(and(
        eq(schema.requests.id, row.id),
        eq(schema.requests.parentRequestId, parentId),
      ))
    updated++
  }

  return NextResponse.json({ ok: true, updated })
}
