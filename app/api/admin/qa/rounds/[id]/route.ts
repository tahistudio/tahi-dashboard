/**
 * GET   /api/admin/qa/rounds/[id]
 *       { round, site, pages, groups }. round.browsers is the list of browsers the round covers.
 *       Pages in sortOrder, each with browserTicks: its viewport ticks per browser of the round
 *       (Chromium from the vp_* columns, the others from one query over qa_browser_ticks).
 *       Each group lists the site's non-removed page total and how many of them this round samples.
 *
 * PATCH /api/admin/qa/rounds/[id]
 *       Body: { name?: string (1 to 120), status?: 'open' | 'closed',
 *               browsers?: ('chromium' | 'firefox' | 'webkit')[] (non-empty; open rounds only) }.
 *       Closing stamps closedAt; reopening clears it. Removing a browser keeps its ticks, scans
 *       and comments and only hides them.
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
import type { QaBrowserKey } from '@/lib/qa/types'

/** Most pages recounted by one PATCH, as in check-links: about 3 to 4 D1 queries each. */
const MAX_RECOMPUTE = 40

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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
  // Firefox and WebKit ticks for the whole round in one query (one bound parameter).
  const tickRows = browsers.some(b => b !== 'chromium')
    ? await database
      .select({
        roundPageId: schema.qaBrowserTicks.roundPageId,
        browser: schema.qaBrowserTicks.browser,
        viewport: schema.qaBrowserTicks.viewport,
        ticked: schema.qaBrowserTicks.ticked,
      })
      .from(schema.qaBrowserTicks)
      .innerJoin(schema.qaRoundPages, eq(schema.qaBrowserTicks.roundPageId, schema.qaRoundPages.id))
      .where(eq(schema.qaRoundPages.roundId, round.id))
    : []
  const browserTicks = mergeBrowserTicks(pages, tickRows, browsers)

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
      siteChecks: parseJson(round.siteChecks),
      redirectMap: parseJson(round.redirectMap),
    },
    site,
    pages: pages.map(page => ({ ...page, browserTicks: browserTicks.get(page.id) ?? {} })),
    groups,
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

  const update: { name?: string; status?: 'open' | 'closed'; closedAt?: string | null; browsers?: string } = {}
  let browsers: QaBrowserKey[] | null = null
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
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (browsers && loaded.round.status === 'closed') {
    return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  }

  await database.update(schema.qaRounds).set(update).where(eq(schema.qaRounds.id, id))

  // Hidden or restored browsers change which scans count, so the pages that have scans in a changed
  // browser are recounted. Capped like check-links (a Worker has a subrequest budget); the rest are
  // corrected by their next scan or link check, and recomputeSkipped says how many were left.
  let recomputeSkipped = 0
  if (browsers) {
    const before = parseRoundBrowsers(loaded.round.browsers)
    const changed = [...before.filter(b => !browsers.includes(b)), ...browsers.filter(b => !before.includes(b))]
    if (changed.length > 0) {
      const scanned = await database
        .select({ roundPageId: schema.qaScanResults.roundPageId, browser: schema.qaScanResults.browser })
        .from(schema.qaScanResults)
        .innerJoin(schema.qaRoundPages, eq(schema.qaScanResults.roundPageId, schema.qaRoundPages.id))
        .where(and(eq(schema.qaRoundPages.roundId, id), inArray(schema.qaScanResults.browser, changed)))
      const pageIds = [...new Set(scanned.map(r => r.roundPageId))].sort()
      recomputeSkipped = Math.max(0, pageIds.length - MAX_RECOMPUTE)
      const reloaded = { ...loaded, round: { ...loaded.round, browsers: JSON.stringify(browsers) } }
      // The browsers change is already saved, so a failed recount is reported, never a 500.
      for (const pageId of pageIds.slice(0, MAX_RECOMPUTE)) {
        try {
          await recomputeCounts(database, pageId, reloaded)
        } catch {
          recomputeSkipped += 1
        }
      }
    }
  }
  return NextResponse.json({ item: { ...loaded.round, ...update, browsers: browsers ?? parseRoundBrowsers(loaded.round.browsers) }, recomputeSkipped })
}
