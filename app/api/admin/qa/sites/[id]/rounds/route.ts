/**
 * GET  /api/admin/qa/sites/[id]/rounds
 *      Rounds for one site, newest first, each with its browsers, tick, status and page counts.
 *      Ticks count across all of the round's browsers.
 *
 * POST /api/admin/qa/sites/[id]/rounds
 *      Snapshots the site's non-removed pages into a new round. Ungrouped pages
 *      are all included; for each template group only the sample paths are.
 *      Body: { name: string (1 to 120), target: 'staging' | 'live',
 *              browsers?: ('chromium' | 'firefox' | 'webkit')[] (non-empty, default ['chromium']) }.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadSite, targetOrigin } from '@/lib/qa/server'
import { pickSamples } from '@/lib/qa/grouping'
import { parseBrowserInput, parseRoundBrowsers } from '@/lib/qa/browsers'
import { QA_DEFAULT_BROWSER, QA_VIEWPORT_KEYS, type QaBrowserKey, type QaTarget } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RoundPageRow = typeof schema.qaRoundPages.$inferSelect
type PageRow = typeof schema.qaPages.$inferSelect

/** D1 caps bound parameters per statement at 100. A round page row binds 13 (7 rows = 91). */
const ROUND_PAGE_INSERT_CHUNK = 7
const ID_QUERY_CHUNK = 90

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function comparePaths(a: string, b: string): number {
  if (a === b) return 0
  if (a === '/') return -1
  if (b === '/') return 1
  return a < b ? -1 : 1
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Ticks and status counts for one round. Ticks count across the round's browsers: Chromium from the
 * vp_* columns, the others from the number of ticked qa_browser_ticks rows per browser.
 */
function roundCounts(rows: RoundPageRow[], browsers: QaBrowserKey[], tickedByBrowser: Map<string, number>) {
  let ticksDone = 0
  let pass = 0
  let fail = 0
  let untested = 0
  for (const r of rows) {
    if (browsers.includes('chromium')) ticksDone += r.vpXl + r.vpDesktop + r.vpTablet + r.vpMobileL + r.vpMobileP
    if (r.status === 'pass') pass++
    else if (r.status === 'fail') fail++
    else untested++
  }
  for (const b of browsers) if (b !== 'chromium') ticksDone += tickedByBrowser.get(b) ?? 0
  return { ticksDone, ticksTotal: rows.length * QA_VIEWPORT_KEYS.length * browsers.length, pass, fail, untested }
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
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rounds = (await database.select().from(schema.qaRounds).where(eq(schema.qaRounds.siteId, id)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  const roundIds = rounds.map(r => r.id)
  const pageRows: RoundPageRow[] = []
  for (const ids of chunk(roundIds, ID_QUERY_CHUNK)) {
    pageRows.push(...await database.select().from(schema.qaRoundPages).where(inArray(schema.qaRoundPages.roundId, ids)))
  }

  // Ticked Firefox and WebKit ticks per round and browser: one grouped query per chunk of rounds.
  const tickedCounts = new Map<string, Map<string, number>>()
  for (const ids of chunk(roundIds, ID_QUERY_CHUNK)) {
    const grouped = await database
      .select({ roundId: schema.qaRoundPages.roundId, browser: schema.qaBrowserTicks.browser, n: sql<number>`count(*)` })
      .from(schema.qaBrowserTicks)
      .innerJoin(schema.qaRoundPages, eq(schema.qaBrowserTicks.roundPageId, schema.qaRoundPages.id))
      .where(and(inArray(schema.qaRoundPages.roundId, ids), eq(schema.qaBrowserTicks.ticked, 1)))
      .groupBy(schema.qaRoundPages.roundId, schema.qaBrowserTicks.browser)
    for (const g of grouped) {
      const perBrowser = tickedCounts.get(g.roundId) ?? new Map<string, number>()
      perBrowser.set(g.browser, Number(g.n))
      tickedCounts.set(g.roundId, perBrowser)
    }
  }

  const items = rounds.map(round => {
    const own = pageRows.filter(p => p.roundId === round.id)
    const browsers = parseRoundBrowsers(round.browsers)
    return { ...round, browsers, ...roundCounts(own, browsers, tickedCounts.get(round.id) ?? new Map<string, number>()), pages: own.length }
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length < 1 || name.length > 120) {
    return NextResponse.json({ error: 'name must be 1 to 120 characters' }, { status: 400 })
  }
  if (body.target !== 'staging' && body.target !== 'live') {
    return NextResponse.json({ error: 'target must be staging or live' }, { status: 400 })
  }
  const target: QaTarget = body.target
  let browsers: QaBrowserKey[] = [QA_DEFAULT_BROWSER]
  if (body.browsers !== undefined) {
    const parsed = parseBrowserInput(body.browsers)
    if (!parsed) {
      return NextResponse.json({ error: 'browsers must be a non-empty list of chromium, firefox or webkit' }, { status: 400 })
    }
    browsers = parsed
  }

  const { id } = await params
  const database = (await db()) as D1
  const site = await loadSite(database, id)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!targetOrigin(site, target)) {
    return NextResponse.json({ error: `The ${target} URL is not set on this site` }, { status: 400 })
  }

  const pages: PageRow[] = await database.select().from(schema.qaPages)
    .where(and(eq(schema.qaPages.siteId, id), isNull(schema.qaPages.removedAt)))
  const byPath = new Map(pages.map(p => [p.path, p]))

  const ungrouped = pages.filter(p => !p.groupKey).sort((a, b) => comparePaths(a.path, b.path))
  const groups = new Map<string, string[]>()
  for (const p of pages) {
    if (!p.groupKey) continue
    groups.set(p.groupKey, [...(groups.get(p.groupKey) ?? []), p.path])
  }

  const now = new Date().toISOString()
  const roundId = crypto.randomUUID()
  const planned: { pageId: string; path: string; groupKey: string | null; sortOrder: number }[] = []
  for (const p of ungrouped) {
    planned.push({ pageId: p.id, path: p.path, groupKey: null, sortOrder: planned.length })
  }
  for (const key of [...groups.keys()].sort()) {
    for (const path of pickSamples(groups.get(key) ?? [])) {
      const page = byPath.get(path)
      if (!page) continue
      planned.push({ pageId: page.id, path, groupKey: key, sortOrder: planned.length })
    }
  }

  if (planned.length === 0) {
    return NextResponse.json({ error: 'Import or add pages before starting a round' }, { status: 400 })
  }

  const pageInserts = chunk(planned, ROUND_PAGE_INSERT_CHUNK).map(rows =>
    database.insert(schema.qaRoundPages).values(rows.map(r => ({
      id: crypto.randomUUID(),
      roundId,
      pageId: r.pageId,
      path: r.path,
      groupKey: r.groupKey,
      sortOrder: r.sortOrder,
      updatedAt: now,
    }))),
  )
  const round = {
    id: roundId,
    siteId: id,
    name,
    target,
    status: 'open',
    browsers: JSON.stringify(browsers),
    createdBy: userId,
    createdAt: now,
  }
  const writes = [database.insert(schema.qaRounds).values(round), ...pageInserts]
  await database.batch([writes[0], ...writes.slice(1)])

  return NextResponse.json({ item: { ...round, browsers, pages: planned.length } }, { status: 201 })
}
