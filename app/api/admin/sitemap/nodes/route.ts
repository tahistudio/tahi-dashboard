/**
 * GET  /api/admin/sitemap/nodes              list ALL nodes (flat array)
 * POST /api/admin/sitemap/nodes              create a node
 *
 * Both gated to the sitemap allowlist (Liam + Staci).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, eq } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const database = await db()
  const nodes = await database
    .select()
    .from(schema.sitemapNodes)
    .orderBy(asc(schema.sitemapNodes.sortOrder), asc(schema.sitemapNodes.title))
  return NextResponse.json({ nodes })
}

interface CreateBody {
  parentId?: string | null
  nodeType?: 'page' | 'cms_collection' | 'section'
  title: string
  slug?: string | null
  url?: string | null
  positioningVertical?: string | null
  status?: string
  sortOrder?: number
}

export async function POST(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const body = (await req.json().catch(() => ({}))) as CreateBody
  if (!body.title || body.title.trim().length === 0) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.sitemapNodes).values({
    id,
    parentId: body.parentId ?? null,
    nodeType: body.nodeType ?? 'page',
    title: body.title.trim(),
    slug: body.slug ?? null,
    url: body.url ?? null,
    positioningVertical: body.positioningVertical ?? null,
    status: body.status ?? 'idea',
    sortOrder: body.sortOrder ?? 0,
    createdBy: userId,
    lastEditedBy: userId,
    createdAt: now,
    updatedAt: now,
  })
  const [created] = await database
    .select()
    .from(schema.sitemapNodes)
    .where(eq(schema.sitemapNodes.id, id))
    .limit(1)
  return NextResponse.json({ node: created })
}
