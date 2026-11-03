/**
 * GET  /api/admin/qa/sites/[id]/rounds
 *      Rounds for one site, newest first, each with its browsers, viewports, tick, status and page
 *      counts. `viewports` is the resolved list of viewport keys the round covers (never the raw
 *      column) and `legacyViewports` is true for a round made before the viewport set, which keeps
 *      the five viewports it was made with. ticksTotal is pages x viewports x browsers. ticksDone
 *      counts only ticks inside the round's browsers and viewports: Chromium ticks on a legacy
 *      round come from the qa_round_pages vp_* columns, every other tick from qa_browser_ticks rows.
 *
 * POST /api/admin/qa/sites/[id]/rounds
 *      Snapshots the site's non-removed pages into a new round. Ungrouped pages
 *      are all included; for each template group only the sample paths are.
 *      Body: { name: string (1 to 120), target: 'staging' | 'live',
 *              browsers?: ('chromium' | 'firefox' | 'webkit')[] (non-empty, default ['chromium']),
 *              viewports?: QaViewportKey[] (non-empty list of core or niche keys; a legacy key is refused) }.
 *      Omitting viewports stores nothing, so the round is a legacy round. The item carries the
 *      resolved `viewports` and `legacyViewports`.
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
import {
  QA_DEFAULT_BROWSER,
  isLegacyRoundViewports,
  parseRoundViewports,
  parseViewportInput,
  serialiseRoundViewports,
  tickStoreFor,
  type QaBrowserKey,
  type QaTarget,
  type QaViewportKey,
} from '@/lib/qa/types'

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

/** Ticked qa_browser_ticks rows of one round, counted per browser and viewport. */
interface TickedGroup { browser: string; viewport: string; n: number }

/**
 * Ticks and status counts for one round. A tick counts when its browser is one of the round's
 * browsers and its viewport is in the round's set. Chromium ticks on a legacy round come from the
 * vp_* columns; every other tick is a ticked qa_browser_ticks row (grouped), except a chromium row
 * on a legacy key, which the column wins over. ticksTotal is pages x viewports x browsers.
 */
function roundCounts(
  rows: RoundPageRow[],
  browsers: QaBrowserKey[],
  viewports: readonly QaViewportKey[],
  legacy: boolean,
  grouped: readonly TickedGroup[],
) {
  let ticksDone = 0
  let pass = 0
  let fail = 0
  let untested = 0
  for (const r of rows) {
    if (legacy && browsers.includes('chromium')) ticksDone += r.vpXl + r.vpDesktop + r.vpTablet + r.vpMobileL + r.vpMobileP
    if (r.status === 'pass') pass++
    else if (r.status === 'fail') fail++
    else untested++
  }
  const inSet = new Set<string>(viewports)
  for (const g of grouped) {
    if (!(browsers as string[]).includes(g.browser) || !inSet.has(g.viewport)) continue
    if (tickStoreFor(g.browser, g.viewport) !== 'row') continue
    ticksDone += g.n
  }
  return { ticksDone, ticksTotal: rows.length * viewports.length * browsers.length, pass, fail, untested }
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

  // Ticked qa_browser_ticks rows per round, browser and viewport: one grouped query per chunk of rounds
  // (90 round ids, so 91 bound values with the ticked flag). Filtered by each round's own set in code.
  const tickedGroups = new Map<string, TickedGroup[]>()
  for (const ids of chunk(roundIds, ID_QUERY_CHUNK)) {
    const grouped = await database
      .select({
        roundId: schema.qaRoundPages.roundId,
        browser: schema.qaBrowserTicks.browser,
        viewport: schema.qaBrowserTicks.viewport,
        n: sql<number>`count(*)`,
      })
      .from(schema.qaBrowserTicks)
      .innerJoin(schema.qaRoundPages, eq(schema.qaBrowserTicks.roundPageId, schema.qaRoundPages.id))
      .where(and(inArray(schema.qaRoundPages.roundId, ids), eq(schema.qaBrowserTicks.ticked, 1)))
      .groupBy(schema.qaRoundPages.roundId, schema.qaBrowserTicks.browser, schema.qaBrowserTicks.viewport)
    for (const g of grouped) {
      const list = tickedGroups.get(g.roundId) ?? []
      list.push({ browser: g.browser, viewport: g.viewport, n: Number(g.n) })
      tickedGroups.set(g.roundId, list)
    }
  }

  const items = rounds.map(round => {
    const own = pageRows.filter(p => p.roundId === round.id)
    const browsers = parseRoundBrowsers(round.browsers)
    const viewports = parseRoundViewports(round.viewports)
    const legacyViewports = isLegacyRoundViewports(round.viewports)
    return {
      ...round,
      browsers,
      viewports,
      legacyViewports,
      ...roundCounts(own, browsers, viewports, legacyViewports, tickedGroups.get(round.id) ?? []),
      pages: own.length,
    }
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
  // Omitted stores nothing: the round is a legacy round (NULL column).
  let viewportsJson: string | undefined
  if (body.viewports !== undefined) {
    const parsed = parseViewportInput(body.viewports)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    viewportsJson = serialiseRoundViewports(parsed.keys)
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
    ...(viewportsJson !== undefined ? { viewports: viewportsJson } : {}),
    createdBy: userId,
    createdAt: now,
  }
  const writes = [database.insert(schema.qaRounds).values(round), ...pageInserts]
  await database.batch([writes[0], ...writes.slice(1)])

  // The raw column string never leaves the route: the item carries the resolved keys.
  const item = {
    ...round,
    browsers,
    viewports: parseRoundViewports(viewportsJson),
    legacyViewports: isLegacyRoundViewports(viewportsJson),
    pages: planned.length,
  }
  return NextResponse.json({ item }, { status: 201 })
}
