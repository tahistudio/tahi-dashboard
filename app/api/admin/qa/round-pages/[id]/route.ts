/**
 * GET   /api/admin/qa/round-pages/[id]
 *       { roundPage, status, note, categories, pagespeed, browsers, ticks, scans, links, issues }.
 *       categories has { total, fail, warn, info } for a11y, links, seo, launch and perf (total is the
 *       count on the issue panel tab); pagespeed is { mobile?, desktop? } scores or null. Scans keyed by browser, then
 *       viewport; the round's browsers and this page's ticks per browser; the link results
 *       for this page's URLs; and every issue for the page: the page-level rules per browser,
 *       merged so an identical issue seen in several browsers appears once (with its
 *       browsers), plus duplicate title and description checks across the round's scanned
 *       desktop results.
 *
 * PATCH /api/admin/qa/round-pages/[id]
 *       Body: { vp?: { xl?, desktop?, tablet?, mobile_l?, mobile_p? } (booleans),
 *               browser?: 'chromium' | 'firefox' | 'webkit' (default: the round's first browser; applies to vp;
 *               400 when it is not one of the round's browsers),
 *               status?: 'untested' | 'pass' | 'fail', note?: string | null (max 4000) }.
 *       Chromium ticks write the vp_* columns; Firefox and WebKit ticks upsert qa_browser_ticks.
 *       409 when the round is closed.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRoundPage, rowToLinkResult, scannedLinkUrls, scansByBrowser, targetOrigin } from '@/lib/qa/server'
import { parseStoredScan } from '@/lib/qa/normalise-scan'
import { browserPageIssues, duplicateMetaIssues } from '@/lib/qa/issue-rules'
import { mergeBrowserTicks, parseRoundBrowsers } from '@/lib/qa/browsers'
import { categorySummaries, parseStoredPageSpeed } from '@/lib/qa/category-summary'
import {
  QA_BROWSER_KEYS,
  QA_PRIMARY_VIEWPORT,
  isQaBrowserKey,
  type QaBrowserKey,
  type QaLinkResult,
  type QaTarget,
} from '@/lib/qa/types'

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
  const browsers = parseRoundBrowsers(round.browsers)
  // Scans of a browser removed from the round stay stored but are hidden.
  const scans = scansByBrowser(ownRows, browsers)

  const tickRows = await database.select().from(schema.qaBrowserTicks)
    .where(eq(schema.qaBrowserTicks.roundPageId, roundPage.id))
  const ticks = mergeBrowserTicks([roundPage], tickRows, browsers).get(roundPage.id) ?? {}

  const urls = scannedLinkUrls(scans)
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
  // One desktop scan per page, from its first browser in the usual order, so a page scanned in
  // several browsers does not read as a duplicate of itself.
  const browserRank = (key: string) => {
    const i = QA_BROWSER_KEYS.findIndex(b => b === key)
    return i === -1 ? QA_BROWSER_KEYS.length : i
  }
  const firstDesktop = new Map<string, ScanRow>()
  for (const row of desktopRows) {
    if (!browsers.some(b => b === row.browser)) continue
    const held = firstDesktop.get(row.roundPageId)
    if (!held || browserRank(row.browser) < browserRank(held.browser)) firstDesktop.set(row.roundPageId, row)
  }
  const metaPages = [...firstDesktop.values()].flatMap(row => {
    const path = pathById.get(row.roundPageId)
    if (path === undefined) return []
    const seo = parseStoredScan(row.result).seo
    return [{ path, title: seo.title, description: seo.metaDescription }]
  })
  const duplicates = duplicateMetaIssues(metaPages).get(roundPage.path) ?? []

  const origin = targetOrigin(site, target) ?? ''
  const host = origin ? new URL(origin).hostname : ''
  const issues = [...browserPageIssues(scans, target, host, linkMap), ...duplicates]
  const links = urls.flatMap((url): QaLinkResult[] => {
    const hit = linkMap.get(url)
    return hit ? [hit] : []
  })

  // Everything the issue panel shows, so a caller that cannot see the screen has the same picture:
  // status and note, the five category counts, and the PageSpeed scores per strategy.
  return NextResponse.json({
    roundPage,
    status: roundPage.status,
    note: roundPage.note,
    categories: categorySummaries(issues),
    pagespeed: parseStoredPageSpeed(roundPage.pagespeed),
    browsers,
    ticks,
    scans,
    links,
    issues,
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

  const update: RoundPageUpdate = {}
  let requestedBrowser: QaBrowserKey | null = null
  if (body.browser !== undefined) {
    if (!isQaBrowserKey(body.browser)) {
      return NextResponse.json({ error: 'browser must be chromium, firefox or webkit' }, { status: 400 })
    }
    if (body.vp === undefined) return NextResponse.json({ error: 'browser needs vp' }, { status: 400 })
    requestedBrowser = body.browser
  }
  const tickWrites: { viewport: VpApiKey; ticked: number }[] = []
  if (body.vp !== undefined) {
    if (!isRecord(body.vp)) return NextResponse.json({ error: 'vp must be an object' }, { status: 400 })
    for (const [key, value] of Object.entries(body.vp)) {
      if (!(key in VP_COLUMNS)) return NextResponse.json({ error: `Unknown viewport ${key}` }, { status: 400 })
      if (typeof value !== 'boolean') return NextResponse.json({ error: `vp.${key} must be a boolean` }, { status: 400 })
      tickWrites.push({ viewport: key as VpApiKey, ticked: value ? 1 : 0 })
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
  if (Object.keys(update).length === 0 && tickWrites.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  // No browser named: the round's first one, so dashboard and MCP callers behave the same.
  const roundBrowsers = parseRoundBrowsers(loaded.round.browsers)
  const browser = requestedBrowser ?? roundBrowsers[0]
  if (tickWrites.length > 0 && !roundBrowsers.includes(browser)) {
    return NextResponse.json({ error: 'That browser is not part of this round' }, { status: 400 })
  }

  const now = new Date().toISOString()
  // Chromium ticks stay in the vp_* columns; the other browsers upsert qa_browser_ticks.
  if (browser === 'chromium') {
    for (const w of tickWrites) update[VP_COLUMNS[w.viewport]] = w.ticked
  }
  update.updatedBy = userId
  update.updatedAt = now
  await database.update(schema.qaRoundPages).set(update).where(eq(schema.qaRoundPages.id, id))
  if (browser !== 'chromium' && tickWrites.length > 0) {
    await database.insert(schema.qaBrowserTicks)
      .values(tickWrites.map(w => ({ roundPageId: id, browser, viewport: w.viewport, ticked: w.ticked, updatedBy: userId, updatedAt: now })))
      .onConflictDoUpdate({
        target: [schema.qaBrowserTicks.roundPageId, schema.qaBrowserTicks.browser, schema.qaBrowserTicks.viewport],
        set: { ticked: sql`excluded.ticked`, updatedBy: userId, updatedAt: now },
      })
  }
  return NextResponse.json({ item: { ...loaded.roundPage, ...update } })
}
