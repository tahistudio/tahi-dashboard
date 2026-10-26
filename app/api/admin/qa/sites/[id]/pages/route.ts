import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { isRecord, loadSite } from '@/lib/qa/server'
import { normalisePath } from '@/lib/qa/sitemap'
import { computeGroups } from '@/lib/qa/grouping'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const PATH_MAX = 500

/**
 * POST /api/admin/qa/sites/[id]/pages  body { path }
 * Adds a manual page. A path that was previously removed is restored (200)
 * instead of inserting a duplicate (201 when a new row is created).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const path = typeof body.path === 'string' ? normalisePath(body.path) : null
  if (!path || path.length > PATH_MAX) {
    return NextResponse.json({ error: 'Enter a page path such as /about' }, { status: 400 })
  }

  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await database.select().from(schema.qaPages).where(eq(schema.qaPages.siteId, id))
  const existing = rows.find(r => r.path === path)
  const now = new Date().toISOString()

  if (existing && !existing.removedAt) {
    return NextResponse.json({ error: 'That page is already in this site' }, { status: 409 })
  }
  if (existing) {
    await database.update(schema.qaPages)
      .set({ removedAt: null, updatedAt: now })
      .where(eq(schema.qaPages.id, existing.id))
    return NextResponse.json({ item: { ...existing, removedAt: null, updatedAt: now } })
  }

  const activePaths = rows.filter(r => !r.removedAt).map(r => r.path)
  const groupKey = computeGroups([...activePaths, path]).get(path) ?? null
  const item = {
    id: crypto.randomUUID(), siteId: id, path, title: null, groupKey, source: 'manual',
    removedAt: null, createdAt: now, updatedAt: now,
  }
  await database.insert(schema.qaPages).values(item)
  return NextResponse.json({ item }, { status: 201 })
}
