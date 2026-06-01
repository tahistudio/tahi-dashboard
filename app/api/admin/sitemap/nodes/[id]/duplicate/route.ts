/**
 * POST /api/admin/sitemap/nodes/[id]/duplicate
 *
 * Clone a node (NOT its subtree — just the single node, placed under
 * the same parent). Useful for spinning up similar page templates
 * (e.g. duplicate "Service: Enterprise Webflow" → tweak into "Service:
 * Custom Webflow Cloud Apps").
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const { id } = await params
  const database = await db()
  const [src] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const newId = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.sitemapNodes).values({
    id: newId,
    parentId: src.parentId,
    sortOrder: src.sortOrder + 1,
    nodeType: src.nodeType,
    title: `${src.title} (copy)`,
    slug: src.slug ? `${src.slug}-copy` : null,
    url: null,
    purpose: src.purpose,
    icpAudience: src.icpAudience,
    primaryKeyword: src.primaryKeyword,
    aeoIntent: src.aeoIntent,
    positioningVertical: src.positioningVertical,
    successMetric: src.successMetric,
    status: 'idea',  // reset status — the copy isn't built yet
    specialFeatures: src.specialFeatures,
    designNotes: src.designNotes,
    contentNotes: src.contentNotes,
    targetLaunchDate: null,
    bodyTiptap: src.bodyTiptap,
    createdBy: userId,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  })
  const [created] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, newId))
    .limit(1)
  return NextResponse.json({ node: created })
}
