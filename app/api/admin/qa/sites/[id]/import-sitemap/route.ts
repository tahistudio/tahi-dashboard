import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { fetchText, isRecord, loadSite, parseTarget, targetOrigin } from '@/lib/qa/server'
import { normalisePath, parseSitemap, SITEMAP_MAX_FILES, SITEMAP_MAX_URLS } from '@/lib/qa/sitemap'
import { computeGroups } from '@/lib/qa/grouping'
import { isSafePublicUrl } from '@/lib/qa/ssrf'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const INSERT_CHUNK = 10
/** 3 SET values plus 90 ids stays under D1's 100 bound parameters per statement. */
const ID_CHUNK = 90

/**
 * POST /api/admin/qa/sites/[id]/import-sitemap  body { target: 'staging' | 'live' }
 *
 * Reads the sitemap for one target and upserts its pages. Sitemap-sourced
 * pages that vanish from the sitemap are flagged removed (never deleted).
 * Manual pages are never flagged. If the sitemap is incomplete (a child
 * sitemap cannot be read, or the URL cap truncates the list) nothing is
 * flagged removed, so a partial read cannot hide real pages.
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
  const target = parseTarget(body.target)
  if (!target) return NextResponse.json({ error: "target must be 'staging' or 'live'" }, { status: 400 })

  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const origin = targetOrigin(site, target)
  if (!origin) return NextResponse.json({ error: 'This site has no URL for that target' }, { status: 400 })
  if (!isSafePublicUrl(origin)) return NextResponse.json({ error: 'This site has no URL for that target' }, { status: 400 })

  const rootRes = await fetchText(`${origin}/sitemap.xml`)
  if (rootRes === null) return NextResponse.json({ error: 'Could not read sitemap.xml' }, { status: 502 })

  // A body cut off at the size cap is a partial read: never flag removals from it.
  let truncated = rootRes.truncated
  let locs: string[] = []
  const root = parseSitemap(rootRes.text)
  if (root.kind === 'index') {
    if (root.locs.length > SITEMAP_MAX_FILES) truncated = true
    for (const childUrl of root.locs.slice(0, SITEMAP_MAX_FILES)) {
      if (!isSafePublicUrl(childUrl)) return NextResponse.json({ error: 'Could not read sitemap.xml' }, { status: 502 })
      const childRes = await fetchText(childUrl)
      if (childRes === null) return NextResponse.json({ error: 'Could not read sitemap.xml' }, { status: 502 })
      if (childRes.truncated) truncated = true
      const child = parseSitemap(childRes.text)
      if (child.kind === 'urlset') locs.push(...child.locs)
    }
  } else {
    locs = root.locs
  }
  if (locs.length > SITEMAP_MAX_URLS) truncated = true
  locs = locs.slice(0, SITEMAP_MAX_URLS)

  const pathSet = new Set<string>(['/'])
  for (const loc of locs) {
    const p = normalisePath(loc)
    if (p) pathSet.add(p)
  }
  const newPaths = [...pathSet]
  const newSet = new Set(newPaths)

  const now = new Date().toISOString()
  const existing = await database.select().from(schema.qaPages).where(eq(schema.qaPages.siteId, id))
  const byPath = new Map(existing.map(p => [p.path, p]))
  const keptManualPaths = existing
    .filter(p => !p.removedAt && p.source !== 'sitemap' && !newSet.has(p.path))
    .map(p => p.path)
  const groups = computeGroups([...newPaths, ...keptManualPaths])

  let added = 0
  let updated = 0
  // Existing rows whose group or removed state changes, bucketed by new groupKey
  // so each bucket is one UPDATE ... WHERE id IN (...) instead of one per row.
  const regroup = new Map<string | null, string[]>()
  const inserts: (typeof schema.qaPages.$inferInsert)[] = []
  for (const path of newPaths) {
    const groupKey = groups.get(path) ?? null
    const row = byPath.get(path)
    if (!row) {
      inserts.push({
        id: crypto.randomUUID(), siteId: id, path, groupKey, source: 'sitemap',
        removedAt: null, createdAt: now, updatedAt: now,
      })
      added++
      continue
    }
    updated++
    if (row.groupKey !== groupKey || row.removedAt) {
      const ids = regroup.get(groupKey)
      if (ids) ids.push(row.id)
      else regroup.set(groupKey, [row.id])
    }
  }

  const statements: BatchItem<'sqlite'>[] = []
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    statements.push(database.insert(schema.qaPages).values(inserts.slice(i, i + INSERT_CHUNK)))
  }
  for (const [groupKey, ids] of regroup) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      statements.push(database.update(schema.qaPages)
        .set({ groupKey, removedAt: null, updatedAt: now })
        .where(inArray(schema.qaPages.id, ids.slice(i, i + ID_CHUNK))))
    }
  }

  const staleIds = existing
    .filter(p => p.source === 'sitemap' && !p.removedAt && !newSet.has(p.path))
    .map(p => p.id)
  let removed = 0
  if (!truncated) {
    removed = staleIds.length
    for (let i = 0; i < staleIds.length; i += ID_CHUNK) {
      statements.push(database.update(schema.qaPages)
        .set({ removedAt: now, updatedAt: now })
        .where(inArray(schema.qaPages.id, staleIds.slice(i, i + ID_CHUNK))))
    }
  }
  if (statements.length > 0) await database.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

  return NextResponse.json({
    added,
    updated,
    removed,
    total: newPaths.length + keptManualPaths.length + (truncated ? staleIds.length : 0),
    truncated,
  })
}
