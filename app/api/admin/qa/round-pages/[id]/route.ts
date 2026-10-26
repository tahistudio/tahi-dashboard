/**
 * GET   /api/admin/qa/round-pages/[id]
 *       { roundPage, scans, links, issues }. Scans per viewport, the link results
 *       for this page's URLs, and every issue for the page: the page-level rules
 *       plus duplicate title and description checks across the round's scanned
 *       desktop results.
 *
 * PATCH /api/admin/qa/round-pages/[id]
 *       Body: { vp?: { xl?, desktop?, tablet?, mobile_l?, mobile_p? } (booleans),
 *               status?: 'untested' | 'pass' | 'fail', note?: string | null (max 4000) }.
 *       409 when the round is closed.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRoundPage, rowToLinkResult, targetOrigin } from '@/lib/qa/server'
import { duplicateMetaIssues, pageIssues } from '@/lib/qa/issue-rules'
import { QA_PRIMARY_VIEWPORT, type QaLinkResult, type QaScanResult, type QaTarget, type QaViewportKey } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type ScanRow = typeof schema.qaScanResults.$inferSelect
type RoundPageUpdate = Partial<typeof schema.qaRoundPages.$inferInsert>

const ID_QUERY_CHUNK = 90
const NOTE_MAX = 4000
const PAGE_STATUSES = ['untested', 'pass', 'fail'] as const

/** Maps the API's viewport names to round page columns. */
const VP_COLUMNS = {
  xl: 'vpXl',
  desktop: 'vpDesktop',
  tablet: 'vpTablet',
  mobile_l: 'vpMobileL',
  mobile_p: 'vpMobileP',
} as const
type VpApiKey = keyof typeof VP_COLUMNS

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { roundPage, round, site } = loaded
  const target = round.target as QaTarget

  const ownRows = await database.select().from(schema.qaScanResults)
    .where(eq(schema.qaScanResults.roundPageId, roundPage.id))
  const scans: Partial<Record<QaViewportKey, QaScanResult>> = {}
  for (const row of ownRows) scans[row.viewport as QaViewportKey] = JSON.parse(row.result) as QaScanResult

  const urls = [...new Set(Object.values(scans).flatMap(s => (s ? s.links.map(l => l.url) : [])))]
  const linkRows: (typeof schema.qaLinkResults.$inferSelect)[] = []
  for (const urlChunk of chunk(urls, ID_QUERY_CHUNK)) {
    linkRows.push(...await database.select().from(schema.qaLinkResults)
      .where(and(eq(schema.qaLinkResults.roundId, round.id), inArray(schema.qaLinkResults.url, urlChunk))))
  }
  const linkMap = new Map(linkRows.map(r => [r.url, rowToLinkResult(r)]))

  // Duplicate title and description checks look across every scanned page of the round.
  const roundPages = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.roundId, round.id))
  const pathById = new Map(roundPages.map(p => [p.id, p.path]))
  const desktopRows: ScanRow[] = []
  for (const idChunk of chunk(roundPages.map(p => p.id), ID_QUERY_CHUNK)) {
    desktopRows.push(...await database.select().from(schema.qaScanResults)
      .where(and(inArray(schema.qaScanResults.roundPageId, idChunk), eq(schema.qaScanResults.viewport, QA_PRIMARY_VIEWPORT))))
  }
  const metaPages = desktopRows.flatMap(row => {
    const path = pathById.get(row.roundPageId)
    if (path === undefined) return []
    const seo = (JSON.parse(row.result) as QaScanResult).seo
    return [{ path, title: seo.title, description: seo.metaDescription }]
  })
  const duplicates = duplicateMetaIssues(metaPages).get(roundPage.path) ?? []

  const origin = targetOrigin(site, target) ?? ''
  const host = origin ? new URL(origin).hostname : ''
  const issues = [...pageIssues(scans, target, host, linkMap), ...duplicates]
  const links = urls.flatMap((url): QaLinkResult[] => {
    const hit = linkMap.get(url)
    return hit ? [hit] : []
  })

  return NextResponse.json({ roundPage, scans, links, issues })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: RoundPageUpdate = {}
  if (body.vp !== undefined) {
    if (!isRecord(body.vp)) return NextResponse.json({ error: 'vp must be an object' }, { status: 400 })
    for (const [key, value] of Object.entries(body.vp)) {
      if (!(key in VP_COLUMNS)) return NextResponse.json({ error: `Unknown viewport ${key}` }, { status: 400 })
      if (typeof value !== 'boolean') return NextResponse.json({ error: `vp.${key} must be a boolean` }, { status: 400 })
      update[VP_COLUMNS[key as VpApiKey]] = value ? 1 : 0
    }
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(PAGE_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'status must be untested, pass or fail' }, { status: 400 })
    }
    update.status = body.status
  }
  if (body.note !== undefined) {
    if (body.note === null) {
      update.note = null
    } else if (typeof body.note === 'string' && body.note.length <= NOTE_MAX) {
      update.note = body.note
    } else {
      return NextResponse.json({ error: `note must be text up to ${NOTE_MAX} characters` }, { status: 400 })
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  update.updatedBy = userId
  update.updatedAt = new Date().toISOString()
  await database.update(schema.qaRoundPages).set(update).where(eq(schema.qaRoundPages.id, id))
  return NextResponse.json({ item: { ...loaded.roundPage, ...update } })
}
