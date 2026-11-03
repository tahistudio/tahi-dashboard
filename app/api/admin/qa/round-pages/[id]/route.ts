/**
 * GET   /api/admin/qa/round-pages/[id]
 *       { roundPage, status, note, categories, pagespeed, browsers, viewports, ticks, scans, links, issues }.
 *       categories has { total, fail, warn, info } for a11y, links, seo, launch and perf (total is the
 *       count on the issue panel tab); pagespeed is { mobile?, desktop? } scores or null. Scans keyed by browser, then
 *       viewport; the round's browsers; viewports is the round's resolved viewport keys (a legacy
 *       round gets xl, desktop, tablet, mobile_l, mobile_p); this page's ticks per browser over
 *       those viewports; the link results for this page's URLs; and every issue for the page:
 *       the page-level rules per browser, merged so an identical issue seen in several browsers
 *       appears once (with its browsers), plus duplicate title and description checks across
 *       the round's scanned results on the round's primary viewport (desktop for a legacy
 *       round, laptop_m for the core set; see primaryViewportFor).
 *
 * PATCH /api/admin/qa/round-pages/[id]
 *       Body: { vp?: { [viewportKey]: boolean } (the keys of the round's viewport set; a legacy
 *                 round uses xl, desktop, tablet, mobile_l, mobile_p),
 *               browser?: 'chromium' | 'firefox' | 'webkit' (default: the round's first browser; applies to vp;
 *               400 when it is not one of the round's browsers),
 *               status?: 'untested' | 'pass' | 'fail', note?: string | null (max 4000) }.
 *       Where a tick is stored: a Chromium tick on a legacy key writes the vp_* column of the page;
 *       every other tick (Firefox and WebKit, and Chromium on any other key) upserts qa_browser_ticks.
 *       The page update and every tick chunk go to D1 in one batch, so a failure never leaves a
 *       partial tick set.
 *       Errors, in this order: 400 for a body that is not an object, an unknown browser, a vp that
 *       is not an object, a key that is not a registry viewport (the key echoed up to 40
 *       characters) or a non boolean value, a bad status or note, or nothing to update (all
 *       before any database read); 404; 409 when the round is closed; 400 when the browser is not
 *       one of the round's browsers; 400 when a vp key is not part of the round's viewport set.
 *       The response item is the page row with the update applied plus browserTicks, this
 *       page's settled ticks per round browser over the round's viewports.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRoundPage, rowToLinkResult, scannedLinkUrls, scansByBrowser, targetOrigin } from '@/lib/qa/server'
import { parseStoredScan } from '@/lib/qa/normalise-scan'
import { browserPageIssues, duplicateMetaIssues } from '@/lib/qa/issue-rules'
import { mergeBrowserTicks, parseRoundBrowsers } from '@/lib/qa/browsers'
import { categorySummaries, parseStoredPageSpeed } from '@/lib/qa/category-summary'
import {
  QA_BROWSER_KEYS,
  isQaBrowserKey,
  isQaViewportKey,
  legacyTickColumn,
  parseRoundViewports,
  primaryViewportFor,
  tickStoreFor,
  type QaBrowserKey,
  type QaLinkResult,
  type QaTarget,
  type QaViewportKey,
} from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type ScanRow = typeof schema.qaScanResults.$inferSelect
type RoundPageUpdate = Partial<typeof schema.qaRoundPages.$inferInsert>
interface TickRowWrite {
  roundPageId: string
  browser: QaBrowserKey
  viewport: QaViewportKey
  ticked: number
  updatedBy: string | null
  updatedAt: string
}

const ID_QUERY_CHUNK = 90
const NOTE_MAX = 4000
const PAGE_STATUSES = ['untested', 'pass', 'fail'] as const
/** Rows per qa_browser_ticks upsert statement: 7 binds per row today, 8 once SQA.5 adds via, under the D1 cap of 100. */
const TICK_UPSERT_CHUNK = 10

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
  const viewports = parseRoundViewports(round.viewports)
  // Scans of a browser or viewport removed from the round stay stored but are hidden.
  const scans = scansByBrowser(ownRows, browsers, viewports)

  const tickRows = await database.select().from(schema.qaBrowserTicks)
    .where(eq(schema.qaBrowserTicks.roundPageId, roundPage.id))
  const ticks = mergeBrowserTicks([roundPage], tickRows, browsers, viewports).get(roundPage.id) ?? {}

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
  // The round's primary viewport supplies the SEO fields; a set always has one, the guard is for the type.
  const primary = primaryViewportFor(viewports)
  const primaryRows: ScanRow[] = []
  if (primary !== null) {
    for (const idChunk of chunk(roundPages.map(p => p.id), ID_QUERY_CHUNK)) {
      primaryRows.push(...await database.select().from(schema.qaScanResults)
        .where(and(inArray(schema.qaScanResults.roundPageId, idChunk), eq(schema.qaScanResults.viewport, primary))))
    }
  }
  // One primary viewport scan per page, from its first browser in the usual order, so a page
  // scanned in several browsers does not read as a duplicate of itself.
  const browserRank = (key: string) => {
    const i = QA_BROWSER_KEYS.findIndex(b => b === key)
    return i === -1 ? QA_BROWSER_KEYS.length : i
  }
  const firstPrimary = new Map<string, ScanRow>()
  for (const row of primaryRows) {
    if (!browsers.some(b => b === row.browser)) continue
    const held = firstPrimary.get(row.roundPageId)
    if (!held || browserRank(row.browser) < browserRank(held.browser)) firstPrimary.set(row.roundPageId, row)
  }
  const metaPages = [...firstPrimary.values()].flatMap(row => {
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
    viewports,
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
  const tickWrites: { viewport: QaViewportKey; ticked: number }[] = []
  if (body.vp !== undefined) {
    if (!isRecord(body.vp)) return NextResponse.json({ error: 'vp must be an object' }, { status: 400 })
    for (const [key, value] of Object.entries(body.vp)) {
      if (!isQaViewportKey(key)) return NextResponse.json({ error: `Unknown viewport ${key.slice(0, 40)}` }, { status: 400 })
      if (typeof value !== 'boolean') return NextResponse.json({ error: `vp.${key.slice(0, 40)} must be a boolean` }, { status: 400 })
      tickWrites.push({ viewport: key, ticked: value ? 1 : 0 })
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
  const viewports = parseRoundViewports(loaded.round.viewports)
  for (const w of tickWrites) {
    if (!viewports.includes(w.viewport)) {
      return NextResponse.json(
        { error: `viewport ${w.viewport} is not part of this round (it uses: ${viewports.join(', ')})` },
        { status: 400 },
      )
    }
  }

  const now = new Date().toISOString()
  // Chromium on a legacy key stays in the vp_* column; every other tick is a qa_browser_ticks row.
  const rowWrites: TickRowWrite[] = []
  for (const w of tickWrites) {
    const column = legacyTickColumn(w.viewport)
    if (column !== null && tickStoreFor(browser, w.viewport) === 'column') {
      update[column] = w.ticked
    } else {
      rowWrites.push({ roundPageId: id, browser, viewport: w.viewport, ticked: w.ticked, updatedBy: userId, updatedAt: now })
    }
  }
  update.updatedBy = userId
  update.updatedAt = now

  // The page update and every tick chunk go in one batch, so a failure never leaves a partial tick set.
  const statements: BatchItem<'sqlite'>[] = [database.update(schema.qaRoundPages).set(update).where(eq(schema.qaRoundPages.id, id))]
  for (const rows of chunk(rowWrites, TICK_UPSERT_CHUNK)) {
    statements.push(database.insert(schema.qaBrowserTicks)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.qaBrowserTicks.roundPageId, schema.qaBrowserTicks.browser, schema.qaBrowserTicks.viewport],
        set: { ticked: sql`excluded.ticked`, updatedBy: userId, updatedAt: now },
      }))
  }
  await database.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

  // This page's settled ticks. This request's row writes are laid over what was read, so the
  // answer is right even if the read raced the batch.
  const stored = await database.select().from(schema.qaBrowserTicks)
    .where(eq(schema.qaBrowserTicks.roundPageId, id))
  const written = new Set(rowWrites.map(r => `${r.browser}:${r.viewport}`))
  const tickRows = [
    ...stored.filter(r => !written.has(`${r.browser}:${r.viewport}`)),
    ...rowWrites,
  ]
  const browserTicks = mergeBrowserTicks([{ ...loaded.roundPage, ...update }], tickRows, roundBrowsers, viewports).get(id) ?? {}
  return NextResponse.json({ item: { ...loaded.roundPage, ...update, browserTicks } })
}
