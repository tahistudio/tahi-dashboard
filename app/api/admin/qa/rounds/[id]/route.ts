/**
 * GET   /api/admin/qa/rounds/[id]
 *       { round, site, pages, groups, viewportDefs }. round.browsers is the list of browsers the round
 *       covers. round.viewports is the resolved list of viewport keys of the round (never the raw
 *       column) and round.legacyViewports is true for a round made before the viewport set, which
 *       keeps the five viewports it was made with. viewportDefs is the registry definition of each of
 *       those viewports (label, width, height, dpr, kind, tier, overview) plus webflowBreakpoint.
 *       Pages in sortOrder, each with browserTicks: its viewport ticks per browser of the round, over
 *       the round's viewports (Chromium ticks on a legacy round from the vp_* columns, every other
 *       tick from one query over qa_browser_ticks, which always runs).
 *       Each group lists the site's non-removed page total and how many of them this round samples.
 *
 * PATCH /api/admin/qa/rounds/[id]
 *       Body: { name?: string (1 to 120), status?: 'open' | 'closed',
 *               browsers?: ('chromium' | 'firefox' | 'webkit')[] (non-empty; open rounds only),
 *               viewports?: QaViewportKey[] (the full list, non-empty core or niche keys; open rounds only) }.
 *       Closing stamps closedAt; reopening clears it. Removing a browser or a viewport keeps its
 *       ticks, scans and comments and only hides them. A legacy round keeps the five viewports it
 *       was made with: changing its viewports is a 400. Changing browsers or viewports recounts, once,
 *       the pages that have scans in a changed browser or a changed viewport (at most 40 pages;
 *       recomputeSkipped says how many were left for their next scan). A name or status change
 *       recounts nothing. The item carries the resolved browsers, viewports and legacyViewports.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRound, recomputeCounts } from '@/lib/qa/server'
import { mergeBrowserTicks, parseBrowserInput, parseRoundBrowsers } from '@/lib/qa/browsers'
import {
  isLegacyRoundViewports,
  parseRoundViewports,
  parseViewportInput,
  serialiseRoundViewports,
  viewportDefsFor,
  webflowBreakpointFor,
  type QaBrowserKey,
  type QaViewportKey,
} from '@/lib/qa/types'

/** Most pages recounted by one PATCH, as in check-links: about 3 to 4 D1 queries each. */
const MAX_RECOMPUTE = 40

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Items in exactly one of the two lists, before-only items first. */
function symmetricDifference<T>(before: readonly T[], after: readonly T[]): T[] {
  return [...before.filter(x => !after.includes(x)), ...after.filter(x => !before.includes(x))]
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
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
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded

  const pages = (await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.roundId, round.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const browsers = parseRoundBrowsers(round.browsers)
  const viewports = parseRoundViewports(round.viewports)
  // Every tick that is not a legacy Chromium column tick for the whole round in one query (one bound
  // parameter). It always runs: a round on the registry viewports keeps its Chromium ticks here too.
  const tickRows = await database
    .select({
      roundPageId: schema.qaBrowserTicks.roundPageId,
      browser: schema.qaBrowserTicks.browser,
      viewport: schema.qaBrowserTicks.viewport,
      ticked: schema.qaBrowserTicks.ticked,
    })
    .from(schema.qaBrowserTicks)
    .innerJoin(schema.qaRoundPages, eq(schema.qaBrowserTicks.roundPageId, schema.qaRoundPages.id))
    .where(eq(schema.qaRoundPages.roundId, round.id))
  const browserTicks = mergeBrowserTicks(pages, tickRows, browsers, viewports)

  const sitePages = await database.select().from(schema.qaPages)
    .where(and(eq(schema.qaPages.siteId, site.id), isNull(schema.qaPages.removedAt)))
  const totals = new Map<string, number>()
  for (const p of sitePages) {
    if (p.groupKey) totals.set(p.groupKey, (totals.get(p.groupKey) ?? 0) + 1)
  }
  const sampled = new Map<string, number>()
  for (const p of pages) {
    if (p.groupKey) sampled.set(p.groupKey, (sampled.get(p.groupKey) ?? 0) + 1)
  }
  const groups = [...sampled.keys()].sort().map(groupKey => ({
    groupKey,
    totalPages: totals.get(groupKey) ?? 0,
    sampled: sampled.get(groupKey) ?? 0,
  }))

  return NextResponse.json({
    round: {
      ...round,
      browsers,
      viewports,
      legacyViewports: isLegacyRoundViewports(round.viewports),
      siteChecks: parseJson(round.siteChecks),
      redirectMap: parseJson(round.redirectMap),
    },
    site,
    pages: pages.map(page => ({ ...page, browserTicks: browserTicks.get(page.id) ?? {} })),
    groups,
    viewportDefs: viewportDefsFor(viewports).map(d => ({ ...d, webflowBreakpoint: webflowBreakpointFor(d.key) })),
  })
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

  const update: { name?: string; status?: 'open' | 'closed'; closedAt?: string | null; browsers?: string; viewports?: string } = {}
  let browsers: QaBrowserKey[] | null = null
  let viewports: QaViewportKey[] | null = null
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 120) {
      return NextResponse.json({ error: 'name must be 1 to 120 characters' }, { status: 400 })
    }
    update.name = name
  }
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'closed') {
      return NextResponse.json({ error: 'status must be open or closed' }, { status: 400 })
    }
    update.status = body.status
    update.closedAt = body.status === 'closed' ? new Date().toISOString() : null
  }
  if (body.browsers !== undefined) {
    browsers = parseBrowserInput(body.browsers)
    if (!browsers) {
      return NextResponse.json({ error: 'browsers must be a non-empty list of chromium, firefox or webkit' }, { status: 400 })
    }
    update.browsers = JSON.stringify(browsers)
  }
  if (body.viewports !== undefined) {
    const parsed = parseViewportInput(body.viewports)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    viewports = parsed.keys
    update.viewports = serialiseRoundViewports(viewports)
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((browsers || viewports) && loaded.round.status === 'closed') {
    return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  }
  if (viewports && isLegacyRoundViewports(loaded.round.viewports)) {
    return NextResponse.json(
      { error: 'This round keeps the five viewports it was made with. Start a new round to use the new set.' },
      { status: 400 },
    )
  }

  await database.update(schema.qaRounds).set(update).where(eq(schema.qaRounds.id, id))

  // Hidden or restored browsers and viewports change which scans count, so the pages that have scans
  // in a changed browser or a changed viewport are recounted, once each. Capped like check-links (a
  // Worker has a subrequest budget); the rest are corrected by their next scan or link check, and
  // recomputeSkipped says how many were left.
  let recomputeSkipped = 0
  if (browsers || viewports) {
    const changedBrowsers = browsers ? symmetricDifference(parseRoundBrowsers(loaded.round.browsers), browsers) : []
    const changedViewports = viewports ? symmetricDifference(parseRoundViewports(loaded.round.viewports), viewports) : []
    const found = new Set<string>()
    if (changedBrowsers.length > 0) {
      const scanned = await database
        .select({ roundPageId: schema.qaScanResults.roundPageId })
        .from(schema.qaScanResults)
        .innerJoin(schema.qaRoundPages, eq(schema.qaScanResults.roundPageId, schema.qaRoundPages.id))
        .where(and(eq(schema.qaRoundPages.roundId, id), inArray(schema.qaScanResults.browser, changedBrowsers)))
      for (const r of scanned) found.add(r.roundPageId)
    }
    if (changedViewports.length > 0) {
      // At most 16 keys plus the round id: well under the D1 cap of 100 bound values.
      const scanned = await database
        .select({ roundPageId: schema.qaScanResults.roundPageId })
        .from(schema.qaScanResults)
        .innerJoin(schema.qaRoundPages, eq(schema.qaScanResults.roundPageId, schema.qaRoundPages.id))
        .where(and(eq(schema.qaRoundPages.roundId, id), inArray(schema.qaScanResults.viewport, changedViewports)))
      for (const r of scanned) found.add(r.roundPageId)
    }
    const pageIds = [...found].sort()
    recomputeSkipped = Math.max(0, pageIds.length - MAX_RECOMPUTE)
    if (pageIds.length > 0) {
      const reloaded = {
        ...loaded,
        round: {
          ...loaded.round,
          ...(browsers ? { browsers: JSON.stringify(browsers) } : {}),
          ...(viewports ? { viewports: serialiseRoundViewports(viewports) } : {}),
        },
      }
      // The change is already saved, so a failed recount is reported, never a 500.
      for (const pageId of pageIds.slice(0, MAX_RECOMPUTE)) {
        try {
          await recomputeCounts(database, pageId, reloaded)
        } catch {
          recomputeSkipped += 1
        }
      }
    }
  }
  return NextResponse.json({
    item: {
      ...loaded.round,
      ...update,
      browsers: browsers ?? parseRoundBrowsers(loaded.round.browsers),
      viewports: viewports ?? parseRoundViewports(loaded.round.viewports),
      legacyViewports: isLegacyRoundViewports(loaded.round.viewports),
    },
    recomputeSkipped,
  })
}
