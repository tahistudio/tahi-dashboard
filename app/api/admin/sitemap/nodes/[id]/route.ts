/**
 * GET    /api/admin/sitemap/nodes/[id]       full detail + reviews
 * PATCH  /api/admin/sitemap/nodes/[id]       partial update
 * DELETE /api/admin/sitemap/nodes/[id]       delete (cascades children — UI confirms)
 *
 * Gated to Liam + Staci.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Fields the client is allowed to PATCH. Anything not in this list
// is silently ignored — prevents drive-by writes to createdAt/createdBy.
const EDITABLE_FIELDS = new Set([
  'parentId', 'sortOrder', 'nodeType', 'title', 'slug', 'url',
  'purpose', 'icpAudience', 'primaryKeyword', 'aeoIntent',
  'positioningVertical', 'successMetric', 'status', 'specialFeatures',
  'designNotes', 'contentNotes', 'targetLaunchDate', 'bodyTiptap',
])

export async function GET(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const database = await db()
  const [node] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  if (!node) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const reviews = await database
    .select()
    .from(schema.sitemapNodeReviews)
    .where(eq(schema.sitemapNodeReviews.nodeId, id))
    .orderBy(desc(schema.sitemapNodeReviews.createdAt))
    .limit(50)
  return NextResponse.json({ node, reviews })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(k)) updates[k] = v
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no editable fields supplied' }, { status: 400 })
  }
  updates.updatedAt = new Date().toISOString()
  updates.lastEditedBy = userId
  const database = await db()
  await database
    .update(schema.sitemapNodes)
    .set(updates)
    .where(eq(schema.sitemapNodes.id, id))
  const [updated] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ node: updated })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const database = await db()
  // Cascade — delete children first (recursive walk, depth-first). At
  // expected depths of 3-4 this is fine without a CTE.
  const allNodes = await database
    .select({ id: schema.sitemapNodes.id, parentId: schema.sitemapNodes.parentId })
    .from(schema.sitemapNodes)
  const childrenOf = new Map<string, string[]>()
  for (const n of allNodes) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? []
      arr.push(n.id)
      childrenOf.set(n.parentId, arr)
    }
  }
  function collectSubtree(rootId: string, acc: string[] = []): string[] {
    acc.push(rootId)
    for (const cid of (childrenOf.get(rootId) ?? [])) collectSubtree(cid, acc)
    return acc
  }
  const idsToDelete = collectSubtree(id)
  // Delete reviews first, then nodes. D1 has no ON DELETE CASCADE for
  // our setup so we do it explicitly.
  for (const nid of idsToDelete) {
    await database.delete(schema.sitemapNodeReviews).where(eq(schema.sitemapNodeReviews.nodeId, nid))
    await database.delete(schema.sitemapNodes).where(eq(schema.sitemapNodes.id, nid))
  }
  return NextResponse.json({ deletedCount: idsToDelete.length })
}
