/**
 * POST /api/admin/content/clusters/seed
 *
 * Idempotent insert of the 8 default topical clusters from WORKFLOWS
 * Phase I. Existing clusters with matching slugs are skipped (slug is
 * a unique key on content_clusters), so re-running is safe.
 *
 * Contract:
 *   { inserted: number, skipped: number, clusters: ContentClusterRow[] }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { inArray, asc } from 'drizzle-orm'
import { DEFAULT_CLUSTERS } from '@/lib/content-clusters'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Read everything that already matches one of our slugs so we can skip
  // the inserts. Slug is unique so this is a tight lookup.
  const slugs = DEFAULT_CLUSTERS.map(c => c.slug)
  const existing = await database
    .select({ slug: schema.contentClusters.slug })
    .from(schema.contentClusters)
    .where(inArray(schema.contentClusters.slug, slugs))
  const have = new Set(existing.map(r => r.slug))

  const now = new Date().toISOString()
  let inserted = 0
  for (const c of DEFAULT_CLUSTERS) {
    if (have.has(c.slug)) continue
    await database.insert(schema.contentClusters).values({
      id: crypto.randomUUID(),
      name: c.name,
      slug: c.slug,
      description: c.description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    inserted++
  }

  const all = await database
    .select()
    .from(schema.contentClusters)
    .orderBy(asc(schema.contentClusters.name))

  return NextResponse.json({
    inserted,
    skipped: DEFAULT_CLUSTERS.length - inserted,
    clusters: all,
  })
}
