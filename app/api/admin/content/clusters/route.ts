/**
 * GET /api/admin/content/clusters
 *
 * Returns every cluster row, ordered by name. The Ideas tab uses this
 * for cluster filter chips and the SlideOver's cluster picker.
 *
 * Query:
 *   ?status=active|all   default 'active'
 *
 * Contract:
 *   { clusters: ContentClusterRow[] }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'active'

  const database = await db()

  const rows = statusParam === 'all'
    ? await database.select().from(schema.contentClusters).orderBy(asc(schema.contentClusters.name))
    : await database
        .select()
        .from(schema.contentClusters)
        .where(eq(schema.contentClusters.status, statusParam))
        .orderBy(asc(schema.contentClusters.name))

  return NextResponse.json({ clusters: rows })
}
