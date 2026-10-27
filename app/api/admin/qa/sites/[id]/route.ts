import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'
import { isRecord, loadOrgNames, loadSite, parseSiteFieldPatch } from '@/lib/qa/server'
import { parseRoundBrowsers } from '@/lib/qa/browsers'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/qa/sites/[id]  - site, its pages (active first, then removed) and rounds.
 * PATCH                          - edit name, URLs or notes.
 * DELETE                         - archive the site (sets archivedAt, keeps the rows).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pageRows = await database.select().from(schema.qaPages).where(eq(schema.qaPages.siteId, id))
  const pages = [...pageRows].sort((a, b) => {
    if (!a.removedAt !== !b.removedAt) return a.removedAt ? 1 : -1
    return a.path.localeCompare(b.path)
  })
  const rounds = await database.select().from(schema.qaRounds)
    .where(eq(schema.qaRounds.siteId, id))
    .orderBy(desc(schema.qaRounds.createdAt))
  const names = await loadOrgNames(database, [site.orgId])

  return NextResponse.json({
    item: { ...site, orgName: names.get(site.orgId) ?? null },
    pages,
    rounds: rounds.map(r => ({ ...r, browsers: parseRoundBrowsers(r.browsers) })),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const parsed = parseSiteFieldPatch(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed.patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const merged = { stagingUrl: site.stagingUrl, liveUrl: site.liveUrl, ...parsed.patch }
  if (!merged.stagingUrl && !merged.liveUrl) {
    return NextResponse.json({ error: 'Add a staging URL or a live URL' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const updates = { ...parsed.patch, updatedAt: now }
  await database.update(schema.qaSites).set(updates).where(eq(schema.qaSites.id, id))
  const names = await loadOrgNames(database, [site.orgId])
  return NextResponse.json({ item: { ...site, ...updates, orgName: names.get(site.orgId) ?? null } })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  await database.update(schema.qaSites).set({ archivedAt: now, updatedAt: now }).where(eq(schema.qaSites.id, id))
  return NextResponse.json({ ok: true })
}
